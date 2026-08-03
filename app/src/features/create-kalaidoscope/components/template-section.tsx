import type { Template } from "../templates";
import { TemplateCard } from "./template-card";

export interface TemplateSectionProps {
  title: string;
  templates: Template[];
  onSelect: (t: Template) => void;
}

export function TemplateSection({
  title,
  templates,
  onSelect,
}: TemplateSectionProps) {
  return (
    <div>
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted-foreground text-center">
        {title}
      </h2>
      <div className="flex flex-wrap justify-center gap-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
