import { describe, it, expect } from 'vitest';
import {
  SKIP_TAGS,
  TRANSLATED_ATTR,
  ORIGINAL_TEXT_ATTR,
  ORIGINAL_TEXT_NODES_ATTR,
  MACHINE_TRANSLATION_ATTR,
  SOURCE_LANG_ATTR,
  TARGET_LANG_ATTR,
} from './content-types';

describe('SKIP_TAGS', () => {
  it('is a Set', () => {
    expect(SKIP_TAGS).toBeInstanceOf(Set);
  });

  it.each([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'CODE',
    'PRE',
    'TEXTAREA',
    'INPUT',
    'SELECT',
    'BUTTON',
    'SVG',
    'MATH',
    'CANVAS',
    'VIDEO',
    'AUDIO',
    'IFRAME',
    'OBJECT',
    'EMBED',
  ])('contains %s', (tag) => {
    expect(SKIP_TAGS.has(tag)).toBe(true);
  });

  it.each(['P', 'DIV', 'SPAN', 'A', 'H1', 'BODY'])('does not contain %s', (tag) => {
    expect(SKIP_TAGS.has(tag)).toBe(false);
  });
});

describe('constants', () => {
  it('TRANSLATED_ATTR is a string', () => {
    expect(typeof TRANSLATED_ATTR).toBe('string');
    expect(TRANSLATED_ATTR).toBe('data-translated');
  });

  it('ORIGINAL_TEXT_ATTR is a string', () => {
    expect(typeof ORIGINAL_TEXT_ATTR).toBe('string');
    expect(ORIGINAL_TEXT_ATTR).toBe('data-original-text');
  });

  it('ORIGINAL_TEXT_NODES_ATTR is a string', () => {
    expect(typeof ORIGINAL_TEXT_NODES_ATTR).toBe('string');
    expect(ORIGINAL_TEXT_NODES_ATTR).toBe('data-original-text-nodes');
  });

  it('MACHINE_TRANSLATION_ATTR is a string', () => {
    expect(typeof MACHINE_TRANSLATION_ATTR).toBe('string');
    expect(MACHINE_TRANSLATION_ATTR).toBe('data-machine-translation');
  });

  it('SOURCE_LANG_ATTR is a string', () => {
    expect(typeof SOURCE_LANG_ATTR).toBe('string');
    expect(SOURCE_LANG_ATTR).toBe('data-source-lang');
  });

  it('TARGET_LANG_ATTR is a string', () => {
    expect(typeof TARGET_LANG_ATTR).toBe('string');
    expect(TARGET_LANG_ATTR).toBe('data-target-lang');
  });
});
