/**
 * A post-kalaidoscope-creation action seeded from a template, rendered as a card on the
 * home page. Only `import` exists today. Persisted per kalaidoscope.
 */
export interface KalaidoscopeAction {
  id: string;
  type: "import";
  title: string;
  description: string;
  icon?: string;
}
