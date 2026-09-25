import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface UseAutoScrollOptions {
  active: boolean;
  content: unknown;
  threshold?: number;
}

export interface UseAutoScrollResult<T extends HTMLElement> {
  containerRef: RefObject<T | null>;
  onScroll: () => void;
}

export function useAutoScroll<T extends HTMLElement = HTMLDivElement>({
  active,
  content,
  threshold = 40,
}: UseAutoScrollOptions): UseAutoScrollResult<T> {
  const containerRef = useRef<T | null>(null);
  const userScrolledUp = useRef(false);
  const wasActive = useRef(false);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > threshold;
  }, [threshold]);

  useEffect(() => {
    if (active && !wasActive.current) {
      userScrolledUp.current = false;
    }
    wasActive.current = active;
  }, [active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: content is the re-run trigger — every change scrolls to the bottom unless the user scrolled up
  useEffect(() => {
    if (!active || userScrolledUp.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active, content]);

  return { containerRef, onScroll };
}
