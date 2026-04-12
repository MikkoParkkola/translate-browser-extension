import { describe, expect, it } from 'vitest';

import type { ActionSettings } from './message-handlers';
import { buildTabActionMessage } from './tab-actions';

const settings: ActionSettings = {
  sourceLang: 'auto',
  targetLang: 'en',
  strategy: 'smart',
  provider: 'opus-mt',
};

describe('buildTabActionMessage', () => {
  it('maps translate-selection to a content command', () => {
    expect(buildTabActionMessage('translate-selection', settings)).toEqual({
      type: 'translateSelection',
      ...settings,
    });
  });

  it('maps translate-page to a content command', () => {
    expect(buildTabActionMessage('translate-page', settings)).toEqual({
      type: 'translatePage',
      ...settings,
    });
  });

  it('maps undo-translation to a content command', () => {
    expect(buildTabActionMessage('undo-translation', settings)).toEqual({
      type: 'undoTranslation',
    });
  });

  it('maps translate-image and preserves imageUrl', () => {
    expect(
      buildTabActionMessage('translate-image', settings, {
        imageUrl: 'https://example.com/test.png',
      })
    ).toEqual({
      type: 'translateImage',
      imageUrl: 'https://example.com/test.png',
      ...settings,
    });
  });

  it('maps toggle-widget to a content command', () => {
    expect(buildTabActionMessage('toggle-widget', settings)).toEqual({
      type: 'toggleWidget',
    });
  });

  it('maps screenshot-translate to a content command', () => {
    expect(buildTabActionMessage('screenshot-translate', settings)).toEqual({
      type: 'enterScreenshotMode',
    });
  });
});
