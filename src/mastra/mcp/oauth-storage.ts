import fs from "node:fs";
import path from "node:path";
import type { OAuthStorage } from "@mastra/mcp";

/**
 * File-backed OAuthStorage that persists tokens, client info, and code verifiers
 * to a JSON file so they survive process restarts.
 *
 * MCPOAuthClientProvider calls storage.set() with values that are already
 * JSON.stringify'd (e.g. JSON.stringify(tokensObject)), and expects storage.get()
 * to return that same string so it can JSON.parse() it back. This implementation
 * stores the raw string values directly without re-serializing.
 */
export class FileOAuthStorage implements OAuthStorage {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<Record<string, string | undefined>> {
    try {
      const data = await fs.promises.readFile(this.filePath, "utf-8");
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  private async save(data: Record<string, string | undefined>): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async set(key: string, value: string): Promise<void> {
    const data = await this.load();
    data[key] = value;
    await this.save(data);
  }

  async get(key: string): Promise<string | undefined> {
    const data = await this.load();
    return data[key];
  }

  async delete(key: string): Promise<void> {
    const data = await this.load();
    delete data[key];
    await this.save(data);
  }
}
