import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import { ProjCard, StatusBadge } from "./projection-card";
import { mockProjections } from "../fixtures";
import type { SourceItem } from "../sources";
import { action } from "@/lib/story-utils.ts";

export default { title: "Projections / ProjCard" };

const brief =
  "Lay out the overall commercial strategy, building on the projection 'Pricing model' for the pricing decision and the projection 'Acquisition hooks' for the lead-magnet analysis — reference them rather than restating them.";

const colourOnly: SourceItem[] = [
  { kind: "Colour", id: "c1", label: "Business", value: "#fda4af" },
  { kind: "Colour", id: "c2", label: "Design system", value: "#10b981" },
];

const mixed: SourceItem[] = [
  { kind: "Colour", id: "c1", label: "Business", value: "#fda4af" },
  { kind: "Projection", id: "p1", label: "Pricing model" },
  { kind: "Projection", id: "p2", label: "Acquisition hooks" },
  { kind: "Reflection", id: "r1", label: "Weekly standups" },
];

const handlers = {
  onOpen: action("onOpen"),
  onReview: action("onReview"),
  onTogglePin: action("onTogglePin"),
};

const stable = { status: "stable" as const, entropy: 0, blockedBy: [] };

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-section="projections" className="flex flex-wrap gap-3 p-4">
      {children}
    </div>
  );
}

export const Default: Story = () => (
  <Frame>
    <ProjCard
      p={mockProjections[2]}
      status={stable}
      brief={brief}
      sources={colourOnly}
      {...handlers}
    />
  </Frame>
);

export const WithSources: Story = () => (
  <Frame>
    <ProjCard
      p={mockProjections[0]}
      status={stable}
      brief={brief}
      sources={mixed}
      {...handlers}
    />
  </Frame>
);

export const WholeScope: Story = () => (
  <Frame>
    <ProjCard
      p={mockProjections[2]}
      status={stable}
      brief={brief}
      sources={[]}
      {...handlers}
    />
  </Frame>
);

export const NoBrief: Story = () => (
  <Frame>
    <ProjCard
      p={mockProjections[2]}
      status={stable}
      brief=""
      sources={colourOnly}
      {...handlers}
    />
  </Frame>
);

export const Pinned: Story = () => (
  <Frame>
    <ProjCard
      p={mockProjections[0]}
      status={stable}
      brief={brief}
      sources={colourOnly}
      {...handlers}
    />
  </Frame>
);

export const WithReviewCandidate: Story = () => (
  <Frame>
    <ProjCard
      p={mockProjections[1]}
      candidateId="snap-3"
      status={{ status: "pending", entropy: 0, blockedBy: [] }}
      brief={brief}
      sources={mixed}
      {...handlers}
    />
  </Frame>
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
