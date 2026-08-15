import type { NeedItem, PinItem, RecentFragment } from "./types";

export const mockPinItems: PinItem[] = [
  {
    id: "p1",
    kind: "projection",
    name: "Revenue Forecast Q3",
  },
  {
    id: "r1",
    kind: "reflection",
    name: "Customer Feedback Log",
  },
  {
    id: "p2",
    kind: "projection",
    name: "Server CPU Analytics",
  },
];

export const mockNeedItems: NeedItem[] = [
  {
    id: "p1",
    kind: "projection",
    name: "Revenue Forecast Q3",
    meta: "3 new fragments · 1 window due",
    action: "review",
    candidateId: "cand1",
  },
  {
    id: "r1",
    kind: "reflection",
    name: "Customer Feedback Log",
    meta: "waiting on Revenue Forecast Q3",
    action: "open",
  },
  {
    id: "r2",
    kind: "reflection",
    name: "Security Audits",
    meta: "needs refresh",
    action: "open",
  },
  {
    id: "p2",
    kind: "projection",
    name: "Server CPU Analytics",
    meta: "Revenue Forecast Q3 updated",
    action: "refresh",
  },
];

export const mockRecentFragments: RecentFragment[] = [
  {
    id: "f1",
    type: "Web Webhook",
    time: "10:15 AM",
    day: "Today",
    colours: [1, 2],
  },
  {
    id: "f2",
    type: "Database Query",
    time: "09:30 AM",
    day: "Today",
    colours: [3],
  },
  {
    id: "f3",
    type: "API Call",
    time: "05:14 PM",
    day: "Yesterday",
    colours: [4, 5, 6],
  },
  {
    id: "f4",
    type: "System Log",
    time: "11:02 AM",
    day: "Yesterday",
    colours: [],
  },
  {
    id: "f5",
    type: "Cron Job",
    time: "11:30 PM",
    day: "Last Week",
    colours: [2, 4],
  },
];
