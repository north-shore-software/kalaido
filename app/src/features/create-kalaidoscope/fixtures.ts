import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { appState } from "@/hooks/use-app-state.ts";

export const mockKalaidoscopes: KalaidoscopeMeta[] = [
  {
    id: "k-personal",
    type: "local_file",
    locator: "/Users/louis/kalaidoscopes/personal",
    displayName: "Personal Journal",
    icon: "BookOpenIcon",
  },
  {
    id: "k-research",
    type: "local_file",
    locator: "/Users/louis/kalaidoscopes/research",
    displayName: "Research Notes",
  },
  {
    id: "k-team",
    type: "cloud",
    locator: "north-shore/team",
    displayName: "Team Workspace",
    icon: "UsersIcon",
  },
];

/**
 * Put the shell store in a known state for a story or test: these
 * kalaidoscopes are available, and `openId` (if given) is the open one.
 * `appState` is a module singleton, so this is the whole setup.
 */
export function seedKalaidoscopes(
  kalaidoscopes: KalaidoscopeMeta[] = mockKalaidoscopes,
  openId?: string,
) {
  appState.availableKalaidoscopes = kalaidoscopes;
  appState.appStage = openId
    ? { stage: "kalaidoscope_open", selectedKalaidoscopeId: openId }
    : { stage: "no_kalaidoscopes_available" };
}
