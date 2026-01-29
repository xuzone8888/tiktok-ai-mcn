import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Neumorphism (Uiverse 'Good Mouse' Exact Replica)
        "neumorphic":
          "relative overflow-hidden rounded-full bg-[#e0e0e0] text-[#4d4d4d] font-bold border-2 border-[#cecece] shadow-[inset_4px_4px_10px_#bcbcbc,inset_-4px_-4px_10px_#ffffff] hover:shadow-[inset_2px_2px_5px_#bcbcbc,inset_-2px_-2px_5px_#ffffff,2px_2px_5px_#bcbcbc,-2px_-2px_5px_#ffffff] transition-all active:scale-95 px-8 tracking-wider",
        // Titanium V3: Solid Refined (Brand Cyan)
        "solid-refined":
          "relative overflow-hidden border border-white/20 text-black font-bold bg-[#00F2EA] rounded-xl shadow-[0_0_20px_rgba(0,242,234,0.3)] hover:bg-[#50fffa] hover:shadow-[0_0_30px_rgba(0,242,234,0.6)] active:scale-95 transition-all tracking-wide",
        // White Glow: 主页原版白色发光按钮
        "white-glow":
          "bg-gradient-to-b from-white to-gray-100 text-black hover:to-white rounded-xl font-medium shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] transition-all duration-300 border-t border-white hover:scale-[1.02] active:scale-95",
        // ============================================================================
        // JCUI 1.0 Titanium Silver 系列
        // ============================================================================
        // Titanium: 主按钮 (纯白发光)
        "titanium":
          "relative overflow-hidden bg-white text-black hover:bg-white/90 rounded-lg font-bold shadow-[0_0_15px_rgba(255,255,255,0.15)] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] transition-all duration-300 active:scale-95",
        // Titanium Ghost: 次级玻璃按钮
        "titanium-ghost":
          "bg-white/10 text-white hover:bg-white/20 border border-white/10 hover:border-white/20 rounded-lg font-medium transition-all duration-300 active:scale-95",
        // Titanium Outline: 轮廓按钮
        "titanium-outline":
          "bg-transparent text-white border border-white/20 hover:border-white/40 hover:bg-white/5 rounded-lg font-medium transition-all duration-300 active:scale-95",
        // ============================================================================
        // JCUI 2.0 Mermaid Glass (Final)
        // ============================================================================
        // Mermaid: Primary Action (Holographic Gradient)
        "mermaid":
          "relative overflow-hidden bg-gradient-to-r from-mermaid-lime via-mermaid-cyan to-mermaid-pink text-black font-bold border border-white/20 shadow-[0_0_20px_rgba(0,242,234,0.3)] hover:shadow-[0_0_30px_rgba(0,242,234,0.5),0_0_20px_rgba(204,255,0,0.4)] hover:scale-[1.02] active:scale-95 transition-all duration-300 tracking-wide",
        // Mermaid Ghost: Secondary (Glass + Gradient Text/Border effect)
        "mermaid-ghost":
          "relative overflow-hidden bg-white/5 text-white border border-white/10 hover:bg-white/10 hover:border-mermaid-cyan/50 hover:text-mermaid-cyan transition-all duration-300 active:scale-95 backdrop-blur-sm",
        // Mermaid Icon: For icon-only buttons
        "mermaid-icon":
          "bg-[#0B0C10] border border-white/10 text-white/70 hover:text-mermaid-cyan hover:border-mermaid-cyan/50 hover:bg-mermaid-cyan/5 transition-all duration-300 active:scale-90 shadow-none hover:shadow-[0_0_15px_rgba(0,242,234,0.1)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
