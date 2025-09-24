/**
 * TypeScript definitions for Content TranslationService module
 */

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface PageTranslationResult {
  success?: boolean;
  translatedCount?: number;
  totalNodes?: number;
  framework?: string[];
  alreadyInProgress?: boolean;
  noContent?: boolean;
  error?: string;
}

export interface DebugTextAnalysis {
  totalNodes: number;
  translatableNodes: number;
  samples: Array<{
    text: string;
    translatable: boolean;
    parent?: string;
    classes: string[];
  }>;
}

export interface HiddenContentAnalysis {
  hiddenElements: Array<{
    text: string;
    element: string;
    classes: string[];
  }>;
}

export interface IframeAnalysis {
  iframes: Array<{
    src: string;
    textNodes: number;
    accessible: boolean;
    error?: string;
  }>;
}

export interface TranslationBatchResult {
  translatedCount: number;
  totalNodes: number;
}

export declare class TranslationService {
  constructor(options?: Record<string, any>);

  readonly isInitialized: boolean;
  readonly isTranslating: boolean;

  handleMessage(
    request: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): Promise<void>;

  translateSelection(text: string): Promise<TranslationResult | null>;
  translatePage(): Promise<PageTranslationResult>;

  debugShowAllText(): DebugTextAnalysis;
  extractHiddenDutchContent(): HiddenContentAnalysis;
  scanIframes(): IframeAnalysis;

  cleanup(): void;

  private setupMessageHandlers(): void;
  private sendMessageWithRetry(message: any, maxRetries?: number): Promise<any>;
  private detectJavaScriptFramework(): string[];
  private findNoscriptContent(): void;
  private comprehensiveScan(): Node[];
  private isTranslatableText(text: string): boolean;
  private findTextNodes(root?: Element): Node[];
  private findTextNodesInDocument(doc: Document, root?: Element): Node[];
  private isTranslatableNode(node: Node): boolean;
  private translateNodes(nodes: Node[]): Promise<TranslationBatchResult>;
  private createBatches(nodes: Node[], maxBatchSize?: number): Node[][];
  private splitLongText(text: string, maxChars: number): string[];
  private translateOptimizedBatch(nodes: Node[], settings: any): Promise<number>;
  private applyTranslation(node: Node, translatedText: string): void;
  private showTranslationResult(original: string, translated: string, info?: Record<string, any>): void;
  private handleContextInvalidation(): void;
}