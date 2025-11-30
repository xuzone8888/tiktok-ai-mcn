"use client";

import { Button } from "@/components/ui/button";
import { ShieldX, Mail, LogOut } from "lucide-react";
import Link from "next/link";

export default function BannedPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {/* 图标 */}
        <div className="relative inline-flex mb-8">
          <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping" />
          <div className="relative h-24 w-24 rounded-full bg-red-500/10 flex items-center justify-center border-2 border-red-500/30">
            <ShieldX className="h-12 w-12 text-red-500" />
          </div>
        </div>

        {/* 标题 */}
        <h1 className="text-3xl font-bold text-red-500 mb-4">账号已被封禁</h1>
        
        {/* 说明 */}
        <p className="text-muted-foreground mb-8">
          您的账号因违反平台使用条款而被暂停使用。
          如果您认为这是一个错误，请联系客服申诉。
        </p>

        {/* 操作按钮 */}
        <div className="space-y-3">
          <Button
            asChild
            className="w-full bg-gradient-to-r from-tiktok-cyan to-blue-500 text-black font-semibold"
          >
            <a href="mailto:support@mcn.ai">
              <Mail className="h-4 w-4 mr-2" />
              联系客服申诉
            </a>
          </Button>

          <Button
            variant="outline"
            asChild
            className="w-full border-white/20"
          >
            <Link href="/api/auth/signout">
              <LogOut className="h-4 w-4 mr-2" />
              退出登录
            </Link>
          </Button>
        </div>

        {/* 底部说明 */}
        <p className="text-xs text-muted-foreground mt-8">
          如需帮助，请发送邮件至{" "}
          <a href="mailto:support@mcn.ai" className="text-tiktok-cyan hover:underline">
            support@mcn.ai
          </a>
        </p>
      </div>
    </div>
  );
}

