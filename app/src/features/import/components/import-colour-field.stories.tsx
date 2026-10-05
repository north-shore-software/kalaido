import type { Story } from "@ladle/react";
import { useState } from "react";
import type { ImportColourChoice } from "../submit-import";
import {
  ImportColourField,
  type ImportColourOption,
} from "./import-colour-field";

export default { title: "Import / ImportColourField" };

const colours: ImportColourOption[] = [
  { id: "col_1", name: "Customer feedback", swatch: 0 },
  { id: "col_2", name: "Incidents", swatch: 3 },
];

const wrap = "w-[540px] bg-background p-4";

function Field({ initial }: { initial: ImportColourChoice }) {
  const [value, setValue] = useState(initial);
  return (
    <div className={wrap}>
      <ImportColourField colours={colours} value={value} onChange={setValue} />
    </div>
  );
}

export const None: Story = () => <Field initial={{ kind: "none" }} />;

export const Existing: Story = () => (
  <Field initial={{ kind: "existing", id: "col_2" }} />
);

/** "New colour…" reveals the name field; the import waits for a name. */
export const NewColour: Story = () => (
  <Field initial={{ kind: "new", name: "" }} />
);

export const NoColoursYet: Story = () => {
  const [value, setValue] = useState<ImportColourChoice>({ kind: "none" });
  return (
    <div className={wrap}>
      <ImportColourField colours={[]} value={value} onChange={setValue} />
    </div>
  );
};
