import type { Story } from "@ladle/react";
import { ImportStatus } from "./import-status";

export default { title: "Import / ImportStatus" };

export const Running: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportStatus phase="running" />
  </div>
);

export const DoneSingle: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportStatus phase="done" imported={1} />
  </div>
);

export const DoneMultiple: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportStatus phase="done" imported={42} />
  </div>
);

export const Cancelled: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportStatus phase="cancelled" />
  </div>
);

export const ErrorState: Story = () => (
  <div className="p-4 max-w-xl border rounded-lg bg-background">
    <ImportStatus
      phase="error"
      errorMsg="Invalid file format or corrupted archive."
    />
  </div>
);
