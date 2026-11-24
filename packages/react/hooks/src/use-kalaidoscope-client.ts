import { createContext, use } from "react";
import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";

export const KalaidoscopeClientContext = createContext<TypedPocketBase | null>(
  null,
);

export function useKalaidoscopeClient() {
  const context = use(KalaidoscopeClientContext);
  if (!context) {
    throw new Error(
      "useKalaidoscopeClient must be used within a KalaidoscopeContainer",
    );
  }
  return context;
}
