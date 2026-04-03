import type { Page } from '@playwright/test';

import { test, expect, popupUrl, findTabIdByUrlFragment, sendTabMessage } from './fixtures';

const WEBMCP_HARNESS_URL = 'http://127.0.0.1:8080/e2e/webmcp-harness.html';
const WEBMCP_HARNESS_FRAGMENT = '/e2e/webmcp-harness.html';

async function runHarnessCommand<T>(
  popupPage: Page,
  tabId: number,
  command: Record<string, unknown>
): Promise<T> {
  const result = await popupPage.evaluate(async ({ targetTabId, payload }) => {
    const [{ result: value }] = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: async (input) => {
        const windowWithHooks = window as Window & typeof globalThis & {
          __translateWebMcpTest?: {
            registerTools: () => Promise<boolean>;
            unregisterTools: () => Promise<void>;
          };
          __webMcpHarness?: {
            registeredTools: Array<{
              name: string;
              description?: string;
              inputSchema?: unknown;
              annotations?: unknown;
            }>;
            registeredCalls: Array<{ name: string; args: Record<string, unknown> }>;
            siteToolCalls: Array<{ name: string; args: Record<string, unknown> }>;
            lastSelectionTranslation: string | null;
            lastPageSummary: string | null;
            clearCalls: () => void;
          };
        };

        if (input.type === 'installHarness') {
          if (!windowWithHooks.__webMcpHarness) {
            const registeredTools: Array<{
              name: string;
              description?: string;
              inputSchema?: unknown;
              annotations?: unknown;
            }> = [];
            const registeredExecutors = new Map<string, (input: unknown) => Promise<unknown>>();
            const siteTools = new Map<string, {
              name: string;
              description: string;
              execute: (inputArgsJson: string) => Promise<unknown>;
            }>();

            const harness = {
              registeredTools,
              registeredCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
              siteToolCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
              lastSelectionTranslation: null as string | null,
              lastPageSummary: null as string | null,
              clearCalls() {
                this.registeredCalls.length = 0;
                this.siteToolCalls.length = 0;
                this.lastSelectionTranslation = null;
                this.lastPageSummary = null;
                document.body.removeAttribute('data-site-page-summary');
                document.body.removeAttribute('data-site-selection-translation');
              },
            };

            siteTools.set('site_translate_selection', {
              name: 'site_translate_selection',
              description: 'Translate the current selection using a site-provided tool.',
              async execute(inputArgsJson) {
                const args = JSON.parse(inputArgsJson || '{}') as Record<string, unknown>;
                const translatedText =
                  `site-selection:${String(args.targetLang ?? 'unknown')}:` +
                  `${String(args.text ?? '')}`;
                harness.siteToolCalls.push({ name: 'site_translate_selection', args });
                harness.lastSelectionTranslation = translatedText;
                document.body.setAttribute('data-site-selection-translation', translatedText);
                return {
                  content: [{ type: 'text', text: translatedText }],
                };
              },
            });

            siteTools.set('site_translate_page', {
              name: 'site_translate_page',
              description: 'Translate the current page content using a site-provided tool.',
              async execute(inputArgsJson) {
                const args = JSON.parse(inputArgsJson || '{}') as Record<string, unknown>;
                const summaryText = `site-page:${String(args.targetLang ?? 'unknown')}`;
                harness.siteToolCalls.push({ name: 'site_translate_page', args });
                harness.lastPageSummary = summaryText;
                document.body.setAttribute('data-site-page-summary', summaryText);
                return {
                  content: [{ type: 'text', text: summaryText }],
                };
              },
            });

            const modelContext = {
              async registerTool(tool: {
                name: string;
                description?: string;
                inputSchema?: unknown;
                annotations?: unknown;
                execute: (input: unknown) => Promise<unknown>;
              }) {
                const descriptor = {
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.inputSchema,
                  annotations: tool.annotations,
                };
                const existingIndex = registeredTools.findIndex((entry) => entry.name === tool.name);
                if (existingIndex >= 0) {
                  registeredTools.splice(existingIndex, 1, descriptor);
                } else {
                  registeredTools.push(descriptor);
                }
                registeredExecutors.set(tool.name, tool.execute);
              },
              async unregisterTool(name: string) {
                const existingIndex = registeredTools.findIndex((entry) => entry.name === name);
                if (existingIndex >= 0) {
                  registeredTools.splice(existingIndex, 1);
                }
                registeredExecutors.delete(name);
              },
            };

            const modelContextTesting = {
              async listTools() {
                return [
                  ...Array.from(siteTools.values()).map(({ name, description }) => ({
                    name,
                    description,
                  })),
                  ...registeredTools.map(({ name, description }) => ({ name, description })),
                ];
              },
              async executeTool(name: string, inputArgsJson: string) {
                const siteTool = siteTools.get(name);
                if (siteTool) {
                  return siteTool.execute(inputArgsJson);
                }

                const executor = registeredExecutors.get(name);
                if (!executor) {
                  throw new Error(`Unknown tool: ${name}`);
                }

                const parsedInput = JSON.parse(inputArgsJson || '{}') as Record<string, unknown>;
                harness.registeredCalls.push({ name, args: parsedInput });
                return executor(parsedInput);
              },
            };

            Object.defineProperty(navigator, 'modelContext', {
              configurable: true,
              value: modelContext,
            });
            Object.defineProperty(navigator, 'modelContextTesting', {
              configurable: true,
              value: modelContextTesting,
            });

            windowWithHooks.__webMcpHarness = harness;
          }

          windowWithHooks.__webMcpHarness.clearCalls();
          return true;
        }

        if (input.type === 'hasTestHook') {
          return Boolean(windowWithHooks.__translateWebMcpTest);
        }

        if (input.type === 'registerTools') {
          if (!windowWithHooks.__translateWebMcpTest) {
            throw new Error('Missing WebMCP test hook');
          }
          return windowWithHooks.__translateWebMcpTest.registerTools();
        }

        if (input.type === 'getHarnessState') {
          const harness = windowWithHooks.__webMcpHarness;
          return {
            registeredTools: harness?.registeredTools ?? [],
            registeredCalls: harness?.registeredCalls ?? [],
            siteToolCalls: harness?.siteToolCalls ?? [],
            lastSelectionTranslation: harness?.lastSelectionTranslation ?? null,
            lastPageSummary: harness?.lastPageSummary ?? null,
            pageSummaryAttribute: document.body.getAttribute('data-site-page-summary'),
          };
        }

        if (input.type === 'executeTool') {
          const testing = navigator as Navigator & {
            modelContextTesting?: {
              executeTool: (name: string, inputArgsJson: string) => Promise<unknown>;
            };
          };
          return testing.modelContextTesting?.executeTool(
            String(input.name),
            JSON.stringify((input.args ?? {}) as Record<string, unknown>)
          );
        }

        if (input.type === 'selectText') {
          const element = document.querySelector('#selection-source');
          if (!element || !element.firstChild || element.firstChild.nodeType !== Node.TEXT_NODE) {
            throw new Error('Could not prepare selection text');
          }

          const selection = window.getSelection();
          if (!selection) {
            throw new Error('Selection API is not available');
          }

          const textNode = element.firstChild;
          const range = document.createRange();
          range.setStart(textNode, 0);
          range.setEnd(textNode, textNode.textContent?.length ?? 0);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }

        throw new Error(`Unknown harness command: ${String(input.type)}`);
      },
      args: [payload],
    });

    return value;
  }, { targetTabId: tabId, payload: command });

  return result as T;
}

async function prepareWebMcpHarness(popupPage: Page, tabId: number): Promise<void> {
  await expect.poll(() => runHarnessCommand<boolean>(popupPage, tabId, { type: 'hasTestHook' })).toBe(true);
  await runHarnessCommand(popupPage, tabId, { type: 'installHarness' });
  const registered = await runHarnessCommand<boolean>(popupPage, tabId, { type: 'registerTools' });
  expect(registered).toBe(true);
}

async function waitForRegisteredToolNames(popupPage: Page, tabId: number): Promise<string[]> {
  await expect.poll(async () => {
    const state = await runHarnessCommand<{
      registeredTools: Array<{ name: string }>;
    }>(popupPage, tabId, { type: 'getHarnessState' });
    return state.registeredTools.map((tool) => tool.name).sort();
  }).toEqual(['detect_language', 'translate_page', 'translate_selection']);

  const state = await runHarnessCommand<{
    registeredTools: Array<{ name: string }>;
  }>(popupPage, tabId, { type: 'getHarnessState' });
  return state.registeredTools.map((tool) => tool.name).sort();
}

test.describe('WebMCP integration', () => {
  test.describe.configure({ timeout: 60_000 });

  test('registers extension WebMCP tools on supported pages', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(WEBMCP_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await findTabIdByUrlFragment(popupPage, WEBMCP_HARNESS_FRAGMENT);
    await prepareWebMcpHarness(popupPage, tabId);

    const toolNames = await waitForRegisteredToolNames(popupPage, tabId);
    expect(toolNames).toEqual(['detect_language', 'translate_page', 'translate_selection']);

    const state = await runHarnessCommand<{
      registeredTools: Array<{
        name: string;
        inputSchema?: { properties?: { text?: { type?: string } } };
        annotations?: { readOnlyHint?: boolean };
      }>;
    }>(popupPage, tabId, { type: 'getHarnessState' });
    const detectLanguageTool = state.registeredTools.find((tool) => tool.name === 'detect_language');

    expect(detectLanguageTool?.annotations?.readOnlyHint).toBe(true);
    expect(detectLanguageTool?.inputSchema?.properties?.text?.type).toBe('string');

    await popupPage.close();
    await page.close();
  });

  test('detect_language executes through the testing bridge', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(WEBMCP_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await findTabIdByUrlFragment(popupPage, WEBMCP_HARNESS_FRAGMENT);
    await prepareWebMcpHarness(popupPage, tabId);
    await waitForRegisteredToolNames(popupPage, tabId);

    const rawResult = await runHarnessCommand<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>(popupPage, tabId, {
      type: 'executeTool',
      name: 'detect_language',
      args: { text: 'Bonjour le monde, comment allez-vous ?' },
    });

    expect(rawResult).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('"lang":"fr"') }],
      isError: false,
    });

    await popupPage.close();
    await page.close();
  });

  test('translateSelection prefers the site-provided tool', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(WEBMCP_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await findTabIdByUrlFragment(popupPage, WEBMCP_HARNESS_FRAGMENT);
    await prepareWebMcpHarness(popupPage, tabId);
    await waitForRegisteredToolNames(popupPage, tabId);
    await runHarnessCommand(popupPage, tabId, { type: 'selectText' });

    const response = await sendTabMessage<{ success: boolean; status: string }>(popupPage, tabId, {
      type: 'translateSelection',
      sourceLang: 'en',
      targetLang: 'de',
      strategy: 'smart',
    });

    expect(response).toEqual({ success: true, status: 'started' });

    await expect.poll(async () => {
      return runHarnessCommand<{
        siteToolCalls: Array<{ name: string; args: Record<string, unknown> }>;
        registeredCalls: Array<{ name: string; args: Record<string, unknown> }>;
        lastSelectionTranslation: string | null;
      }>(popupPage, tabId, { type: 'getHarnessState' });
    }).toMatchObject({
      siteToolCalls: [
        {
          name: 'site_translate_selection',
          args: {
            sourceLang: 'en',
            targetLang: 'de',
            strategy: 'smart',
            text: 'Selected text for WebMCP site tool preference.',
          },
        },
      ],
      registeredCalls: [],
      lastSelectionTranslation: 'site-selection:de:Selected text for WebMCP site tool preference.',
    });

    await popupPage.close();
    await page.close();
  });

  test('translatePage prefers the site-provided tool', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(WEBMCP_HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl(extensionId));
    await popupPage.waitForLoadState('domcontentloaded');

    const tabId = await findTabIdByUrlFragment(popupPage, WEBMCP_HARNESS_FRAGMENT);
    await prepareWebMcpHarness(popupPage, tabId);
    await waitForRegisteredToolNames(popupPage, tabId);

    const response = await sendTabMessage<{ success: boolean; status: string }>(popupPage, tabId, {
      type: 'translatePage',
      sourceLang: 'en',
      targetLang: 'fr',
      strategy: 'quality',
    });

    expect(response).toEqual({ success: true, status: 'started' });

    await expect.poll(async () => {
      return runHarnessCommand<{
        siteToolCalls: Array<{ name: string; args: Record<string, unknown> }>;
        registeredCalls: Array<{ name: string; args: Record<string, unknown> }>;
        lastPageSummary: string | null;
        pageSummaryAttribute: string | null;
      }>(popupPage, tabId, { type: 'getHarnessState' });
    }).toMatchObject({
      siteToolCalls: [
        {
          name: 'site_translate_page',
          args: {
            sourceLang: 'en',
            targetLang: 'fr',
            strategy: 'quality',
          },
        },
      ],
      registeredCalls: [],
      lastPageSummary: 'site-page:fr',
      pageSummaryAttribute: 'site-page:fr',
    });

    await popupPage.close();
    await page.close();
  });
});
