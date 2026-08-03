import type { Story } from "@ladle/react";
import { ImportPreview } from "./import-preview";
import type { FileEntry } from "@/api/app/ingest-file";

export default { title: "Import / ImportPreview" };

const mockEntries: FileEntry[] = [
  { path: "notes/intro.txt", kind: "text" },
  { path: "documents/specification.docx", kind: "docx" },
  { path: "images/logo.png", kind: "other" },
  { path: "notes/outline.md", kind: "text" },
  { path: "unsupported_file.exe", kind: "other" },
];

export const Scanning: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportPreview entries={[]} scanning={true} />
  </div>
);

export const Empty: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportPreview entries={[]} scanning={false} />
  </div>
);

export const WithEntries: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportPreview entries={mockEntries} scanning={false} />
  </div>
);
