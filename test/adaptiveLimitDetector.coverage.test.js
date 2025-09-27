const AdaptiveLimitDetector = require('../src/lib/adaptiveLimitDetector.js');

describe('AdaptiveLimitDetector coverage', () => {
  let detector;
  let nowSpy;
  let currentTime;

  beforeEach(() => {
    jest.resetModules();
    currentTime = 0;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    detector = new AdaptiveLimitDetector({
      baseBackoffMs: 10,
      backoffMultiplier: 2,
      maxAdaptiveDelay: 100,
      circuitBreakerThreshold: 1,
      detectionWindow: 1000,
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  test('records requests, responses, and rate limits', () => {
    const requestId = detector.startRequest({ provider: 'primary' });
    expect(detector.canMakeRequest('primary')).toBe(true);

    currentTime += 5;
    let state = detector.recordResponse(requestId, { status: 200, success: true });
    expect(state.successCount).toBe(1);

    // Trigger rate limit response
    const reqId2 = detector.startRequest({ provider: 'primary' });
    currentTime += 5;
    state = detector.recordResponse(reqId2, {
      status: 429,
      isRateLimit: true,
      headers: { 'Retry-After': '20' },
    });
    expect(state.rateLimited).toBe(true);
    expect(detector.getAdaptiveDelay('primary')).toBeGreaterThan(0);
    expect(detector.checkRequestAllowed('primary')).toBe(false);

    // Advance time to probe circuit breaker
    currentTime += 20000;
    expect(detector.checkRequestAllowed('primary')).toBe(true);
    expect(detector.getCircuitBreakerState().state).toBe('half-open');

    // Successful probe should close the circuit
    detector.recordResponse('primary', { status: 200, success: true });
    expect(detector.getCircuitBreakerState().state).toBe('closed');
  });

  test('records errors and updates status snapshots', () => {
    detector.startRequest({ provider: 'fallback' });
    currentTime += 1;
    const errorState = detector.recordError('fallback', { status: 500 });
    expect(errorState.errorCount).toBe(1);

    const limitState = detector.getLimitStatus();
    expect(limitState.totalErrorCount).toBe(1);

    currentTime += 5;
    detector.getLimitStatus();
    const nextStatus = detector.getLimitStatus();
    expect(nextStatus.errorCount).toBe(0);
  });

  test('reset clears internal state', () => {
    detector.startRequest({ provider: 'reset' });
    detector.recordError('reset', { status: 429, retryAfterMs: 10, isRateLimit: true });
    expect(detector.getAdaptiveDelay('reset')).toBeGreaterThan(0);

    detector.reset();
    expect(detector.getStatus().providers).toEqual({});
    expect(detector.getAdaptiveDelay('reset')).toBe(0);
  });

  test('supports simplified configuration paths', () => {
    const simple = new AdaptiveLimitDetector({ enableCircuitBreaker: false });
    expect(simple.checkRequestAllowed('simple')).toBe(true);
    simple.startRequest({ provider: 'simple' });
    const state = simple.recordResponse('simple', { success: true, retryAfterMs: 40 });
    expect(state.rateLimited).toBe(true);
  });
});
