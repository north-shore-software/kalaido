import {
  ChatCircleIcon,
  EnvelopeIcon,
  FileTextIcon,
  type Icon,
  KanbanIcon,
  NoteIcon,
  PencilLineIcon,
} from "@phosphor-icons/react";

export function fragmentTypeIcon(type: string): Icon {
  const t = type.toLowerCase();
  if (t.includes("email") || t.includes("mail")) return EnvelopeIcon;
  if (t.includes("message")) return ChatCircleIcon;
  if (t.includes("linear")) return KanbanIcon;
  if (t.includes("note")) return NoteIcon;
  if (t.includes("edit")) return PencilLineIcon;
  return FileTextIcon; // doc, google doc, and the catch-all
}
