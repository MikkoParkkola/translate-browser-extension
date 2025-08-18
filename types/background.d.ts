import type { TranslateOptions } from './index';

export function updateBadge(): void;
export function setUsingPlus(v: boolean): void;
export function _setActiveTranslations(n: number): void;
export function handleTranslate(opts: TranslateOptions & { secondaryModel?: string; parallel?: boolean | 'auto'; provider?: string }): Promise<{ text?: string; confidence?: number; error?: string }>;
export function _setConfig(cfg: any): void;
