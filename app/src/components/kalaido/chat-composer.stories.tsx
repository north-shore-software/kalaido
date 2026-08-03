import { useState } from "react";
import type { Story } from "@ladle/react";
import { ChatComposer } from "./chat-composer";
import { QUOTA_MESSAGE } from "@/api/kalaidoscope/cloud/quota";
import { action, noop } from "@/lib/story-utils.ts";

export default { title: "Kalaido / ChatComposer" };

export const Default: Story = () => {
  const [value, setValue] = useState("");
  return (
    <div className="max-w-md bg-background border border-line rounded-lg">
      <ChatComposer
        value={value}
        onChange={setValue}
        onSubmit={() => {
          console.log("Submitted:", value);
          setValue("");
        }}
      />
    </div>
  );
};

export const Disabled: Story = () => (
  <div className="max-w-md bg-background border border-line rounded-lg">
    <ChatComposer
      value=""
      onChange={noop}
      onSubmit={action("onSubmit")}
      disabled
    />
  </div>
);

export const QuotaExceeded: Story = () => (
  <div className="max-w-md bg-background border border-line rounded-lg">
    <ChatComposer
      value=""
      onChange={noop}
      onSubmit={action("onSubmit")}
      quotaMessage={QUOTA_MESSAGE}
    />
  </div>
);
