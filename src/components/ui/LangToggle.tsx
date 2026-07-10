"use client";

import { Globe } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ============================================================================
// LangToggle — 主应用 Header 用的语言切换按钮（下拉菜单款式，与 ThemeToggle 一致）
// ============================================================================

export function LangToggle() {
  const { lang, setLang } = useLang();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-9 w-9 rounded-lg",
            "hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring",
            "transition-colors duration-200"
          )}
          title={lang === "zh" ? "切换语言" : "Switch Language"}
        >
          <Globe className="h-[18px] w-[18px] text-muted-foreground" />
          <span className="sr-only">{lang === "zh" ? "切换语言" : "Switch Language"}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className={cn(
          "w-36 p-1",
          "bg-popover/95 backdrop-blur-xl",
          "border border-border/50",
          "shadow-lg shadow-black/10 dark:shadow-black/30"
        )}
      >
        <DropdownMenuItem
          onClick={() => setLang("zh")}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors duration-150",
            lang === "zh" ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
          )}
        >
          <span>🇨🇳</span>
          <span className="flex-1">中文</span>
          {lang === "zh" && <span className="text-xs text-primary">✓</span>}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => setLang("en")}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors duration-150",
            lang === "en" ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
          )}
        >
          <span>🇺🇸</span>
          <span className="flex-1">English</span>
          {lang === "en" && <span className="text-xs text-primary">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
