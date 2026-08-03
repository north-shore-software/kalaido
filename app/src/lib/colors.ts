/** A stable swatch colour per id so cards aren't all identical.
 *  The `% 8` is coupled to the 8-colour `ColourSwatch` palette. */
export function swatchIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % 8;
  return h;
}
