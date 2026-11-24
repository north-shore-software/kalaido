import {
  type AuthOutcome,
  CloudAuthPanel as BaseCloudAuthPanel,
  type CloudAuthPanelProps,
} from "@kalaido/components/auth/cloud-auth-panel";
import { syncCloudWorkspaces } from "@/lib/cloud-workspaces";

export type { AuthOutcome };

export function CloudAuthPanel(
  props: Omit<CloudAuthPanelProps, "onSyncWorkspaces">,
) {
  return (
    <BaseCloudAuthPanel {...props} onSyncWorkspaces={syncCloudWorkspaces} />
  );
}
