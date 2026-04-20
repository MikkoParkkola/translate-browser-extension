import { describe, expect, it } from 'vitest';
import {
  deriveDownloadedModelName,
  normalizeDownloadedModelRecord,
  normalizeDownloadedModelRecords,
  upsertDownloadedModelRecord,
} from './downloaded-models';

describe('normalizeDownloadedModelRecord', () => {
  it('rejects non-object and invalid record values', () => {
    expect(normalizeDownloadedModelRecord('')).toBeNull();
    expect(normalizeDownloadedModelRecord(null)).toBeNull();
    expect(normalizeDownloadedModelRecord({ id: '' })).toBeNull();
  });

  it('normalizes object records with invalid numeric fields', () => {
    expect(
      normalizeDownloadedModelRecord({
        id: 'opus-mt-en-fi',
        name: '',
        size: -1,
        lastUsed: Number.NaN,
      }),
    ).toEqual({
      id: 'opus-mt-en-fi',
      name: undefined,
      size: 0,
      lastUsed: undefined,
    });
  });
});

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

  it('filters out invalid entries from mixed arrays', () => {
    expect(
      normalizeDownloadedModelRecords([
        '',
        null,
        { id: '' },
        { id: 'translategemma', size: 42, lastUsed: 10 },
      ]),
    ).toEqual([
      {
        id: 'translategemma',
        name: undefined,
        size: 42,
        lastUsed: 10,
      },
    ]);
  });
});

describe('deriveDownloadedModelName', () => {
  it('derives provider-aware names for downloaded models', () => {
    expect(deriveDownloadedModelName('opus-mt-en-fi')).toBe('OPUS-MT EN-FI');
    expect(deriveDownloadedModelName('opus-mt')).toBe('OPUS-MT');
    expect(deriveDownloadedModelName('translategemma-model')).toBe('TranslateGemma');
    expect(deriveDownloadedModelName('unknown-model')).toBeUndefined();
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

  it('returns normalized existing records when the update id is invalid', () => {
    expect(
      upsertDownloadedModelRecord(
        [{ id: 'opus-mt-en-fi', size: 1 }],
        { id: '', size: 99 },
      ),
    ).toEqual([
      {
        id: 'opus-mt-en-fi',
        name: undefined,
        size: 1,
        lastUsed: undefined,
      },
    ]);
  });

  it('keeps prior values when update fields are invalid or empty', () => {
    expect(
      upsertDownloadedModelRecord(
        [{ id: 'opus-mt-en-fi', name: 'Existing', size: 5, lastUsed: 7 }],
        { id: 'opus-mt-en-fi', name: '', size: 0, lastUsed: Number.NaN },
      ),
    ).toEqual([
      {
        id: 'opus-mt-en-fi',
        name: 'Existing',
        size: 5,
        lastUsed: 7,
      },
    ]);
  });

  it('falls back to zero size for new records with invalid size values', () => {
    expect(
      upsertDownloadedModelRecord([], {
        id: 'new-model',
        size: 0,
      }),
    ).toEqual([
      {
        id: 'new-model',
        name: undefined,
        size: 0,
        lastUsed: undefined,
      },
    ]);
  });
});
