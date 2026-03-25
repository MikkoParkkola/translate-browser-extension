import { describe, expect, it } from 'vitest';
import {
  normalizeDownloadedModelRecords,
  upsertDownloadedModelRecord,
} from './downloaded-models';

describe('normalizeDownloadedModelRecords', () => {
  it('normalizes legacy string entries into record objects', () => {
    expect(
      normalizeDownloadedModelRecords(['opus-mt-en-fi']),
    ).toEqual([
      {
        id: 'opus-mt-en-fi',
        size: 0,
      },
    ]);
  });
});

describe('upsertDownloadedModelRecord', () => {
  it('adds new normalized records', () => {
    expect(
      upsertDownloadedModelRecord([], {
        id: 'translategemma',
        name: 'TranslateGemma',
        size: 123,
      }),
    ).toEqual([
      {
        id: 'translategemma',
        name: 'TranslateGemma',
        size: 123,
        lastUsed: undefined,
      },
    ]);
  });

  it('preserves existing size and name when only lastUsed changes', () => {
    expect(
      upsertDownloadedModelRecord(
        [
          {
            id: 'opus-mt-en-fi',
            name: 'OPUS-MT EN-FI',
            size: 314572800,
            lastUsed: 1,
          },
        ],
        {
          id: 'opus-mt-en-fi',
          lastUsed: 2,
        },
      ),
    ).toEqual([
      {
        id: 'opus-mt-en-fi',
        name: 'OPUS-MT EN-FI',
        size: 314572800,
        lastUsed: 2,
      },
    ]);
  });
});
