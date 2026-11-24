import type { HostAdapter } from "@kalaido/platform";
import { createContext, type ReactNode, useContext } from "react";

const HostContext = createContext<HostAdapter | null>(null);

export function HostProvider({
  host,
  children,
}: {
  host: HostAdapter;
  children: ReactNode;
}) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useHost(): HostAdapter {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error("useHost must be used within a HostProvider");
  }
  return host;
}
