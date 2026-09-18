import type { Story } from "@ladle/react";
import { useState } from "react";
import type { LlmRole } from "@/api/kalaidoscope/llm-config";
import { ProviderFields } from "./provider-fields";

export default { title: "Create Kalaidoscope / ProviderFields" };

/**
 * Gemini only: the Ollama variant renders `OllamaSetupStatus`, which asks the
 * Tauri host for the local model status and has no place in the workbench.
 */
function GeminiFields({
  disabled,
  highlighted,
}: {
  disabled?: boolean;
  highlighted?: ReadonlySet<"name" | "apiKey" | "model">;
}) {
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [roleModels, setRoleModels] = useState<
    Partial<Record<LlmRole, string>>
  >({});
  return (
    <ProviderFields
      provider="gemini"
      apiKey={apiKey}
      defaultModel={defaultModel}
      roleModels={roleModels}
      disabled={disabled}
      highlightedFields={highlighted}
      onProviderChange={() => {}}
      onApiKeyChange={setApiKey}
      onDefaultModelChange={setDefaultModel}
      onRoleModelChange={(role, model) =>
        setRoleModels((prev) => ({ ...prev, [role]: model }))
      }
    />
  );
}

export const Gemini: Story = () => (
  <div className="w-[540px] bg-background p-4">
    <GeminiFields />
  </div>
);

/** The required-field highlight a blank submit triggers. */
export const GeminiHighlighted: Story = () => (
  <div className="w-[540px] bg-background p-4">
    <GeminiFields highlighted={new Set(["apiKey", "model"])} />
  </div>
);

export const Disabled: Story = () => (
  <div className="w-[540px] bg-background p-4">
    <GeminiFields disabled />
  </div>
);
