const fs = require('fs');
const content = fs.readFileSync('e:/TIKTOK-AI/src/app/(main)/character/create/components/casting-preview.tsx', 'utf8');

const jsxMatch = content.match(/<div className="hero-bg-container">([\s\S]*?)<\/style>/);
if (!jsxMatch) {
  console.error("Could not find JSX/CSS block");
  process.exit(1);
}

let extracted = '<div className="hero-bg-container">' + jsxMatch[1] + '</style>';

// Replacements to decouple from store/state
extracted = extracted.replace(/src=\{generatedImageUrl\}/, 'src="https://images.unsplash.com/photo-1544502062-f82887f03d1c?q=80&w=2000&auto=format&fit=crop" style={{ filter: "brightness(0.8)" }}');
extracted = extracted.replace(/value=\{store\.characterName\}/, 'value="九尾狐"');
extracted = extracted.replace(/store\.characterTags\.length > 0 \? \([\s\S]*?\) : \([\s\S]*?\)/, '<span className="mer-pill">森林冒险</span><span className="mer-pill">奇幻</span>');
extracted = extracted.replace(/store\.isSaving \? "保存中\.\.\." : "保存当前角色"/, '"保存当前角色"');
extracted = extracted.replace(/disabled=\{!store\.characterName\.trim\(\) \|\| store\.isSaving\}/, '');
extracted = extracted.replace(/className=\{`video-prep-label \$\{store\.referenceReady \? 'is-ready' : ''\}`\}/, 'className="video-prep-label is-ready"');
extracted = extracted.replace(/store\.referenceReady \? '✓ 视频资源已就绪' : '视频资源准备中'/, '"✓ 视频资源已就绪"');
extracted = extracted.replace(/className=\{`video-prep-fill \$\{store\.referenceReady \? 'is-ready' : ''\}`\}/, 'className="video-prep-fill is-ready"');
extracted = extracted.replace(/opacity: store\.referenceReady \? 1 : 0\.4/, 'opacity: 1');
extracted = extracted.replace(/pointerEvents: store\.referenceReady \? 'auto' : 'none'/, "pointerEvents: 'auto'");
extracted = extracted.replace(/className=\{`btn-activate \$\{store\.referenceReady \? 'btn-activate--ready' : 'btn-activate--pending'\}`\}/, 'className="btn-activate btn-activate--ready"');
extracted = extracted.replace(/store\.referenceReady \? '▶ 生成动态视频 \(消耗 10 积分\)' : '⏳ 视频资源准备中\.\.\.'/, "'▶ 生成动态视频 (消耗 10 积分)'");
extracted = extracted.replace(/disabled=\{!store\.referenceReady \|\| store\.isSaving\}/g, '');
extracted = extracted.replace(/onClick=\{[^\}]+\}/g, '');
extracted = extracted.replace(/onChange=\{[^\}]+\}/g, '');
extracted = extracted.replace(/onKeyDown=\{[^\}]+\}/g, '');

const finalPage = `
"use client";
import React, { useState } from "react";

export default function PreviewLayoutPage() {
  const [tagInput, setTagInput] = useState("");
  return (
    <div className="casting-preview" style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#050505" }}>
      ${extracted}
    </div>
  );
}
`;

fs.mkdirSync('e:/TIKTOK-AI/src/app/(main)/character/preview-layout', { recursive: true });
fs.writeFileSync('e:/TIKTOK-AI/src/app/(main)/character/preview-layout/page.tsx', finalPage, 'utf8');
console.log("SUCCESS");
