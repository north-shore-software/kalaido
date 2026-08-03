import { JSDOM } from "jsdom";

if (typeof globalThis.window === "undefined") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;

  // Use Object.defineProperty for navigator as Node 22 defines it as a read-only getter on globalThis
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    writable: true,
    configurable: true,
  });

  g.localStorage = dom.window.localStorage;
  g.HTMLElement = dom.window.HTMLElement;
  g.CustomEvent = dom.window.CustomEvent;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  g.matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    media: "",
    dispatchEvent: () => false,
  });
  (dom.window as unknown as Record<string, unknown>).matchMedia ??=
    g.matchMedia;
}
