import pg from 'pg';

const { Pool, types } = pg;

/**
 * PostgreSQL-Zugriff.
 *
 * Alle Queries laufen parametrisiert ($1, $2, ...). String-Konkatenation von
 * SQL ist per ESLint-Regel im Repository untersagt (§42).
 */

// node-postgres liefert BIGINT (OID 20) und NUMERIC (OID 1700) standardmässig
// als String, um Präzisionsverlust zu vermeiden. Für unsere Wertebereiche
// (Zähler, Confidence 0..1) ist Number sicher und deutlich bequemer.
types.setTypeParser(20, (value) => Number.parseInt(value, 10));
types.setTypeParser(1700, (value) => Number.parseFloat(value));

export type QueryParam =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | Buffer
  | readonly (string | number | null)[];

export interface DatabaseOptions {
  connectionString: string;
  max?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: QueryParam[]): Promise<QueryResult<T>>;
}

export class Database implements Queryable {
  private readonly pool: pg.Pool;

  constructor(options: DatabaseOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      application_name: options.applicationName ?? 'swissov',
      statement_timeout: options.statementTimeoutMs ?? 15_000,
      // Verbindungen werden nach Leerlauf geschlossen, damit Serverless-/
      // Autoscaling-Umgebungen keine Verbindungen halten.
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    // Ein Fehler auf einer idle-Verbindung darf den Prozess nicht beenden.
    this.pool.on('error', (error) => {
      console.error('[database] idle client error', error.message);
    });
  }

  async query<T = Record<string, unknown>>(
    text: string,
    params: QueryParam[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query(text, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  /** Erste Zeile oder `null`. */
  async queryOne<T = Record<string, unknown>>(
    text: string,
    params: QueryParam[] = [],
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  /** Führt `fn` in einer Transaktion aus; rollt bei Fehlern zurück. */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Queryable = {
        query: async <R>(text: string, params: QueryParam[] = []) => {
          const result = await client.query(text, params as unknown[]);
          return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
        },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Setzt den JWT-Claim für RLS-geschützte Zugriffe innerhalb einer Transaktion.
   * Wird nur dort verwendet, wo Zugriffe explizit unter Nutzerrechten laufen
   * sollen; der Regelpfad der API prüft Berechtigungen im Anwendungscode.
   */
  async asUser<T>(userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      await tx.query('SELECT set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ]);
      return fn(tx);
    });
  }

  async healthcheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Direkter Zugriff auf den Pool — nur für Bulk-Operationen (COPY) im Import. */
  get rawPool(): pg.Pool {
    return this.pool;
  }
}

export function createDatabase(options: DatabaseOptions): Database {
  return new Database(options);
}
