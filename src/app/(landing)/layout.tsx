import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ToryX - AI驱动的短视频创作平台",
  description: "一站式AI内容创作解决方案，从图片生成、视频制作到数字人模特，让每一个创作者都能高效产出专业级短视频内容。",
  keywords: ["AI视频", "短视频制作", "电商图片", "AI模特", "TikTok", "内容创作"],
};

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
