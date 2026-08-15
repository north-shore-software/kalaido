import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/css-utils";

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border px-1.5 py-[3px] font-mono text-pill whitespace-nowrap uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "border-line-strong text-fg-3 tracking-[0.08em]",
        secondary: "border-line text-fg-4 tracking-[0.08em]",
        destructive:
          "border-critical/45 bg-critical-wash text-critical-ink focus-visible:ring-destructive/40",
        outline: "border-line-strong text-fg-3 tracking-[0.08em]",
        ghost: "border-transparent text-fg-4 hover:text-fg-2",
        link: "border-transparent text-cyan-ink underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
