import type { TypedPocketBase } from "@/api/kalaidoscope/types.ts";

// The client for the currently open kalaidoscope. Created by
// switchLocalKalaidoscope before the stage flips to `kalaidoscope_open`, so
// any component rendered under that stage can read it synchronously.
let activeClient: TypedPocketBase | null = null;

export function setActiveKalaidoscopeClient(client: TypedPocketBase | null) {
  activeClient = client;
}

export function getActiveKalaidoscopeClient(): TypedPocketBase | null {
  return activeClient;
}
