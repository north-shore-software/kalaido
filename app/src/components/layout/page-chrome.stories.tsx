import type { Story } from "@ladle/react";
import { StatusPill } from "@/components/kalaido";
import { DocBody } from "../kalaido/bars.tsx";
import { Segmented } from "../kalaido/segmented.tsx";
import { PageBody, PageCard, PageHeader, PaneHeader } from "./page-chrome.tsx";

export default { title: "Layout / Page Chrome" };

export const HeaderDefault: Story = () => (
  <div className="border border-line rounded-lg bg-background overflow-hidden">
    <PageHeader
      title="Color Palette Configurations"
      crumb={["Design System", "Colors", "Overview"]}
      description="Define raw ingests and map them to truth values with CMYK-aligned semantic palettes."
      actions={
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 border hover:bg-surface-2 text-xs font-semibold rounded-md"
          >
            Export JSON
          </button>
          <button
            type="button"
            className="px-3 py-1.5 bg-foreground text-background text-xs font-semibold rounded-md"
          >
            New Palette
          </button>
        </div>
      }
    />
  </div>
);

export const HeaderWithTabs: Story = () => (
  <div className="border border-line rounded-lg bg-background overflow-hidden">
    <PageHeader
      title="Billing & Invoicing"
      crumb={["Settings", "Billing"]}
      tabs={
        <div className="py-2">
          <Segmented
            items={
              [
                "Overview",
                "Invoices",
                "Usage Limits",
                "Payment Methods",
              ] as const
            }
            value="Overview"
            onChange={(v) => console.log("Tab switched to:", v)}
          />
        </div>
      }
    />
  </div>
);

export const BodyDefault: Story = () => (
  <div className="border border-line rounded-lg bg-background overflow-hidden h-[300px] flex flex-col">
    <PageHeader title="Scrolling Document Workspace" />
    <PageBody>
      <DocBody title={false} paragraphs={4} />
    </PageBody>
  </div>
);

export const CardWorkspace: Story = () => (
  <div className="border border-line rounded-lg bg-background overflow-hidden h-[300px] flex flex-col">
    <PageHeader title="Split-Pane Dashboard Workspace" />
    <PageCard className="bg-surface-1 p-4">
      <div className="flex-1 border border-dashed rounded-lg flex items-center justify-center text-xs text-fg-3">
        Full-bleed non-scrolling card area (useful for split views or editors)
      </div>
    </PageCard>
  </div>
);

export const PaneHeaderDefault: Story = () => (
  <div className="max-w-md border border-line rounded-lg bg-background overflow-hidden">
    <PaneHeader
      label="Source Snapshot Code"
      status={
        <StatusPill kind="magenta" dot>
          Validated
        </StatusPill>
      }
    />
    <div className="p-4 font-mono text-xs text-fg-3 bg-card h-[100px]">
      {'{\n  "version": "1.1.0",\n  "active": true\n}'}
    </div>
  </div>
);
