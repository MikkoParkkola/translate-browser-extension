export interface TMEntry {
  k: string;
  text: string;
  ts: number;
}

export interface TMStats {
  hits: number;
  misses: number;
  sets: number;
  evictionsTTL: number;
  evictionsLRU: number;
  entries: number;
}

export declare function get(key: string): Promise<TMEntry | null>;
export declare function set(key: string, text: string): Promise<void>;
export declare function stats(): TMStats;
export declare function __resetStats(): void;

export declare const qwenTM: {
  get: typeof get;
  set: typeof set;
  stats: typeof stats;
  __resetStats: typeof __resetStats;
};
