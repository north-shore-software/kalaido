export type EntityKind = "projection" | "reflection";

export interface PinItem {
  id: string;
  kind: EntityKind;
  name: string;
}

/**
 * What taking up this row does: review a candidate that is already waiting,
 * generate one and review it, or just open the entity because there is nothing
 * actionable yet (blocked upstream, or a reflection, which has no review gate).
 */
export type NeedAction = "review" | "refresh" | "open";

export interface NeedItem {
  id: string;
  kind: EntityKind;
  name: string;
  meta: string;
  action: NeedAction;
  /** Pending review candidate id (projections only). */
  candidateId?: string;
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
  fragments: number;
}

export interface RecentFragment {
  id: string;
  type: string;
  time: string;
  day: string;
  colours: number[];
}
