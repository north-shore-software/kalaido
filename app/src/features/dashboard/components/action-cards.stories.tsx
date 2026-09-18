import type { Story } from "@ladle/react";
import { CaptureFragmentCard, ImportNotesCard } from "./action-cards";

export default { title: "Dashboard / ActionCards" };

/** The first-run hero pair, before any fragments exist. */
export const Hero: Story = () => (
  <div className="grid max-w-3xl gap-4 bg-background p-6 sm:grid-cols-2">
    <CaptureFragmentCard layout="hero" onClick={() => {}} />
    <ImportNotesCard layout="hero" onClick={() => {}} />
  </div>
);

/** The compact row pair a populated dashboard shows. */
export const Row: Story = () => (
  <div className="flex max-w-3xl flex-col gap-3 bg-background p-6">
    <CaptureFragmentCard layout="row" onClick={() => {}} />
    <ImportNotesCard layout="row" onClick={() => {}} />
  </div>
);
