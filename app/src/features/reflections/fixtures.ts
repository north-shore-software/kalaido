import type { TimelineItem } from "@/components/kalaido";
import {
  TIMELINE_STABLE_FIXTURES,
  TIMELINE_TRUTH_FIXTURES,
} from "@/components/kalaido/fixtures.ts";

export const SCHEDULE_FIXTURE_1 = {
  freq: 2, // Weekly
  win: 2, // 7 days
};

export const SCHEDULE_FIXTURE_2 = {
  freq: 1, // Daily
  win: 1, // 24h
};

export const FIXTURE_REFLECTION_ID = "refl_12345";

export const FIXTURE_SCHED_DISPLAY_LIVE = {
  freq: "Weekly",
  win: "7 days",
  scheduled: true,
};

export const FIXTURE_SCHED_DISPLAY_MANUAL = {
  freq: "manual",
  win: "all time",
  scheduled: false,
};

export const FIXTURE_CONTENT_1 = `### Weekly Reflection — Jul 6, 2026

- **Velocity**: Shippable features and refactoring tasks went smoothly.
- **Highlights**:
  - Decomposed projections into pure components and container patterns.
  - Successfully verified ladle build and main bundle size.
- **Blockers**: None reported. Looking forward to the next steps.`;

export const FIXTURE_CONTENT_2 = `### Daily Reflection — Jul 5, 2026

- **Focus**: Pure component extraction.
- **Highlights**:
  - Created ScheduleChips and SchedulePill.
  - Integrated into the details panel and authoring page.`;

// The shared truth fixtures include a pending item; these fixtures lead with
// their own pending state (or none), so keep only settled versions from them.
const settledTimeline = TIMELINE_TRUTH_FIXTURES.filter((item) => !item.pending);

export const FIXTURE_TIMELINE_FEW: TimelineItem[] = settledTimeline.map(
  (item) => ({
    ...item,
    onClick: () => {},
  }),
);

export const FIXTURE_TIMELINE_MANY: TimelineItem[] = [
  {
    id: "pending-candidate",
    label: "Pending candidate",
    note: "Jul 1, 2026 - Jul 6, 2026",
    current: false,
    pending: true,
    active: false,
    onClick: () => {},
  },
  ...settledTimeline.map((item) => ({ ...item, onClick: () => {} })),
  ...TIMELINE_STABLE_FIXTURES.map((item) => ({ ...item, onClick: () => {} })),
];
