/**
 * A proposed reflection being taken up from the dashboard. Passed as router
 * state by the Proposed group: the row already exists with its scope and
 * schedule, so all that is seeded is the opening message, sent verbatim as
 * the first turn (it is already the user's own instruction).
 */
export interface ReflectionSeed {
  message: string;
}
