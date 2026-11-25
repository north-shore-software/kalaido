import type { TimeWindow } from "@kalaido/client/kalaidoscope/chat";
import {
  ContextBar,
  type ContextItem,
  RefineChatPanel,
  RefineComposer,
} from "@kalaido/components";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { Input } from "@kalaido/primitives/shadcn/input";

export interface ReflectionRefineMiddlePaneProps {
  started: boolean;
  isNew: boolean;
  session: RefineSession;
  context: ContextItem[];
  activeWindow: TimeWindow | undefined;
  input: string;
  nameInput: string;
  creating: boolean;
  onInputChange: (next: string) => void;
  onNameInputChange: (next: string) => void;
  onContextChange: (next: ContextItem[]) => void;
  onMention: (item: ContextItem) => void;
  onStartReflection: () => void;
}

export function ReflectionRefineMiddlePane({
  started,
  isNew,
  session,
  context,
  activeWindow,
  input,
  nameInput,
  creating,
  onInputChange,
  onNameInputChange,
  onContextChange,
  onMention,
  onStartReflection,
}: ReflectionRefineMiddlePaneProps) {
  if (started) {
    return (
      <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
        <RefineChatPanel
          session={session}
          title={isNew ? "Define the summary" : "Refine the lens"}
          context={context}
          onMention={onMention}
          onContextChange={onContextChange}
          entity="reflection"
          timeWindow={activeWindow}
          placeholder={
            isNew ? undefined : "‘group by project and lead with blockers’…"
          }
        />
      </div>
    );
  }

  if (!isNew) {
    return (
      <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
        <RefineComposer preparing />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
      <RefineComposer
        title="Define the summary"
        helperText="Describe the summary you want. Your first message creates the reflection and starts generating a draft."
        helperTextClassName="max-w-[70%]"
        value={input}
        onChange={onInputChange}
        placeholder="‘a tight weekly work-snippet of what shipped’…"
        disabled={creating}
        onSubmit={onStartReflection}
        onMention={onMention}
        nameField={
          <div className="shrink-0 px-4 pb-3">
            <Input
              value={nameInput}
              onChange={(e) => onNameInputChange(e.target.value)}
              placeholder="Name (optional — Kalaido will suggest one)"
              aria-label="Reflection name"
              disabled={creating}
            />
          </div>
        }
        beforeInput={
          <ContextBar
            items={context}
            onChange={onContextChange}
            entity="reflection"
            timeWindow={activeWindow}
          />
        }
      />
    </div>
  );
}
