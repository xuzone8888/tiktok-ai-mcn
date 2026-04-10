import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legal Notice - Wuhan Guanxing Cultural Media Co., Ltd. (Star Gaze)",
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
