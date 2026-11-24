import { getHost } from "@kalaido/platform";
import {
  MarkdownContent as PrimitiveMarkdownContent,
  type MarkdownContentProps,
  type MarkdownVariant,
} from "@kalaido/primitives/kalaido/markdown-content";
import { useCallback } from "react";

export type { MarkdownContentProps, MarkdownVariant };

export function MarkdownContent({
  onOpenLink,
  ...props
}: MarkdownContentProps) {
  const handleOpenLink = useCallback(
    (href: string) => {
      if (onOpenLink) {
        onOpenLink(href);
        return;
      }
      void getHost()
        .openExternalUrl(href)
        .then((result) => {
          if (result.isErr()) window.open(href, "_blank", "noreferrer");
        });
    },
    [onOpenLink],
  );

  return <PrimitiveMarkdownContent {...props} onOpenLink={handleOpenLink} />;
}
