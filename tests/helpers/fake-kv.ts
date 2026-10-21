import type { KVNamespaceListResult } from "@cloudflare/workers-types";
import type { createStore } from "@/lib/kv";

type StoreKv = Parameters<typeof createStore>[0];

type Meta = Record<string, unknown> | null;

type Entry = { value: string; metadata: Meta };

/**
 * In-memory subset of KVNamespace used by BioStore.
 * TTL is ignored. list cursors are numeric offsets.
 */
export class FakeKv {
  readonly entries = new Map<string, Entry>();
  gets = 0;
  puts = 0;
  getWithMetadataCalls = 0;
  lists = 0;
  deletes = 0;
  reads: string[] = [];

  seed(key: string, value: string, metadata: Meta = null): void {
    this.entries.set(key, { value, metadata });
  }

  async get(key: string, type?: "text" | "json" | "arrayBuffer" | "stream"): Promise<unknown> {
    this.gets++;
    this.reads.push(key);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (type === "json") return JSON.parse(entry.value);
    return entry.value;
  }

  async getWithMetadata(
    key: string,
    type?: string,
  ): Promise<{ value: unknown; metadata: Meta; cacheStatus: null }> {
    this.getWithMetadataCalls++;
    this.reads.push(key);
    const entry = this.entries.get(key);
    if (!entry) return { value: null, metadata: null, cacheStatus: null };
    const value = type === "json" ? JSON.parse(entry.value) : entry.value;
    return { value, metadata: entry.metadata, cacheStatus: null };
  }

  async put(
    key: string,
    value: string,
    options?: { metadata?: unknown; expirationTtl?: number },
  ): Promise<void> {
    this.puts++;
    const metadata = (options?.metadata as Meta) ?? null;
    this.entries.set(key, { value, metadata });
  }

  async delete(key: string): Promise<void> {
    this.deletes++;
    this.entries.delete(key);
  }

  async list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<KVNamespaceListResult<unknown>> {
    this.lists++;
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1000;
    const start = options?.cursor ? Number(options.cursor) : 0;
    const names = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort();
    const slice = names.slice(start, start + limit);
    const next = start + slice.length;
    const complete = next >= names.length;
    return {
      keys: slice.map((name) => ({
        name,
        metadata: this.entries.get(name)?.metadata ?? undefined,
      })),
      list_complete: complete,
      cursor: complete ? undefined : String(next),
      cacheStatus: null,
    } as KVNamespaceListResult<unknown>;
  }

  asNamespace(): StoreKv {
    return this as unknown as StoreKv;
  }
}
