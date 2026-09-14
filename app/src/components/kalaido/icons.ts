import {
  FileTextIcon,
  type LucideIcon,
  MailIcon,
  MessageCircleIcon,
  PencilLineIcon,
  SquareKanbanIcon,
  StickyNoteIcon,
} from "lucide-react";

export function fragmentTypeIcon(type: string): LucideIcon {
  const t = type.toLowerCase();
  if (t.includes("email") || t.includes("mail")) return MailIcon;
  if (t.includes("message")) return MessageCircleIcon;
  if (t.includes("linear")) return SquareKanbanIcon;
  if (t.includes("note")) return StickyNoteIcon;
  if (t.includes("edit")) return PencilLineIcon;
  return FileTextIcon; // doc, google doc, and the catch-all
}
