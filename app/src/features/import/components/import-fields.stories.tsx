import type { Story } from "@ladle/react";
import type { FileEntry } from "@/api/app/ingest-file";
import type { ImportPicker } from "../hooks/use-import-picker";
import { ImportFields } from "./import-fields";

export default { title: "Import / ImportFields" };

const entries: FileEntry[] = [
  { path: "notes/intro.txt", kind: "text" },
  { path: "documents/specification.docx", kind: "docx" },
  { path: "images/logo.png", kind: "other" },
];

/** A picker in a given state; choosing needs the host's file dialog. */
function picker(overrides: Partial<ImportPicker> = {}): ImportPicker {
  return {
    path: "",
    entries: [],
    scanning: false,
    pickError: "",
    chooseFile: async () => {},
    clear: () => {},
    ...overrides,
  };
}

const wrap = "w-[540px] bg-background p-4";

export const Empty: Story = () => (
  <div className={wrap}>
    <ImportFields picker={picker()} />
  </div>
);

export const Scanning: Story = () => (
  <div className={wrap}>
    <ImportFields
      picker={picker({ path: "/Users/louis/notes.zip", scanning: true })}
    />
  </div>
);

export const WithFile: Story = () => (
  <div className={wrap}>
    <ImportFields
      picker={picker({ path: "/Users/louis/notes.zip", entries })}
    />
  </div>
);

export const WithError: Story = () => (
  <div className={wrap}>
    <ImportFields
      picker={picker({
        path: "/Users/louis/notes.zip",
        pickError: "Couldn't read that file to preview it.",
      })}
    />
  </div>
);

export const Disabled: Story = () => (
  <div className={wrap}>
    <ImportFields
      picker={picker({ path: "/Users/louis/notes.zip" })}
      disabled
    />
  </div>
);
