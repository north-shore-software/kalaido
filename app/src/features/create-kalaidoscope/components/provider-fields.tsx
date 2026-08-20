import { SlidersHorizontalIcon } from "lucide-react";
import { useId, useState } from "react";
import {
  type OptionCard,
  OptionCards,
  Pill,
  RequiredPill,
  requiredHighlightClass,
  RevealToggle,
} from "@/components/kalaido";
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
import { cn } from "@/lib/css-utils";
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
    lines: ["Runs privately on this device"],
  },
  {
    value: "gemini",
    label: "Google Gemini",
    lines: ["Use your own Google API key"],
  },
];

export interface ProviderFieldsProps {
  provider: LlmProvider;
  apiKey: string;
  defaultModel: string;
  roleModels: Partial<Record<LlmRole, string>>;
  disabled?: boolean;
  highlightedFields?: ReadonlySet<"name" | "apiKey" | "model">;
  apiKeyFieldId?: string;
  modelFieldId?: string;
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
  highlightedFields,
  apiKeyFieldId: externalApiKeyFieldId,
  modelFieldId: externalModelFieldId,
  onProviderChange,
  onApiKeyChange,
  onDefaultModelChange,
  onRoleModelChange,
}: ProviderFieldsProps) {
  const fallbackApiKeyFieldId = useId();
  const apiKeyFieldId = externalApiKeyFieldId ?? fallbackApiKeyFieldId;
  const providerLabelId = useId();
  const fallbackModelFieldId = useId();
  const modelFieldId = externalModelFieldId ?? fallbackModelFieldId;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const activeCustomRoleCount =
    Object.values(roleModels).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3">
      <span
        id={providerLabelId}
        className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
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
            <label
              htmlFor={apiKeyFieldId}
              className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              API key
            </label>
            <div className="relative flex items-center">
              <Input
                id={apiKeyFieldId}
                type={showApiKey ? "text" : "password"}
                autoComplete="off"
                value={apiKey}
                disabled={disabled}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="Paste your Gemini API key"
                className={cn(
                  "h-12 w-full pr-10 text-[18px] transition-all duration-150 placeholder:text-muted-foreground/80",
                  highlightedFields?.has("apiKey") && [
                    requiredHighlightClass,
                    "pr-28",
                  ],
                )}
              />
              {highlightedFields?.has("apiKey") && (
                <RequiredPill className="right-11" />
              )}
              {apiKey && (
                <RevealToggle
                  shown={showApiKey}
                  onToggle={() => setShowApiKey((prev) => !prev)}
                  subject="API key"
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={modelFieldId}
              className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Model
            </label>
            <div className="relative flex w-full items-center">
              <Select
                value={defaultModel}
                onValueChange={(val) => onDefaultModelChange(val ?? "")}
                disabled={disabled}
              >
                <SelectTrigger
                  id={modelFieldId}
                  className={cn(
                    "h-12 w-full font-mono text-[18px] transition-all duration-150 data-placeholder:font-sans data-placeholder:text-muted-foreground/80",
                    highlightedFields?.has("model") && requiredHighlightClass,
                  )}
                >
                  <SelectValue placeholder="Please select a model" />
                </SelectTrigger>
                <SelectContent className="font-mono">
                  {GEMINI_SUGGESTED_MODELS.map((model) => (
                    <SelectItem
                      key={model}
                      value={model}
                      className="font-mono text-[18px]"
                    >
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {highlightedFields?.has("model") && (
                <RequiredPill className="right-6" />
              )}
            </div>
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
          className="h-11 w-full font-mono text-body data-placeholder:font-sans data-placeholder:text-muted-foreground/80"
        >
          <SelectValue placeholder={`Default (${placeholder})`} />
        </SelectTrigger>
        <SelectContent className="font-mono">
          <SelectItem value="default" className="font-mono text-body">
            Default ({placeholder})
          </SelectItem>
          {GEMINI_SUGGESTED_MODELS.map((model) => (
            <SelectItem
              key={model}
              value={model}
              className="font-mono text-body"
            >
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
