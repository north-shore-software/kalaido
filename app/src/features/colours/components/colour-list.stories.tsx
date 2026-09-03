import type { Story } from "@ladle/react";
import { useState } from "react";
import { action } from "@/lib/story-utils.ts";
import { mockColours } from "../fixtures";
import { ColourList } from "./colour-list";

export default { title: "Colours / Colour List" };

export const Default: Story = () => {
  const [selectedId, setSelectedId] = useState<string | null>("col_1");
  const countMap = new Map<string, number>([
    ["col_1", 12],
    ["col_2", 3],
    ["col_3", 45],
  ]);

  return (
    <div className="border border-line rounded-lg overflow-hidden h-[400px] bg-background flex">
      <ColourList
        colours={mockColours}
        isLoading={false}
        countByColour={countMap}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </div>
  );
};

export const Loading: Story = () => {
  return (
    <div className="border border-line rounded-lg overflow-hidden h-[400px] bg-background flex">
      <ColourList
        colours={[]}
        isLoading={true}
        countByColour={new Map()}
        selectedId={null}
        onSelect={action("onSelect")}
      />
    </div>
  );
};

export const Empty: Story = () => {
  return (
    <div className="border border-line rounded-lg overflow-hidden h-[400px] bg-background flex">
      <ColourList
        colours={[]}
        isLoading={false}
        countByColour={new Map()}
        selectedId={null}
        onSelect={action("onSelect")}
      />
    </div>
  );
};
