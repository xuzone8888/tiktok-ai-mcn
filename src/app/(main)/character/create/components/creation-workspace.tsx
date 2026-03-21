"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  useCharacterStudioStore,
  useCharacterIsGenerating,
} from "@/stores/character-studio-store";
import {
  getDnaOptionGroups,
} from "../data/dna-options";
import type { CharacterDna } from "@/types/character";

import { 
  Sparkles, Keyboard, Lightbulb, Wand2, ImagePlus, 
  CloudUpload, Hourglass, RefreshCw, Dna, VenetianMask, 
  User, Ruler, Scissors, Shirt, Loader2
} from "lucide-react";

function getGroupIcon(key: string) {
  const props = { className: "w-4 h-4 opacity-70" };
  const map: Record<string, React.ReactNode> = {
    species: <Dna {...props} />,
    baseDna: <VenetianMask {...props} />,
    genderAge: <User {...props} />,
    bodyType: <Ruler {...props} />,
    hair: <Scissors {...props} />,
    outfit: <Shirt {...props} />,
  };
  return map[key] || <Sparkles {...props} />;
}

function TypewriterTextArea({ value, onChange, placeholders, className }: { value: string, onChange: (val: string) => void, placeholders: string[], className: string }) {
  const [placeholder, setPlaceholder] = useState("");
  const [idx, setIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);

  useEffect(() => {
    if (value.trim()) {
      setPlaceholder("");
      return;
    }
    const text = placeholders[idx];
    if (charIdx < text.length) {
      const t = setTimeout(() => {
        setPlaceholder(prev => prev + text[charIdx]);
        setCharIdx(prev => prev + 1);
      }, 50);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => {
        setPlaceholder("");
        setCharIdx(0);
        setIdx((prev) => (prev + 1) % placeholders.length);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [charIdx, idx, placeholders, value]);

  return (
    <textarea
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function GenerateButton({ store, isGenerating, handleGenerate }: { store: any, isGenerating: boolean, handleGenerate: () => void }) {
  return (
    <button
      onClick={handleGenerate}
      disabled={!store.prompt.trim() || isGenerating}
      className={`relative w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98] border flex items-center justify-center gap-2 overflow-hidden group/btn
        ${!store.prompt.trim() || isGenerating 
          ? 'bg-white/[0.05] text-white/30 border border-white/5 cursor-not-allowed shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] backdrop-blur-md' 
          : 'bg-gradient-to-r from-[#00F2EA] via-[#CCFF00] to-[#EC4899] text-black shadow-[0_8px_30px_rgba(204,255,0,0.2),0_0_20px_rgba(236,72,153,0.3),inset_0_2px_4px_rgba(255,255,255,0.6),inset_0_-2px_4px_rgba(0,0,0,0.2)] hover:shadow-[0_12px_40px_rgba(204,255,0,0.4),0_0_30px_rgba(0,242,234,0.4),inset_0_2px_4px_rgba(255,255,255,0.8),inset_0_-2px_4px_rgba(0,0,0,0.2)] hover:scale-[1.02] border border-white/40 ring-1 ring-[#CCFF00]/30'
        }`}
    >
      {/* 内部高光游走效果（仅在有条件且悬浮时显现） */}
      {store.prompt.trim() && !isGenerating && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-[150%] skew-x-[30deg] group-hover/btn:translate-x-[150%] transition-transform duration-1000 ease-in-out pointer-events-none" />
      )}
      {isGenerating ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin text-black/50" />
          正在铸造...
        </>
      ) : (
        <><Sparkles className="w-5 h-5" /> 消耗 <span className="tabular-lining">20</span> 积分 · 开始铸造</>
      )}
    </button>
  );
}

function DnaGroup({ group, store, handleSelect, getSelected }: any) {
  return (
    <div className="relative group p-5 sm:p-6 !rounded-[24px] border border-white/20 hover:border-[#00F2EA]/40 bg-white/[0.07] hover:bg-white/[0.08] backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.4)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.4),0_0_30px_rgba(0,242,234,0.15),inset_0_1px_1px_rgba(255,255,255,0.4)] transition-all duration-500 ease-spring h-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[#00F2EA]/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <div className="text-xs font-bold text-white/50 mb-3 sm:mb-4 uppercase tracking-[0.2em] flex items-center gap-2 relative z-10 group-hover:text-[#00F2EA]/90 transition-colors">
        {getGroupIcon(group.key)} <span className="pt-[1px]">{group.label}</span>
      </div>
      <div className="flex flex-wrap gap-2.5 relative z-10">
        {group.options.map((opt: any) => {
          const isSelected = getSelected(group.key).includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(group.key, opt.value)}
              className={`px-4 py-2 rounded-full text-[13px] tracking-wide transition-all duration-500 ease-spring active:scale-95
                ${isSelected 
                  ? 'bg-gradient-to-b from-white to-white/95 text-[#0F172A] font-extrabold border border-white shadow-[0_4px_20px_rgba(0,242,234,0.3),inset_0_-2px_4px_rgba(0,0,0,0.1)] ring-1 ring-[#00F2EA]/40' 
                  : 'bg-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] text-white/60 hover:text-white border border-white/10 hover:bg-white/[0.1] hover:border-[#00F2EA]/30 hover:shadow-[0_4px_15px_rgba(0,242,234,0.15),inset_0_1px_1px_rgba(255,255,255,0.2)]'
                }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  );
}

export function CreationWorkspace() {
  const store = useCharacterStudioStore();
  const isGenerating = useCharacterIsGenerating();

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const optionGroups = getDnaOptionGroups(store.dnaConfig.species);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!workspaceRef.current) return;
    const rect = workspaceRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    workspaceRef.current.style.setProperty("--mouse-x", `${x}px`);
    workspaceRef.current.style.setProperty("--mouse-y", `${y}px`);
  }, []);

  const handleDnaPillSelect = useCallback(
    (groupKey: string, value: string) => {
      const fieldMap: Record<string, keyof CharacterDna> = {
        species: "species",
        baseDna: "baseDna",
        bodyType: "bodyType",
        outfit: "outfit",
      };

      if (groupKey === "species") {
        store.updateDnaConfig({
          species: value as CharacterDna["species"],
          baseDna: "",
          bodyType: "",
          hairStyle: "",
          hairColor: "",
          outfit: "",
        });
      } else if (groupKey === "genderAge") {
        const genderValues = ["female", "male", "neutral"];
        if (genderValues.includes(value)) {
          store.updateDnaConfig({ gender: value as CharacterDna["gender"] });
        } else {
          store.updateDnaConfig({ ageGroup: value });
        }
      } else if (groupKey === "hair") {
        const hairColorValues = [
          "natural_black", "tea_brown", "ash_blonde", "silver_white",
          "dream_pink", "honey_brown", "cherry_red", "ocean_blue",
          "sakura_pink", "emerald_green", "gradient_rainbow",
          "solid_color", "two_tone", "natural_fur", "orange_tabby",
          "snow_white", "midnight_black", "golden",
        ];
        if (hairColorValues.includes(value)) {
          store.updateDnaConfig({ hairColor: value });
        } else {
          store.updateDnaConfig({ hairStyle: value });
        }
      } else if (fieldMap[groupKey]) {
        store.updateDnaConfig({ [fieldMap[groupKey]]: value });
      }

      // FIX【3.2 智能拼装覆盖防呆】: 绝对禁止在 Freeform 模式下污染 prompt 树
      setTimeout(() => {
        if (store.creationMode === "dna") {
          const prompt = store.buildPromptFromDna();
          if (prompt) {
            store.setPrompt(prompt);
          }
        }
      }, 0);
    },
    [store]
  );

  const getSelectedValues = (groupKey: string): string[] => {
    const dna = store.dnaConfig;
    switch (groupKey) {
      case "species": return [dna.species];
      case "baseDna": return dna.baseDna ? [dna.baseDna] : [];
      case "genderAge": return [dna.gender, dna.ageGroup].filter(Boolean);
      case "bodyType": return dna.bodyType ? [dna.bodyType] : [];
      case "hair": return [dna.hairStyle, dna.hairColor].filter(Boolean);
      case "outfit": return dna.outfit ? [dna.outfit] : [];
      default: return [];
    }
  };

  const handleEnhancePrompt = async () => {
    if (!store.prompt.trim() || store.isEnhancing) return;
    store.setIsEnhancing(true);
    try {
      const response = await fetch("/api/characters/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: store.prompt, mode: "expand" }),
      });
      const data = await response.json();
      if (data.success && data.enhancedPrompt) {
        store.setPrompt(data.enhancedPrompt);
      }
    } catch (error) {
      console.error("[Magic Wand] Error:", error);
    } finally {
      store.setIsEnhancing(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload/image", { method: "POST", body: formData });
      const data = await response.json();
      if (data.url) store.setReferenceImageUrl(data.url);
    } catch (error) {
      console.error("Upload error", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!store.prompt.trim() || isGenerating) return;
    store.startGeneration();
    try {
      let userId = store.userId;
      if (!userId) {
        try {
          const creditsRes = await fetch("/api/user/credits");
          const creditsData = await creditsRes.json();
          if (creditsData.userId) {
            userId = creditsData.userId;
            store.setUserInfo(creditsData.userId, creditsData.credits ?? 0);
          }
        } catch (err) {}
      }
      if (!userId) {
        store.setGenerationFailed("请先登录后再生成角色");
        return;
      }
      const response = await fetch("/api/characters/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "hero",
          prompt: store.prompt,
          sourceImageUrl: store.referenceImageUrl || undefined,
          userId,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        store.setGenerationFailed(data.error || "生成失败");
        return;
      }
      if (data.refPrompt) store.setRefPrompt(data.refPrompt);
      store.setTaskIds(data.heroTaskId || null, null);
    } catch (error) {
      store.setGenerationFailed("网络错误，请重试");
    }
  };



  return (
    <div 
      ref={workspaceRef}
      onMouseMove={handleMouseMove}
      className="creation-workspace group/workspace max-w-[1500px] mx-auto w-full relative pb-32 lg:pb-8 pt-4 lg:pt-8 px-4 lg:px-8
      bg-gradient-to-br from-[#1C1C21]/90 via-[#0E0E11]/90 to-[#050505]/90 backdrop-blur-3xl rounded-[40px] shadow-[inset_0_1px_3px_rgba(255,255,255,0.05),0_8px_40px_rgba(0,0,0,0.6)] border border-white/5 overflow-hidden"
    >
      

      
      {/* 0. 人鱼法则微晕 (Mermaid Iris Ambient) - 用极其隐蔽的粉/黄/青取代死白光，最高亮度仅 7% */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,242,234,0.06),transparent_60%)] pointer-events-none mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(236,72,153,0.06),transparent_50%)] pointer-events-none mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(204,255,0,0.03),transparent_40%)] pointer-events-none mix-blend-screen" />
      
      {/* 1. Titanium Header & 全局模式切换 (左右分布) */}
      <div className="mb-6 lg:mb-8 relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold flex items-center gap-3 drop-shadow-lg text-white tracking-tight-ios text-balance">
            <Sparkles className="w-7 h-7 text-tiktok-cyan" fill="currentColor" />
            创建角色
            <span className="text-xs lg:text-sm font-normal text-white/40 tracking-widest uppercase mt-1 lg:mt-2 ml-1 lg:ml-2">Character Forge</span>
          </h1>
          <p className="mt-2 text-white/50 text-xs lg:text-sm flex items-center gap-1.5"><Dna className="w-3.5 h-3.5" /> 注入 DNA 特征，铸造专属数字角色</p>
        </div>
        
        {/* iOS 原生级 Tab 滑块 (提至 Header) */}
        <div className="flex bg-white/10 p-1.5 rounded-full border border-white/20 shadow-[inset_0_1px_4px_rgba(0,0,0,0.4)] backdrop-blur-[40px] w-full sm:w-fit shrink-0 relative overflow-hidden">
          <button 
            type="button"
            onClick={() => store.setCreationMode("dna")}
            className={`flex-1 sm:px-8 py-2.5 rounded-full text-sm font-bold tracking-tight-ios transition-all duration-300 flex items-center justify-center gap-2 ${store.creationMode === 'dna' ? 'bg-gradient-to-b from-white to-white/90 shadow-[0_4px_15px_rgba(255,255,255,0.2),inset_0_-2px_5px_rgba(0,0,0,0.05)] border border-white/80 text-black' : 'text-white/70 hover:text-white border border-transparent'}`}>
             <Dna className="w-4 h-4" /> DNA Forge
          </button>
          <button 
            type="button"
            onClick={() => store.setCreationMode("freeform")}
            className={`flex-1 sm:px-8 py-2.5 rounded-full text-sm font-bold tracking-tight-ios transition-all duration-300 flex items-center justify-center gap-2 ${store.creationMode === 'freeform' ? 'bg-gradient-to-b from-white to-white/90 shadow-[0_4px_15px_rgba(255,255,255,0.2),inset_0_-2px_5px_rgba(0,0,0,0.05)] border border-white/80 text-black' : 'text-white/70 hover:text-white border border-transparent'}`}>
             <Keyboard className="w-4 h-4" /> Freeform
          </button>
        </div>
      </div>

      {/* 2. 主分栏架构 (1:1 终极对称) */}
      <div className="flex flex-col xl:grid xl:grid-cols-2 gap-8 relative items-stretch">
        
        {/* 左侧工作台 */}
        <div className="workspace-left flex flex-col w-full h-full">

          {/* 面板内容切换 */}
          {store.creationMode === "dna" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {optionGroups.map((group: any, idx: number) => (
                <div key={group.key} className="animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: `${idx * 100}ms`, animationFillMode: 'backwards' }}>
                  <DnaGroup group={group} store={store} handleSelect={handleDnaPillSelect} getSelected={getSelectedValues} />
                </div>
              ))}
            </div>
          ) : (
            <div className="freeform-area h-[400px] lg:h-[500px] shrink-0 relative group !rounded-[32px] animate-in fade-in zoom-in-95 duration-500 ease-out" style={{ animationFillMode: 'backwards' }}>
               <TypewriterTextArea 
                 className="w-full h-full bg-white/[0.03] backdrop-blur-[20px] border border-white/10 shadow-[inset_0_1px_3px_rgba(255,255,255,0.1),0_10px_40px_rgba(0,0,0,0.4)] rounded-[32px] p-6 lg:p-8 text-white/90 text-base lg:text-lg font-mono leading-loose tracking-wide focus:border-[#00F2EA]/40 focus:bg-[#00F2EA]/[0.02] focus:shadow-[0_0_30px_rgba(0,242,234,0.15),inset_0_1px_3px_rgba(255,255,255,0.3)] focus:outline-none transition-all duration-500 ease-spring resize-none custom-scrollbar group-hover:border-[#00F2EA]/30 selection:bg-[#00F2EA]/30"
                 value={store.prompt}
                 onChange={(val) => store.setPrompt(val)}
                 placeholders={[
                   "描述你想要的角色特征...",
                   "例如：一位身穿新中式汉服的清冷精神少女，肤白如玉...",
                   "正在构思：白发红眼的吸血鬼贵族，身穿复古晚礼服...",
                   "灵感：一位赛博朋克风格的机甲特工，霓虹雨夜..."
                 ]}
               />
               <div className="absolute top-0 right-8 px-4 py-2 bg-white/10 rounded-b-xl border-x border-b border-white/30 text-[10px] text-white/50 tracking-widest font-bold backdrop-blur-md pointer-events-none">FREEFORM CANVAS</div>
            </div>
          )}
        </div>

        {/* 右侧核心控制台 (1:1等比例镜像) */}
        <div className="workspace-right w-full relative h-full">
          <div className="p-5 lg:p-7 !rounded-[32px] flex flex-col gap-6 relative h-full bg-white/[0.05] backdrop-blur-[100px] border border-white/20 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.3)] min-h-[400px] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-white/[0.05] to-transparent pointer-events-none" />
            
            {/* 控制台内容区 */}
            <div className="flex-1 flex flex-col gap-6 relative z-10">
              
              {/* FIX 3.1【双重输入框防呆】: 仅在 DNA 模式下展示智能提示词 */}
              {store.creationMode === "dna" && (
                <div className="prompt-section flex flex-col gap-3 shrink-0 flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs lg:text-sm font-medium text-white/70 flex items-center gap-1.5"><Lightbulb className="w-4 h-4 text-yellow-200/80" /> 智能提示词联动</span>
                    <button
                      type="button"
                      onClick={handleEnhancePrompt}
                      disabled={!store.prompt.trim() || store.isEnhancing}
                      className="px-3 lg:px-4 py-1.5 rounded-full border shadow-[0_2px_10px_rgba(0,0,0,0.1)] backdrop-blur-md bg-white/10 text-white/80 hover:text-white border-white/20 hover:border-[#EC4899]/50 hover:bg-white/[0.15] hover:shadow-[0_0_20px_rgba(236,72,153,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 min-w-[90px] group/enhance"
                    >
                      {store.isEnhancing ? <><Loader2 className="w-3.5 h-3.5 animate-spin text-[#CCFF00]" />施法中</> : <><Wand2 className="w-3.5 h-3.5 text-[#EC4899] group-hover/enhance:drop-shadow-[0_0_8px_rgba(236,72,153,0.8)] transition-all" /> AI 扩写</>}
                    </button>
                  </div>
                  
                  <div className={`relative rounded-2xl transition-all duration-500 bg-white/[0.02] backdrop-blur-[40px] shadow-[inset_0_1px_3px_rgba(255,255,255,0.05),0_4px_20px_rgba(0,0,0,0.4)] border flex-1 flex flex-col ${store.isEnhancing ? 'border-[#CCFF00]/50 shadow-[0_0_30px_rgba(204,255,0,0.2),inset_0_1px_5px_rgba(255,255,255,0.3)]' : 'border-white/10 hover:border-[#EC4899]/30 hover:bg-[#EC4899]/[0.02] hover:shadow-[0_0_20px_rgba(236,72,153,0.1)]'}`}>
                    {store.isEnhancing && (
                      <div className="absolute inset-0 border-2 border-[#CCFF00]/50 rounded-2xl animate-pulse pointer-events-none z-10" />
                    )}
                    <TypewriterTextArea
                      className="flex-1 w-full min-h-[140px] bg-transparent p-4 lg:p-5 text-white/90 text-[15px] font-mono leading-loose tracking-wide focus:outline-none resize-none relative z-0 custom-scrollbar block selection:bg-[#00F2EA]/30"
                      value={store.prompt}
                      onChange={(val) => store.setPrompt(val)}
                      placeholders={[
                        "点击左侧特征胶囊会自动在这里组装...",
                        "灵感：身穿霓虹机能服的元气少女星推官...",
                        "或者在这里输入你天马行空的灵感，让 AI 施展魔法..."
                      ]}
                    />
                  </div>
                </div>
              )}

              {/* 参考图上传区 */}
              <div className="reference-upload-section shrink-0 relative z-10">
                <div className="text-xs lg:text-sm font-medium text-white/70 mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5"><ImagePlus className="w-4 h-4 opacity-70" /> 参考图上传 (可选)</span>
                  {store.referenceImageUrl && (
                     <button type="button" onClick={() => store.setReferenceImageUrl(null)} className="text-[11px] lg:text-xs text-red-400 hover:text-red-300 bg-red-400/10 px-2 py-1 rounded">清除图</button>
                  )}
                </div>
                
                <div 
                  onClick={() => !store.referenceImageUrl && fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if(file) handleImageUpload(file);
                  }}
                  className={`relative rounded-2xl transition-all duration-300 flex flex-col items-center justify-center overflow-hidden min-h-[90px] lg:min-h-[110px]
                    ${store.referenceImageUrl ? 'border border-white/20 p-0 bg-white/[0.05] shadow-lg' : 'border border-dashed border-white/30 hover:border-[#CCFF00]/40 hover:bg-[#CCFF00]/[0.03] cursor-pointer p-4 lg:p-5 bg-black/20 shadow-[inset_0_1px_4px_rgba(0,0,0,0.3)] hover:shadow-[0_0_20px_rgba(204,255,0,0.1)] backdrop-blur-xl group'}
                    ${isUploading ? 'opacity-50' : ''}`}
                >
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => {if(e.target.files) handleImageUpload(e.target.files[0])}} />
                  
                  {store.referenceImageUrl ? (
                    <div className="relative w-full aspect-[4/3] group/img">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={store.referenceImageUrl} alt="Reference" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                        <button type="button" onClick={(e) => {e.stopPropagation(); fileInputRef.current?.click();}} className="px-5 py-2.5 bg-white/20 border border-white/40 rounded-full text-xs lg:text-sm font-bold text-white hover:bg-white/30 hover:scale-105 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.2)] flex items-center gap-2">
                          <RefreshCw className="w-4 h-4" /> 更换图片
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-2 group-hover:bg-white/20 group-hover:scale-110 transition-all shadow-inner">
                        {isUploading ? <Hourglass className="w-5 h-5 text-white/80 animate-pulse" /> : <CloudUpload className="w-5 h-5 text-white/80" />}
                      </div>
                      <span className="text-[11px] lg:text-xs text-white/50 font-medium tracking-wide flex items-center gap-1.5">
                         {isUploading ? '正在解析维度...' : '拖拽或点击上传参考图像'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* PC 端的悬浮生成按钮 (绝对固定在右侧控制台底部) */}
            <div className="hidden lg:block shrink-0 pt-4 border-t border-white/10 mt-auto relative z-10">
              <GenerateButton store={store} isGenerating={isGenerating} handleGenerate={handleGenerate} />
            </div>
            
          </div>
        </div>
      </div>

      {/* 4.2 移动端的悬浮吸底生成按钮 (强制 Fixed Bottom) */}
      <div className="lg:hidden fixed bottom-6 left-4 right-4 z-[100]">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xl rounded-2xl -z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]" />
        <GenerateButton store={store} isGenerating={isGenerating} handleGenerate={handleGenerate} />
      </div>

      {/* iOS 原生级滚动条全局样式与重置 */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
          margin-top: 10px;
          margin-bottom: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: transparent;
          border-radius: 4px;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4) !important;
        }
      `}</style>
    </div>
  );
}
