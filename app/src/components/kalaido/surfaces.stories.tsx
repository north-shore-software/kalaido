import type { Story } from "@ladle/react";

export default { title: "Kalaido / Surfaces" };

interface ThemeOption {
  name: string;
  desc: string;
  bg0: string;
  bg1: string;
  bg2: string;
  line: string;
  lineStrong: string;
}

const THEMES: ThemeOption[] = [
  {
    name: "Option 3A: Dark Obsidian (Active on App)",
    desc: "Balanced neutral dark charcoal (~11% luminance)",
    bg0: "#1a1b1e",
    bg1: "#222327",
    bg2: "#2a2c31",
    line: "#36383e",
    lineStrong: "#4b4d55",
  },
  {
    name: "Option 1A: Midnight Slate (Blue-Slate, Balanced)",
    desc: "Intermediate blue-slate tone (~11% luminance)",
    bg0: "#1a1d24",
    bg1: "#21252e",
    bg2: "#2a2f3a",
    line: "#353b49",
    lineStrong: "#484f60",
  },
  {
    name: "Option 1B: Cool Charcoal (Subtle Blue, Slightly Darker)",
    desc: "Subtle cool slate tone (~10% luminance)",
    bg0: "#171a20",
    bg1: "#1e2129",
    bg2: "#262a34",
    line: "#313642",
    lineStrong: "#434958",
  },
  {
    name: "Option 3B: Deep Graphite (Neutral Charcoal, Slightly Darker)",
    desc: "Deep graphite neutral tone (~10% luminance)",
    bg0: "#16171a",
    bg1: "#1e1f23",
    bg2: "#27282c",
    line: "#33353a",
    lineStrong: "#45474e",
  },
  {
    name: "Original (Too Bright)",
    desc: "Original base values (#252628 / #2d2f31)",
    bg0: "#252628",
    bg1: "#2d2f31",
    bg2: "#37393c",
    line: "#3a3c3f",
    lineStrong: "#4e5155",
  },
];

function ThemePreviewCard({ theme }: { theme: ThemeOption }) {
  return (
    <div
      className="flex flex-col border p-6 font-sans transition-all"
      style={{
        backgroundColor: theme.bg0,
        borderColor: theme.line,
        color: "#f5f6f6",
      }}
    >
      <div className="mb-4">
        <div className="text-sm font-bold text-[#f5f6f6]">{theme.name}</div>
        <div className="text-xs text-[#a3a5a7]">{theme.desc}</div>
        <div className="font-mono text-[10px] text-[#84868a] mt-1">
          bg-0: {theme.bg0} · bg-1: {theme.bg1} · bg-2: {theme.bg2} · line: {theme.line}
        </div>
      </div>

      <div
        className="flex min-h-[220px] border overflow-hidden"
        style={{
          backgroundColor: theme.bg0,
          borderColor: theme.line,
        }}
      >
        <div
          className="w-44 shrink-0 border-r p-3 flex flex-col gap-2"
          style={{
            backgroundColor: theme.bg1,
            borderColor: theme.line,
          }}
        >
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#84868a]">
            Sidebar (bg-1)
          </div>
          <div
            className="px-2.5 py-1.5 text-xs font-semibold flex items-center gap-2"
            style={{
              backgroundColor: `color-mix(in srgb, #4ade80 8%, transparent)`,
              borderLeft: "2px solid #4ade80",
              color: "#4ade80",
            }}
          >
            Projections
          </div>
          <div className="px-2.5 py-1.5 text-xs text-[#d6d8d9] flex items-center gap-2">
            Reflections
          </div>
          <div className="px-2.5 py-1.5 text-xs text-[#d6d8d9] flex items-center gap-2">
            Colours
          </div>
        </div>

        <div className="flex-1 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg text-[#f5f6f6]">Projections View</h3>
            <span
              className="text-[10.5px] font-mono font-bold uppercase px-2 py-0.5"
              style={{
                backgroundColor: `color-mix(in srgb, #4ade80 8%, transparent)`,
                borderColor: `color-mix(in srgb, #4ade80 45%, transparent)`,
                borderWidth: 1,
                borderStyle: "solid",
                color: "#4ade80",
              }}
            >
              Plan of record
            </span>
          </div>

          <div
            className="border p-3 flex flex-col gap-2"
            style={{
              backgroundColor: theme.bg1,
              borderColor: theme.line,
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#f5f6f6]">Checkout Redesign PRD</span>
              <span className="font-mono text-[10.5px] text-[#84868a]">v2 · live</span>
            </div>
            <p className="text-xs text-[#d6d8d9] leading-relaxed">
              A live projection distilling recent telemetry into measurable engineering requirements.
            </p>
            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: theme.line }}>
              <span className="font-mono text-[10px] text-[#84868a]">1,048,576 tokens</span>
              <button
                type="button"
                className="px-3 py-1 text-xs font-bold uppercase"
                style={{
                  backgroundColor: "#4ade80",
                  color: "#16171a",
                }}
              >
                + New Snapshot
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const SurfaceComparisons: Story = () => (
  <div className="p-8 bg-[#121315] text-[#f5f6f6] min-h-screen max-w-6xl font-sans">
    <div className="mb-6">
      <h1 className="text-2xl font-display font-normal text-[#f5f6f6]">Surface & Ground Exploration (§3)</h1>
      <p className="text-xs text-[#a3a5a7] mt-1">
        Explore darker grey backgrounds with subtle cool / blue / green undertones for enhanced text contrast and immersion.
      </p>
    </div>

    <div className="flex flex-col gap-6">
      {THEMES.map((theme) => (
        <ThemePreviewCard key={theme.name} theme={theme} />
      ))}
    </div>
  </div>
);
