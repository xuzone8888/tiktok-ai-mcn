import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        // ============================================================================
        // JCUI 2.0 Mermaid Glass Status (Final)
        // ============================================================================
        // Mermaid: Brand Gradient
        "mermaid": "border-transparent bg-gradient-to-r from-mermaid-lime via-mermaid-cyan to-mermaid-pink text-black font-bold shadow-[0_0_15px_rgba(0,242,234,0.4)]",
        // Neon Success (Green)
        "neon-success": "border-transparent bg-[#22c55e]/10 text-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.2)]",
        // Neon Warning (Amber)
        "neon-warning": "border-transparent bg-[#f59e0b]/10 text-[#f59e0b] shadow-[0_0_10px_rgba(245,158,11,0.2)]",
        // Neon Error (Red)
        "neon-error": "border-transparent bg-[#ef4444]/10 text-[#ef4444] shadow-[0_0_10px_rgba(239,68,68,0.2)]",
        // Neon Info (Blue)
        "neon-info": "border-transparent bg-[#3b82f6]/10 text-[#3b82f6] shadow-[0_0_10px_rgba(59,130,246,0.2)]",
        // Glass: Premium Neutral
        "glass": "border-white/10 bg-white/5 text-white/70 backdrop-blur-md",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

