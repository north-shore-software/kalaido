import { createColour } from "@kalaido/client/kalaidoscope/colours";
import {
  type IngestStatus,
  ingestFile,
} from "@kalaido/client/kalaidoscope/ingest";
import { err, ok, type Result } from "neverthrow";
import type { ImportColourChoice, ImportRequest } from "./types";

export async function submitImport(
  req: ImportRequest,
  signal?: AbortSignal,
): Promise<Result<IngestStatus, Error>> {
  const colourId = await resolveColour(req.colour ?? { kind: "none" });
  if (colourId.isErr()) return err(colourId.error);

  const blob = await req.file.readBlob();
  if (blob.isErr()) return err(blob.error);

  return ingestFile(
    {
      file: blob.value,
      filename: req.file.filename,
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
        .map((r) => r.id)
        .mapErr((e) => new Error(e.message || "Couldn't create the colour."));
    }
  }
}
