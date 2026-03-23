/**
 * NLLB-200-Distilled-600M Local Translation Provider
 *
 * Uses Meta's No Language Left Behind model via Transformers.js.
 * A single 350MB model covering 200 language pairs — the natural
 * successor to per-pair OPUS-MT models when broad language coverage
 * is needed.
 *
 * Advantages over OPUS-MT:
 *   - One download instead of 76 per-pair models
 *   - 200 language pairs including many low-resource languages
 *   - No pivot routing needed (direct any→any translation)
 *   - Better quality on less-resourced language pairs
 *
 * Trade-offs:
 *   - ~350MB quantised (vs ~170MB per OPUS-MT pair)
 *   - Slightly higher inference latency on common high-resource pairs
 *   - Uses FLORES-200 language codes internally (we map from ISO 639-1)
 *
 * @see https://huggingface.co/Xenova/nllb-200-distilled-600M
 */

import { BaseProvider } from './base-provider';
import { createLogger } from '../core/logger';
import { withTimeout } from '../core/async-utils';
import { CONFIG } from '../config';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

const log = createLogger('NLLB-200');

const NLLB_MODEL = 'Xenova/nllb-200-distilled-600M';

// Dynamic import type for Transformers.js pipeline
type TranslationPipeline = (
  text: string,
  options?: Record<string, unknown>
) => Promise<Array<{ translation_text: string }>>;

/**
 * Maps ISO 639-1 codes to FLORES-200 language codes used by NLLB.
 * FLORES-200 uses the format: <language>_<script> (e.g. eng_Latn, fin_Latn, zho_Hans)
 *
 * Only languages with confirmed NLLB support are included.
 * @see https://github.com/facebookresearch/flores/blob/main/flores200/README.md
 */
export const ISO_TO_FLORES: Record<string, string> = {
  af: 'afr_Latn',
  am: 'amh_Ethi',
  ar: 'arb_Arab',
  az: 'azj_Latn',
  be: 'bel_Cyrl',
  bg: 'bul_Cyrl',
  bn: 'ben_Beng',
  bs: 'bos_Latn',
  ca: 'cat_Latn',
  cs: 'ces_Latn',
  cy: 'cym_Latn',
  da: 'dan_Latn',
  de: 'deu_Latn',
  el: 'ell_Grek',
  en: 'eng_Latn',
  es: 'spa_Latn',
  et: 'est_Latn',
  eu: 'eus_Latn',
  fa: 'pes_Arab',
  fi: 'fin_Latn',
  fr: 'fra_Latn',
  ga: 'gle_Latn',
  gl: 'glg_Latn',
  gu: 'guj_Gujr',
  he: 'heb_Hebr',
  hi: 'hin_Deva',
  hr: 'hrv_Latn',
  hu: 'hun_Latn',
  hy: 'hye_Armn',
  id: 'ind_Latn',
  is: 'isl_Latn',
  it: 'ita_Latn',
  ja: 'jpn_Jpan',
  ka: 'kat_Geor',
  kk: 'kaz_Cyrl',
  km: 'khm_Khmr',
  kn: 'kan_Knda',
  ko: 'kor_Hang',
  lt: 'lit_Latn',
  lv: 'lvs_Latn',
  mk: 'mkd_Cyrl',
  ml: 'mal_Mlym',
  mn: 'khk_Cyrl',
  mr: 'mar_Deva',
  ms: 'zsm_Latn',
  mt: 'mlt_Latn',
  my: 'mya_Mymr',
  nl: 'nld_Latn',
  no: 'nob_Latn',
  pa: 'pan_Guru',
  pl: 'pol_Latn',
  pt: 'por_Latn',
  ro: 'ron_Latn',
  ru: 'rus_Cyrl',
  sk: 'slk_Latn',
  sl: 'slv_Latn',
  sq: 'als_Latn',
  sr: 'srp_Cyrl',
  sv: 'swe_Latn',
  sw: 'swh_Latn',
  ta: 'tam_Taml',
  te: 'tel_Telu',
  th: 'tha_Thai',
  tl: 'tgl_Latn',
  tr: 'tur_Latn',
  uk: 'ukr_Cyrl',
  ur: 'urd_Arab',
  uz: 'uzn_Latn',
  vi: 'vie_Latn',
  xh: 'xho_Latn',
  zh: 'zho_Hans',
  zu: 'zul_Latn',
};

const SUPPORTED_LANGS = Object.keys(ISO_TO_FLORES);

export class NLLB200Provider extends BaseProvider {
  private pipeline: TranslationPipeline | null = null;
  private loading: Promise<TranslationPipeline> | null = null;

  constructor() {
    super({
      id: 'nllb-200',
      name: 'NLLB-200 (Universal)',
      type: 'local',
      qualityTier: 'standard',
      costPerMillion: 0,
    });
  }

  async isAvailable(): Promise<boolean> {
    return true; // Always available — model downloads on first use
  }

  getSupportedLanguages(): LanguagePair[] {
    const pairs: LanguagePair[] = [];
    for (const src of SUPPORTED_LANGS) {
      for (const tgt of SUPPORTED_LANGS) {
        if (src !== tgt) pairs.push({ src, tgt });
      }
    }
    return pairs;
  }

  supportsLanguagePair(src: string, tgt: string): boolean {
    return src in ISO_TO_FLORES && tgt in ISO_TO_FLORES;
  }

  getConfig(): ProviderConfig {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      qualityTier: this.qualityTier,
      costPerMillion: this.costPerMillion,
      icon: this.icon,
    };
  }

  private async getPipeline(): Promise<TranslationPipeline> {
    if (this.pipeline) return this.pipeline;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      log.info(`Loading NLLB-200-distilled-600M model...`);
      const { pipeline } = await import('@huggingface/transformers');
      const pipe = await withTimeout(
        pipeline('translation', NLLB_MODEL, { device: 'wasm', dtype: 'q8' } as Record<string, unknown>),
        CONFIG.timeouts.opusMtDirectMs,
        'Loading NLLB-200-distilled-600M',
      );
      this.pipeline = pipe as unknown as TranslationPipeline;
      this.loading = null;
      log.info('NLLB-200-distilled-600M loaded');
      return this.pipeline;
    })();

    return this.loading;
  }

  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    _options?: TranslationOptions,
  ): Promise<string | string[]> {
    const srcFlores = ISO_TO_FLORES[sourceLang];
    const tgtFlores = ISO_TO_FLORES[targetLang];

    if (!srcFlores || !tgtFlores) {
      throw new Error(`NLLB-200: unsupported language pair ${sourceLang}→${targetLang}`);
    }

    const pipe = await this.getPipeline();
    const texts = Array.isArray(text) ? text : [text];

    const results = await Promise.all(
      texts.map(async (t) => {
        if (!t?.trim()) return t;
        const output = await pipe(t, {
          src_lang: srcFlores,
          tgt_lang: tgtFlores,
        });
        return output[0]?.translation_text ?? t;
      }),
    );

    return Array.isArray(text) ? results : results[0];
  }
}

export const nllb200Provider = new NLLB200Provider();
