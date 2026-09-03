import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { mockTimelineItems, mockTimelineItemsWithCandidate } from "../fixtures";
import { ProjectionSideRail } from "./projection-side-rail";

export default { title: "Projections / ProjectionSideRail" };

export const UpToDate: Story = () => (
  <div className="flex h-[600px] border border-line bg-bg rounded-lg max-w-sm">
    <ProjectionSideRail
      readOnly={false}
      rotLoading={false}
      info={{ status: "stable", entropy: 0, blockedBy: [] }}
      onReviewCandidate={undefined}
      regenerating={false}
      onRefresh={action("onRefresh")}
      onBackToLive={action("onBackToLive")}
      timeline={mockTimelineItems}
    />
  </div>
);

export const Stale: Story = () => (
  <div className="flex h-[600px] border border-line bg-bg rounded-lg max-w-sm">
    <ProjectionSideRail
      readOnly={false}
      rotLoading={false}
      info={{ status: "stale", entropy: 3, blockedBy: [] }}
      onReviewCandidate={undefined}
      regenerating={false}
      onRefresh={action("onRefresh")}
      onBackToLive={action("onBackToLive")}
      timeline={mockTimelineItems}
    />
  </div>
);

export const PendingReviewCandidate: Story = () => (
  <div className="flex h-[600px] border border-line bg-bg rounded-lg max-w-sm">
    <ProjectionSideRail
      readOnly={false}
      rotLoading={false}
      info={{ status: "pending", entropy: 0, blockedBy: [] }}
      onReviewCandidate={action("onReviewCandidate")}
      regenerating={false}
      onRefresh={action("onRefresh")}
      onBackToLive={action("onBackToLive")}
      timeline={mockTimelineItemsWithCandidate}
    />
  </div>
);

export const Blocked: Story = () => (
  <div className="flex h-[600px] border border-line bg-bg rounded-lg max-w-sm">
    <ProjectionSideRail
      readOnly={false}
      rotLoading={false}
      info={{ status: "blocked", entropy: 0, blockedBy: ["upstream-1"] }}
      blockedNames={["Weekly digest"]}
      onReviewCandidate={undefined}
      regenerating={false}
      onRefresh={action("onRefresh")}
      onBackToLive={action("onBackToLive")}
      timeline={mockTimelineItems}
    />
  </div>
);

export const ReadOnlyPastSnapshot: Story = () => (
  <div className="flex h-[600px] border border-line bg-bg rounded-lg max-w-sm">
    <ProjectionSideRail
      readOnly={true}
      rotLoading={false}
      info={{ status: "stable", entropy: 0, blockedBy: [] }}
      onReviewCandidate={undefined}
      regenerating={false}
      onRefresh={action("onRefresh")}
      onBackToLive={action("onBackToLive")}
      timeline={mockTimelineItems}
    />
  </div>
);
