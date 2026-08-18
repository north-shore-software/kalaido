import type { Story } from "@ladle/react";

export default { title: "Kalaido / HueMap" };

interface HueItem {
  name: string;
  role: string;
  color: string;
  washAlpha?: number;
  solidFgWhite?: boolean;
}

const SECTION_HUES: HueItem[] = [
  {
    name: "Onboarding / Boot",
    role: "Brand Cyan (Pre-workspace)",
    color: "#22d3ee",
  },
  { name: "Capture", role: "Shell Quick Action", color: "#22d3ee" },
  { name: "Dashboard", role: "Section Accent", color: "#22d3ee" },
  { name: "Chat", role: "Section Accent", color: "#f5d90a" },
  { name: "Projections", role: "Section Accent", color: "#4ade80" },
  { name: "Reflections", role: "Section Accent", color: "#c084fc" },
  { name: "Colours", role: "Section Accent", color: "#fda4af" },
  { name: "Fragments", role: "Section Accent", color: "#a3e635" },
  { name: "Connections", role: "Neutral Accent", color: "#d6d8d9" },
  { name: "Settings", role: "Neutral Accent", color: "#d6d8d9" },
];

const STATUS_AND_GUARDRAIL_HUES: HueItem[] = [
  {
    name: "Neon Magenta",
    role: "Constant Demand (#ff2e93)",
    color: "#ff2e93",
    washAlpha: 4,
    solidFgWhite: true,
  },
  { name: "Drifting", role: "Status (Stale/Degraded)", color: "#ff9f0a" },
  {
    name: "Danger / Critical",
    role: "Destructive / Alert (#ff3333)",
    color: "#ff3333",
    washAlpha: 4,
    solidFgWhite: true,
  },
  { name: "Stable", role: "Status (Healthy)", color: "#22d3ee" },
];

function HueRow({ item }: { item: HueItem }) {
  const alpha = item.washAlpha ?? 8;
  const washBg = `color-mix(in srgb, ${item.color} ${alpha}%, transparent)`;
  const edgeBorder = `color-mix(in srgb, ${item.color} 45%, transparent)`;
  const solidTextColor = item.solidFgWhite ? "#ffffff" : "#16171a";

  return (
    <div className="grid grid-cols-[180px_1fr_1fr_1fr] items-center gap-4 py-2.5 border-b border-[#3a3c3f]">
      <div>
        <div className="font-sans text-xs font-semibold text-[#f5f6f6]">
          {item.name}
        </div>
        <div className="font-mono text-[10px] text-[#84868a]">{item.role}</div>
        <div className="font-mono text-[10px] text-[#64666a]">{item.color}</div>
      </div>

      <div>
        <span
          className="inline-flex items-center px-1.5 py-0.5 text-[9.5px] font-mono font-semibold tracking-[0.12em] uppercase"
          style={{
            backgroundColor: washBg,
            borderColor: edgeBorder,
            borderWidth: 1,
            borderStyle: "solid",
            color: item.color,
          }}
        >
          {item.name} Wash
        </span>
      </div>

      <div
        className="h-10 px-3 flex items-center bg-[#2d2f31]"
        style={{
          borderLeft: `2px solid ${item.color}`,
        }}
      >
        <span className="font-mono text-[11px] text-[#d6d8d9]">
          2px active rail/nav edge
        </span>
      </div>

      <div
        className="h-9 px-3 flex items-center justify-center font-sans text-xs font-bold uppercase tracking-wider"
        style={{
          backgroundColor: item.color,
          color: solidTextColor,
        }}
      >
        Solid Fill ({item.solidFgWhite ? "white fg" : "#16171a fg"})
      </div>
    </div>
  );
}

export const HueMap: Story = () => (
  <div className="p-8 bg-[#252628] text-[#f5f6f6] min-h-screen max-w-5xl font-sans">
    <div className="mb-6">
      <h1 className="text-2xl font-display font-normal text-[#f5f6f6]">
        Section → Hue Map (§3)
      </h1>
      <p className="text-xs text-[#a3a5a7] mt-1">
        Design system color reference for section accents, global constants, and
        momentum status.
      </p>
    </div>

    <div className="mb-8">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.14em] text-[#84868a] mb-3">
        Section & Shell Hues (in sidebar order)
      </h2>
      <div className="border border-[#3a3c3f] bg-[#252628] px-4">
        {SECTION_HUES.map((item) => (
          <HueRow key={item.name} item={item} />
        ))}
      </div>
    </div>

    <div className="mb-8">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.14em] text-[#84868a] mb-3">
        Constants & Status Tokens
      </h2>
      <div className="border border-[#3a3c3f] bg-[#252628] px-4">
        {STATUS_AND_GUARDRAIL_HUES.map((item) => (
          <HueRow key={item.name} item={item} />
        ))}
      </div>
    </div>

    <div className="mb-8">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.14em] text-[#84868a] mb-3">
        Proximity Comparisons (§3 / §4 guardrails)
      </h2>
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-[#3a3c3f] p-4 bg-[#2d2f31]">
          <div className="text-xs font-semibold text-[#f5f6f6] mb-1">
            Colours Blush vs Neon Magenta Demand
          </div>
          <div className="text-[11px] text-[#a3a5a7] mb-3">
            Colours Blush (#fda4af) vs Neon Magenta (#ff2e93).
          </div>
          <div className="flex flex-col gap-2">
            <HueRow
              item={{
                name: "Colours (Blush)",
                role: "Section Accent",
                color: "#fda4af",
              }}
            />
            <HueRow
              item={{
                name: "Neon Magenta",
                role: "Action / Demand",
                color: "#ff2e93",
                washAlpha: 4,
                solidFgWhite: true,
              }}
            />
          </div>
        </div>

        <div className="border border-[#3a3c3f] p-4 bg-[#2d2f31]">
          <div className="text-xs font-semibold text-[#f5f6f6] mb-1">
            Chat Yellow vs Drifting vs Danger Red
          </div>
          <div className="text-[11px] text-[#a3a5a7] mb-3">
            Drifting (#ff9f0a) vs Signal Red (#ff3333) vs Chat Yellow (#f5d90a).
          </div>
          <div className="flex flex-col gap-2">
            <HueRow
              item={{
                name: "Chat Yellow",
                role: "Section Accent",
                color: "#f5d90a",
              }}
            />
            <HueRow
              item={{
                name: "Drifting Orange",
                role: "Status (Momentum)",
                color: "#ff9f0a",
              }}
            />
            <HueRow
              item={{
                name: "Danger (Signal Red)",
                role: "Destructive",
                color: "#ff3333",
                washAlpha: 4,
                solidFgWhite: true,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  </div>
);
