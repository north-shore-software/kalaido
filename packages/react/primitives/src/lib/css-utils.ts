import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "display",
        "card-title",
        "body",
        "row",
        "item",
        "body-sm",
        "btn",
        "meta",
        "btn-sm",
        "mono-sm",
        "label",
        "crumb",
        "pill",
      ],
      shadow: ["cyan"],
      "drop-shadow": ["magenta"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
