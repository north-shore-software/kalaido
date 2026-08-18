import { useState } from "react";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { defineRoute } from "@/routes/route-kit";
import { importTransitions } from "./Import.transitions";
import { openFilePicker } from "@/api/app/os-integrations.ts";
import {
  PageBody,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Label } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { classifyPath, type FileEntry } from "@/api/app/ingest-file";
import { useFileIngest } from "@/hooks/use-file-ingest";
import { ImportPreview } from "../components/import-preview";
import { FilePicker } from "../components/file-picker";
import { ImportStatus } from "../components/import-status";
import { ImportActions } from "../components/import-actions";

export default function Import() {
  const { go } = useAppNavigate();

  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pickError, setPickError] = useState("");

  const { phase, imported, errorMsg, runIngest, cancel, reset } =
    useFileIngest();
  const running = phase === "running";

  async function chooseFile() {
    const pickerResult = await openFilePicker([
      { name: "Mailbox archive", extensions: ["mbox", "eml"] },
      { name: "Text", extensions: ["txt", "md", "text"] },
      { name: "Word document", extensions: ["docx"] },
      { name: "Zip archive", extensions: ["zip"] },
      { name: "All files", extensions: ["*"] },
    ]);
    if (pickerResult.isErr()) return;
    const selected = pickerResult.value;
    if (typeof selected !== "string") return;

    setPath(selected);
    reset();
    setEntries([]);
    setPickError("");

    // Preview the contents via the Rust host's classify_path. Failing to scan
    // doesn't block the import — the whole file is uploaded regardless, and the
    // backend infers the format per file from its name.
    setScanning(true);
    const result = await classifyPath(selected);
    setScanning(false);
    if (result.isErr()) {
      setPickError("Couldn't read that file to preview it.");
      return;
    }
    setEntries(result.value);
  }

  function runImport() {
    if (!path || running) return;
    void runIngest({ path });
  }

  function importAnother() {
    reset();
    setPath("");
    setEntries([]);
    setPickError("");
  }

  return (
    <PageLayout>
      <PageHeader
        title="Import"
        description="Bring an mbox archive, a text file, a Word document, or a zip into this kalaidoscope."
        actions={
          <Button
            className="border-lime-edge bg-lime-wash text-lime-ink hover:border-lime hover:bg-lime-wash hover:text-lime-ink"
            onClick={() => go(importTransitions.backToStream)}
            disabled={running}
          >
            Back to stream
          </Button>
        }
      />
      <PageBody>
        <div className="flex max-w-2xl flex-col gap-8">
          <section className="flex flex-col gap-2">
            <Label>File</Label>
            <FilePicker path={path} disabled={running} onChoose={chooseFile} />
            {pickError && (
              <p className="text-body-sm text-fg-3">{pickError}</p>
            )}
            {path && <ImportPreview entries={entries} scanning={scanning} />}
          </section>

          <ImportStatus phase={phase} imported={imported} errorMsg={errorMsg} />

          <ImportActions
            phase={phase}
            running={running}
            onImport={runImport}
            onCancel={cancel}
            onViewStream={() => go(importTransitions.viewStream)}
            onImportAnother={importAnother}
            disabledImport={!path}
          />
        </div>
      </PageBody>
    </PageLayout>
  );
}

export const importRoute = defineRoute({
  id: "import",
  path: "/import",
  feature: "Import",
  requiredScope: ["kalaidoscope"],
  transitions: importTransitions,
  Component: Import,
});
