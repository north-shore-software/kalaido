import {
  ImportActions,
  ImportColourField,
  type ImportColourChoice,
  ImportFields,
  ImportStatus,
  isImportColourReady,
  useFileIngest,
  useImportPicker,
} from "@kalaido/features/import";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useState } from "react";
import {
  PageBody,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { desktopImportAdapter } from "../desktop-import-adapter";
import { importTransitions } from "./Import.transitions";

export default function Import() {
  const { go } = useAppNavigate();

  const { phase, imported, errorMsg, runIngest, cancel, reset } =
    useFileIngest();
  const running = phase === "running";
  const picker = useImportPicker(desktopImportAdapter, reset);
  const [colour, setColour] = useState<ImportColourChoice>({ kind: "none" });
  const colours = useLiveCollection("colour", {
    sort: "-created",
    fields: "id,name,swatch",
  });

  function runImport() {
    if (!picker.file || running) return;
    void runIngest({ file: picker.file, colour });
  }

  function importAnother() {
    reset();
    picker.clear();
    setColour({ kind: "none" });
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
          <ImportFields picker={picker} disabled={running} />
          <ImportColourField
            colours={colours.records}
            value={colour}
            onChange={setColour}
            disabled={running}
          />

          <ImportStatus phase={phase} imported={imported} errorMsg={errorMsg} />

          <ImportActions
            phase={phase}
            running={running}
            onImport={runImport}
            onCancel={cancel}
            onViewStream={() => go(importTransitions.viewStream)}
            onImportAnother={importAnother}
            disabledImport={!picker.file || !isImportColourReady(colour)}
          />
        </div>
      </PageBody>
    </PageLayout>
  );
}
