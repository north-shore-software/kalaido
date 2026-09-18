import type { Story } from "@ladle/react";
import { FIXTURE_REFLECTION_ID } from "../fixtures";
import { BackfillCard } from "./backfill-card";

export default { title: "Reflections / BackfillCard" };

/** Pick a date to enable the button; running it needs a sidecar. */
export const Default: Story = () => (
  <div className="w-[360px] bg-background p-4">
    <BackfillCard reflectionId={FIXTURE_REFLECTION_ID} />
  </div>
);
