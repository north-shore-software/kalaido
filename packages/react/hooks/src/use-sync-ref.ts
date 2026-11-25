import { type RefObject, useLayoutEffect } from "react";

/** Synchronizes a ref's `.current` to the latest committed value after render. */
export function useSyncRef<T>(ref: RefObject<T>, value: T): void {
  useLayoutEffect(() => {
    ref.current = value;
  });
}
