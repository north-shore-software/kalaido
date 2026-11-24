use crate::sidecar::types::SidecarHandle;
use std::sync::Arc;
use std::time::Duration;
use tauri_plugin_shell::process::CommandChild;
use tokio::sync::Notify;
use tokio::time::{sleep, timeout};

/// Sends `kill` to the child and waits up to 3 s for the reader task to
/// observe `Terminated`. Without this wait the next spawn races the OS
/// releasing the bound port, which manifests as "address already in use".
pub(crate) async fn stop_child(child: CommandChild, terminated: Arc<Notify>) {
    let _ = child.kill();
    let _ = timeout(Duration::from_secs(3), terminated.notified()).await;
}

/// Confirms a port is actually free by attempting a transient bind. Some
/// kernels hold the listener open briefly after process exit; retries every
/// 50 ms up to the deadline before giving up.
pub(crate) async fn wait_for_port(port: u16, max_wait: Duration) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + max_wait;
    loop {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                drop(listener);
                return Ok(());
            }
            Err(e) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!(
                        "port {port} still in use after {:?}: {e}",
                        max_wait
                    ));
                }
                sleep(Duration::from_millis(50)).await;
            }
        }
    }
}

pub(crate) async fn stop_sidecar(handle: SidecarHandle, port_to_free: Option<u16>) {
    stop_child(handle.child, handle.terminated).await;
    if let Some(port) = port_to_free {
        // Best-effort: if the kernel hasn't released the port yet, the next
        // spawn will retry. Don't fail on a slow release.
        let _ = wait_for_port(port, Duration::from_secs(2)).await;
    }
}

/// Best-effort synchronous cleanup for `RunEvent::ExitRequested`, where we
/// can't await. Just signals kill and lets the OS reap the child.
pub(crate) fn stop_sidecar_blocking(handle: SidecarHandle) {
    let _ = handle.child.kill();
}
