import type { Story } from "@ladle/react";
import { ReflectionBody } from "./reflection-body";
import { FIXTURE_CONTENT_1, FIXTURE_CONTENT_2 } from "../fixtures";

export default { title: "Reflections / ReflectionBody" };

export const LiveReady: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionBody
        readOnly={false}
        status="ready"
        content={FIXTURE_CONTENT_1}
      />
    </div>
  );
};

export const LiveLoading: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionBody readOnly={false} status="loading" />
    </div>
  );
};

export const LiveEmpty: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionBody readOnly={false} status="empty" />
    </div>
  );
};

export const LiveError: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionBody
        readOnly={false}
        status="error"
        errorMessage="Database connection timeout"
      />
    </div>
  );
};

export const ReadOnlyHistorical: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionBody
        readOnly={true}
        historical={{ status: "stable" }}
        historicalContent={FIXTURE_CONTENT_2}
      />
    </div>
  );
};

export const ReadOnlyLoading: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionBody
        readOnly={true}
        historical={null}
        historicalLoading={true}
      />
    </div>
  );
};

export const ReadOnlyNotFound: Story = () => {
  return (
    <div className="w-[600px] border border-line bg-card">
      <ReflectionBody
        readOnly={true}
        historical={null}
        historicalLoading={false}
      />
    </div>
  );
};
