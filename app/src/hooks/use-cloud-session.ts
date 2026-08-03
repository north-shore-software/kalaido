import { authClient } from "@/api/cloud/auth.ts";

export function useCloudSession() {
  const { data: session, isPending } = authClient.useSession();
  return {
    session,
    user: session?.user ?? null,
    isPending,
    signedIn: !!session,
  };
}
