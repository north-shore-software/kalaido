import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/css-utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border border-transparent bg-clip-padding font-semibold whitespace-nowrap uppercase transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "border-line-strong bg-transparent text-fg-2 hover:border-fg-3 hover:text-fg-1 aria-expanded:border-fg-3 aria-expanded:text-fg-1",
        commit:
          "bg-magenta font-bold text-magenta-foreground drop-shadow-magenta clip-chamfer hover:opacity-[0.86] focus-visible:ring-magenta/50",
        outline:
          "border-fg-3 bg-transparent text-fg-1 hover:border-fg-1 aria-expanded:border-fg-1",
        secondary:
          "bg-surface-2 text-fg-1 hover:bg-surface-3 aria-expanded:bg-surface-3",
        ghost:
          "bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg-1 aria-expanded:bg-surface-2 aria-expanded:text-fg-1",
        destructive:
          "border-destructive/40 bg-transparent text-destructive hover:border-destructive focus-visible:ring-destructive/40",
        link: "text-cyan-ink underline underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-2 px-3.5 text-btn has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1.5 px-2 text-btn-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[25px] gap-2 px-3 text-btn-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "h-10 gap-2 px-5 text-btn has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
