// Kalaido hi-fi scaffold primitives — idiomatic shadcn/Tailwind equivalents of
// the design-mock kit, driven entirely by the design tokens in index.css so
// they render correctly in both light and dark themes.
export { Bar, Lines, DocBody } from "./bars";
export { Mark } from "./brand";
export { Label, Mono } from "./text";
export { StatusPill, type StatusKind } from "./status-pill";
export { ColourSwatch, contentColour } from "./colour";
export { Metric } from "./metric";
export { Timeline, type TimelineItem } from "./timeline";
export { FragmentCard } from "./fragment-card";
export { ListRow } from "./list-row";
export { DiffLine } from "./diff";
export {
  ContextPicker,
  type ContextPickerProps,
  ContextSummary,
  type ContextSummaryProps,
  type ContextItem,
  type ContextKind,
  type EntityKind,
} from "./context-picker";
export { ChatPanel } from "./chat-panel";
export {
  ChatMessages,
  MessageBubble,
  type ChatMessagesProps,
  type MessageBubbleProps,
} from "./chat-messages";
export { ChatComposer, type ChatComposerProps } from "./chat-composer";
export { RefineChatPanel } from "./refine-chat-panel";
export { Segmented } from "./segmented";
export { SurfaceCard, surfaceCardClass } from "./surface-card";
export { Pill } from "./pill";
export { Chip } from "./chip";
export { DocumentCard } from "./document-card";
export { PinToggle } from "./pin-toggle";
export { EmptyState } from "./empty-state";
export { fragmentTypeIcon } from "./icons";
export { RefineComposer } from "./refine-composer";
