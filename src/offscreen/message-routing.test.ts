import { describe, it, expect, vi } from 'vitest';
import {
  routeOffscreenMessage,
  type OffscreenMessageHandlers,
  type OffscreenTargetedMessageRecord,
} from './message-routing';

// Minimal handler map: a single `ping` handler is enough to exercise both the
// handled and unhandled routing branches without pulling in the full offscreen
// runtime.
function makeHandlers(): OffscreenMessageHandlers {
  return {
    ping: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as OffscreenMessageHandlers;
}

describe('routeOffscreenMessage', () => {
  it('dispatches to the matching handler for a known string type', async () => {
    const handlers = makeHandlers();
    const message = {
      target: 'offscreen',
      type: 'ping',
    } as OffscreenTargetedMessageRecord;

    const response = await routeOffscreenMessage(message, handlers);

    expect(response).toEqual({ success: true });
    expect(handlers.ping).toHaveBeenCalledWith(message);
  });

  it('reports the unknown string type in the error message', async () => {
    const handlers = makeHandlers();
    const message = {
      target: 'offscreen',
      type: 'definitelyNotAHandler',
    } as OffscreenTargetedMessageRecord;

    const response = await routeOffscreenMessage(message, handlers);

    expect(response).toEqual({
      success: false,
      error: 'Unknown type: definitelyNotAHandler',
    });
  });

  it('coerces a non-string type via String() in the error message', async () => {
    const handlers = makeHandlers();
    const message = {
      target: 'offscreen',
      type: 42,
    } as OffscreenTargetedMessageRecord;

    const response = await routeOffscreenMessage(message, handlers);

    expect(response).toEqual({
      success: false,
      error: 'Unknown type: 42',
    });
  });

  it('coerces a missing (undefined) type via String()', async () => {
    const handlers = makeHandlers();
    const message = {
      target: 'offscreen',
    } as OffscreenTargetedMessageRecord;

    const response = await routeOffscreenMessage(message, handlers);

    expect(response).toEqual({
      success: false,
      error: 'Unknown type: undefined',
    });
  });
});
