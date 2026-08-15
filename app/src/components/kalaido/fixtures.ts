import type { TimelineItem } from "./timeline";

export interface MockDocument {
  title: string;
  subtitle: string;
  lines: (number | string)[];
  colours: number[];
  status:
    | "stable"
    | "drifting"
    | "critical"
    | "yellow"
    | "magenta"
    | "cyan"
    | "neutral";
  statusText: string;
}

export interface MockFragment {
  type: string;
  time: string;
  colours: number[];
  preview: string;
  rejected?: boolean;
}

export interface MockListRow {
  title: string;
  subtitle: string;
  colours: number[];
  status:
    | "stable"
    | "drifting"
    | "critical"
    | "yellow"
    | "magenta"
    | "cyan"
    | "neutral";
  statusText: string;
}

export const DOCUMENT_FIXTURES: MockDocument[] = [
  {
    title: "Q3 Product Strategy & Roadmap",
    subtitle: "Modified 2 hours ago by Louis",
    lines: ["100%", "92%", "85%", "60%"],
    colours: [1, 3, 5],
    status: "stable",
    statusText: "stable",
  },
  {
    title: "Marketing Campaign Copy Draft",
    subtitle: "Modified yesterday by Sarah",
    lines: ["95%", "90%", "45%"],
    colours: [2, 7],
    status: "drifting",
    statusText: "drifting",
  },
  {
    title: "Billing Engine Refactor Spec",
    subtitle: "Modified 3 days ago by Dev Team",
    lines: ["100%", "98%", "99%", "95%", "70%"],
    colours: [0, 4],
    status: "critical",
    statusText: "critical",
  },
  {
    title: "Onboarding flow diagrams",
    subtitle: "Modified 1 week ago by Design",
    lines: ["80%", "75%", "20%"],
    colours: [5, 6],
    status: "neutral",
    statusText: "archived",
  },
];

export const FRAGMENT_FIXTURES: MockFragment[] = [
  {
    type: "Email Inbox",
    time: "10:42 AM",
    colours: [3, 5],
    preview:
      "Let's align on the Q3 priorities this afternoon. I've attached the roadmap draft for review, please leave comments on sections 2 and 3 before our sync.",
  },
  {
    type: "WhatsApp Chat",
    time: "11:15 AM",
    colours: [1],
    preview:
      "Hey, did you see the new Kalaido preview? Looks incredibly slick and fast! The local-first reactivity feels instantaneous.",
  },
  {
    type: "Personal Notebook",
    time: "Yesterday",
    colours: [6],
    preview:
      "Remember to refactor the database schema before deploying the next migration. Double check index constraints on the partitions.",
  },
  {
    type: "Linear Issue Tracker",
    time: "June 28",
    colours: [4],
    preview:
      "Fix memory leak in the Tauri IPC channel wrapper which is causing zombie processes on window reload.",
    rejected: true,
  },
];

export const LIST_ROW_FIXTURES: MockListRow[] = [
  {
    title: "Kalaido core color palette",
    subtitle: "cmyk-semantic-palette",
    colours: [1, 2, 3, 4],
    status: "magenta",
    statusText: "magenta",
  },
  {
    title: "Secondary brand accents",
    subtitle: "warm-neutral-tones",
    colours: [5, 6, 7],
    status: "cyan",
    statusText: "cyan",
  },
  {
    title: "Legacy fallback colors",
    subtitle: "system-gray-shades",
    colours: [0],
    status: "neutral",
    statusText: "neutral",
  },
];

export const TIMELINE_TRUTH_FIXTURES: TimelineItem[] = [
  {
    id: "truth-1",
    label: "v1.0.3 - Released",
    note: "Approved automatically via CI pipeline",
    current: false,
  },
  {
    id: "truth-2",
    label: "v1.1.0 - Local Draft",
    note: "Unsaved local schema modifications in memory",
    current: true,
    active: true,
  },
  {
    id: "truth-3",
    label: "v1.1.1 - Pending Sync",
    note: "Validating against remote pocketbase constraints",
    pending: true,
  },
];

export const TIMELINE_STABLE_FIXTURES: TimelineItem[] = [
  {
    id: "stable-1",
    label: "Ingestion succeeded",
    note: "Processed 12 fresh email fragments",
  },
  {
    id: "stable-2",
    label: "Auto-clustering complete",
    note: "Generated 3 new colour-aligned categories",
  },
  {
    id: "stable-3",
    label: "Evaluation warning",
    note: "Detected drifting confidence on note classification",
  },
];
