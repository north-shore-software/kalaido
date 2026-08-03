use std::future::Future;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent, TerminatedPayload};
use tokio::sync::Notify;
use tokio::time::sleep;

use crate::sidecar::log::SidecarLog;
use crate::sidecar::types::{SidecarHandle, SidecarInstance, SidecarStatus};

/// What `supervise` returns to the caller: the child handle (for kill), the
/// shared log buffer (for health probes / error reporting), and a Notify
/// the per-child reader task fires on `Terminated` so kill-and-wait can
/// observe a clean exit.
pub(crate) struct Supervisor {
    pub(crate) child: CommandChild,
    pub(crate) log: Arc<SidecarLog>,
    pub(crate) terminated: Arc<Notify>,
}

/// Spawns the per-child event reader: streams stdout/stderr into a rolling
/// log (with `[tag]` console prefix), flips the termination signal, and
/// invokes `on_terminated` exactly once when the process exits — whether
/// killed by us or crashed on its own. The callback is where protocol-
/// specific code emits its own "stopped"/"crashed" status event.
pub(crate) fn supervise<F>(
    mut rx: Receiver<CommandEvent>,
    child: CommandChild,
    tag: &'static str,
    capture_filter: Option<&'static str>,
    captured_lines: Arc<Mutex<Vec<String>>>,
    on_terminated: F,
) -> Supervisor
where
    F: FnOnce(TerminatedPayload) + Send + 'static,
{
    let log = Arc::new(SidecarLog::new());
    let terminated = Arc::new(Notify::new());

    let log_reader = log.clone();
    let terminated_reader = terminated.clone();
    tauri::async_runtime::spawn(async move {
        let mut on_terminated = Some(on_terminated);
        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();

        let process_line = |line: &str| {
            if let Some(filter) = capture_filter
                && line.starts_with(filter)
            {
                let value = line.strip_prefix(filter).unwrap_or("").to_string();
                captured_lines.lock().unwrap().push(value);
                return;
            }
            eprintln!("[{tag}] {line}");
            log_reader.push(line.to_string());
        };

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    stdout_buf.extend_from_slice(&bytes);
                    while let Some(i) = stdout_buf.iter().position(|&b| b == b'\n') {
                        let mut line_bytes = stdout_buf.drain(..=i).collect::<Vec<_>>();
                        line_bytes.pop();
                        if line_bytes.last() == Some(&b'\r') {
                            line_bytes.pop();
                        }
                        let line = String::from_utf8_lossy(&line_bytes);
                        process_line(&line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    stderr_buf.extend_from_slice(&bytes);
                    while let Some(i) = stderr_buf.iter().position(|&b| b == b'\n') {
                        let mut line_bytes = stderr_buf.drain(..=i).collect::<Vec<_>>();
                        line_bytes.pop();
                        if line_bytes.last() == Some(&b'\r') {
                            line_bytes.pop();
                        }
                        let line = String::from_utf8_lossy(&line_bytes);
                        process_line(&line);
                    }
                }
                CommandEvent::Error(err) => {
                    eprintln!("[{tag}] error: {err}");
                    log_reader.push(format!("error: {err}"));
                }
                CommandEvent::Terminated(payload) => {
                    if !stdout_buf.is_empty() {
                        let line = String::from_utf8_lossy(&stdout_buf);
                        process_line(&line);
                    }
                    if !stderr_buf.is_empty() {
                        let line = String::from_utf8_lossy(&stderr_buf);
                        process_line(&line);
                    }

                    eprintln!("[{tag}] terminated: {payload:?}");
                    log_reader.terminated.store(true, Ordering::SeqCst);
                    terminated_reader.notify_waiters();
                    if let Some(cb) = on_terminated.take() {
                        cb(payload);
                    }
                }
                _ => {}
            }
        }
    });

    Supervisor {
        child,
        log,
        terminated,
    }
}

pub(crate) async fn wait_for_ready<F, Fut>(log: &SidecarLog, check_fn: F) -> Result<(), String>
where
    F: Fn() -> Fut,
    Fut: Future<Output = bool>,
{
    for _ in 0..50 {
        if log.terminated.load(Ordering::SeqCst) {
            let tail = log.tail();
            return Err(if tail.is_empty() {
                "The sidecar exited during startup.".into()
            } else {
                format!("The sidecar exited during startup:\n\n{tail}")
            });
        }
        if check_fn().await {
            return Ok(());
        }
        sleep(Duration::from_millis(100)).await;
    }
    let tail = log.tail();
    Err(if tail.is_empty() {
        "Sidecar did not become ready within 5 seconds.".into()
    } else {
        format!("Sidecar did not become ready within 5 seconds:\n\n{tail}")
    })
}

fn update_and_emit_status(
    app: &AppHandle,
    status_arc: &Arc<Mutex<SidecarStatus>>,
    event_name: &str,
    status: SidecarStatus,
) {
    *status_arc.lock().unwrap() = status.clone();
    let _ = app.emit(event_name, status);
}

/// How to launch one sidecar process: which bundled binary, with what
/// arguments/environment, and which stdout prefix to divert into
/// `captured_lines` instead of the log (e.g. `KALAIDO_`).
pub(crate) struct SidecarSpec {
    pub(crate) sidecar_name: &'static str,
    pub(crate) args: Vec<String>,
    pub(crate) envs: Vec<(String, String)>,
    pub(crate) capture_filter: Option<&'static str>,
}

/// Generic sidecar spawner.
/// Emits status transitions throughout (`spawning` → `starting` → `running` on success, or
/// `failed` at any step) to the given `event_name`. Returns a SidecarInstance.
pub(crate) async fn spawn_sidecar<F, Fut>(
    app: &AppHandle,
    id: &str,
    event_name: &str,
    spec: SidecarSpec,
    health_check: F,
) -> Result<SidecarInstance, String>
where
    F: Fn(Arc<Mutex<Vec<String>>>) -> Fut + Send + 'static,
    Fut: Future<Output = bool> + Send + 'static,
{
    let SidecarSpec {
        sidecar_name,
        args,
        envs,
        capture_filter,
    } = spec;

    let status_arc = Arc::new(Mutex::new(SidecarStatus::new("spawning", Some(id), None)));
    update_and_emit_status(
        app,
        &status_arc,
        event_name,
        SidecarStatus::new("spawning", Some(id), None),
    );

    let mut command = app
        .shell()
        .sidecar(sidecar_name)
        .map_err(|e| e.to_string())?
        .args(args);

    for (k, v) in envs {
        command = command.env(k, v);
    }

    let spawn_result = command.spawn();

    let (rx, child) = match spawn_result {
        Ok(v) => v,
        Err(e) => {
            let msg = e.to_string();
            update_and_emit_status(
                app,
                &status_arc,
                event_name,
                SidecarStatus::new("failed", Some(id), Some(msg.clone())),
            );
            return Err(msg);
        }
    };

    let app_for_cb = app.clone();
    let id_for_cb = id.to_string();
    let event_name_for_cb = event_name.to_string();
    let captured_lines = Arc::new(Mutex::new(Vec::new()));
    let captured_lines_clone = captured_lines.clone();
    let status_arc_for_cb = status_arc.clone();

    let supervisor = supervise(
        rx,
        child,
        sidecar_name,
        capture_filter,
        captured_lines_clone,
        move |payload| {
            let detail = format!("exit code {:?}, signal {:?}", payload.code, payload.signal);
            let next = SidecarStatus::new("stopped", Some(&id_for_cb), Some(detail));
            update_and_emit_status(&app_for_cb, &status_arc_for_cb, &event_name_for_cb, next);
        },
    );

    let log = supervisor.log.clone();
    let handle = SidecarHandle {
        child: supervisor.child,
        terminated: supervisor.terminated,
    };

    update_and_emit_status(
        app,
        &status_arc,
        event_name,
        SidecarStatus::new("starting", Some(id), None),
    );

    let captured_lines_for_check = captured_lines.clone();
    match wait_for_ready(&log, move || health_check(captured_lines_for_check.clone())).await {
        Ok(()) => {
            let mut port = None;
            {
                let lines = captured_lines.lock().unwrap();
                for line in lines.iter() {
                    if let Some(p_str) = line.strip_prefix("PORT=")
                        && let Ok(p) = p_str.parse::<u16>()
                    {
                        port = Some(p);
                    }
                }
            }
            update_and_emit_status(
                app,
                &status_arc,
                event_name,
                SidecarStatus::with_port("running", Some(id), None, port),
            );
            Ok(SidecarInstance {
                handle,
                captured_lines,
                status: status_arc,
            })
        }
        Err(msg) => {
            update_and_emit_status(
                app,
                &status_arc,
                event_name,
                SidecarStatus::new("failed", Some(id), Some(msg.clone())),
            );
            Err(msg)
        }
    }
}
