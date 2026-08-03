use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

/// Rolling tail of a sidecar's stdout/stderr plus a flag the supervisor
/// flips on `Terminated`. Health-probe loops in per-sidecar modules read
/// `terminated` to bail out early when the child has already exited, and
/// `tail()` to surface the last few lines as the error message.
pub(crate) struct SidecarLog {
    lines: Mutex<Vec<String>>,
    pub(crate) terminated: AtomicBool,
}

impl SidecarLog {
    pub(crate) fn new() -> Self {
        Self {
            lines: Mutex::new(Vec::new()),
            terminated: AtomicBool::new(false),
        }
    }

    pub(crate) fn push(&self, line: String) {
        let mut lines = self.lines.lock().unwrap();
        lines.push(line);
        // Keep only the tail; startup errors are what matter here.
        let len = lines.len();
        if len > 50 {
            lines.drain(0..len - 50);
        }
    }

    pub(crate) fn tail(&self) -> String {
        let lines = self.lines.lock().unwrap();
        let start = lines.len().saturating_sub(12);
        lines[start..].join("\n")
    }
}
