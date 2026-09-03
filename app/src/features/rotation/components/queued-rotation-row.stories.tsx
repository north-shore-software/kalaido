import type { Story } from "@ladle/react";
import { mockQueuedRows } from "../fixtures";
import { QueuedRotationRow } from "./queued-rotation-row";

export default { title: "Rotation / QueuedRotationRow" };

export const First: Story = () => (
  <div className="p-4 max-w-xl">
    <QueuedRotationRow {...mockQueuedRows[0]} />
  </div>
);

export const Middle: Story = () => (
  <div className="p-4 max-w-xl">
    <QueuedRotationRow {...mockQueuedRows[1]} />
  </div>
);

export const Last: Story = () => (
  <div className="p-4 max-w-xl">
    <QueuedRotationRow {...mockQueuedRows[2]} />
  </div>
);
