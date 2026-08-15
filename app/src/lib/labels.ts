import { FragmentTypeOptions } from "@/api/kalaidoscope/types";

const FRAGMENT_TYPE_LABELS: Record<FragmentTypeOptions, string> = {
  email: "Email",
  note: "Note",
  whatsapp: "WhatsApp",
  sms: "SMS",
  chat: "Chat",
};

export function fragmentTypeLabel(type: string): string {
  const label = FRAGMENT_TYPE_LABELS[type as FragmentTypeOptions];
  if (label) return label;
  // Some rows carry types the generated enum doesn't know about (stale
  // schemas) — fall back to a readable label.
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Fragment";
}

export interface FragmentTypeOption {
  value: FragmentTypeOptions;
  label: string;
}

export const FRAGMENT_TYPE_OPTIONS: FragmentTypeOption[] = Object.values(
  FragmentTypeOptions,
).map((value) => ({ value, label: fragmentTypeLabel(value) }));
