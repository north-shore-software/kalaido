// Helpers for Ladle stories only. `action` logs invocations to the console so
// clicking things in a story gives visible feedback; `noop` is for callbacks
// whose invocation is uninteresting.
export const noop = () => {};
export const action =
  (name: string) =>
  (...args: unknown[]) =>
    console.log(`[action] ${name}`, ...args);
