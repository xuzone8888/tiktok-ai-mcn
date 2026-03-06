/**
 * 轮播组件导出
 */

export { SlideshowModePanel, type SlideshowMode } from './SlideshowModePanel';
export { PositionUploader, type Position } from './PositionUploader';
export { MusicPoolManager, type MusicMode } from './MusicPoolManager';
export { SubtitleEditor, type SubtitleConfig } from './SubtitleEditor';
export { TransitionPicker, type TransitionEffect } from './TransitionPicker';
export { SlideshowSection } from './SlideshowSection';
export type { SlideshowTask } from '@/stores/slideshow-store';
export { CreateSlideshowModal } from './CreateSlideshowModal';

// Phase 1: Enhanced Components
export { BGMSelector, type BGMConfig, type BGMMode, PRESET_MUSIC, assignRandomMusic } from './BGMSelector';
export { VoiceSelector, type VoiceConfig, PRESET_VOICES } from './VoiceSelector';
export { AICaptionGenerator, type AICaptionConfig, type CaptionStyle, type CaptionMode } from './AICaptionGenerator';

