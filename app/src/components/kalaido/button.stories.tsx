import type { Story } from "@ladle/react";
import { ArrowRightIcon, PlusIcon, SendIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default { title: "Kalaido / Button" };

export const AllVariants: Story = () => (
  <div className="p-8 bg-[#252628] text-[#f5f6f6] min-h-screen flex flex-col gap-6 font-sans">
    <div>
      <h1 className="text-2xl font-display font-normal text-[#f5f6f6]">
        Buttons — Variants (§7)
      </h1>
      <p className="text-xs text-[#a3a5a7] mt-1">
        Ghost (default) · Outlined · Primary (commit) · Section Action · Text
        (ghost) · Destructive · Secondary
      </p>
    </div>

    <div className="flex flex-wrap items-center gap-4 border border-[#3a3c3f] p-6 bg-[#2d2f31]">
      <Button variant="default">Ghost (Default)</Button>
      <Button variant="outline">
        <PlusIcon />
        Outlined
      </Button>
      <Button variant="commit">
        Primary Action
        <ArrowRightIcon />
      </Button>
      <Button variant="section">
        <PlusIcon />
        Section Action
      </Button>
      <Button variant="ghost">Text Button</Button>
      <Button variant="destructive">
        <TrashIcon />
        Destructive
      </Button>
      <Button variant="secondary">Secondary</Button>
    </div>
  </div>
);

export const AllSizes: Story = () => (
  <div className="p-8 bg-[#252628] text-[#f5f6f6] min-h-screen flex flex-col gap-6 font-sans">
    <div>
      <h1 className="text-2xl font-display font-normal text-[#f5f6f6]">
        Buttons — Sizes (§7)
      </h1>
      <p className="text-xs text-[#a3a5a7] mt-1">
        default (40px) · sm (25px) · xs (24px) · Icon sizes
      </p>
    </div>

    <div className="flex flex-col gap-6 border border-[#3a3c3f] p-6 bg-[#2d2f31]">
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs font-mono text-[#84868a]">
          default (40px)
        </span>
        <Button size="default" variant="default">
          Default Ghost
        </Button>
        <Button size="default" variant="section">
          <PlusIcon />
          Default Section
        </Button>
        <Button size="default" variant="commit">
          Default Primary
        </Button>
        <Button size="icon" variant="default">
          <SendIcon />
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <span className="w-28 text-xs font-mono text-[#84868a]">sm (25px)</span>
        <Button size="sm" variant="default">
          Small Ghost
        </Button>
        <Button size="sm" variant="section">
          <PlusIcon />
          Small Section
        </Button>
        <Button size="sm" variant="commit">
          Small Primary
        </Button>
        <Button size="icon-sm" variant="default">
          <SendIcon />
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <span className="w-28 text-xs font-mono text-[#84868a]">xs (24px)</span>
        <Button size="xs" variant="default">
          Extra Small
        </Button>
        <Button size="xs" variant="section">
          <PlusIcon />
          XS Section
        </Button>
        <Button size="xs" variant="outline">
          XS Outline
        </Button>
        <Button size="icon-xs" variant="default">
          <SendIcon />
        </Button>
      </div>
    </div>
  </div>
);
