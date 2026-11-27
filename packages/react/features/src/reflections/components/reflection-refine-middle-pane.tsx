import type { TimeWindow } from "@kalaido/client/kalaidoscope/chat";
import {
  ContextBar,
  type ContextItem,
  RefineChatPanel,
  RefineComposer,
} from "@kalaido/components";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { Label } from "@kalaido/primitives/kalaido";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Input } from "@kalaido/primitives/shadcn/input";
import type { ReflectionRefineTab } from "../refine-state";
import { CADENCE_WIN, CADENCES } from "../schedule";
import { RefineConfigPanel } from "./refine-config-panel";
import { SchedulePill } from "./schedule-controls";
import { StandingLensEditor } from "./standing-lens-editor";

export interface ReflectionRefineMiddlePaneProps {
  activeTab: ReflectionRefineTab;
  onTabChange: (tab: ReflectionRefineTab) => void;
  lensDirty: boolean;
  scheduleDirty: boolean;
  started: boolean;
  isNew: boolean;
  isEstablished: boolean;
  fromNote: string | undefined;
  session: RefineSession;
  lensPrompt: string;
  onLensPromptChange: (next: string) => void;
  cadence: number;
  onCadenceChange: (next: number) => void;
  fromDate: string;
  onFromDateChange: (next: string) => void;
  endDate: string;
  onEndDateChange: (next: string) => void;
  paused: boolean;
  onPausedChange: (next: boolean) => void;
  context: ContextItem[];
  activeWindow: TimeWindow | undefined;
  input: string;
  nameInput: string;
  creating: boolean;
  busy: boolean;
  onInputChange: (next: string) => void;
  onNameInputChange: (next: string) => void;
  onContextChange: (next: ContextItem[]) => void;
  onMention: (item: ContextItem) => void;
  onStartReflection: () => void;
}

function TuningTabButton({
  label,
  selected,
  dirty,
  onClick,
}: {
  label: string;
  selected: boolean;
  dirty: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 border-b-2 px-4 py-2.5 text-label font-semibold uppercase tracking-[0.14em] transition-colors",
        selected
          ? "border-section text-fg-1"
          : "border-transparent text-fg-4 hover:bg-surface-2 hover:text-fg-2",
      )}
    >
      <span>{label}</span>
      {dirty && (
        <>
          <span
            aria-hidden="true"
            className="size-[5px] shrink-0 rounded-full bg-section"
          />
          <span className="sr-only"> (unsaved changes)</span>
        </>
      )}
    </button>
  );
}

/**
 * Left-hand 2-tab tuning workspace (`Lens` | `Schedule & Sources`) sitting
 * beside the persistent Preview pane. Keeps lens authoring period-agnostic and
 * stages all schedule, source, and standing-lens edits locally until Save.
 */
export function ReflectionRefineMiddlePane({
  activeTab,
  onTabChange,
  lensDirty,
  scheduleDirty,
  started,
  isNew,
  isEstablished,
  fromNote,
  session,
  lensPrompt,
  onLensPromptChange,
  cadence,
  onCadenceChange,
  fromDate,
  onFromDateChange,
  endDate,
  onEndDateChange,
  paused,
  onPausedChange,
  context,
  activeWindow,
  input,
  nameInput,
  creating,
  busy,
  onInputChange,
  onNameInputChange,
  onContextChange,
  onMention,
  onStartReflection,
}: ReflectionRefineMiddlePaneProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col border-r border-line">
      <div
        role="tablist"
        aria-label="Reflection tuning tabs"
        className="flex shrink-0 items-center border-b border-line bg-surface-1 px-2"
      >
        <TuningTabButton
          label="Lens"
          selected={activeTab === "lens"}
          dirty={lensDirty}
          onClick={() => onTabChange("lens")}
        />
        <TuningTabButton
          label="Schedule & Sources"
          selected={activeTab === "schedule"}
          dirty={scheduleDirty}
          onClick={() => onTabChange("schedule")}
        />
      </div>

      {activeTab === "lens" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <StandingLensEditor
            value={lensPrompt}
            onChange={onLensPromptChange}
            disabled={busy}
          />
          {started ? (
            <RefineChatPanel
              session={session}
              context={context}
              hideContextBar
              onMention={onMention}
              onContextChange={onContextChange}
              entity="reflection"
              placeholder={
                isEstablished
                  ? "‘group by project and lead with blockers’…"
                  : "Describe how to refine this standing lens…"
              }
            />
          ) : !isNew ? (
            <RefineComposer preparing />
          ) : (
            <RefineComposer
              helperText="Describe the recurring summary you want. Configure cadence and sources in Schedule & Sources anytime before saving."
              helperTextClassName="max-w-[75%]"
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
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
          <RefineConfigPanel
            cadence={cadence}
            onCadenceChange={onCadenceChange}
            fromDate={fromDate}
            onFromDateChange={onFromDateChange}
            fromDisabled={isEstablished}
            fromNote={fromNote}
            endDate={endDate}
            onEndDateChange={onEndDateChange}
            paused={paused}
            onPausedChange={onPausedChange}
          />
          <SchedulePill
            freq={paused ? "Paused" : CADENCES[cadence]}
            win={`${CADENCE_WIN[cadence]} · auto-approved`}
          />
          <div className="flex flex-col gap-2">
            <Label>Sources</Label>
            <p className="text-meta text-fg-4">
              Reflections summarize fragments and colours only. Changes update
              sample window counts immediately and persist on Save.
            </p>
            <div className="border border-line bg-surface-1">
              <ContextBar
                items={context}
                onChange={onContextChange}
                entity="reflection"
                timeWindow={activeWindow}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
