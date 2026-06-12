import pg from "pg";
import type { OAuthStorage } from "@mastra/mcp";

export class PgOAuthStorage implements OAuthStorage {
  readonly #pool: pg.Pool;
  readonly #ready: Promise<void>;
  readonly #userId: string;

  constructor(userId: string, connectionString: string) {
    this.#userId = userId;
    this.#pool = new pg.Pool({ connectionString });
    this.#ready = this.#init();
  }

  async #init(): Promise<void> {
    await this.#pool.query(
      `CREATE TABLE IF NOT EXISTS oauth_tokens (
         user_id TEXT NOT NULL,
         key     TEXT NOT NULL,
         value   TEXT NOT NULL,
         PRIMARY KEY (user_id, key)
       )`,
    );
  }

  async #exec<T>(fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
    await this.#ready;
    return fn(this.#pool);
  }

  async set(key: string, value: string): Promise<void> {
    await this.#exec(p => p.query(
      `INSERT INTO oauth_tokens (user_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [this.#userId, key, value],
    ));
  }

  async get(key: string): Promise<string | undefined> {
    const res = await this.#exec(p => p.query(
      `SELECT value FROM oauth_tokens WHERE user_id = $1 AND key = $2`,
      [this.#userId, key],
    ));
    return res.rows[0]?.value;
  }

  async delete(key: string): Promise<void> {
    await this.#exec(p => p.query(
      `DELETE FROM oauth_tokens WHERE user_id = $1 AND key = $2`,
      [this.#userId, key],
    ));
  }
}
