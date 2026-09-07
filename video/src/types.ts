/** 縦型ショート動画（TikTok / Instagram リール）の台本ドメインモデル。 */

export const HOOK_TYPES = ['損失回避', '逆張り', '具体的数字'] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const SECTION_NAMES = ['hook', 'problem', 'solution', 'cta'] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

/** 本文中の `**強調**` を許すナレーション文字列。 */
export type Narration = string;

export interface BulletsVisual {
  readonly kind: 'bullets';
  readonly items: readonly string[];
  readonly caption: string;
}

export interface DonutSlice {
  readonly label: string;
  readonly percent: number;
  readonly amount: string;
}

export interface DonutVisual {
  readonly kind: 'donut';
  readonly slices: readonly DonutSlice[];
  readonly caption: string;
}

export interface StepItem {
  readonly label: string;
  readonly detail: string;
}

export interface StepsVisual {
  readonly kind: 'steps';
  readonly items: readonly StepItem[];
  readonly caption: string;
}

export interface BarItem {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly accent: boolean;
}

export interface BarsVisual {
  readonly kind: 'bars';
  readonly items: readonly BarItem[];
  readonly caption: string;
}

export type Visual = BulletsVisual | DonutVisual | StepsVisual | BarsVisual;

export interface ScriptBody {
  readonly hook: Narration;
  readonly problem: Narration;
  readonly solution: Narration;
  readonly cta: Narration;
}

export interface ShortScript {
  /** ファイル名に使う識別子。`[a-z0-9-]+`。 */
  readonly id: string;
  readonly title: string;
  readonly hookType: HookType;
  /** 冒頭 1 フレーム目に出す最大サイズのテロップ。 */
  readonly telopFirstFrame: string;
  readonly script: ScriptBody;
  readonly visual: Visual;
  /** 画面下部に出し続ける免責文。 */
  readonly disclaimer: string;
  readonly ctaLabel: string;
  readonly hashtags: readonly string[];
}

export interface Caption {
  readonly text: Narration;
  readonly startMs: number;
  readonly endMs: number;
}

export interface Section {
  readonly name: SectionName;
  readonly text: Narration;
  readonly startMs: number;
  readonly durationMs: number;
  readonly captions: readonly Caption[];
}

export interface Timeline {
  readonly id: string;
  readonly fps: number;
  readonly totalMs: number;
  readonly sections: readonly Section[];
}

export interface RenderOptions {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly crf: number;
  readonly outDir: string;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  fps: 30,
  width: 1080,
  height: 1920,
  crf: 19,
  outDir: 'video/out',
};

/** 台本 4 セクションの既定尺（ms）。TTS を使う場合は実測値で置き換える。 */
export const NOMINAL_SECTION_MS: Readonly<Record<SectionName, number>> = {
  hook: 1500,
  problem: 5000,
  solution: 10000,
  cta: 3000,
};
