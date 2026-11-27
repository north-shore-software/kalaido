export function installKeyboardInset(): void {
  const viewport = window.visualViewport;
  let baseInnerHeight = window.innerHeight;
  let lastInnerWidth = window.innerWidth;

  const update = () => {
    const root = document.documentElement;
    if (window.innerWidth !== lastInnerWidth) {
      lastInnerWidth = window.innerWidth;
      baseInnerHeight = window.innerHeight;
    }

    const androidIme = Number.parseFloat(root.dataset.androidIme ?? "0") || 0;
    if (androidIme <= 0) {
      baseInnerHeight = window.innerHeight;
    }

    const visualInset = viewport
      ? Math.max(0, window.innerHeight - viewport.height)
      : 0;
    const alreadyShrunk = Math.max(0, baseInnerHeight - window.innerHeight);
    const fallbackIme =
      androidIme > 0 ? Math.max(0, androidIme - alreadyShrunk) : 0;
    const inset = Math.max(visualInset, fallbackIme);

    root.style.setProperty("--keyboard-inset", `${inset}px`);
    root.style.setProperty(
      "--keyboard-offset",
      `${viewport ? viewport.offsetTop : 0}px`,
    );
  };

  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  window.addEventListener("kalaido:insets", update);
  update();
}
