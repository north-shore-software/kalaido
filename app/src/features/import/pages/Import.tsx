import { Label } from "@/components/kalaido";
import {
  PageBody,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { useFileIngest } from "@/hooks/use-file-ingest";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { FilePicker } from "../components/file-picker";
import { ImportActions } from "../components/import-actions";
import { ImportPreview } from "../components/import-preview";
import { ImportStatus } from "../components/import-status";
import { useImportPicker } from "../hooks/use-import-picker";
import { importTransitions } from "./Import.transitions";

export default function Import() {
  const { go } = useAppNavigate();

  const { phase, imported, errorMsg, runIngest, cancel, reset } =
    useFileIngest();
  const running = phase === "running";
  const { path, entries, scanning, pickError, chooseFile, clear } =
    useImportPicker(reset);

  function runImport() {
    if (!path || running) return;
    void runIngest({ path });
  }

  function importAnother() {
    reset();
    clear();
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
            {pickError && <p className="text-body-sm text-fg-3">{pickError}</p>}
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
