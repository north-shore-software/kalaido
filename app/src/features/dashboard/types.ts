export type EntityKind = "projection" | "reflection";

export interface PinItem {
  id: string;
  kind: EntityKind;
  name: string;
}

export interface NeedItem {
  id: string;
  kind: EntityKind;
  name: string;
  meta: string;
  /** Pending review candidate id (projections only). */
  candidateId?: string;
}

export interface RecentFragment {
  id: string;
  type: string;
  time: string;
  day: string;
  colours: number[];
}
