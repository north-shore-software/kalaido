import type { Story } from "@ladle/react";
import { ReflectionHeader } from "./reflection-header";
import {
  FIXTURE_REFLECTION_ID,
  FIXTURE_SCHED_DISPLAY_LIVE,
  FIXTURE_SCHED_DISPLAY_MANUAL,
} from "../fixtures";

export default { title: "Reflections / ReflectionHeader" };

export const Default: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionHeader
        reflectionId={FIXTURE_REFLECTION_ID}
        name="Team Performance Reflection"
        schedDisplay={FIXTURE_SCHED_DISPLAY_LIVE}
        readOnly={false}
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
        readOnly={true}
      />
    </div>
  );
};
