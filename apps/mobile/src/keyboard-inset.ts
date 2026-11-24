export function installKeyboardInset(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const update = () => {
    const inset = Math.max(0, window.innerHeight - viewport.height);
    const style = document.documentElement.style;
    style.setProperty("--keyboard-inset", `${inset}px`);
    style.setProperty("--keyboard-offset", `${viewport.offsetTop}px`);
  };

  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
}
