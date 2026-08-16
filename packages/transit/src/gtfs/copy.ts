import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import copyFrom from 'pg-copy-streams';
import type pg from 'pg';

/**
 * Bulk-Import per `COPY ... FROM STDIN`.
 *
 * Zeilenweise `INSERT`s wären für den Schweizer Gesamtfeed (Millionen
 * stop_times) um Grössenordnungen zu langsam. COPY ist der schnellste Weg,
 * und da ausschliesslich der Server die Werte erzeugt, entsteht dabei keine
 * Injection-Fläche: alle Werte werden CSV-konform escaped.
 */

export type CopyValue = string | number | boolean | null | undefined;

/**
 * Formatiert eine Zeile für `FORMAT csv`.
 *
 * NULL wird als unquotiertes leeres Feld geschrieben; ein leerer String wird
 * als `""` geschrieben. Diese Unterscheidung entspricht dem PostgreSQL-
 * Standardverhalten in CSV-Modus.
 */
export function formatCopyRow(values: readonly CopyValue[]): string {
  const fields = values.map((value) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  });
  return `${fields.join(',')}\n`;
}

export interface CopyOptions {
  /** Anzahl Zeilen, nach denen der Fortschritt gemeldet wird. */
  progressEvery?: number;
  onProgress?: (rows: number) => void;
}

/**
 * Schreibt Zeilen in eine Tabelle. `rows` wird als AsyncIterable konsumiert,
 * damit der CSV-Parser des Archivs direkt durchgereicht werden kann, ohne
 * dass die Daten vollständig im Speicher landen.
 */
export async function copyRows(
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: AsyncIterable<readonly CopyValue[]>,
  options: CopyOptions = {},
): Promise<number> {
  const sql = `COPY ${table} (${columns.join(', ')}) FROM STDIN WITH (FORMAT csv)`;
  const stream = client.query(copyFrom.from(sql));

  let count = 0;
  const progressEvery = options.progressEvery ?? 250_000;

  const source = Readable.from(
    (async function* generate(): AsyncGenerator<string> {
      for await (const row of rows) {
        count += 1;
        if (options.onProgress && count % progressEvery === 0) options.onProgress(count);
        yield formatCopyRow(row);
      }
    })(),
  );

  await pipeline(source, stream);
  return count;
}

/** WKT-Darstellung eines Punkts für direkte Übergabe an eine Geometriespalte. */
export function pointEwkt(lon: number, lat: number, srid = 4326): string {
  return `SRID=${srid};POINT(${lon} ${lat})`;
}
