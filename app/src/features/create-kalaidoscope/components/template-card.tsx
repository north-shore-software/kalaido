import { iconByName } from "@/lib/icons";
import type { Template } from "../templates";

export interface TemplateCardProps {
  template: Template;
  onSelect: (t: Template) => void;
}

export function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const Icon = iconByName(template.icon);
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="flex w-60 flex-col gap-3 border bg-card p-4 text-left ring-1 ring-foreground/5 transition-colors hover:bg-muted/30 hover:ring-primary/40"
    >
      <Icon className="size-5 text-muted-foreground" />
      <div>
        <div className="text-sm font-medium">{template.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {template.description}
        </div>
      </div>
    </button>
  );
}
