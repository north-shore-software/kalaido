import * as Icons from "lucide-react";
import { FileIcon, type LucideIcon } from "lucide-react";

/**
 * Resolve a lucide icon by its export name (e.g. "MailIcon"), for icons defined
 * as strings in JSON templates. Falls back to FileIcon for missing/unknown names.
 * Mirrors the lookup in `icon-picker.tsx`.
 */
export function iconByName(name?: string): LucideIcon {
  if (!name) return FileIcon;
  const ic = (Icons as Record<string, unknown>)[name];
  return (ic as LucideIcon) ?? FileIcon;
}
