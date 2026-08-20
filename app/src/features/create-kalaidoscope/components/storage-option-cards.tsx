import { type OptionCard, OptionCards } from "@/components/kalaido";

export type StorageType = "local_file" | "cloud";

const storageOptions: OptionCard<StorageType>[] = [
  {
    value: "local_file",
    label: "Local",
    lines: ["Stored on this device only"],
  },
  {
    value: "cloud",
    label: "Cloud",
    lines: ["Synced across your devices"],
  },
];

export interface StorageOptionCardsProps {
  value: StorageType;
  onChange: (v: StorageType) => void;
  "aria-labelledby"?: string;
}

export function StorageOptionCards({
  value,
  onChange,
  "aria-labelledby": ariaLabelledBy,
}: StorageOptionCardsProps) {
  return (
    <OptionCards
      options={storageOptions}
      value={value}
      onChange={onChange}
      aria-labelledby={ariaLabelledBy}
    />
  );
}
