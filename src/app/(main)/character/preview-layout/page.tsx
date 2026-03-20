"use client";

import React from "react";

/**
 * 纯静态布局预览页：模拟保存角色面板的视觉效果
 * 使用内联 style，不依赖 styled-jsx，不依赖外部图片
 */
export default function PreviewLayoutPage() {
  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 50,
      overflow: "hidden",
      background: "#0a0a0f",
    }}>
      {/* 返回按钮 */}
      <button style={{
        position: "absolute", top: "1.5rem", left: "1.5rem", zIndex: 10,
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.5rem 1rem", borderRadius: "2rem",
        background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.6)", fontSize: "0.85rem", cursor: "pointer",
      }} type="button">
        ‹ 返回预览
      </button>

      {/* 全屏沉浸背景层 - 使用渐变模拟暗色角色图 */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
        {/* 模拟角色图的渐变背景 */}
        <div style={{
          width: "100%", height: "100%",
          background: [
            "radial-gradient(ellipse at 30% 45%, rgba(34, 80, 60, 0.8) 0%, transparent 60%)",
            "radial-gradient(ellipse at 25% 35%, rgba(80, 60, 40, 0.6) 0%, transparent 50%)",
            "radial-gradient(ellipse at 35% 55%, rgba(40, 70, 50, 0.5) 0%, transparent 55%)",
            "linear-gradient(180deg, #0a1510 0%, #0d1a14 30%, #050a08 100%)",
          ].join(", "),
        }} />
        {/* 暗角遮罩 - 与 casting-preview.tsx 保持一致 */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: [
            "radial-gradient(circle at 20% 50%, transparent 0%, rgba(5,5,10,0.6) 80%)",
            "linear-gradient(90deg, transparent 30%, rgba(5,5,10,0.8) 70%, rgba(5,5,10,0.95) 100%)",
            "linear-gradient(0deg, rgba(5,5,10,0.9) 0%, transparent 20%)",
          ].join(", "),
        }} />
      </div>

      {/* 模拟人脸轮廓的装饰圆 */}
      <div style={{
        position: "absolute", left: "15%", top: "15%", width: "45vh", height: "60vh",
        borderRadius: "50%", zIndex: 1, pointerEvents: "none",
        background: "radial-gradient(ellipse, rgba(180,140,100,0.08) 0%, transparent 70%)",
        filter: "blur(30px)",
      }} />

      {/* 悬浮主操作面板 - right 使用百分比以适配 sidebar */}
      <div style={{
        position: "absolute",
        right: "5%",
        top: "50%",
        transform: "translateY(-50%)",
        width: "340px",
        maxWidth: "30vw",
        background: "rgba(15,15,20,0.4)",
        backdropFilter: "blur(80px)",
        WebkitBackdropFilter: "blur(80px)",
        borderRadius: "1.5rem",
        padding: "2rem 1.75rem",
        zIndex: 10,
        boxShadow: "0 20px 40px -10px rgba(0,0,0,0.5), inset 0 1px 0 0 rgba(255,255,255,0.05)",
      }}>
        {/* 顶部辉光线 */}
        <div style={{
          position: "absolute", top: "-2px", right: "2rem",
          width: "60px", height: "2px",
          background: "linear-gradient(90deg, transparent, rgba(0,242,234,0.8), transparent)",
          filter: "blur(2px)", opacity: 0.6,
        }} />

        {/* 角色名称 */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: "0.75rem", letterSpacing: "0.02em" }}>
            角色名称 <span style={{ color: "#00F2EA" }}>*</span>
          </label>
          <input
            type="text"
            placeholder="请输入角色名称"
            defaultValue="九尾狐"
            maxLength={50}
            style={{
              width: "100%", padding: "0.65rem 0.85rem",
              background: "rgba(255,255,255,0.03)", border: "1px solid transparent",
              borderRadius: "0.75rem", color: "white", fontSize: "0.85rem", outline: "none",
            }}
          />
        </div>

        {/* 核心风格序列 */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: "0.75rem", letterSpacing: "0.02em" }}>
            核心风格序列
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            <span style={{ padding: "0.35rem 0.7rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>森林冒险</span>
            <span style={{ padding: "0.35rem 0.7rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>奇幻</span>
            <div style={{ display: "flex", gap: "8px", width: "100%", marginTop: "6px" }}>
              <input type="text" placeholder="添加标签..." readOnly style={{
                flex: 1, background: "transparent", border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                color: "white", fontSize: "0.75rem", padding: "0.2rem 0", outline: "none",
              }} />
              <button disabled type="button" style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.2)",
                fontSize: "0.75rem", cursor: "not-allowed",
              }}>添加</button>
            </div>
          </div>
        </div>

        {/* 保存按钮 */}
        <button type="button" style={{
          width: "100%", padding: "0.7rem", borderRadius: "0.75rem",
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.05)",
          color: "rgba(255,255,255,0.9)", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ opacity: 0.7, marginRight: "6px" }}>💾</span>
          保存当前角色
        </button>
        <div style={{ textAlign: "center", fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "0.6rem" }}>
          保存后可在角色库中随时调用
        </div>

        {/* 分割线 */}
        <div style={{ display: "flex", alignItems: "center", margin: "1.25rem 0" }}>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" }} />
          <span style={{ padding: "0 0.8rem", fontSize: "0.65rem", color: "rgba(255,255,255,0.3)" }}>动态视频</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" }} />
        </div>

        {/* 视频资源进度条 */}
        <div style={{ margin: "0.6rem 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "0.7rem", color: "#4ade80" }}>✓ 视频资源已就绪</span>
            <button type="button" style={{
              fontSize: "0.62rem", padding: "2px 8px", borderRadius: "4px",
              border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.6)", cursor: "pointer",
            }}>查看参考图</button>
          </div>
          <div style={{ height: "3px", borderRadius: "2px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: "2px", width: "100%", background: "linear-gradient(90deg, #22c55e, #4ade80)" }} />
          </div>
        </div>

        {/* 预设动作库 */}
        <div style={{ marginTop: "0.8rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: "0.6rem" }}>预设动作库</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.8rem" }}>
            <div style={{ padding: "0.35rem 0.7rem", background: "rgba(255,255,255,1)", borderRadius: "2rem", fontSize: "0.75rem", color: "rgba(0,0,0,0.9)", fontWeight: 500, boxShadow: "0 0 15px -3px rgba(255,255,255,0.3)" }}>走路</div>
            <div style={{ padding: "0.35rem 0.7rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>打招呼</div>
            <div style={{ padding: "0.35rem 0.7rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>转身</div>
            <div style={{ padding: "0.35rem 0.7rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>自定义</div>
          </div>
        </div>

        {/* 生成视频按钮 */}
        <button type="button" style={{
          width: "100%", padding: "0.8rem", borderRadius: "0.75rem", border: "none",
          fontSize: "0.9rem", cursor: "pointer",
          background: "linear-gradient(135deg, rgba(204,255,0,0.9), rgba(0,242,234,0.9), rgba(236,72,153,0.9))",
          color: "#000", fontWeight: 800, letterSpacing: "0.5px",
          boxShadow: "0 10px 40px -10px rgba(0,242,234,0.6), inset 0 4px 15px rgba(255,255,255,0.4)",
          borderTop: "1px solid rgba(255,255,255,0.45)",
        }}>
          ▶ 生成动态视频 (消耗 10 积分)
        </button>
        <div style={{ textAlign: "center", fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "0.6rem" }}>
          将自动生成一段 8 秒的展示视频
        </div>
      </div>
    </div>
  );
}
