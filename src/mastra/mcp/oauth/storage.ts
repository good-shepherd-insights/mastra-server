import { createClient, type Client } from "@libsql/client";
import type { OAuthStorage } from "@mastra/mcp";

export class LibSQLOAuthStorage implements OAuthStorage {
  private ready: Promise<void>;

  constructor(private client: Client, private userId: string) {
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

  async set(key: string, value: string): Promise<void> {
    await this.ready;
    await this.client.execute({
      sql: `INSERT INTO oauth_tokens (user_id, key, value) VALUES (?, ?, ?)
            ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      args: [this.userId, key, value],
    });
  }

  async get(key: string): Promise<string | undefined> {
    await this.ready;
    const rs = await this.client.execute({
      sql: `SELECT value FROM oauth_tokens WHERE user_id = ? AND key = ?`,
      args: [this.userId, key],
    });
    const row = rs.rows[0];
    return row ? String(row.value) : undefined;
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    await this.client.execute({
      sql: `DELETE FROM oauth_tokens WHERE user_id = ? AND key = ?`,
      args: [this.userId, key],
    });
  }
}

export function createLibSQLStorage(
  url: string,
  authToken: string | undefined,
  userId: string,
): LibSQLOAuthStorage {
  return new LibSQLOAuthStorage(createClient({ url, authToken }), userId);
}
