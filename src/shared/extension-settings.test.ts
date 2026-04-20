import { describe, expect, it } from 'vitest';
import {
  buildExtensionSettingsStorageMutation,
  normalizeExtensionSettings,
  normalizeUserSettings,
} from './extension-settings';

describe('normalizeUserSettings', () => {
  it('uses caller-provided defaults for missing values', () => {
    expect(
      normalizeUserSettings({}, {
        provider: 'chrome-builtin',
        targetLang: 'fi',
      }),
    ).toEqual({
      sourceLang: 'auto',
      targetLang: 'fi',
      provider: 'chrome-builtin',
      strategy: 'smart',
    });
  });

  it('normalizes invalid provider and strategy values', () => {
    expect(
      normalizeUserSettings(
        {
          provider: 'not-real',
          strategy: 'bogus',
        },
        'opus-mt',
      ),
    ).toEqual({
      sourceLang: 'auto',
      targetLang: 'en',
      provider: 'opus-mt',
      strategy: 'smart',
    });
  });
});

describe('normalizeExtensionSettings', () => {
  it('includes autoTranslate with a false default', () => {
    expect(
      normalizeExtensionSettings({
        sourceLang: 'fi',
        targetLang: 'de',
        strategy: 'quality',
        autoTranslate: true,
      }),
    ).toEqual({
      sourceLang: 'fi',
      targetLang: 'de',
      provider: 'opus-mt',
      strategy: 'quality',
      autoTranslate: true,
    });
  });
});

describe('buildExtensionSettingsStorageMutation', () => {
  it('normalizes partial setting patches', () => {
    expect(
      buildExtensionSettingsStorageMutation({
        provider: 'opus-mt-local',
        strategy: 'bogus',
        autoTranslate: 'invalid',
      }),
    ).toEqual({
      provider: 'opus-mt',
      strategy: 'smart',
      autoTranslate: false,
    });
  });

  it('fills targetLang from caller defaults when needed', () => {
    expect(
      buildExtensionSettingsStorageMutation(
        {
          targetLang: '',
        },
        { targetLang: 'sv' },
      ),
    ).toEqual({
      targetLang: 'sv',
    });
  });
});
