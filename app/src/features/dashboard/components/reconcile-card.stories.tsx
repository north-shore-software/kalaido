import type { Story } from "@ladle/react";
import { ReconcileCard } from "./reconcile-card";

export default { title: "Dashboard / ReconcileCard" };

const noop = () => {};

export const Ready: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 5,
        ready: 5,
        reflections: 0,
        newFragments: 12,
        names: [
          "Weekly digest",
          "Personas",
          "Hiring notes",
          "Launch log",
          "Q3",
        ],
      }}
      onStart={noop}
    />
  </div>
);

export const NotStarted: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 5,
        ready: 0,
        reflections: 2,
        newFragments: 12,
        names: [
          "Weekly digest",
          "Personas",
          "Hiring notes",
          "Launch log",
          "Q3",
        ],
      }}
      onStart={noop}
    />
  </div>
);

export const Preparing: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 5,
        ready: 2,
        reflections: 2,
        newFragments: 12,
        names: [
          "Weekly digest",
          "Personas",
          "Hiring notes",
          "Launch log",
          "Q3",
        ],
      }}
      running
      onStart={noop}
    />
  </div>
);

export const Failed: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 2,
        ready: 1,
        reflections: 0,
        newFragments: 3,
        names: ["Weekly digest", "Personas"],
      }}
      lastError="projection abc123: gemini: 503 overloaded"
      onStart={noop}
    />
  </div>
);

export const Starting: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 1,
        ready: 0,
        reflections: 0,
        newFragments: 1,
        names: ["Weekly digest"],
      }}
      starting
      onStart={noop}
    />
  </div>
);

export const ReflectionsOnly: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 0,
        ready: 0,
        reflections: 2,
        newFragments: 3,
        names: [],
      }}
      onStart={noop}
    />
  </div>
);

export const ReflectionsUpdating: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 0,
        ready: 0,
        reflections: 2,
        newFragments: 3,
        names: [],
      }}
      running
      onStart={noop}
    />
  </div>
);

export const CaughtUp: Story = () => (
  <div className="max-w-xl p-4">
    <ReconcileCard
      summary={{
        projections: 0,
        ready: 0,
        reflections: 0,
        newFragments: 0,
        names: [],
      }}
      onStart={noop}
    />
  </div>
);
