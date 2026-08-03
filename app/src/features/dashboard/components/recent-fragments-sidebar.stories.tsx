import type { Story } from "@ladle/react";
import { RecentFragmentsSidebar } from "./recent-fragments-sidebar";
import { mockRecentFragments } from "../fixtures";

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
