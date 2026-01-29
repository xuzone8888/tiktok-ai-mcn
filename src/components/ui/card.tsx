import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Card 变体定义
const cardVariants = cva(
  "rounded-xl border text-card-foreground transition-all duration-300",
  {
    variants: {
      variant: {
        default: "bg-card shadow",
        // JCUI 1.0 Crystal: 水晶风格毛玻璃卡片
        crystal:
          "bg-[#15161A]/80 backdrop-blur-xl border-white/[0.08] hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)] group",
        // JCUI 1.0 Crystal Elevated: 带发光边框的高亮版本
        "crystal-elevated":
          "bg-[#15161A]/80 backdrop-blur-xl border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] hover:border-white/30 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] group",
        // ============================================================================
        // JCUI 2.0 Mermaid Glass (Final)
        // ============================================================================
        // Mermaid: Aurora Card (Breathing Border)
        "mermaid":
          "bg-[#050505] border-transparent relative rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] before:absolute before:inset-0 before:rounded-xl before:p-[1px] before:bg-gradient-to-br before:from-mermaid-lime before:via-mermaid-cyan before:to-mermaid-pink before:-z-10 before:opacity-50 hover:before:opacity-100 transition-all duration-500",
        // Glass: Standard Container
        "glass":
          "bg-[#0B0C10] border border-white/10 hover:border-white/20 transition-all duration-500 shadow-none hover:shadow-lg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof cardVariants> { }

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, className }))}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
