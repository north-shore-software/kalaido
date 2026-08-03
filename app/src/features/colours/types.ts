// A Colour is a reusable, AI-based filter over fragments (a "topic lens"). Users
// define one with natural-language `criteria`; the backend materializes which
// fragments match into the `colour_fragment` join. A colour can be selected as a
// context category for a projection, alongside fragment types and source
// projections.
export interface Colour {
  id: string;
  name: string;
  criteria: string;
  createdAt: string;
  updatedAt: string;
}
