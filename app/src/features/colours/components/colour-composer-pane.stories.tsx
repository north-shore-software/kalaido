import type { Story } from "@ladle/react";
import { useState } from "react";
import { ColourComposerPane } from "./colour-composer-pane";
import { mockFragments } from "../fixtures";
import type { TypeFilter } from "../hooks/use-colour-preview";
import { action } from "@/lib/story-utils.ts";

export default { title: "Colours / Colour Composer Pane" };

export const Default: Story = () => {
  const [name, setName] = useState("Customer Feedback");
  const [criteria, setCriteria] = useState(
    "Looking for emails about product bugs or pricing issues.",
  );
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  return (
    <div className="border border-line rounded-lg overflow-hidden bg-background">
      <ColourComposerPane
        name={name}
        criteria={criteria}
        typeFilter={typeFilter}
        previewing={false}
        previewFragments={mockFragments}
        saving={false}
        onName={setName}
        onCriteria={setCriteria}
        onTypeFilter={setTypeFilter}
        onCancel={() => console.log("Cancel clicked")}
        onSave={() => console.log("Save clicked")}
      />
    </div>
  );
};

export const Blank: Story = () => {
  const [name, setName] = useState("");
  const [criteria, setCriteria] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  return (
    <div className="border border-line rounded-lg overflow-hidden bg-background">
      <ColourComposerPane
        name={name}
        criteria={criteria}
        typeFilter={typeFilter}
        previewing={false}
        previewFragments={[]}
        saving={false}
        onName={setName}
        onCriteria={setCriteria}
        onTypeFilter={setTypeFilter}
        onCancel={() => console.log("Cancel")}
        onSave={() => console.log("Save")}
      />
    </div>
  );
};

export const Previewing: Story = () => {
  return (
    <div className="border border-line rounded-lg overflow-hidden bg-background">
      <ColourComposerPane
        name="Urgent Bugs"
        criteria="Service crashes or major failures"
        typeFilter="all"
        previewing={true}
        previewFragments={[]}
        saving={false}
        onName={action("onName")}
        onCriteria={action("onCriteria")}
        onTypeFilter={action("onTypeFilter")}
        onCancel={action("onCancel")}
        onSave={action("onSave")}
      />
    </div>
  );
};
