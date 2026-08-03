import type { Story } from "@ladle/react";
import { TemplateSection } from "./template-section";
import { templates } from "../templates";
import { action } from "@/lib/story-utils.ts";

export default { title: "Setup / TemplateSection" };

const mockSection = templates[0]; // For Work

export const Default: Story = () => (
  <div className="p-4 bg-background max-w-3xl">
    <TemplateSection
      title={mockSection.title}
      templates={mockSection.templates}
      onSelect={action("onSelect")}
    />
  </div>
);
