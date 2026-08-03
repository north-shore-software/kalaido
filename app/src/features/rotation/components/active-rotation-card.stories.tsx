import type { Story } from "@ladle/react";
import { ActiveRotationCard } from "./active-rotation-card";
import {
  mockActiveRotationProjection,
  mockActiveRotationProjectionGenerating,
  mockActiveRotationReflection,
} from "../fixtures";
import { action } from "@/lib/story-utils.ts";

export default { title: "Rotation / ActiveRotationCard" };

export const ProjectionWithDraft: Story = () => (
  <div className="p-4 max-w-xl">
    <ActiveRotationCard
      {...mockActiveRotationProjection}
      onSkip={action("onSkip")}
      onTweak={action("onTweak")}
      onApprove={action("onApprove")}
    />
  </div>
);

export const ProjectionGeneratingBusy: Story = () => (
  <div className="p-4 max-w-xl">
    <ActiveRotationCard
      {...mockActiveRotationProjectionGenerating}
      onSkip={action("onSkip")}
      onTweak={action("onTweak")}
      onApprove={action("onApprove")}
    />
  </div>
);

export const ReflectionWithWindows: Story = () => (
  <div className="p-4 max-w-xl">
    <ActiveRotationCard
      {...mockActiveRotationReflection}
      onSkip={action("onSkip")}
      onTweak={action("onTweak")}
      onApprove={action("onApprove")}
    />
  </div>
);
