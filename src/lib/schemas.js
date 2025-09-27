const { z } = require('zod');

const nonNegativeNumber = z.preprocess((value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}, z.number().nonnegative());

const usageSummarySchema = z.object({
  requests: nonNegativeNumber.default(0),
  requestLimit: nonNegativeNumber.optional(),
  tokens: nonNegativeNumber.default(0),
  tokenLimit: nonNegativeNumber.optional(),
});

const providerUsageSchema = z.object({
  requests: nonNegativeNumber.default(0),
  tokens: nonNegativeNumber.default(0),
  totalRequests: nonNegativeNumber.default(0),
  totalTokens: nonNegativeNumber.default(0),
});

const providersUsageSchema = z.record(providerUsageSchema);

const providerSnapshotSchema = z.object({
  apiKey: z.boolean().optional().default(false),
  model: z.string().optional().default(''),
  endpoint: z.string().optional().default(''),
  requests: nonNegativeNumber.default(0),
  tokens: nonNegativeNumber.default(0),
  totalRequests: nonNegativeNumber.default(0),
  totalTokens: nonNegativeNumber.default(0),
}).passthrough();

const providersSchema = z.record(providerSnapshotSchema);

const homeInitResponseSchema = z.object({
  providers: providersSchema.default({}),
  providersUsage: providersUsageSchema.default({}),
  usage: usageSummarySchema.default({ requests: 0, tokens: 0 }),
  provider: z.string().default('unknown'),
  apiKey: z.boolean().default(false),
});

const usageResponseSchema = z.object({
  requests: nonNegativeNumber.default(0),
  requestLimit: nonNegativeNumber.optional(),
  tokens: nonNegativeNumber.default(0),
  tokenLimit: nonNegativeNumber.optional(),
  models: z.record(z.object({
    requests: nonNegativeNumber.optional(),
    tokens: nonNegativeNumber.optional(),
    avoidedRequests: nonNegativeNumber.optional(),
    avoidedTokens: nonNegativeNumber.optional(),
    cost: z.preprocess(v => {
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    }, z.number()).optional(),
  }).passthrough()).optional(),
  costs: z.record(z.object({
    '24h': z.preprocess(v => {
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    }, z.number()).optional(),
    '7d': z.preprocess(v => {
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    }, z.number()).optional(),
  }).passthrough()).optional(),
}).passthrough();

const tmCacheMetricsResponseSchema = z.object({
  tmMetrics: z.record(z.unknown()).default({}),
  cacheStats: z.record(z.unknown()).default({}),
});

const metricsResponseSchema = z.object({
  usage: usageResponseSchema.default({ requests: 0, tokens: 0 }),
  cache: z.record(z.unknown()).default({}),
  tm: z.record(z.unknown()).default({}),
  providers: providersSchema.default({}),
  providersUsage: providersUsageSchema.default({}),
  status: z.record(z.unknown()).default({}),
}).passthrough();

const debugInfoResponseSchema = z.object({
  ok: z.boolean().default(true),
  timestamp: z.preprocess(v => {
    const num = Number(v);
    return Number.isFinite(num) && num >= 0 ? num : Date.now();
  }, z.number().nonnegative()),
  usage: usageResponseSchema.default({ requests: 0, tokens: 0 }),
  providersUsage: providersUsageSchema.default({}),
  config: z.record(z.unknown()).default({}),
  cache: z.record(z.unknown()).default({}),
  tm: z.record(z.unknown()).default({}),
  health: z.object({
    lastProviderOk: z.boolean().default(false),
    provider: z.string().optional().default(''),
    model: z.string().optional().default(''),
  }).default({ lastProviderOk: false, provider: '', model: '' }),
  lastEvent: z.unknown().nullable().optional(),
}).passthrough();

const permissionsResponseSchema = z.object({
  granted: z.boolean().default(false),
  origin: z.string().optional().default(''),
});

const autoTranslateResponseSchema = z.object({
  ok: z.boolean().default(true),
  autoTranslate: z.boolean().optional().default(false),
}).passthrough();

const quickTranslateResponseSchema = z.object({
  ok: z.boolean().optional().default(true),
  error: z.string().optional(),
}).passthrough();

const testTranslationResponseSchema = z.object({
  success: z.boolean().default(false),
  text: z.string().optional(),
  confidence: z.preprocess(v => {
    const num = Number(v);
    return Number.isFinite(num) ? num : undefined;
  }, z.number().min(0).max(1)).optional(),
  error: z.string().optional(),
}).passthrough();

const tmGetAllResponseSchema = z.object({
  entries: z.array(z.unknown()).default([]),
});

const simpleOkResponseSchema = z.object({
  ok: z.boolean().default(true),
}).passthrough();

module.exports = {
  homeInitResponseSchema,
  usageResponseSchema,
  tmCacheMetricsResponseSchema,
  metricsResponseSchema,
  debugInfoResponseSchema,
  permissionsResponseSchema,
  autoTranslateResponseSchema,
  quickTranslateResponseSchema,
  testTranslationResponseSchema,
  tmGetAllResponseSchema,
  simpleOkResponseSchema,
};
