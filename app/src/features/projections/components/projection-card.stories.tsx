import type { Story } from "@ladle/react";
import { ProjCard, StatusBadge } from "./projection-card";
import { mockProjections } from "../fixtures";
import { action } from "@/lib/story-utils.ts";

export default { title: "Projections / ProjCard" };

export const Default: Story = () => (
  <div className="p-4 flex gap-4 flex-wrap">
    <ProjCard
      p={mockProjections[2]}
      status={{ status: "stable", entropy: 0, blockedBy: [] }}
      onOpen={action("onOpen")}
      onReview={action("onReview")}
      onTogglePin={action("onTogglePin")}
    />
  </div>
);

export const Pinned: Story = () => (
  <div className="p-4 flex gap-4 flex-wrap">
    <ProjCard
      p={mockProjections[0]}
      status={{ status: "stable", entropy: 0, blockedBy: [] }}
      onOpen={action("onOpen")}
      onReview={action("onReview")}
      onTogglePin={action("onTogglePin")}
    />
  </div>
);

export const WithReviewCandidate: Story = () => (
  <div className="p-4 flex gap-4 flex-wrap">
    <ProjCard
      p={mockProjections[1]}
      candidateId="snap-3"
      status={{ status: "pending", entropy: 0, blockedBy: [] }}
      onOpen={action("onOpen")}
      onReview={action("onReview")}
      onTogglePin={action("onTogglePin")}
    />
  </div>
);

export const Badges: Story = () => (
  <div className="p-4 flex flex-col gap-4">
    <div>
      <p className="text-xs text-fg-3 mb-1 font-semibold">Stable</p>
      <StatusBadge info={{ status: "stable", entropy: 0, blockedBy: [] }} />
    </div>
    <div>
      <p className="text-xs text-fg-3 mb-1 font-semibold">Stale (no entropy)</p>
      <StatusBadge info={{ status: "stale", entropy: 0, blockedBy: [] }} />
    </div>
    <div>
      <p className="text-xs text-fg-3 mb-1 font-semibold">
        Stale (with 5 updates)
      </p>
      <StatusBadge info={{ status: "stale", entropy: 5, blockedBy: [] }} />
    </div>
    <div>
      <p className="text-xs text-fg-3 mb-1 font-semibold">Blocked upstream</p>
      <StatusBadge
        info={{ status: "blocked", entropy: 0, blockedBy: ["upstream-1"] }}
      />
    </div>
  </div>
);
