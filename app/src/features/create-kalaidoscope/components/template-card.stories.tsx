import type { Story } from "@ladle/react";
import { TemplateCard } from "./template-card";
import { templates } from "../templates";
import { action } from "@/lib/story-utils.ts";

export default { title: "Setup / TemplateCard" };

const mockTemplate1 = templates[0].templates[0]; // Meeting Notes
const mockTemplate2 = templates[0].templates[1]; // Project Tracker
const mockTemplate3 = templates[1].templates[2]; // Organize Emails

export const MeetingNotes: Story = () => (
  <div className="p-4">
    <TemplateCard template={mockTemplate1} onSelect={action("onSelect")} />
  </div>
);

export const ProjectTracker: Story = () => (
  <div className="p-4">
    <TemplateCard template={mockTemplate2} onSelect={action("onSelect")} />
  </div>
);

export const OrganizeEmails: Story = () => (
  <div className="p-4">
    <TemplateCard template={mockTemplate3} onSelect={action("onSelect")} />
  </div>
);
