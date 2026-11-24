import { getCloudSessionAtom } from "@kalaido/client/cloud/auth";
import { useStore } from "better-auth/react";

export function useCloudSession() {
  const { data: session, isPending } = useStore(getCloudSessionAtom());
  return {
    session,
    user: session?.user ?? null,
    isPending,
    signedIn: !!session,
  };
}
