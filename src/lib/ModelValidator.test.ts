import { describe, it, expect } from 'vitest';
import { ModelValidator } from './ModelValidator';

describe('ModelValidator', () => {
  it('constructor accepts registry and config', () => {
    const validator = new ModelValidator({ models: [] }, { strictMode: true });
    expect(validator).toBeInstanceOf(ModelValidator);
  });

  it('constructor works with no arguments', () => {
    const validator = new ModelValidator();
    expect(validator).toBeInstanceOf(ModelValidator);
  });

  it('constructor works with only registry', () => {
    const validator = new ModelValidator({ models: [] });
    expect(validator).toBeInstanceOf(ModelValidator);
  });

  it('validateModelIntegrity returns { valid: true }', async () => {
    const validator = new ModelValidator();
    const result = await validator.validateModelIntegrity();
    expect(result).toEqual({ valid: true });
  });

  it('validateModelIntegrity works with various argument shapes', async () => {
    const validator = new ModelValidator({}, { strictMode: false });

    const r1 = await validator.validateModelIntegrity('model-id');
    expect(r1.valid).toBe(true);

    const r2 = await validator.validateModelIntegrity('model-id', { checksum: 'abc' });
    expect(r2.valid).toBe(true);

    const r3 = await validator.validateModelIntegrity();
    expect(r3.valid).toBe(true);
  });
});
