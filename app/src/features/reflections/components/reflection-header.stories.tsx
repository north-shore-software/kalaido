import type { Story } from "@ladle/react";
import {
  FIXTURE_REFLECTION_ID,
  FIXTURE_SCHED_DISPLAY_LIVE,
  FIXTURE_SCHED_DISPLAY_MANUAL,
} from "../fixtures";
import { ReflectionHeader } from "./reflection-header";

export default { title: "Reflections / ReflectionHeader" };

export const Default: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionHeader
        reflectionId={FIXTURE_REFLECTION_ID}
        name="Team Performance Reflection"
        schedDisplay={FIXTURE_SCHED_DISPLAY_LIVE}
      />
    </div>
  );
};

export const ReadOnly: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionHeader
        reflectionId={FIXTURE_REFLECTION_ID}
        name="Manual Sprint Reflection"
        schedDisplay={FIXTURE_SCHED_DISPLAY_MANUAL}
      />
    </div>
  );
};
