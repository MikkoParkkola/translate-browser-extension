import { describe, expect, it } from 'vitest';
import {
  GENERAL_SETTINGS_TARGET_LANGUAGES,
  GLOSSARY_LANGUAGES,
  ONBOARDING_LANGUAGES,
  POPUP_SOURCE_LANGUAGES,
  POPUP_TARGET_LANGUAGES,
  POPUP_STRATEGIES,
  SITE_RULE_LANGUAGES,
  SITE_RULE_STRATEGIES,
} from './translation-options';

describe('translation-options', () => {
  it('excludes auto from target-language lists while keeping it in source lists', () => {
    expect(POPUP_SOURCE_LANGUAGES[0]).toEqual({
      code: 'auto',
      name: 'Auto Detect',
      flag: '',
    });
    expect(POPUP_TARGET_LANGUAGES.some((option) => option.code === 'auto')).toBe(false);
    expect(GENERAL_SETTINGS_TARGET_LANGUAGES.some((option) => option.code === 'auto')).toBe(false);
  });

  it('builds onboarding flags only for languages that declare one', () => {
    expect(ONBOARDING_LANGUAGES.find((option) => option.code === 'en')).toEqual({
      code: 'en',
      name: 'English',
      flag: 'GB',
    });
    expect(ONBOARDING_LANGUAGES.find((option) => option.code === 'cs')).toBeUndefined();
  });

  it('includes default entries for glossary and site-rule selectors', () => {
    expect(GLOSSARY_LANGUAGES[0]).toEqual({ code: 'all', name: 'All Languages' });
    expect(SITE_RULE_LANGUAGES[0]).toEqual({ code: '', name: 'Use default' });
    expect(SITE_RULE_STRATEGIES[0]).toEqual({ id: '', name: 'Use default' });
  });

  it('keeps popup strategies focused on interactive choices', () => {
    expect(POPUP_STRATEGIES.map((option) => option.id)).toEqual(['smart', 'fast', 'quality']);
  });
});
