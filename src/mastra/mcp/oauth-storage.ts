import fs from "node:fs";
import path from "node:path";
import type { OAuthStorage } from "@mastra/mcp";

/**
 * File-backed OAuthStorage that persists each key to its own file.
 *
 * Previous implementation stored all keys in one JSON map and performed
 * load-modify-save, which is vulnerable to concurrent write races.
 * This implementation writes each key atomically to an isolated file.
 *
 * MCPOAuthClientProvider stores keys: "tokens", "client_info", "code_verifier".
 * Values are already JSON.stringify'd strings; we store them verbatim.
 */
export class FileOAuthStorage implements OAuthStorage {
  private storageDirectory: string;
  private legacyFilePath: string;

  constructor(filePath: string) {
    // Keep compatibility with prior path shape (single-file JSON map):
    // - per-key files are stored in the same parent directory
    // - legacy map reads still use the original file path
    this.storageDirectory = path.dirname(filePath);
    this.legacyFilePath = filePath;
  }

  private keyFilePath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.storageDirectory, `${safeKey}.json`);
  }

  private async readLegacyMap(): Promise<Record<string, string | undefined>> {
    try {
      const raw = await fs.promises.readFile(this.legacyFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return parsed as Record<string, string | undefined>;
    } catch {
      return {};
    }
  }

  async set(key: string, value: string): Promise<void> {
    await fs.promises.mkdir(this.storageDirectory, { recursive: true });
    const targetPath = this.keyFilePath(key);
    const tempPath =
      `${targetPath}.tmp-${process.pid}-${Date.now()}-` +
      `${Math.random().toString(16).slice(2)}`;
    // Atomic write: write temp file first, then rename into place.
    await fs.promises.writeFile(tempPath, value, "utf-8");
    await fs.promises.rename(tempPath, targetPath);
  }

  async get(key: string): Promise<string | undefined> {
    // Preferred path: per-key file.
    try {
      return await fs.promises.readFile(this.keyFilePath(key), "utf-8");
    } catch {
      // Fallback for already-deployed legacy single-file storage.
      const legacy = await this.readLegacyMap();
      const value = legacy[key];
      return typeof value === "string" ? value : undefined;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.promises.unlink(this.keyFilePath(key));
    } catch {
      // Ignore missing key files.
    }
    // Remove key from legacy map too so fallback reads cannot resurrect deleted values.
    const legacy = await this.readLegacyMap();
    if (key in legacy) {
      delete legacy[key];
      try {
        await fs.promises.mkdir(path.dirname(this.legacyFilePath), { recursive: true });
        await fs.promises.writeFile(this.legacyFilePath, JSON.stringify(legacy, null, 2), "utf-8");
      } catch {
        // Ignore legacy cleanup failures.
      }
    }
  }
}
