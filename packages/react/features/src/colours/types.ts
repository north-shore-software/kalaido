/**
 * A colour composed from fragments that already exist — a chat's saved
 * bookmarks. Passed as router state; the composer opens with them as the
 * positive examples the preview judges with and the colour pins on create.
 */
export interface ColourSeed {
  positiveExamples: string[];
}
