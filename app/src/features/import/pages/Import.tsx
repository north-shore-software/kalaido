import { useState } from "react";
import {
  PageBody,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { useCollection } from "@/hooks/use-collection";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { ImportActions } from "../components/import-actions";
import { ImportColourField } from "../components/import-colour-field";
import { ImportFields } from "../components/import-fields";
import { ImportStatus } from "../components/import-status";
import { useFileIngest } from "../hooks/use-file-ingest";
import { useImportPicker } from "../hooks/use-import-picker";
import { type ImportColourChoice, isImportColourReady } from "../submit-import";
import { importTransitions } from "./Import.transitions";

export default function Import() {
  const { go } = useAppNavigate();

  const { phase, imported, errorMsg, runIngest, cancel, reset } =
    useFileIngest();
  const running = phase === "running";
  const picker = useImportPicker(reset);
  const [colour, setColour] = useState<ImportColourChoice>({ kind: "none" });
  const colours = useCollection("colour", {
    sort: "-created",
    fields: "id,name,swatch",
  });

  function runImport() {
    if (!picker.path || running) return;
    void runIngest({ path: picker.path, colour });
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
            disabledImport={!picker.path || !isImportColourReady(colour)}
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
