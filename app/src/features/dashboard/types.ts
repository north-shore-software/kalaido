import type { SourceItem } from "@/components/kalaido";

export type EntityKind = "projection" | "reflection";

export interface PinItem {
  id: string;
  kind: EntityKind;
  name: string;
}

/**
 * A projection or reflection a discover run proposed and nobody has opened
 * yet: a name, an opening message and a scope, with no lens or snapshot.
 */
export interface ProposedItem {
  id: string;
  kind: EntityKind;
  name: string;
  message: string;
  sources: SourceItem[];
}

export interface RecentFragment {
  id: string;
  type: string;
  title?: string;
  time: string;
  day: string;
  colours: number[];
}
