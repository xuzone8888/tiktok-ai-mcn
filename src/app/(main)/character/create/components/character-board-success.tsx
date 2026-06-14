"use client";

import { ArrowLeft, CheckCircle2, Eye, RefreshCw, Save, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { CharacterBoardCropMeta, CharacterDna } from "@/types/character";

import styles from "./character-board-success.module.css";

interface CharacterBoardSuccessProps {
  boardUrl: string;
  cropMeta: CharacterBoardCropMeta | null;
  dnaConfig: CharacterDna;
  prompt: string;
  boardPrompt: string | null;
  characterName: string;
  isSaving: boolean;
  savedCharacterId: string | null;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onBack: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
  onViewMyRoles: () => void;
}

const DEFAULT_CROP: CharacterBoardCropMeta = {
  sourceWidth: 2048,
  sourceHeight: 1360,
  splitX: 949,
  seam: 48,
  left: { left: 0, top: 0, width: 925, height: 1360 },
  right: { left: 973, top: 0, width: 1075, height: 1360 },
};

const SPECIES_LABEL: Record<CharacterDna["species"], string> = {
  realistic: "写真真人",
  anime: "二次元",
  mascot: "潮玩吉盒",
  animal: "动物精灵",
};

const GENDER_LABEL: Record<CharacterDna["gender"], string> = {
  female: "女性",
  male: "男性",
  neutral: "中性",
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function getBoardAspect(crop: CharacterBoardCropMeta) {
  return `${crop.sourceWidth} / ${crop.sourceHeight}`;
}

export function CharacterBoardSuccess({
  boardUrl,
  cropMeta,
  dnaConfig,
  prompt,
  boardPrompt,
  characterName,
  isSaving,
  savedCharacterId,
  onNameChange,
  onSave,
  onBack,
  onRegenerate,
  onDiscard,
  onViewMyRoles,
}: CharacterBoardSuccessProps) {
  const [showFullBoard, setShowFullBoard] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const crop = cropMeta || DEFAULT_CROP;
  const promptToShow = boardPrompt || prompt;
  const tags = useMemo(() => {
    const base = [SPECIES_LABEL[dnaConfig.species], GENDER_LABEL[dnaConfig.gender]];
    if (dnaConfig.baseDna) base.push("角色设定");
    return base;
  }, [dnaConfig.baseDna, dnaConfig.gender, dnaConfig.species]);

  const canSave = Boolean(characterName.trim()) && !isSaving && !savedCharacterId;

  return (
    <div className={styles.characterBoardSuccess}>
      <div className={styles.gridBg} />
      <div className={styles.ambient} />

      <button className={styles.backButton} onClick={onBack} type="button">
        <ArrowLeft className="h-4 w-4" />
        重新配置
      </button>

      <button
        className={styles.exitButton}
        onClick={savedCharacterId ? onViewMyRoles : onDiscard}
        type="button"
      >
        <X className="h-4 w-4" />
        {savedCharacterId ? "关闭" : "放弃"}
      </button>

      <header className={styles.header}>
        <div className={styles.titleMark} />
        <div>
          <h1>角色已诞生</h1>
          <p>完整设定板已生成</p>
        </div>
        <button
          className={styles.regenerateIconButton}
          onClick={onRegenerate}
          type="button"
          aria-label="重新生成"
          title="重新生成"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      <main className={styles.stage}>
        <button
          className={cx(styles.boardCard, styles.fullBoardCard)}
          style={{ aspectRatio: getBoardAspect(crop) }}
          onClick={() => setShowFullBoard(true)}
          type="button"
        >
          <div className={styles.fullBoardFrame}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={boardUrl} alt="完整角色设定板" />
          </div>
        </button>

        <aside className={styles.savePanel}>
          <h2>保存角色</h2>

          <label className={styles.field}>
            <span>角色名</span>
            <input
              value={characterName}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="输入角色名"
              maxLength={50}
            />
          </label>

          <div className={styles.field}>
            <span>类型</span>
            <div className={styles.tags}>
              {tags.map((tag, index) => (
                <span className={styles.tag} key={`${tag}-${index}`}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className={cx(styles.field, styles.promptField)}>
            <span>创建提示词</span>
            <button className={styles.promptViewButton} onClick={() => setShowPrompt(true)} type="button">
              <Eye className="h-4 w-4" />
              查看完整提示词
            </button>
          </div>

          <div className={styles.saveSpacer} />

          {savedCharacterId ? (
            <button className={styles.savedLink} onClick={onViewMyRoles} type="button">
              <CheckCircle2 className="h-5 w-5" />
              查看我的角色
            </button>
          ) : (
            <>
              <button className={styles.saveButton} onClick={onSave} disabled={!canSave} type="button">
                <Save className="h-5 w-5" />
                {isSaving ? "保存中..." : "保存为角色"}
              </button>
              <button className={styles.discardButton} onClick={onDiscard} disabled={isSaving} type="button">
                <X className="h-4 w-4" />
                放弃并退出
              </button>
            </>
          )}
        </aside>
      </main>

      {showFullBoard && (
        <div className={styles.modal} onClick={() => setShowFullBoard(false)}>
          <button className={styles.modalClose} onClick={() => setShowFullBoard(false)} type="button">
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={boardUrl} alt="完整角色设定板" onClick={(event) => event.stopPropagation()} />
        </div>
      )}

      {showPrompt && (
        <div className={styles.modal} onClick={() => setShowPrompt(false)}>
          <div className={styles.promptModal} onClick={(event) => event.stopPropagation()}>
            <button className={styles.promptModalClose} onClick={() => setShowPrompt(false)} type="button">
              <X className="h-5 w-5" />
            </button>
            <h3>完整提示词</h3>
            <textarea value={promptToShow} readOnly />
          </div>
        </div>
      )}
    </div>
  );
}
