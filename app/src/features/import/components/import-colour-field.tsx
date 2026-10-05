import { ColourSwatch, Label } from "@/components/kalaido";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Where an import's fragments go: nowhere, an existing colour, or one made for it. */
export type ImportColourChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

export interface ImportColourOption {
  id: string;
  name: string;
  swatch: number;
}

const NONE = "none";
const NEW = "new";

/** A new colour needs a name before the import can go. */
export function isImportColourReady(choice: ImportColourChoice): boolean {
  return choice.kind !== "new" || choice.name.trim() !== "";
}

export interface ImportColourFieldProps {
  colours: ImportColourOption[];
  value: ImportColourChoice;
  onChange: (next: ImportColourChoice) => void;
  disabled?: boolean;
}

export function ImportColourField({
  colours,
  value,
  onChange,
  disabled,
}: ImportColourFieldProps) {
  const items = [
    { value: NONE, label: "No colour" },
    ...colours.map((c) => ({
      value: c.id,
      label: (
        <span className="flex items-center gap-1.5">
          <ColourSwatch c={c.swatch} />
          {c.name || "Untitled colour"}
        </span>
      ),
    })),
    { value: NEW, label: "New colour…" },
  ];
  const selected =
    value.kind === "none" ? NONE : value.kind === "new" ? NEW : value.id;

  function pick(next: string | null) {
    if (next === NEW) {
      onChange({ kind: "new", name: value.kind === "new" ? value.name : "" });
    } else if (!next || next === NONE) {
      onChange({ kind: "none" });
    } else {
      onChange({ kind: "existing", id: next });
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <Label>Colour</Label>
      <Select
        items={items}
        value={selected}
        onValueChange={pick}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" aria-label="Colour">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.kind === "new" && (
        <Input
          autoFocus
          aria-label="New colour name"
          placeholder="e.g. Customer feedback"
          value={value.name}
          disabled={disabled}
          onChange={(e) => onChange({ kind: "new", name: e.target.value })}
        />
      )}
      <p className="text-body-sm text-fg-3">
        Every fragment this import creates joins the colour.
      </p>
    </section>
  );
}
