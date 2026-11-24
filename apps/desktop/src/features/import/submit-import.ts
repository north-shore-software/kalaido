import { createColour } from "@kalaido/client/kalaidoscope/colours";
import {
  type IngestStatus,
  ingestFile,
} from "@kalaido/client/kalaidoscope/ingest";
import { err, ok, type Result } from "neverthrow";
import { readLocalFileFromDisk } from "@/api/app/ingest-file";

export type ImportColourChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

export function isImportColourReady(choice: ImportColourChoice): boolean {
  return choice.kind !== "new" || choice.name.trim() !== "";
}

export interface ImportRequest {
  path: string;
  colour?: ImportColourChoice;
  organizeAfter?: boolean;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export async function submitImport(
  req: ImportRequest,
  signal?: AbortSignal,
): Promise<Result<IngestStatus, Error>> {
  const colourId = await resolveColour(req.colour ?? { kind: "none" });
  if (colourId.isErr()) return err(colourId.error);

  const bytes = await readLocalFileFromDisk(req.path);
  if (bytes.isErr()) return err(bytes.error);

  return ingestFile(
    {
      file: new Blob([bytes.value]),
      filename: basename(req.path),
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
