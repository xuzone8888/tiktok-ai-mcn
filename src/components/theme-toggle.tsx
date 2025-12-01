"use client"

import * as React from "react"
import { Moon, Sun, Monitor, Check } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// ============================================================================
// Theme Toggle with Dropdown Menu
// 带下拉菜单的主题切换组件
// ============================================================================

export function ThemeToggle() {
  const { setTheme, theme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // 避免 hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg">
        <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
      </Button>
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn(
            "relative h-9 w-9 rounded-lg overflow-hidden",
            "hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring",
            "transition-colors duration-200"
          )}
        >
          {/* Sun Icon - 浅色模式显示 */}
          <Sun 
            className={cn(
              "absolute h-[18px] w-[18px] text-amber-500",
              "transition-all duration-500 ease-out",
              isDark 
                ? "rotate-90 scale-0 opacity-0" 
                : "rotate-0 scale-100 opacity-100"
            )} 
          />
          {/* Moon Icon - 深色模式显示 */}
          <Moon 
            className={cn(
              "absolute h-[18px] w-[18px] text-blue-400",
              "transition-all duration-500 ease-out",
              isDark 
                ? "rotate-0 scale-100 opacity-100" 
                : "-rotate-90 scale-0 opacity-0"
            )} 
          />
          <span className="sr-only">切换主题</span>
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        align="end" 
        className={cn(
          "w-40 p-1",
          "bg-popover/95 backdrop-blur-xl",
          "border border-border/50",
          "shadow-lg shadow-black/10 dark:shadow-black/30"
        )}
      >
        {/* Light Mode */}
        <DropdownMenuItem 
          onClick={() => setTheme("light")} 
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer",
            "transition-colors duration-150",
            theme === "light" 
              ? "bg-primary/10 text-primary" 
              : "hover:bg-muted/50"
          )}
        >
          <Sun className="h-4 w-4 text-amber-500" />
          <span className="flex-1">浅色模式</span>
          {theme === "light" && (
            <Check className="h-4 w-4 text-primary" />
          )}
        </DropdownMenuItem>

        {/* Dark Mode */}
        <DropdownMenuItem 
          onClick={() => setTheme("dark")} 
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer",
            "transition-colors duration-150",
            theme === "dark" 
              ? "bg-primary/10 text-primary" 
              : "hover:bg-muted/50"
          )}
        >
          <Moon className="h-4 w-4 text-blue-400" />
          <span className="flex-1">深色模式</span>
          {theme === "dark" && (
            <Check className="h-4 w-4 text-primary" />
          )}
        </DropdownMenuItem>

        {/* System Mode */}
        <DropdownMenuItem 
          onClick={() => setTheme("system")} 
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer",
            "transition-colors duration-150",
            theme === "system" 
              ? "bg-primary/10 text-primary" 
              : "hover:bg-muted/50"
          )}
        >
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">跟随系统</span>
          {theme === "system" && (
            <Check className="h-4 w-4 text-primary" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ============================================================================
// Theme Toggle Cycle Button
// 循环切换的主题按钮 (点击循环: light → dark → system → light)
// ============================================================================

export function ThemeToggleCycle() {
  const { setTheme, theme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const cycleTheme = () => {
    if (theme === "light") {
      setTheme("dark")
    } else if (theme === "dark") {
      setTheme("system")
    } else {
      setTheme("light")
    }
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg">
        <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
      </Button>
    )
  }

  const isDark = resolvedTheme === "dark"
  const isSystem = theme === "system"

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={cycleTheme}
      className={cn(
        "relative h-9 w-9 rounded-lg overflow-hidden group",
        "hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring",
        "transition-colors duration-200"
      )}
      title={`当前: ${theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统"}`}
    >
      {/* Sun Icon */}
      <Sun 
        className={cn(
          "absolute h-[18px] w-[18px]",
          "transition-all duration-500 ease-out",
          !isDark && !isSystem
            ? "rotate-0 scale-100 opacity-100 text-amber-500" 
            : "rotate-90 scale-0 opacity-0 text-amber-500"
        )} 
      />
      
      {/* Moon Icon */}
      <Moon 
        className={cn(
          "absolute h-[18px] w-[18px]",
          "transition-all duration-500 ease-out",
          isDark && !isSystem
            ? "rotate-0 scale-100 opacity-100 text-blue-400" 
            : "-rotate-90 scale-0 opacity-0 text-blue-400"
        )} 
      />

      {/* Monitor Icon (System) */}
      <Monitor 
        className={cn(
          "absolute h-[18px] w-[18px]",
          "transition-all duration-500 ease-out",
          isSystem
            ? "rotate-0 scale-100 opacity-100 text-muted-foreground" 
            : "rotate-90 scale-0 opacity-0 text-muted-foreground"
        )} 
      />

      {/* Hover indicator */}
      <span className={cn(
        "absolute inset-0 rounded-lg",
        "bg-gradient-to-br from-amber-500/0 to-blue-500/0",
        "group-hover:from-amber-500/10 group-hover:to-blue-500/10",
        "transition-all duration-300"
      )} />
      
      <span className="sr-only">切换主题</span>
    </Button>
  )
}

// ============================================================================
// Sidebar Theme Toggle
// 侧边栏专用的主题切换组件 (更紧凑的设计)
// ============================================================================

export function SidebarThemeToggle() {
  const { setTheme, theme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30">
        <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
        <span className="text-sm text-muted-foreground">加载中...</span>
      </div>
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/30 border border-border/50">
      {/* Light */}
      <button
        onClick={() => setTheme("light")}
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-md",
          "transition-all duration-200",
          theme === "light"
            ? "bg-background shadow-sm text-amber-500"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
        title="浅色模式"
      >
        <Sun className="h-4 w-4" />
      </button>

      {/* System */}
      <button
        onClick={() => setTheme("system")}
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-md",
          "transition-all duration-200",
          theme === "system"
            ? "bg-background shadow-sm text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
        title="跟随系统"
      >
        <Monitor className="h-4 w-4" />
      </button>

      {/* Dark */}
      <button
        onClick={() => setTheme("dark")}
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-md",
          "transition-all duration-200",
          theme === "dark"
            ? "bg-background shadow-sm text-blue-400"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
        title="深色模式"
      >
        <Moon className="h-4 w-4" />
      </button>
    </div>
  )
}
