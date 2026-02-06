/**
 * TypeScript definitions for ContentObserver module
 */

export interface ContentObserverOptions {
  enableSmartFiltering?: boolean;
  batchDelay?: number;
  maxBatchSize?: number;
  minTextLength?: number;
  skipElements?: string[];
  skipClasses?: string[];
  skipAttributes?: string[];
  viewportMargin?: string;
  intersectionThreshold?: number;
}

export interface ContentMetadata {
  source: 'mutation' | 'initial' | 'manual';
  timestamp: number;
  batchSize: number;
}

export type NewContentCallback = (nodes: Node[], metadata: ContentMetadata) => void;

export declare class ContentObserver {
  constructor(onNewContent: NewContentCallback, options?: ContentObserverOptions);

  readonly isObserving: boolean;

  startObserving(target?: Element): void;
  stopObserving(): void;
  flush(): void;
  disconnect(): void;

  private initializeObservers(): void;
  private handleMutations(mutations: MutationRecord[]): void;
  private collectTranslatableNodes(rootNode: Node, collector: Set<Node>): void;
  private isTranslatableTextNode(textNode: Node): boolean;
  private isTranslatableElement(element: Element): boolean;
  private addToBatch(nodes: Node[]): void;
  private processBatch(): void;
  private clearBatchTimer(): void;
}