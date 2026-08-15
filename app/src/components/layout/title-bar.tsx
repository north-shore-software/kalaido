/**
 * Window title bar.
 *
 * The window is frameless (`titleBarStyle: "Overlay"`), so app content extends
 * up under the OS title bar region. Each pane paints its own background all the
 * way to the top edge — the sidebar over its width, the body background over the
 * rest — so this strip stays transparent and only supplies the window drag
 * handle. macOS traffic-light controls float over its left edge; it is otherwise
 * intentionally empty.
 */
export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-50 h-[var(--titlebar-height)] bg-transparent"
    />
  );
}
