import { type ReactNode, useState } from "react";
import { type Cache, SWRConfig } from "swr";

export interface LiveCacheProviderProps {
  readonly dedupingInterval?: number;
  readonly children: ReactNode;
}

/**
 * Provides an isolated live-read cache for its subtree (e.g. in tests so
 * `useLiveRead` calls do not share state or deduping windows with other trees).
 */
export function LiveCacheProvider({
  dedupingInterval,
  children,
}: LiveCacheProviderProps) {
  const [cache] = useState<Cache>(() => new Map());
  return (
    <SWRConfig
      value={{
        provider: () => cache,
        ...(dedupingInterval !== undefined ? { dedupingInterval } : {}),
      }}
    >
      {children}
    </SWRConfig>
  );
}
