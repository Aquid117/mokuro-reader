/** Shapes returned by the manga-api `/api/jiten/parse` endpoint (see backend/src/jiten/types.ts). */
export type EffectiveState = 'new' | 'young' | 'due' | 'learning' | null;
export type OverrideState = 'known' | 'ignore' | 'learning';

export interface ParsedToken {
  /** UTF-16 offsets into the block text that was sent */
  s: number;
  e: number;
  /** Jiten word id + reading index: the stable vocabulary identity */
  w: number;
  r: number;
  state: EffectiveState;
}

export interface VocabEntry {
  spelling: string;
  reading: string;
  meanings: string[][];
  pos: string[];
  freq: number;
  pitch: number[];
  jiten: number[];
  override: OverrideState | null;
  mined: boolean;
  conj?: string[];
}

export interface ParseResponse {
  blocks: { key: string; tokens: ParsedToken[]; cached: boolean }[];
  vocab: Record<string, VocabEntry>;
  source: 'jiten' | 'cache' | 'partial' | 'none';
  warning?: string;
}

export const vocabKey = (w: number, r: number) => `${w}:${r}`;
