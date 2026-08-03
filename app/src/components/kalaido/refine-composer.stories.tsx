import type { Story } from "@ladle/react";
import { useState } from "react";
import { RefineComposer } from "./refine-composer.tsx";
import { action } from "@/lib/story-utils.ts";

export default { title: "Kalaido / RefineComposer" };

export const Default: Story = () => {
  const [val, setVal] = useState("");
  return (
    <div className="w-[340px] border border-line bg-card p-4">
      <RefineComposer
        title="Define via chat"
        helperText="Describe the view you want. Your first message creates the projection and starts generating a draft."
        placeholder="‘A live PRD for the checkout redesign’…"
        value={val}
        onChange={setVal}
        onSubmit={() => alert(`Submitted: ${val}`)}
      />
    </div>
  );
};

export const Busy: Story = () => {
  const [val, setVal] = useState("A busy composer value");
  return (
    <div className="w-[340px] border border-line bg-card p-4">
      <RefineComposer
        title="Define via chat"
        helperText="Describe the view you want. Your first message creates the projection and starts generating a draft."
        placeholder="‘A live PRD for the checkout redesign’…"
        value={val}
        onChange={setVal}
        onSubmit={action("onSubmit")}
        busy
      />
    </div>
  );
};

export const Disabled: Story = () => {
  const [val, setVal] = useState("");
  return (
    <div className="w-[340px] border border-line bg-card p-4">
      <RefineComposer
        title="Define via chat"
        helperText="Describe the view you want. Your first message creates the projection and starts generating a draft."
        placeholder="‘A live PRD for the checkout redesign’…"
        value={val}
        onChange={setVal}
        onSubmit={action("onSubmit")}
        disabled
      />
    </div>
  );
};

export const PreparingState: Story = () => {
  return (
    <div className="w-[340px] border border-line bg-card p-4">
      <RefineComposer preparing />
    </div>
  );
};
