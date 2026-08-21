import type { UIMessage } from "ai";
import type {
  ProjectionResponse,
  ProjectionSnapshotResponse,
} from "@/api/kalaidoscope/types";
import { Collections, type IsoAutoDateString } from "@/api/kalaidoscope/types";
import type { TimelineItem } from "@/components/kalaido";
import { TIMELINE_TRUTH_FIXTURES } from "@/components/kalaido/fixtures.ts";
import type { RefineSession } from "@/hooks/use-refine-session";

export const mockMarkdownContent1 = `# Product Roadmap Q3

## Executive Summary
This document outlines the product roadmap for Q3 2026, focused on modernizing our dashboard component architecture, introducing projection lists, and delivering premium web design capabilities.

---

## Phase 1: Foundation
- Define styling tokens and vanilla CSS guidelines.
- Standardize on Ladle for component stories.
- Verify building pipelines.

---

## Phase 2: Refactoring
- Lift useNavigate out of features.
- Storyfy existing components.`;

export const mockMarkdownContent2 = `# Marketing Launch Plan - Kalaidoscope

## Goal
Successfully announce the launch of Kalaidoscope to our developer community.

---

## Deliverables
1. Product Hunt launch page.
2. Twitter announcement thread.
3. Tech blog post outlining the architecture.`;

export const mockProjections: ProjectionResponse[] = [
  {
    id: "proj-1",
    collectionId: "col-proj-1",
    collectionName: Collections.Projection,
    name: "Marketing Launch Plan",
    brief: "Marketing launch plan for Kalaidoscope.",
    pinned_by: "user-1",
    current_context_spec: null,
    current_lens_id: "lens-1",
    last_provider_error_kind: "",
    model: "",
    origin_run_id: "",
    created: "2026-07-06T09:00:00.000Z" as IsoAutoDateString,
    updated: "2026-07-06T10:00:00.000Z" as IsoAutoDateString,
  },
  {
    id: "proj-2",
    collectionId: "col-proj-2",
    collectionName: Collections.Projection,
    name: "Product Roadmap Q3",
    brief: "Product roadmap outlining Q3 2026 priorities.",
    pinned_by: "",
    current_context_spec: null,
    current_lens_id: "lens-2",
    last_provider_error_kind: "",
    model: "",
    origin_run_id: "",
    created: "2026-07-06T09:10:00.000Z" as IsoAutoDateString,
    updated: "2026-07-06T10:15:00.000Z" as IsoAutoDateString,
  },
  {
    id: "proj-3",
    collectionId: "col-proj-3",
    collectionName: Collections.Projection,
    name: "API Design Guidelines",
    brief: "API design guidelines and conventions.",
    pinned_by: "",
    current_context_spec: null,
    current_lens_id: "lens-3",
    last_provider_error_kind: "",
    model: "",
    origin_run_id: "",
    created: "2026-07-06T09:20:00.000Z" as IsoAutoDateString,
    updated: "2026-07-06T10:20:00.000Z" as IsoAutoDateString,
  },
];

export const mockSnapshots: ProjectionSnapshotResponse[] = [
  {
    id: "snap-1",
    collectionId: "col-snap-1",
    collectionName: Collections.ProjectionSnapshot,
    projection_id: "proj-1",
    context_spec: null,
    lens_id: "lens-1",
    model: "gemma4",
    chain_origin: "",
    created_from_refinement_id: "",
    lens_distill_requested: false,
    output: { content: mockMarkdownContent2 },
    resolved_context: null,
    status: "live",
    approval_sequence_number: 1,
    approval_timestamp: "2026-07-06T10:00:00.000Z" as IsoAutoDateString,
    generation_timestamp: "2026-07-06T10:00:00.000Z" as IsoAutoDateString,
    created: "2026-07-06T10:00:00.000Z" as IsoAutoDateString,
    updated: "2026-07-06T10:00:00.000Z" as IsoAutoDateString,
  },
  {
    id: "snap-2",
    collectionId: "col-snap-2",
    collectionName: Collections.ProjectionSnapshot,
    projection_id: "proj-2",
    context_spec: null,
    lens_id: "lens-2",
    model: "gemma4",
    chain_origin: "",
    created_from_refinement_id: "",
    lens_distill_requested: false,
    output: { content: mockMarkdownContent1 },
    resolved_context: null,
    status: "live",
    approval_sequence_number: 1,
    approval_timestamp: "2026-07-06T10:15:00.000Z" as IsoAutoDateString,
    generation_timestamp: "2026-07-06T10:15:00.000Z" as IsoAutoDateString,
    created: "2026-07-06T10:15:00.000Z" as IsoAutoDateString,
    updated: "2026-07-06T10:15:00.000Z" as IsoAutoDateString,
  },
  {
    id: "snap-3",
    collectionId: "col-snap-3",
    collectionName: Collections.ProjectionSnapshot,
    projection_id: "proj-2",
    context_spec: null,
    lens_id: "lens-2",
    model: "gemma4",
    chain_origin: "",
    created_from_refinement_id: "",
    lens_distill_requested: false,
    output: { content: `${mockMarkdownContent1}\n- Review updates added.` },
    resolved_context: null,
    status: "pending",
    approval_sequence_number: 0,
    approval_timestamp: "" as IsoAutoDateString,
    generation_timestamp: "2026-07-06T10:20:00.000Z" as IsoAutoDateString,
    created: "2026-07-06T10:20:00.000Z" as IsoAutoDateString,
    updated: "2026-07-06T10:20:00.000Z" as IsoAutoDateString,
  },
];

// The shared truth fixtures include a pending item; this fixture represents
// "no candidate", so keep only settled versions.
export const mockTimelineItems = TIMELINE_TRUTH_FIXTURES.filter(
  (item) => !item.pending,
);

export const mockTimelineItemsWithCandidate: TimelineItem[] = [
  {
    id: "v2-candidate",
    label: "v2 · candidate",
    note: "Just now",
    current: false,
    pending: true,
    active: false,
  },
  ...mockTimelineItems,
];

const mockMessages: UIMessage[] = [
  {
    id: "msg-1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Make a product roadmap with phase 1 and phase 2.",
      },
    ],
  },
  {
    id: "msg-2",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `Here is a first draft: \n\`\`\`\n${mockMarkdownContent1}\n\`\`\``,
      },
    ],
  },
];

export const mockSession: RefineSession = {
  clientId: "client-123",
  refinementId: "ref-123",
  firstPrompt: "Make a product roadmap",
  initialMessages: mockMessages,
  messages: mockMessages,
  onMessagesChange: () => {},
  preview: mockMarkdownContent1,
  suggestedName: "Product Roadmap",
  started: true,
  creating: false,
  committing: false,
  start: async () => true,
  resume: () => {},
  reset: () => {},
  commit: async () => true,
};

export const mockSessionEmpty: RefineSession = {
  ...mockSession,
  preview: "",
  messages: [],
  started: false,
};

export const mockSessionCommitting: RefineSession = {
  ...mockSession,
  committing: true,
};

export const mockSnapshotContentCurrent = `# Dashboard Overview
This is the current approved snapshot of our system dashboard.
It shows active streams, projection statuses, and basic metrics.`;

export const mockSnapshotContentPending = `# Dashboard Overview (Refined)
This is the new pending draft.
- Added real-time streaming metrics.
- Added rotation status indicators.
- Refactored UI layouts.`;
