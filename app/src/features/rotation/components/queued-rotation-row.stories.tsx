import type { Story } from "@ladle/react";
import { QueuedRotationRow } from "./queued-rotation-row";
import { mockQueuedRows } from "../fixtures";

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
