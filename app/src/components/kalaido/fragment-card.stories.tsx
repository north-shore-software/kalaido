import type { Story } from "@ladle/react";
import { FragmentCard } from "./fragment-card.tsx";
import { FRAGMENT_FIXTURES } from "./fixtures.ts";

export default { title: "Kalaido / FragmentCard" };

export const EmailFragment: Story = () => {
  const frag = FRAGMENT_FIXTURES[0];
  return (
    <div className="max-w-md p-4">
      <FragmentCard
        type={frag.type}
        time={frag.time}
        colours={frag.colours}
        preview={frag.preview}
      />
    </div>
  );
};

export const WhatsAppFragmentCompact: Story = () => {
  const frag = FRAGMENT_FIXTURES[1];
  return (
    <div className="max-w-md p-4">
      <FragmentCard
        type={frag.type}
        time={frag.time}
        colours={frag.colours}
        preview={frag.preview}
        compact
      />
    </div>
  );
};

export const PersonalNote: Story = () => {
  const frag = FRAGMENT_FIXTURES[2];
  return (
    <div className="max-w-md p-4">
      <FragmentCard
        type={frag.type}
        time={frag.time}
        colours={frag.colours}
        preview={frag.preview}
      />
    </div>
  );
};

export const RejectedFragment: Story = () => {
  const frag = FRAGMENT_FIXTURES[3];
  return (
    <div className="max-w-md p-4">
      <FragmentCard
        type={frag.type}
        time={frag.time}
        colours={frag.colours}
        preview={frag.preview}
        rejected
      />
    </div>
  );
};
