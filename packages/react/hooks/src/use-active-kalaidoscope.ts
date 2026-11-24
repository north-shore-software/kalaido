import type { KalaidoscopeMeta } from "@kalaido/platform";
import { createContext, useContext } from "react";

export const ActiveKalaidoscopeContext =
  createContext<Readonly<KalaidoscopeMeta> | null>(null);

export function useActiveKalaidoscope(): Readonly<KalaidoscopeMeta> | null {
  return useContext(ActiveKalaidoscopeContext);
}
