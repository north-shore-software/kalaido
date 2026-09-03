import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { ImportActions } from "./import-actions";

export default { title: "Import / ImportActions" };

export const IdleNoPath: Story = () => (
  <div className="p-4 max-w-xl">
    <ImportActions
      phase="idle"
      running={false}
      onImport={action("onImport")}
      onCancel={action("onCancel")}
      onViewStream={action("onViewStream")}
      onImportAnother={action("onImportAnother")}
      disabledImport={true}
    />
  </div>
);

export const IdleWithPath: Story = () => (
  <div className="p-4 max-w-xl">
    <ImportActions
      phase="idle"
      running={false}
      onImport={action("onImport")}
      onCancel={action("onCancel")}
      onViewStream={action("onViewStream")}
      onImportAnother={action("onImportAnother")}
      disabledImport={false}
    />
  </div>
);

export const Running: Story = () => (
  <div className="p-4 max-w-xl">
    <ImportActions
      phase="running"
      running={true}
      onImport={action("onImport")}
      onCancel={action("onCancel")}
      onViewStream={action("onViewStream")}
      onImportAnother={action("onImportAnother")}
    />
  </div>
);

export const Done: Story = () => (
  <div className="p-4 max-w-xl">
    <ImportActions
      phase="done"
      running={false}
      onImport={action("onImport")}
      onCancel={action("onCancel")}
      onViewStream={action("onViewStream")}
      onImportAnother={action("onImportAnother")}
    />
  </div>
);
