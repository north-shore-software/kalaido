import { ChevronRight } from "lucide-react";
import { useId } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/kalaido";
import {
  GEMINI_SUGGESTED_MODELS,
  type LlmProvider,
  type LlmRole,
  LLM_ROLE_LABELS,
  LLM_ROLES,
} from "@/api/kalaidoscope/llm-config";

const PROVIDER_LABELS = ["Local Ollama", "Google Gemini"] as const;
type ProviderLabel = (typeof PROVIDER_LABELS)[number];

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
  const modelListId = useId();
  const apiKeyFieldId = useId();
  const modelFieldId = useId();

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Model provider
      </span>

      <Segmented<ProviderLabel>
        items={PROVIDER_LABELS}
        value={provider === "ollama" ? "Local Ollama" : "Google Gemini"}
        onChange={(label) =>
          onProviderChange(label === "Local Ollama" ? "ollama" : "gemini")
        }
        className="self-start"
      />

      {provider === "ollama" ? (
        <p className="text-xs text-muted-foreground">
          Runs models on this device through Ollama. Nothing is sent to a hosted
          provider.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Your key is stored in this workspace&apos;s own database and is used
            only for this workspace.
          </p>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={apiKeyFieldId}
              className="text-xs font-medium text-muted-foreground"
            >
              API key
            </label>
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
              className="text-xs font-medium text-muted-foreground"
            >
              Model
            </label>
            <Input
              id={modelFieldId}
              type="text"
              list={modelListId}
              value={defaultModel}
              disabled={disabled}
              onChange={(e) => onDefaultModelChange(e.target.value)}
              placeholder="Choose or type a model name"
            />
            <datalist id={modelListId}>
              {GEMINI_SUGGESTED_MODELS.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </div>

          <Collapsible className="flex flex-col gap-3">
            <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
              Advanced — use a different model per task
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3">
              {LLM_ROLES.map((role) => (
                <RoleField
                  key={role}
                  role={role}
                  value={roleModels[role] ?? ""}
                  placeholder={defaultModel || "Uses the model above"}
                  listId={modelListId}
                  disabled={disabled}
                  onChange={(model) => onRoleModelChange(role, model)}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

interface RoleFieldProps {
  role: LlmRole;
  value: string;
  placeholder: string;
  listId: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}

function RoleField({
  role,
  value,
  placeholder,
  listId,
  disabled,
  onChange,
}: RoleFieldProps) {
  const fieldId = useId();
  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={fieldId}
        className="w-40 shrink-0 text-xs text-muted-foreground"
      >
        {LLM_ROLE_LABELS[role]}
      </label>
      <Input
        id={fieldId}
        type="text"
        list={listId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
