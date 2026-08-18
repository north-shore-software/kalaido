import type { Story } from "@ladle/react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-layout";
import { EditableText } from "./editable-text.tsx";

export default { title: "Kalaido / EditableText" };

export const Inline: Story = () => {
  const [name, setName] = useState("Weekly Team Digest");
  return (
    <div className="max-w-[480px] p-6">
      <span className="text-base font-semibold">
        <EditableText value={name} onCommit={setName} />
      </span>
      <p className="mt-4 text-meta text-fg-4">
        Click the name to edit. Enter/blur commits, Escape cancels, empty
        reverts. Committed value: “{name}”
      </p>
    </div>
  );
};

export const InPageHeader: Story = () => {
  const [name, setName] = useState("Product Roadmap");
  return (
    <PageHeader
      title={name}
      crumb={["Projections", name]}
      onTitleCommit={setName}
    />
  );
};
