import { err, ok, type Result } from "neverthrow";
import { createColour } from "@/api/kalaidoscope/colours";
import { type IngestStatus, ingestFile } from "@/api/kalaidoscope/ingest";

/** Where an import's fragments go: nowhere, an existing colour, or one made for it. */
export type ImportColourChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

/** A new colour needs a name before the import can go. */
export function isImportColourReady(choice: ImportColourChoice): boolean {
  return choice.kind !== "new" || choice.name.trim() !== "";
}

export interface ImportRequest {
  path: string;
  colour?: ImportColourChoice;
  /** Run the organize pipeline once the import lands. */
  organizeAfter?: boolean;
}

/**
 * The upload step every import surface shares: a new colour is created first,
 * then the file goes up tagged with it. What happens after the upload (watch
 * in place, or hand the ingest id to a navigation) is the caller's.
 */
export async function submitImport(
  req: ImportRequest,
  signal?: AbortSignal,
): Promise<Result<IngestStatus, Error>> {
  const colourId = await resolveColour(req.colour ?? { kind: "none" });
  if (colourId.isErr()) return err(colourId.error);
  return ingestFile(
    {
      path: req.path,
      organizeAfter: req.organizeAfter,
      colourId: colourId.value,
    },
    signal,
  );
}

async function resolveColour(
  choice: ImportColourChoice,
): Promise<Result<string | undefined, Error>> {
  switch (choice.kind) {
    case "none":
      return ok(undefined);
    case "existing":
      return ok(choice.id);
    case "new": {
      const res = await createColour({ name: choice.name.trim(), prompt: "" });
      return res
        .map((r) => r.colourId)
        .mapErr((e) => new Error(e.message || "Couldn't create the colour."));
    }
  }
}
