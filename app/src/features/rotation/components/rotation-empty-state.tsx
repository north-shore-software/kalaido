import { CheckIcon } from "lucide-react";

export function RotationEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <CheckIcon className="size-7 text-stable" />
      <p className="text-[13.5px] font-medium">Everything is up to date.</p>
    </div>
  );
}
