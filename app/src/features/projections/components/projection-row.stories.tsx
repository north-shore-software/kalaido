import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { mockProjections } from "../fixtures";
import type { SourceItem } from "../sources";
import { ProjectionRow, ProjectionTableHeader } from "./projection-row";

export default { title: "Projections / ProjectionRow" };

const colourOnly: SourceItem[] = [
  { kind: "Colour", id: "c1", label: "Business", swatch: 0 },
  { kind: "Colour", id: "c2", label: "Design system", swatch: 3 },
];

const mixed: SourceItem[] = [
  { kind: "Colour", id: "c1", label: "Business", swatch: 0 },
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

export const Table: Story = () => (
  <div data-section="projections" className="flex flex-col p-4">
    <ProjectionTableHeader />
    <ProjectionRow
      p={mockProjections[0]}
      generatedAt="2026-11-02 14:05:00.000Z"
      status={stable}
      sources={mixed}
      {...handlers}
    />
    <ProjectionRow
      p={mockProjections[1]}
      generatedAt="2026-10-28 09:30:00.000Z"
      candidateId="snap-3"
      status={{ status: "pending", entropy: 0, blockedBy: [] }}
      sources={colourOnly}
      {...handlers}
    />
    <ProjectionRow
      p={mockProjections[2]}
      generatedAt="2026-10-01 18:12:00.000Z"
      status={{ status: "stale", entropy: 12, blockedBy: [] }}
      sources={[]}
      {...handlers}
    />
    <ProjectionRow
      p={{ ...mockProjections[2], id: "proj-gen", name: "Weekly digest" }}
      status={{ status: "generating", entropy: 0, blockedBy: [] }}
      sources={colourOnly}
      {...handlers}
    />
    <ProjectionRow
      p={{ ...mockProjections[2], id: "proj-new", name: "Never generated" }}
      status={stable}
      sources={colourOnly}
      {...handlers}
    />
  </div>
);
