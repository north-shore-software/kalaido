import type { LoadedFragment } from "./types";

export const mockFragments: LoadedFragment[] = [
  {
    id: "f-1",
    type: "Highlight",
    time: "10:15 AM",
    day: "Today",
    colours: [1, 2],
    preview:
      "Successfully set up the new Next.js dashboard project with unified style guidelines.",
  },
  {
    id: "f-2",
    type: "Note",
    time: "09:30 AM",
    day: "Today",
    colours: [],
    preview:
      "Need to follow up with the team regarding the Tailwind vs Vanilla CSS decision. Currently leaning towards Vanilla CSS for maximum flexibility.",
  },
  {
    id: "f-3",
    type: "Quote",
    time: "04:45 PM",
    day: "Yesterday",
    colours: [3],
    preview:
      "Aesthetically pleasing designs aren't just pretty; they build immediate user trust and engagement. — Design Principles Handbook",
  },
  {
    id: "f-4",
    type: "Web Page",
    time: "11:20 AM",
    day: "Yesterday",
    colours: [4, 5],
    preview:
      "Read about CSS Nesting support in modern browsers. It's now safe to use nest structures without preprocessors in almost all targets.",
  },
  {
    id: "f-5",
    type: "Journal",
    time: "08:00 AM",
    day: "July 4, 2026",
    colours: [2],
    preview:
      "Morning reflection: Feeling incredibly productive today. The refactored components make the workspace so much cleaner and easier to navigate.",
  },
];
