import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRender = vi.fn();

vi.mock('solid-js/web', () => ({
  render: mockRender,
}));

vi.mock('./Options', () => ({
  default: () => null,
}));

describe('options/index', () => {
  beforeEach(() => {
    mockRender.mockClear();
  });

  afterEach(() => {
    const root = document.getElementById('root');
    if (root) root.remove();
    vi.resetModules();
  });

  it('calls render when root element exists', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    await import('./index');

    expect(mockRender).toHaveBeenCalledOnce();
    expect(mockRender).toHaveBeenCalledWith(expect.any(Function), root);
  });

  it('does not call render when root element is missing', async () => {
    await import('./index');

    expect(mockRender).not.toHaveBeenCalled();
  });
});
