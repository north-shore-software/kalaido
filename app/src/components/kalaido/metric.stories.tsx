import type { Story } from "@ladle/react";
import { Metric } from "./metric.tsx";

export default { title: "Kalaido / Metric" };

export const SingleMetric: Story = () => (
  <div className="max-w-xs border rounded-lg bg-card p-4">
    <Metric label="Total Active Pins" value="142" sub="+12% vs last month" />
  </div>
);

export const MetricWithProgressBar: Story = () => (
  <div className="flex flex-col gap-4 max-w-sm border rounded-lg bg-card p-4">
    <Metric
      label="Model Drifting Confidence"
      value="42.8%"
      sub="Stable threshold is 85%"
      bar="42.8%"
      barClassName="bg-drifting"
    />
    <Metric
      label="Data Synchronization progress"
      value="91.2%"
      sub="3.5 GB processed"
      bar="91.2%"
      barClassName="bg-stable"
    />
    <Metric
      label="Database storage remaining"
      value="12%"
      sub="Critical space warning"
      bar="12%"
      barClassName="bg-critical"
    />
  </div>
);
