// Kalaido hi-fi scaffold primitives — idiomatic shadcn/Tailwind equivalents of
// the design-mock kit, driven entirely by the design tokens in index.css so
// they render correctly in both light and dark themes.
export { Bar, DocBody, Lines } from "./bars";
export { Mark } from "./brand";
export { ChatComposer, type ChatComposerProps } from "./chat-composer";
export {
  ChatMessages,
  type ChatMessagesProps,
  MessageBubble,
  type MessageBubbleProps,
} from "./chat-messages";
export { ChatPanel } from "./chat-panel";
export { Chip } from "./chip";
export { ColourSwatch, contentColour } from "./colour";
export {
  ContextBar,
  type ContextBarProps,
} from "./context-bar/context-bar";
export type {
  ContextItem,
  ContextKind,
  EntityKind,
} from "./context-picker";
export { DiffLine } from "./diff";
export { DocumentCard } from "./document-card";
export { EditableText, type EditableTextProps } from "./editable-text";
export { EmptyState } from "./empty-state";
export { FragmentCard } from "./fragment-card";
export { fragmentTypeIcon } from "./icons";
export { ListRow } from "./list-row";
export {
  MarkdownContent,
  type MarkdownContentProps,
  type MarkdownVariant,
} from "./markdown-content";
export { Metric } from "./metric";
export {
  type OptionCard,
  OptionCards,
  type OptionCardsProps,
} from "./option-cards";
export { Pill } from "./pill";
export { PinToggle } from "./pin-toggle";
export { RefineChatPanel } from "./refine-chat-panel";
export { RefineComposer } from "./refine-composer";
export { Segmented } from "./segmented";
export { type StatusKind, StatusPill } from "./status-pill";
export { SurfaceCard, surfaceCardClass } from "./surface-card";
export { Label, Mono } from "./text";
export { Timeline, type TimelineItem } from "./timeline";
