import { SlidersHorizontalIcon } from "lucide-react";
import { useId, useState } from "react";
import { type OptionCard, OptionCards, Pill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GEMINI_SUGGESTED_MODELS,
  type LlmProvider,
  type LlmRole,
  LLM_ROLE_LABELS,
  LLM_ROLES,
} from "@/api/kalaidoscope/llm-config";
import { OllamaSetupStatus } from "./ollama-setup-status";

const providerOptions: OptionCard<LlmProvider>[] = [
  {
    value: "ollama",
    label: "Local Ollama",
    lines: ["Runs on this device", "Offline & private"],
  },
  {
    value: "gemini",
    label: "Google Gemini",
    lines: ["Hosted by Google", "Use your API key"],
  },
];

export interface ProviderFieldsProps {
  provider: LlmProvider;
  apiKey: string;
  defaultModel: string;
  roleModels: Partial<Record<LlmRole, string>>;
  disabled?: boolean;
  onProviderChange: (provider: LlmProvider) => void;
  onApiKeyChange: (apiKey: string) => void;
  onDefaultModelChange: (model: string) => void;
  onRoleModelChange: (role: LlmRole, model: string) => void;
}

export function ProviderFields({
  provider,
  apiKey,
  defaultModel,
  roleModels,
  disabled,
  onProviderChange,
  onApiKeyChange,
  onDefaultModelChange,
  onRoleModelChange,
}: ProviderFieldsProps) {
  const apiKeyFieldId = useId();
  const providerLabelId = useId();
  const modelFieldId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeCustomRoleCount =
    Object.values(roleModels).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3">
      <span
        id={providerLabelId}
        className="text-label uppercase text-muted-foreground"
      >
        Model provider
      </span>

      <OptionCards
        options={providerOptions}
        value={provider}
        onChange={onProviderChange}
        disabled={disabled}
        aria-labelledby={providerLabelId}
      />

      {provider === "ollama" ? (
        <div className="flex flex-col gap-3">
          <OllamaSetupStatus />
        </div>
      ) : (
        <div className="flex flex-col gap-5 pt-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor={apiKeyFieldId}
                className="text-label uppercase text-muted-foreground"
              >
                API key
              </label>
              <Pill className="border-critical/40 bg-critical/10 text-critical-ink">
                Required
              </Pill>
            </div>
            <Input
              id={apiKeyFieldId}
              type="password"
              autoComplete="off"
              value={apiKey}
              disabled={disabled}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="Paste your Gemini API key"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={modelFieldId}
              className="text-label uppercase text-muted-foreground"
            >
              Model
            </label>
            <Select
              value={defaultModel || GEMINI_SUGGESTED_MODELS[0]}
              onValueChange={(val) => onDefaultModelChange(val ?? "")}
              disabled={disabled}
            >
              <SelectTrigger
                id={modelFieldId}
                className="h-10 w-full font-mono text-body-sm"
              >
                <SelectValue placeholder="Select a Gemini model" />
              </SelectTrigger>
              <SelectContent className="font-mono">
                {GEMINI_SUGGESTED_MODELS.map((model) => (
                  <SelectItem
                    key={model}
                    value={model}
                    className="font-mono text-body-sm"
                  >
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 self-end">
            {activeCustomRoleCount > 0 && (
              <Pill
                tone="primary"
                className="h-[25px] min-w-[25px] justify-center px-2 font-mono text-btn-sm"
              >
                {activeCustomRoleCount}
              </Pill>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAdvancedOpen(true)}
              className="gap-1.5 font-mono transition-colors hover:border-cyan-edge hover:bg-cyan-wash hover:text-cyan"
            >
              <SlidersHorizontalIcon className="size-3.5" />
              Advanced
            </Button>
          </div>

          <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <DialogContent className="max-h-[85vh] max-w-lg flex flex-col gap-6 overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Task models</DialogTitle>
                <DialogDescription>
                  Assign specific models to different roles in your workspace.
                  Unset roles use the default model.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                {LLM_ROLES.map((role) => (
                  <RoleField
                    key={role}
                    role={role}
                    value={roleModels[role] ?? ""}
                    placeholder={defaultModel || GEMINI_SUGGESTED_MODELS[0]}
                    disabled={disabled}
                    onChange={(model) => onRoleModelChange(role, model)}
                  />
                ))}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAdvancedOpen(false)}
                  className="font-mono transition-colors hover:border-cyan-edge hover:bg-cyan-wash hover:text-cyan"
                >
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}

interface RoleFieldProps {
  role: LlmRole;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}

function RoleField({
  role,
  value,
  placeholder,
  disabled,
  onChange,
}: RoleFieldProps) {
  const fieldId = useId();
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={fieldId}
        className="text-label uppercase text-muted-foreground"
      >
        {LLM_ROLE_LABELS[role]}
      </label>
      <Select
        value={value || "default"}
        onValueChange={(val) => onChange(val === "default" ? "" : (val ?? ""))}
        disabled={disabled}
      >
        <SelectTrigger
          id={fieldId}
          className="h-10 w-full font-mono text-body-sm"
        >
          <SelectValue placeholder={`Default (${placeholder})`} />
        </SelectTrigger>
        <SelectContent className="font-mono">
          <SelectItem value="default" className="font-mono text-body-sm">
            Default ({placeholder})
          </SelectItem>
          {GEMINI_SUGGESTED_MODELS.map((model) => (
            <SelectItem
              key={model}
              value={model}
              className="font-mono text-body-sm"
            >
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
