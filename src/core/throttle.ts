/**
 * Rate Limiting & Throttling System
 * Ported from legacy throttle.js - battle-tested implementation
 *
 * Features:
 * - Sliding window rate limiting
 * - Exponential backoff with jitter
 * - Predictive batching
 * - Token estimation
 */

import type { ThrottleConfig, ThrottleUsage } from '../types';
import { CONFIG } from '../config';

interface QueueItem<T> {
  fn: () => Promise<T>;
  tokens: number;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface TokenRecord {
  time: number;
  tokens: number;
}

interface RetryableError extends Error {
  retryable?: boolean;
  retryAfter?: number;
}

export class Throttle {
  private queue: QueueItem<unknown>[] = [];
  private config: ThrottleConfig;
  private availableRequests: number;
  private availableTokens: number;
  private requestTimes: number[] = [];
  private tokenTimes: TokenRecord[] = [];
  private totalRequests = 0;
  private totalTokens = 0;
  private processing = false;
  private cooldown = false;
  private interval: ReturnType<typeof setInterval>;

  constructor(opts: Partial<ThrottleConfig> = {}) {
    this.config = {
      requestLimit: opts.requestLimit ?? CONFIG.throttle.requestLimit,
      tokenLimit: opts.tokenLimit ?? CONFIG.throttle.tokenLimit,
      windowMs: opts.windowMs ?? CONFIG.throttle.windowMs,
    };
    this.availableRequests = this.config.requestLimit;
    this.availableTokens = this.config.tokenLimit;
    this.interval = setInterval(() => this.resetWindow(), this.config.windowMs);
  }

  /**
   * Split text into sentences for batching
   */
  splitSentences(text: string): string[] {
    const s = String(text || '');
    const matches = s.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
    return matches ? matches.map((t) => t.trim()) : [s.trim()];
  }

  /**
   * Approximate token count (~4 chars per token)
   */
  approxTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  /**
   * Create predictive batches that respect token limits
   */
  predictiveBatch(texts: string[], maxTokens: number = this.config.tokenLimit): string[][] {
    const sentences: string[] = [];
    texts.forEach((t) => sentences.push(...this.splitSentences(t)));

    const batches: string[][] = [];
    let current: string[] = [];
    let tokens = 0;

    sentences.forEach((s) => {
      const tok = this.approxTokens(s);
      if (current.length && tokens + tok > maxTokens) {
        batches.push(current);
        current = [];
        tokens = 0;
      }
      current.push(s);
      tokens += tok;
    });

    if (current.length) batches.push(current);
    return batches;
  }

  /**
   * Update configuration
   */
  configure(newOpts: Partial<ThrottleConfig>): void {
    Object.assign(this.config, newOpts);
    this.availableRequests = this.config.requestLimit;
    this.availableTokens = this.config.tokenLimit;
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.resetWindow(), this.config.windowMs);
  }

  private resetWindow(): void {
    this.availableRequests = this.config.requestLimit;
    this.availableTokens = this.config.tokenLimit;
    this.processQueue();
  }

  private recordUsage(tokens: number, requests = 1): void {
    const now = Date.now();
    for (let i = 0; i < requests; i++) {
      this.requestTimes.push(now);
    }
    this.tokenTimes.push({ time: now, tokens });
    this.totalRequests += requests;
    this.totalTokens += tokens;
    this.prune(now);
  }

  private prune(now = Date.now()): void {
    while (this.requestTimes.length && now - this.requestTimes[0] > this.config.windowMs) {
      this.requestTimes.shift();
    }
    while (this.tokenTimes.length && now - this.tokenTimes[0].time > this.config.windowMs) {
      this.tokenTimes.shift();
    }
  }

  private processQueue(): void {
    if (this.processing || this.cooldown) return;
    if (!this.queue.length) return;
    if (this.availableRequests <= 0 || this.availableTokens < this.queue[0].tokens) return;

    this.processing = true;
    const intervalMs = Math.ceil(this.config.windowMs / this.config.requestLimit);
    const item = this.queue.shift()!;

    this.availableRequests--;
    this.availableTokens -= item.tokens;
    this.recordUsage(item.tokens);

    item.fn().then(item.resolve, item.reject);
    this.processing = false;
    this.cooldown = true;
    setTimeout(() => {
      this.cooldown = false;
      this.processQueue();
    }, intervalMs);
  }

  /**
   * Run function with rate limiting
   */
  runWithRateLimit<T>(
    fn: () => Promise<T>,
    textOrTokens: string | number,
    opts: { immediate?: boolean } = {}
  ): Promise<T> {
    const tokens = typeof textOrTokens === 'number' ? textOrTokens : this.approxTokens(textOrTokens);

    return new Promise((resolve, reject) => {
      if (opts.immediate && !this.cooldown && this.availableRequests > 0 && this.availableTokens >= tokens) {
        this.availableRequests--;
        this.availableTokens -= tokens;
        this.recordUsage(tokens);
        try {
          Promise.resolve(fn()).then(resolve, reject);
        } catch (e) {
          reject(e);
        }
        return;
      }
      this.queue.push({ fn, tokens, resolve: resolve as (v: unknown) => void, reject });
      this.processQueue();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Run function with automatic retry and exponential backoff
   */
  async runWithRetry<T>(
    fn: () => Promise<T>,
    textOrTokens: string | number,
    attempts = 6,
    debug = false
  ): Promise<T> {
    const tokens = typeof textOrTokens === 'number' ? textOrTokens : this.approxTokens(textOrTokens);
    let wait = 500;

    for (let i = 0; i < attempts; i++) {
      try {
        if (debug) console.log('[Throttle] attempt', i + 1);
        return await this.runWithRateLimit(fn, tokens, { immediate: true });
      } catch (err) {
        const error = err as RetryableError;
        if (!error.retryable || i === attempts - 1) throw error;
        const base = error.retryAfter || wait;
        const jitter = 0.9 + Math.random() * 0.2;
        const delayMs = Math.round(base * jitter);
        if (debug) console.log('[Throttle] retrying after error', error.message, 'in', delayMs, 'ms');
        await this.delay(delayMs);
        wait = Math.min(base * 2, 60000);
      }
    }
    // Note: This is unreachable - loop throws on last attempt (i === attempts - 1)
    // TypeScript requires a return/throw here for type safety
    throw new Error('Max retries exceeded');
  }

  /**
   * Get current usage statistics
   */
  getUsage(): ThrottleUsage {
    this.prune();
    const tokensUsed = this.tokenTimes.reduce((s, t) => s + t.tokens, 0);
    return {
      requests: this.requestTimes.length,
      tokens: tokensUsed,
      requestLimit: this.config.requestLimit,
      tokenLimit: this.config.tokenLimit,
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens,
      queue: this.queue.length,
    };
  }

  /**
   * Reset all usage and queue
   */
  reset(): void {
    this.queue.length = 0;
    this.requestTimes.length = 0;
    this.tokenTimes.length = 0;
    this.totalRequests = 0;
    this.totalTokens = 0;
    this.availableRequests = this.config.requestLimit;
    this.availableTokens = this.config.tokenLimit;
    this.processing = false;
    this.cooldown = false;
  }

  /**
   * Cleanup interval on destroy
   */
  destroy(): void {
    if (this.interval) clearInterval(this.interval);
  }
}

// Singleton instance
export const throttle = new Throttle();

export default throttle;
