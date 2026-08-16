import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';

/**
 * Streaming-CSV-Leser für GTFS-Dateien.
 *
 * GTFS-Dateien haben eine Kopfzeile, aber weder feste Spaltenreihenfolge noch
 * einen festen Spaltenumfang — optionale Felder fehlen häufig ganz. Deshalb
 * wird spaltenweise über den Namen zugegriffen.
 */
export interface CsvRow {
  get(column: string): string | null;
  getRequired(column: string): string;
  readonly lineNumber: number;
}

export interface ReadCsvOptions {
  /** Maximale Anzahl Zeilen (nur für Tests/Diagnose). */
  limit?: number;
}

export async function* readCsv(
  stream: Readable,
  options: ReadCsvOptions = {},
): AsyncGenerator<CsvRow> {
  const parser = parse({
    columns: (header: string[]) =>
      // BOM und Leerzeichen aus den Spaltennamen entfernen — beides kommt in
      // realen GTFS-Feeds vor.
      header.map((name) => name.replace(/^﻿/, '').trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  });

  stream.pipe(parser);

  let lineNumber = 1;
  for await (const record of parser) {
    lineNumber += 1;
    // Wichtig: pro Zeile festhalten. Würde die Closure die äussere Variable
    // lesen, meldeten verzögert ausgewertete Fehler die falsche Zeilennummer.
    const currentLine = lineNumber;
    const data = record as Record<string, string | undefined>;
    const row: CsvRow = {
      lineNumber: currentLine,
      get(column: string): string | null {
        const value = data[column];
        if (value === undefined) return null;
        const trimmed = value.trim();
        return trimmed.length === 0 ? null : trimmed;
      },
      getRequired(column: string): string {
        const value = this.get(column);
        if (value === null) {
          throw new Error(`Pflichtfeld "${column}" fehlt in Zeile ${currentLine}`);
        }
        return value;
      },
    };
    yield row;
    if (options.limit && lineNumber - 1 >= options.limit) {
      // Restlichen Stream verwerfen, damit die Pipeline sauber endet.
      parser.destroy();
      stream.destroy();
      return;
    }
  }
}

/** `0`/`1` aus GTFS in boolean. */
export function gtfsBoolean(value: string | null): boolean {
  return value === '1';
}

/** Ganzzahl mit Fallback; ungültige Werte werden nicht stillschweigend zu 0. */
export function gtfsInt(value: string | null, fallback: number | null = null): number | null {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function gtfsFloat(value: string | null, fallback: number | null = null): number | null {
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}
