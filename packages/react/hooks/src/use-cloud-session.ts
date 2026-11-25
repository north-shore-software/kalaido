import { getAuthClient, getCloudSessionAtom } from "@kalaido/client/cloud/auth";
import { atomLiveSource, useLiveRead } from "@kalaido/state/live";
import { ok } from "neverthrow";

export const CLOUD_SESSION_TAG = "cloud:session";
export const CLOUD_SESSION_KEY = ["cloud", "session"] as const;

export function useCloudSession() {
  const atom = getCloudSessionAtom();
  const { data } = useLiveRead(
    atomLiveSource({
      key: CLOUD_SESSION_KEY,
      tags: [CLOUD_SESSION_TAG],
      subscribeKey: atom,
      read: () => atom.get(),
      subscribe: (listener) => atom.subscribe(listener),
      refetch: async () => {
        await getAuthClient().getSession();
        return ok(atom.get());
      },
    }),
  );

  const snapshot = data ?? atom.get();
  const session = snapshot.data;
  return {
    session,
    user: session?.user ?? null,
    isPending: snapshot.isPending,
    signedIn: !!session,
  };
}
