describe('google-free provider', () => {
  let googleFree;

  beforeEach(() => {
    global.fetch = jest.fn();
    jest.resetModules();
    googleFree = require('../src/providers/googleFree');
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete global.fetch;
  });

  it('parses translation response', async () => {
    const response = [[["Hallo wereld","Hello world",null,null,1]] , null, "en"];
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(response),
    });

    const result = await googleFree.translate({ text: 'Hello world', source: 'en', target: 'nl' });
    expect(result.text).toBe('Hallo wereld');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('throws on http error', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' });

    await expect(
      googleFree.translate({ text: 'Hello world', source: 'en', target: 'nl' })
    ).rejects.toThrow('HTTP 429');
  });
});
