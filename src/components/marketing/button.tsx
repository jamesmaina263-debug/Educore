import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Marketing site's own button, deliberately separate from
// components/ui/button.tsx (which the entire authenticated app shell uses
// on the neutral/blue admin theme). Keeping these independent means a
// marketing-site styling change can never regress the product UI, and vice
// versa. Variant naming mirrors the product button's API (default/outline/
// ghost/link + sm/default/lg) so the two feel like siblings to a developer
// switching between them, even though the visual language differs.
const marketingButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marketing-gold-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Primary CTA: gold fill on navy ink text. Reserved for the one
        // action per section that should draw the eye -- "Book a Demo",
        // final-CTA buttons. Not used for every button on a page.
        default:
          "bg-marketing-gold-500 text-marketing-navy-950 shadow-sm hover:bg-marketing-gold-400",
        // Secondary action on a light (canvas) background.
        outline:
          "border border-marketing-navy-900/15 bg-transparent text-marketing-navy-900 hover:bg-marketing-navy-900/5",
        // Secondary action on a dark (navy) background -- e.g. nav bar,
        // dark hero. Gold-on-transparent, not gold-filled, so it doesn't
        // compete with the one true primary CTA on the page.
        "outline-on-dark":
          "border border-marketing-gold-500/40 bg-transparent text-marketing-gold-300 hover:bg-white/5 hover:border-marketing-gold-500/70",
        ghost: "text-marketing-navy-900 hover:bg-marketing-navy-900/5",
        "ghost-on-dark": "text-white/90 hover:bg-white/10",
        link: "text-marketing-blue underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-md px-4 text-sm",
        lg: "h-12 rounded-md px-7 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface MarketingButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof marketingButtonVariants> {
  asChild?: boolean;
}

const MarketingButton = React.forwardRef<HTMLButtonElement, MarketingButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(marketingButtonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
MarketingButton.displayName = "MarketingButton";

export { MarketingButton, marketingButtonVariants };
