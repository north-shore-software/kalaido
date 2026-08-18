import type { Story } from "@ladle/react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default { title: "Kalaido / Typography" };

const CARD_TITLE_SPACING = [
  { label: "-0.01em (Original tight)", tracking: "-0.01em" },
  { label: "0em (Normal)", tracking: "0em" },
  { label: "0.015em (Slight tracking)", tracking: "0.015em" },
  { label: "0.03em (Spaced)", tracking: "0.03em" },
];

const BODY_SPACING = [
  { label: "0em (Original normal)", tracking: "0em" },
  { label: "0.01em (Subtle spacing)", tracking: "0.01em" },
  { label: "0.02em (Moderate spacing)", tracking: "0.02em" },
  { label: "0.03em (Airy spacing)", tracking: "0.03em" },
];

export const ScaleComparison: Story = () => (
  <div className="p-8 bg-[#1a1b1e] text-[#f5f6f8] min-h-screen max-w-6xl font-sans flex flex-col gap-10">
    <div>
      <h1 className="text-2xl font-display font-normal text-[#f5f6f8]">Typography: Letter Spacing Exploration</h1>
      <p className="text-xs text-[#a3a5ad] mt-1">
        Explore letter-spacing (tracking) options for Card Title (18px Archivo bold) and Body (16px Archivo regular).
      </p>
    </div>

    <div className="border border-[#36383e] bg-[#222327] p-6 flex flex-col gap-6">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.14em] text-[#84868f]">
        Card Title Letter Spacing (18px Archivo Bold)
      </h2>
      <div className="flex flex-col gap-4">
        {CARD_TITLE_SPACING.map((opt) => (
          <div key={opt.label} className="border border-[#36383e] bg-[#1a1b1e] p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono text-[#84868f] mb-1">{opt.label}</div>
              <div
                className="font-sans text-[18px] font-bold text-[#f5f6f8]"
                style={{ letterSpacing: opt.tracking }}
              >
                Checkout Flow Redesign PRD & System Architecture
              </div>
            </div>
            <span className="font-mono text-xs text-[#4ade80]">{opt.tracking}</span>
          </div>
        ))}
      </div>
    </div>

    <div className="border border-[#36383e] bg-[#222327] p-6 flex flex-col gap-6">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.14em] text-[#84868f]">
        Body Text Letter Spacing (16px Archivo Regular / Leading 1.6)
      </h2>
      <div className="flex flex-col gap-4">
        {BODY_SPACING.map((opt) => (
          <div key={opt.label} className="border border-[#36383e] bg-[#1a1b1e] p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-[#84868f]">
              <span>{opt.label}</span>
              <span className="text-[#4ade80]">{opt.tracking}</span>
            </div>
            <p
              className="font-sans text-[16px] leading-[1.6] text-[#d6d8dd]"
              style={{ letterSpacing: opt.tracking }}
            >
              A live projection distilling recent user telemetry and customer feedback into measurable engineering requirements. It continually refreshes as new source fragments arrive.
            </p>
          </div>
        ))}
      </div>
    </div>

    <div className="border border-[#36383e] bg-[#222327] p-6 flex flex-col gap-4">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.14em] text-[#84868f]">
        Combined Card Preview at 0.015em Title / 0.015em Body
      </h2>
      <div className="border border-[#36383e] bg-[#1a1b1e] p-5 flex flex-col gap-3 max-w-xl">
        <div className="flex items-center justify-between">
          <span
            className="font-sans text-[18px] font-bold text-[#f5f6f8]"
            style={{ letterSpacing: "0.015em" }}
          >
            Checkout Flow Redesign PRD
          </span>
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] border border-[#4ade80]/45 bg-[#4ade80]/10 text-[#4ade80] px-2 py-0.5">
            Plan of record
          </span>
        </div>
        <p
          className="font-sans text-[16px] leading-[1.6] text-[#d6d8dd]"
          style={{ letterSpacing: "0.015em" }}
        >
          A live projection distilling recent user telemetry and customer feedback into measurable engineering requirements.
        </p>
        <div className="flex items-center justify-between pt-3 border-t border-[#36383e]">
          <span className="font-mono text-[12.5px] text-[#84868f]">1,048,576 tokens</span>
          <Button variant="section"><PlusIcon />New Snapshot</Button>
        </div>
      </div>
    </div>
  </div>
);
