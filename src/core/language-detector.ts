/**
 * Fast trigram-based language detector
 *
 * Uses ranked trigram correlation between input text and pre-computed
 * reference profiles for Latin-script languages. Non-Latin scripts
 * (CJK, Cyrillic, Arabic, etc.) use fast Unicode range detection.
 * Runs in < 1ms on ~100 chars. No external dependencies.
 */

export interface LanguageDetectionResult {
  lang: string;
  confidence: number;
}

// Top trigrams for Latin-script languages only, ordered by frequency.
// Non-Latin languages (zh, ja, ko, ru, ar, hi) use script detection instead.
// Trigrams include word-boundary spaces for better discrimination.
const PROFILES: Record<string, string[]> = {
  en: [' th','the','he ',' in','ing','nd ',' an','and',' to',' of','ion','tio','ed ','ent','er ',' is',' co',' re',' ha',' fo','on ',' it',' wa','al ',' st','ati','or ','es ','re ',' be','en ','hat','te ',' on',' wh','at ',' wi','ver','all'],
  fi: [' ja','ja ',' on','an ',' ta','en ',' ka',' va','ta ','in ','ssa','ist','sta','nen',' pa','tta','lla',' ko','ise',' ei','sen',' tu','ais','iin','sti','ita','een',' ol',' si','taa','all','lle','aa ','lla','kan',' se'],
  de: ['en ',' di','die','der','er ',' de',' un','und','sch',' da',' ei','ein','ich','che','den',' ge','ung','ch ',' be',' sc','in ',' au',' ve','ber',' mi',' si',' zu','ie ','ter','ver',' an','gen','eit','ine','nde','ung'],
  fr: [' de','es ',' le',' la','le ','les','de ','ent','ion',' co',' pa',' qu',' et','tio','des','que',' un',' en',' pr','ons',' au',' mo','ais',' po','par','men','ait','our',' se','ont','eme','dan','eur','ait','ais'],
  es: [' de','de ',' la','la ',' en','el ',' el',' qu','que',' co','es ',' lo','los','ion','nte','las',' un',' se',' po','del','aci','con','por','ado','ien','ida','nes',' es',' re','ent','cion','ado','dad','est'],
  sv: [' oc','och','en ',' de',' fo','att',' at',' so','som',' en','det',' ha','er ','ing','for',' av','and','de ',' in','ar ',' me',' sk','var',' vi',' ko',' st','den','ter','lla',' ma',' va','nde',' pa','gen'],
  nl: [' de','het','de ',' he',' va','van',' en','een',' ee',' in','ver','der',' ge',' te','er ',' op',' da',' me',' be',' ze',' aa','aar','and','oor','ijk','den',' di','gen','ing','ede','ste',' is',' wo',' we'],
  cs: [' pr',' po',' ne',' na',' je',' se',' ko',' ov',' ro',' za',' do',' st',' no',' ja',' ni',' re',' te',' ve',' od','pro','pre','ost','che','eni','sta','ick','ova','ani','ske','sti',' ce','ych'],
  da: [' de',' og','og ',' en',' er',' fo',' at',' ti',' ha',' me',' af',' so',' pa','for','der','det','den','til','med','som','sig','har','ell','kan',' si',' ar',' he',' ko',' st'],
  no: [' de',' og','og ',' en',' er',' fo',' at',' ti',' ha',' me',' av',' so',' pa','for','som','det','den','med','til','har','var','ene','ter','ing',' si',' he',' ko',' st'],
  pl: [' pr',' ni',' na',' po',' rz',' ze',' do',' je',' si',' ie',' ko',' cz',' st','prz','nie','rze','ych','owa','ego','ski','ani','sta','nia',' sz',' wi',' od',' za','ow ','kie'],
  pt: [' de','de ',' qu','que',' co',' do','do ',' da','da ','dos',' se',' um',' pa',' ma',' po',' no',' es','ent',' re',' na',' ao',' pr','ado','par','com','por','nte','est',' pe','ica',' am','ras','bra'],
  it: [' di','di ','che',' de',' ch',' la',' il',' in',' pe',' co',' un',' no',' re',' le',' al',' da',' ne',' se','del','ell','lla','per','con','ion','one','ent','ato','nte','ere','are','ita','gli','zio'],
  tr: [' bi',' de',' bu',' ba',' ve',' da',' ge',' en',' ya',' an','lar','bir','ler','eri','ile','ini','ara','dan',' ol',' ka',' ak',' er',' ir',' il',' al',' ha',' ta',' si','lik','eki'],
};

/**
 * Extract trigram frequency map from text.
 */
function buildTrigramProfile(text: string): Map<string, number> {
  const profile = new Map<string, number>();
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const len = normalized.length;
  for (let i = 0; i <= len - 3; i++) {
    const tri = normalized.substring(i, i + 3);
    profile.set(tri, (profile.get(tri) || 0) + 1);
  }
  return profile;
}

// Cache parsed profiles
let parsedProfiles: Map<string, Map<string, number>> | null = null;

function getParsedProfiles(): Map<string, Map<string, number>> {
  if (parsedProfiles) return parsedProfiles;
  parsedProfiles = new Map();
  for (const [lang, trigrams] of Object.entries(PROFILES)) {
    const map = new Map<string, number>();
    const total = trigrams.length;
    for (let i = 0; i < total; i++) {
      map.set(trigrams[i], total - i);
    }
    parsedProfiles.set(lang, map);
  }
  return parsedProfiles;
}

/**
 * Compute cosine similarity between two trigram profiles.
 */
function cosineSimilarity(
  inputProfile: Map<string, number>,
  refProfile: Map<string, number>
): number {
  let dotProduct = 0;
  let inputMag = 0;
  let refMag = 0;

  for (const [tri, inputVal] of inputProfile) {
    inputMag += inputVal * inputVal;
    const refVal = refProfile.get(tri);
    if (refVal !== undefined) {
      dotProduct += inputVal * refVal;
    }
  }

  for (const [, refVal] of refProfile) {
    refMag += refVal * refVal;
  }

  const denominator = Math.sqrt(inputMag) * Math.sqrt(refMag);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Script-based detection for non-Latin scripts.
 */
function detectByScript(text: string): LanguageDetectionResult | null {
  let cjkChinese = 0;
  let hiraganaKatakana = 0;
  let hangul = 0;
  let cyrillic = 0;
  let arabic = 0;
  let devanagari = 0;
  let total = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x20) continue;
    total++;
    if (code >= 0x4e00 && code <= 0x9fff) cjkChinese++;
    else if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) hiraganaKatakana++;
    else if (code >= 0xac00 && code <= 0xd7af) hangul++;
    else if (code >= 0x0400 && code <= 0x04ff) cyrillic++;
    else if (code >= 0x0600 && code <= 0x06ff) arabic++;
    else if (code >= 0x0900 && code <= 0x097f) devanagari++;
  }

  if (total === 0) return null;
  const threshold = 0.3;

  if (hiraganaKatakana / total > threshold) return { lang: 'ja', confidence: 0.95 };
  if (hangul / total > threshold) return { lang: 'ko', confidence: 0.95 };
  if (cjkChinese / total > threshold) return { lang: 'zh', confidence: 0.90 };
  if (cyrillic / total > threshold) return { lang: 'ru', confidence: 0.85 };
  if (arabic / total > threshold) return { lang: 'ar', confidence: 0.90 };
  if (devanagari / total > threshold) return { lang: 'hi', confidence: 0.90 };

  return null;
}

/**
 * Detect the language of a text sample.
 *
 * @param text - Input text (works best with 50-200 chars)
 * @returns Detection result with ISO 639-1 code and confidence 0-1, or null if undetermined
 */
export function detectLanguage(text: string): LanguageDetectionResult | null {
  if (!text || text.trim().length < 10) return null;

  // Fast path: non-Latin script detection
  const scriptResult = detectByScript(text);
  if (scriptResult) return scriptResult;

  // Trigram-based detection for Latin-script languages
  const inputProfile = buildTrigramProfile(text);
  const profiles = getParsedProfiles();

  let bestLang = '';
  let bestScore = -1;
  let secondBestScore = -1;

  for (const [lang, refProfile] of profiles) {
    const score = cosineSimilarity(inputProfile, refProfile);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestLang = lang;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (bestScore <= 0) return null;

  // Confidence based on score and margin
  const gap = bestScore - secondBestScore;
  const confidence = Math.min(0.99, bestScore * 0.5 + gap * 3.0);

  if (confidence < 0.10) return null;

  return { lang: bestLang, confidence: Math.round(confidence * 100) / 100 };
}

/**
 * Sample text from a page for language detection.
 * Extracts visible text from body, skipping scripts/styles.
 */
export function samplePageText(maxLength = 500): string {
  const body = document.body;
  if (!body) return '';

  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Text): number {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.textContent?.trim();
      if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let result = '';
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null) !== null) {
    const text = node.textContent?.trim();
    if (text) {
      result += text + ' ';
      if (result.length >= maxLength) break;
    }
  }

  return result.slice(0, maxLength);
}
