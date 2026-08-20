import type { Story } from "@ladle/react";
import { useState } from "react";
import { ModelRadioList } from "./model-radio-list";
import { FIXTURE_MODELS_EMPTY, FIXTURE_MODELS_LIST } from "../fixtures";
import { action } from "@/lib/story-utils.ts";

export default { title: "Settings / ModelRadioList" };

export const ActiveModel: Story = () => {
  const [active, setActive] = useState("gemma3:latest");
  return (
    <div className="max-w-xl p-4 bg-background border border-line flex flex-col gap-3">
      <span className="text-label font-semibold uppercase text-fg-3">
        Active model
      </span>
      <ModelRadioList
        models={FIXTURE_MODELS_LIST}
        activeName={active}
        recommendedModelName="gemma3"
        onSelect={setActive}
      />
    </div>
  );
};

export const Empty: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <ModelRadioList
        models={FIXTURE_MODELS_EMPTY}
        activeName=""
        onSelect={action("onSelect")}
      />
    </div>
  );
};
