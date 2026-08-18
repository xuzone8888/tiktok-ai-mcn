"use client";

import { ArrowLeft, CheckCircle2, Eye, RefreshCw, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("characterCreate");
  const [showFullBoard, setShowFullBoard] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const crop = cropMeta || DEFAULT_CROP;
  const promptToShow = boardPrompt || prompt;
  const tags = useMemo(() => {
    const base = [t(`board.${dnaConfig.species}`), t(`board.${dnaConfig.gender}`)];
    if (dnaConfig.baseDna) base.push(t("board.characterDesign"));
    return base;
  }, [dnaConfig.baseDna, dnaConfig.gender, dnaConfig.species, t]);

  const canSave = Boolean(characterName.trim()) && !isSaving && !savedCharacterId;

  return (
    <div className={styles.characterBoardSuccess}>
      <div className={styles.gridBg} />
      <div className={styles.ambient} />

      <button className={styles.backButton} onClick={onBack} type="button">
        <ArrowLeft className="h-4 w-4" />
        {t("board.reconfigure")}
      </button>

      <button
        className={styles.exitButton}
        onClick={savedCharacterId ? onViewMyRoles : onDiscard}
        type="button"
      >
        <X className="h-4 w-4" />
        {savedCharacterId ? t("board.close") : t("board.discard")}
      </button>

      <header className={styles.header}>
        <div className={styles.titleMark} />
        <div>
          <h1>{t("board.born")}</h1>
          <p>{t("board.generated")}</p>
        </div>
        <button
          className={styles.regenerateIconButton}
          onClick={onRegenerate}
          type="button"
          aria-label={t("board.regenerate")}
          title={t("board.regenerate")}
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
            <img src={boardUrl} alt={t("board.imageAlt")} />
          </div>
        </button>

        <aside className={styles.savePanel}>
          <h2>{t("board.saveCharacter")}</h2>

          <label className={styles.field}>
            <span>{t("board.name")}</span>
            <input
              value={characterName}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={t("board.namePlaceholder")}
              maxLength={50}
            />
          </label>

          <div className={styles.field}>
            <span>{t("board.type")}</span>
            <div className={styles.tags}>
              {tags.map((tag, index) => (
                <span className={styles.tag} key={`${tag}-${index}`}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className={cx(styles.field, styles.promptField)}>
            <span>{t("board.prompt")}</span>
            <button className={styles.promptViewButton} onClick={() => setShowPrompt(true)} type="button">
              <Eye className="h-4 w-4" />
              {t("board.viewPrompt")}
            </button>
          </div>

          <div className={styles.saveSpacer} />

          {savedCharacterId ? (
            <button className={styles.savedLink} onClick={onViewMyRoles} type="button">
              <CheckCircle2 className="h-5 w-5" />
              {t("board.viewMine")}
            </button>
          ) : (
            <>
              <button className={styles.saveButton} onClick={onSave} disabled={!canSave} type="button">
                <Save className="h-5 w-5" />
                {isSaving ? t("board.saving") : t("board.save")}
              </button>
              <button className={styles.discardButton} onClick={onDiscard} disabled={isSaving} type="button">
                <X className="h-4 w-4" />
                {t("board.discardExit")}
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
          <img src={boardUrl} alt={t("board.imageAlt")} onClick={(event) => event.stopPropagation()} />
        </div>
      )}

      {showPrompt && (
        <div className={styles.modal} onClick={() => setShowPrompt(false)}>
          <div className={styles.promptModal} onClick={(event) => event.stopPropagation()}>
            <button className={styles.promptModalClose} onClick={() => setShowPrompt(false)} type="button">
              <X className="h-5 w-5" />
            </button>
            <h3>{t("board.fullPrompt")}</h3>
            <textarea value={promptToShow} readOnly />
          </div>
        </div>
      )}
    </div>
  );
}
