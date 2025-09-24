/**
 * Browser-compatible schemas without external dependencies
 * Replaces zod with simple validation functions
 */

// Simple validation helpers
const validators = {
  boolean: (value, defaultValue = false) => {
    if (typeof value === 'boolean') return value;
    return defaultValue;
  },

  string: (value, defaultValue = '') => {
    if (typeof value === 'string') return value;
    return defaultValue;
  },

  number: (value, defaultValue = 0) => {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
    return defaultValue;
  },

  object: (value, defaultValue = {}) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    return defaultValue;
  },

  array: (value, defaultValue = []) => {
    if (Array.isArray(value)) return value;
    return defaultValue;
  }
};

// Schema validation functions
const homeInitResponseSchema = {
  validate: (data) => {
    const validated = {
      providers: validators.object(data?.providers, {}),
      providersUsage: validators.object(data?.providersUsage, {}),
      usage: {
        requests: validators.number(data?.usage?.requests, 0),
        tokens: validators.number(data?.usage?.tokens, 0),
        requestLimit: data?.usage?.requestLimit,
        tokenLimit: data?.usage?.tokenLimit
      },
      provider: validators.string(data?.provider, 'unknown'),
      apiKey: validators.boolean(data?.apiKey, false)
    };
    return { success: true, data: validated };
  }
};

const usageResponseSchema = {
  validate: (data) => {
    const validated = {
      requests: validators.number(data?.requests, 0),
      tokens: validators.number(data?.tokens, 0),
      requestLimit: data?.requestLimit,
      tokenLimit: data?.tokenLimit,
      models: validators.object(data?.models, {}),
      costs: validators.object(data?.costs, {})
    };
    return { success: true, data: validated };
  }
};

const debugInfoResponseSchema = {
  validate: (data) => {
    const validated = {
      ok: validators.boolean(data?.ok, true),
      timestamp: validators.number(data?.timestamp, Date.now()),
      usage: usageResponseSchema.validate(data?.usage || {}).data,
      providersUsage: validators.object(data?.providersUsage, {}),
      config: validators.object(data?.config, {}),
      cache: validators.object(data?.cache, {}),
      tm: validators.object(data?.tm, {}),
      health: {
        lastProviderOk: validators.boolean(data?.health?.lastProviderOk, false),
        provider: validators.string(data?.health?.provider, ''),
        model: validators.string(data?.health?.model, '')
      },
      lastEvent: data?.lastEvent || null
    };
    return { success: true, data: validated };
  }
};

const permissionsResponseSchema = {
  validate: (data) => {
    const validated = {
      granted: validators.boolean(data?.granted, false),
      origin: validators.string(data?.origin, '')
    };
    return { success: true, data: validated };
  }
};

const autoTranslateResponseSchema = {
  validate: (data) => {
    const validated = {
      ok: validators.boolean(data?.ok, true),
      autoTranslate: validators.boolean(data?.autoTranslate, false)
    };
    return { success: true, data: validated };
  }
};

const quickTranslateResponseSchema = {
  validate: (data) => {
    const validated = {
      ok: validators.boolean(data?.ok, true),
      error: data?.error ? validators.string(data.error) : undefined
    };
    return { success: true, data: validated };
  }
};

const testTranslationResponseSchema = {
  validate: (data) => {
    const validated = {
      success: validators.boolean(data?.success, false),
      text: data?.text ? validators.string(data.text) : undefined,
      confidence: data?.confidence !== undefined ? validators.number(data.confidence, 0) : undefined,
      error: data?.error ? validators.string(data.error) : undefined
    };
    return { success: true, data: validated };
  }
};

const simpleOkResponseSchema = {
  validate: (data) => {
    const validated = {
      ok: validators.boolean(data?.ok, true)
    };
    return { success: true, data: validated };
  }
};

// Export schemas
if (typeof self !== 'undefined') {
  self.qwenSchemas = {
    homeInitResponseSchema,
    usageResponseSchema,
    debugInfoResponseSchema,
    permissionsResponseSchema,
    autoTranslateResponseSchema,
    quickTranslateResponseSchema,
    testTranslationResponseSchema,
    simpleOkResponseSchema
  };
}