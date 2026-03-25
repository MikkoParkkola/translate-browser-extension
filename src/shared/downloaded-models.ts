import type { DownloadedModelRecord } from '../types';

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function normalizeDownloadedModelRecord(value: unknown): DownloadedModelRecord | null {
  if (typeof value === 'string' && value.length > 0) {
    return {
      id: value,
      size: 0,
    };
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    id?: unknown;
    name?: unknown;
    size?: unknown;
    lastUsed?: unknown;
  };

  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return null;
  }

  return {
    id: candidate.id,
    name: typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : undefined,
    size: isFiniteNonNegativeNumber(candidate.size) ? candidate.size : 0,
    lastUsed: isFiniteNonNegativeNumber(candidate.lastUsed) ? candidate.lastUsed : undefined,
  };
}

export function normalizeDownloadedModelRecords(values: unknown): DownloadedModelRecord[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeDownloadedModelRecord(value))
    .filter((value): value is DownloadedModelRecord => value !== null);
}

export interface DownloadedModelRecordUpdate {
  id: string;
  name?: string;
  size?: number;
  lastUsed?: number;
}

function readOptionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function upsertDownloadedModelRecord(
  values: unknown,
  update: DownloadedModelRecordUpdate,
): DownloadedModelRecord[] {
  const normalizedId = readOptionalNonEmptyString(update.id);
  if (!normalizedId) {
    return normalizeDownloadedModelRecords(values);
  }

  const existing = normalizeDownloadedModelRecords(values);
  const existingIndex = existing.findIndex((model) => model.id === normalizedId);
  const previous = existingIndex >= 0 ? existing[existingIndex] : undefined;

  const merged: DownloadedModelRecord = {
    id: normalizedId,
    name: readOptionalNonEmptyString(update.name) ?? previous?.name,
    size: isFiniteNonNegativeNumber(update.size) && update.size > 0
      ? update.size
      : previous?.size ?? 0,
    lastUsed: isFiniteNonNegativeNumber(update.lastUsed)
      ? update.lastUsed
      : previous?.lastUsed,
  };

  if (existingIndex < 0) {
    return [...existing, merged];
  }

  const next = [...existing];
  next[existingIndex] = merged;
  return next;
}
