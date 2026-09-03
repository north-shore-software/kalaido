import type { Story } from "@ladle/react";
import { mockRecentFragments } from "../fixtures";
import { RecentFragmentsSidebar } from "./recent-fragments-sidebar";

export default { title: "Dashboard / RecentFragmentsSidebar" };

export const Default: Story = () => {
  return (
    <div className="flex justify-end p-4 bg-background">
      <RecentFragmentsSidebar fragments={mockRecentFragments} />
    </div>
  );
};

export const Loading: Story = () => {
  return (
    <div className="flex justify-end p-4 bg-background">
      <RecentFragmentsSidebar fragments={[]} loading={true} />
    </div>
  );
};

export const Empty: Story = () => {
  return (
    <div className="flex justify-end p-4 bg-background">
      <RecentFragmentsSidebar fragments={[]} loading={false} />
    </div>
  );
};
