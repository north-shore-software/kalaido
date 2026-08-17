import type { Story } from "@ladle/react";
import { useState } from "react";

import { ItemPicker, type PickerOption } from "./item-picker";
import {
  CONTEXT_WINDOW_TOKENS,
  type Contributor,
  ResolutionReadout,
} from "./resolution-readout";

export default { title: "Kalaido / ContextPicker" };

/*
 * `ContextPicker` itself resolves against a live kalaidoscope — the catalogue,
 * the fragment search and the token endpoint are all remote — so it is exercised
 * in the app rather than here. What these stories cover is the two pieces that
 * are pure functions of their props, and whose visual states are the hard part
 * to get right: the readout at each size, and the picker at each tint.
 */

const CONTRIBUTORS: Contributor[] = [
  { name: "Type: Email", tokens: 198_000 },
  { name: "Type: Slack message", tokens: 121_000 },
  { name: "Proj: Checkout PRD", tokens: 62_000 },
  { name: "Refl: Daily Standup", tokens: 31_000 },
];

/** Scale the fixture up to a given share of the window, keeping the shape. */
function at(share: number): Contributor[] {
  const total = CONTRIBUTORS.reduce((n, c) => n + c.tokens, 0);
  const factor = (CONTEXT_WINDOW_TOKENS * share) / total;
  return CONTRIBUTORS.map((c) => ({
    ...c,
    tokens: Math.round(c.tokens * factor),
  }));
}

const sum = (cs: Contributor[]) => cs.reduce((n, c) => n + c.tokens, 0);

function Readout({ share }: { share: number }) {
  const contributors = at(share);
  return (
    <div className="flex h-[420px] w-[480px] flex-col justify-end border border-line bg-surface-0">
      <ResolutionReadout
        totalTokens={sum(contributors)}
        contributors={contributors}
        fragmentCount={8214}
        sourceCount={2}
      />
    </div>
  );
}

export const ReadoutFits: Story = () => <Readout share={0.41} />;
export const ReadoutNearTheLimit: Story = () => <Readout share={0.88} />;
export const ReadoutOver: Story = () => <Readout share={1.32} />;

/** Nothing resolved yet — absent rather than zero. */
export const ReadoutUnpriced: Story = () => (
  <div className="flex h-[300px] w-[480px] flex-col justify-end border border-line bg-surface-0">
    <ResolutionReadout
      totalTokens={null}
      contributors={[]}
      fragmentCount={null}
      sourceCount={0}
    />
  </div>
);

const COLOURS: PickerOption[] = [
  { id: "1", label: "Personal", value: "#f0189c" },
  { id: "2", label: "Archived", value: "#84868a" },
  { id: "3", label: "Urgent", value: "#ff5a3c" },
  { id: "4", label: "Client work", value: "#22d3ee" },
  { id: "5", label: "Reference", value: "#f5d90a" },
];

const TYPES: PickerOption[] = [
  { id: "email", label: "Email", meta: "3,940 frags" },
  { id: "slack", label: "Slack message", meta: "2,110 frags" },
  { id: "note", label: "Note", meta: "1,220 frags" },
];

function PickerHost({
  kindLabel,
  tint,
  options,
  onAutoSegment,
}: {
  kindLabel: string;
  tint: "cyan" | "yellow" | "magenta";
  options: PickerOption[];
  onAutoSegment?: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="w-[440px] bg-surface-0 p-5">
      <ItemPicker
        kindLabel={kindLabel}
        tint={tint}
        options={options}
        onPick={(o) => setPicked(o.label)}
        onClose={() => setPicked("(closed)")}
        emptyCopy="Colours are how you filter semantically. If you haven't built any yet, let Kalaido read your material and propose a set."
        onAutoSegment={onAutoSegment}
      />
      <p className="mt-3 font-mono text-mono-sm text-fg-5">
        last action: {picked ?? "—"}
      </p>
    </div>
  );
}

export const PickerColour: Story = () => (
  <PickerHost kindLabel="Colour" tint="cyan" options={COLOURS} />
);

export const PickerType: Story = () => (
  <PickerHost kindLabel="Type" tint="cyan" options={TYPES} />
);

export const PickerSource: Story = () => (
  <PickerHost
    kindLabel="Reflection"
    tint="yellow"
    options={[
      { id: "a", label: "Daily Standup", meta: "4 windows" },
      { id: "b", label: "Weekly themes", meta: "12 windows" },
    ]}
  />
);

export const PickerFocus: Story = () => (
  <PickerHost
    kindLabel="Projection"
    tint="magenta"
    options={[{ id: "a", label: "Checkout PRD" }]}
  />
);

/** The state that matters most: no vocabulary to filter with. */
export const PickerNoColours: Story = () => (
  <PickerHost
    kindLabel="Colour"
    tint="cyan"
    options={[]}
    onAutoSegment={() => console.log("auto-segment")}
  />
);
