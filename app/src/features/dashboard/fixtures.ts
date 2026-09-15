import type { PinItem, RecentFragment } from "./types";

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

export const mockRecentFragments: RecentFragment[] = [
  {
    id: "f1",
    type: "Web Webhook",
    title: "Stripe webhook payment received",
    time: "10:15 AM",
    day: "Today",
    colours: [1, 2],
  },
  {
    id: "f2",
    type: "Database Query",
    title: "Quarterly revenue rollup query",
    time: "09:30 AM",
    day: "Today",
    colours: [3],
  },
  {
    id: "f3",
    type: "API Call",
    title: "Customer sync endpoint response",
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
    title: "Nightly backup verification job",
    time: "11:30 PM",
    day: "Last Week",
    colours: [2, 4],
  },
];
