import type { Story } from "@ladle/react";
import type { BackupSummary } from "@/api/kalaidoscope/backups";
import { WorkspaceBackupsView } from "./workspace-backups-panel";

export default { title: "Settings / WorkspaceBackupsPanel" };

const mockBackups: BackupSummary[] = [
  {
    id: "manual-20261001T215056Z.zip",
    kind: "manual",
    created_at: "2026-10-01T21:50:56.000Z",
    size_bytes: 524288,
  },
  {
    id: "scheduled-20261001T120000Z.zip",
    kind: "scheduled",
    created_at: "2026-10-01T12:00:00.000Z",
    size_bytes: 2097152,
  },
  {
    id: "pre-restore-20261001T083000Z.zip",
    kind: "pre-restore",
    created_at: "2026-10-01T08:30:00.000Z",
    size_bytes: 1048576,
  },
];

export const Empty: Story = () => (
  <div className="max-w-2xl bg-background p-6">
    <WorkspaceBackupsView
      backups={[]}
      loading={false}
      busy={false}
      error={null}
      onBackUp={() => {}}
      onRestore={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
    />
  </div>
);

export const WithBackups: Story = () => (
  <div className="max-w-2xl bg-background p-6">
    <WorkspaceBackupsView
      backups={mockBackups}
      loading={false}
      busy={false}
      error={null}
      onBackUp={() => {}}
      onRestore={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
    />
  </div>
);

export const Busy: Story = () => (
  <div className="max-w-2xl bg-background p-6">
    <WorkspaceBackupsView
      backups={mockBackups}
      loading={false}
      busy={true}
      error={null}
      onBackUp={() => {}}
      onRestore={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
    />
  </div>
);
