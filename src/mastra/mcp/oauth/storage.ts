import { createClient, type Client } from "@libsql/client";
import type { OAuthStorage } from "@mastra/mcp";

export class LibSQLOAuthStorage implements OAuthStorage {
  private readonly client: Client;
  private readonly ready: Promise<void>;

  constructor(private readonly userId: string, config: { url: string; authToken?: string }) {
    this.client = createClient(config);
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS oauth_tokens (
         user_id TEXT NOT NULL,
         key     TEXT NOT NULL,
         value   TEXT NOT NULL,
         PRIMARY KEY (user_id, key)
       )`,
    );
  }

  private async exec<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    await this.ready;
    return fn(this.client);
  }

  async set(key: string, value: string): Promise<void> {
    await this.exec(c => c.execute({
      sql: `INSERT INTO oauth_tokens (user_id, key, value) VALUES (?, ?, ?)
            ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      args: [this.userId, key, value],
    }));
  }

  async get(key: string): Promise<string | undefined> {
    const rs = await this.exec(c => c.execute({
      sql: `SELECT value FROM oauth_tokens WHERE user_id = ? AND key = ?`,
      args: [this.userId, key],
    }));
    const row = rs.rows[0];
    return row ? String(row.value) : undefined;
  }

  async delete(key: string): Promise<void> {
    await this.exec(c => c.execute({
      sql: `DELETE FROM oauth_tokens WHERE user_id = ? AND key = ?`,
      args: [this.userId, key],
    }));
  }
}
