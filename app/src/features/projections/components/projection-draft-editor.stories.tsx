import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import {
  mockSession,
  mockSessionCommitting,
  mockSessionEmpty,
} from "../fixtures";
import { ProjectionDraftEditor } from "./projection-draft-editor";

export default { title: "Projections / ProjectionDraftEditor" };

export const Default: Story = () => (
  <div className="h-[600px] border border-line bg-bg rounded-lg flex flex-col overflow-hidden">
    <ProjectionDraftEditor
      session={mockSession}
      projectionId="proj-1"
      title="Define Marketing Launch Plan"
      crumb={["Projections", "Marketing Launch Plan", "Draft"]}
      onCancel={action("onCancel")}
      onApproveSuccess={action("onApproveSuccess")}
    />
  </div>
);

export const Empty: Story = () => (
  <div className="h-[600px] border border-line bg-bg rounded-lg flex flex-col overflow-hidden">
    <ProjectionDraftEditor
      session={mockSessionEmpty}
      projectionId="proj-1"
      title="Define Marketing Launch Plan"
      crumb={["Projections", "Marketing Launch Plan", "Draft"]}
      onCancel={action("onCancel")}
      onApproveSuccess={action("onApproveSuccess")}
    />
  </div>
);

export const Approving: Story = () => (
  <div className="h-[600px] border border-line bg-bg rounded-lg flex flex-col overflow-hidden">
    <ProjectionDraftEditor
      session={mockSessionCommitting}
      projectionId="proj-1"
      title="Define Marketing Launch Plan"
      crumb={["Projections", "Marketing Launch Plan", "Draft"]}
      onCancel={action("onCancel")}
      onApproveSuccess={action("onApproveSuccess")}
    />
  </div>
);
