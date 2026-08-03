import type { Story } from "@ladle/react";
import { SnapshotPreview } from "./snapshot-preview";
import { mockMarkdownContent1, mockSnapshots } from "../fixtures";

export default { title: "Projections / SnapshotPreview" };

export const Ready: Story = () => (
  <div className="p-4 bg-bg border border-line rounded-lg h-[400px] flex">
    <SnapshotPreview
      state={{
        status: "ready",
        current: mockSnapshots[1],
        output: { content: mockMarkdownContent1 },
      }}
      awaitingDraftResume={false}
      readOnly={false}
      historical={undefined}
      historicalContent={undefined}
      historicalLoading={false}
      historicalVersion={undefined}
    />
  </div>
);

export const Loading: Story = () => (
  <div className="p-4 bg-bg border border-line rounded-lg h-[400px] flex">
    <SnapshotPreview
      state={{
        status: "loading",
      }}
      awaitingDraftResume={false}
      readOnly={false}
      historical={undefined}
      historicalContent={undefined}
      historicalLoading={false}
      historicalVersion={undefined}
    />
  </div>
);

export const Empty: Story = () => (
  <div className="p-4 bg-bg border border-line rounded-lg h-[400px] flex">
    <SnapshotPreview
      state={{
        status: "empty",
      }}
      awaitingDraftResume={false}
      readOnly={false}
      historical={undefined}
      historicalContent={undefined}
      historicalLoading={false}
      historicalVersion={undefined}
    />
  </div>
);

export const ErrorState: Story = () => (
  <div className="p-4 bg-bg border border-line rounded-lg h-[400px] flex">
    <SnapshotPreview
      state={{
        status: "error",
        error: new Error("Network connection dropped"),
      }}
      awaitingDraftResume={false}
      readOnly={false}
      historical={undefined}
      historicalContent={undefined}
      historicalLoading={false}
      historicalVersion={undefined}
    />
  </div>
);

export const ReadOnlyPastSnapshot: Story = () => (
  <div className="p-4 bg-bg border border-line rounded-lg h-[400px] flex">
    <SnapshotPreview
      state={{
        status: "ready",
        current: mockSnapshots[0],
        output: { content: mockMarkdownContent1 },
      }}
      awaitingDraftResume={false}
      readOnly={true}
      historical={mockSnapshots[0]}
      historicalContent={mockMarkdownContent1}
      historicalLoading={false}
      historicalVersion={1}
    />
  </div>
);
