import type { Story } from "@ladle/react";
import {
  mockKalaidoscopes,
  seedKalaidoscopes,
} from "@/features/create-kalaidoscope/fixtures";
import { RecoveryScreen } from "./recovery-screen";

export default { title: "Boot / RecoveryScreen" };

const error = {
  message: "Sidecar exited with code 1",
  detail: "Error: listen tcp 127.0.0.1:8090: bind: address already in use",
};

export const Default: Story = () => {
  seedKalaidoscopes([]);
  return (
    <RecoveryScreen
      title="Kalaido could not start"
      description="The local engine did not come up. You can try again or reset the app."
      error={error}
      onRetry={() => {}}
    />
  );
};

/** With other kalaidoscopes to fall back to, the switcher appears. */
export const WithSwitcher: Story = () => {
  seedKalaidoscopes(mockKalaidoscopes, mockKalaidoscopes[0].id);
  return (
    <RecoveryScreen
      title="This kalaidoscope failed to open"
      description="Something went wrong loading it. Try again, or open a different one."
      error={error}
      onRetry={() => {}}
      allowSwitch
      excludeKalaidoscopeId={mockKalaidoscopes[0].id}
    />
  );
};
