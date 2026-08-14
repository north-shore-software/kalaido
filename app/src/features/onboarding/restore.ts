import { err, ok, type Result } from "neverthrow";
import type { LlmProvider } from "@/api/kalaidoscope/llm-config";

export type RestoreInspection =
  | { kind: "ready"; suggestedName: string }
  | { kind: "collision"; existingName: string; suggestedName: string }
  | { kind: "needsKey"; provider: LlmProvider; suggestedName: string };

const STUB_BRANCH_KEY = "kalaido.restore-stub-branch";
const STUB_DELAY_MS = 500;
const STUB_BRANCHES = ["ready", "collision", "needsKey", "invalid"] as const;
type StubBranch = (typeof STUB_BRANCHES)[number];

function stubBranch(): StubBranch {
  const stored = localStorage.getItem(STUB_BRANCH_KEY);
  return STUB_BRANCHES.includes(stored as StubBranch)
    ? (stored as StubBranch)
    : "ready";
}

export function archiveDisplayName(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/\.zip$/i, "") || "Restored workspace";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function inspectWorkspaceArchive(
  filePath: string,
): Promise<Result<RestoreInspection, Error>> {
  await sleep(STUB_DELAY_MS);

  const suggestedName = archiveDisplayName(filePath);

  switch (stubBranch()) {
    case "invalid":
      return err(
        new Error(
          "Unable to restore workspace: invalid or corrupted backup file.",
        ),
      );
    case "collision":
      return ok({
        kind: "collision",
        existingName: suggestedName,
        suggestedName,
      });
    case "needsKey":
      return ok({ kind: "needsKey", provider: "gemini", suggestedName });
    default:
      return ok({ kind: "ready", suggestedName });
  }
}
