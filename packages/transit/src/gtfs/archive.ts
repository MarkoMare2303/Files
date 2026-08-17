import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { authorizedRequest } from '../auth.js';
import { httpRequest } from '../http.js';

/**
 * Herunterladen und Öffnen eines GTFS-Archivs.
 *
 * Der Schweizer Gesamtdatensatz ist mehrere hundert Megabyte gross. Er wird
 * deshalb gestreamt auf Platte geschrieben (nie vollständig in den Speicher)
 * und die Einträge werden einzeln als Stream gelesen.
 */

export interface DownloadResult {
  filePath: string;
  /** SHA-256 des Archivs — identische Feeds werden nicht erneut importiert. */
  checksum: string;
  sizeBytes: number;
  /** Temporäres Verzeichnis; muss vom Aufrufer aufgeräumt werden. */
  cleanup: () => Promise<void>;
}

/**
 * Verwendet eine bereits vorhandene ZIP-Datei als Feed-Quelle.
 *
 * Gleiche Rückgabe wie `downloadArchive()`, damit der Importer keinen
 * Unterschied kennt. `cleanup` ist bewusst ein No-Op: die Datei gehört dem
 * Aufrufer und darf nicht gelöscht werden.
 */
export async function useLocalArchive(filePath: string): Promise<DownloadResult> {
  const resolved = resolve(filePath);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`GTFS-Archiv nicht gefunden: ${resolved}`);
  }

  // Prüfsumme über die vorhandene Datei bilden, ohne sie in den Speicher zu
  // laden — der Schweizer Gesamtdatensatz ist mehrere hundert Megabyte gross.
  const hash = createHash('sha256');
  const source = createReadStream(resolved);
  for await (const chunk of source) {
    hash.update(chunk as Buffer);
  }

  return {
    filePath: resolved,
    checksum: hash.digest('hex'),
    sizeBytes: info.size,
    cleanup: async () => undefined,
  };
}

export async function downloadArchive(
  url: string,
  options: {
    apiKey?: string | undefined;
    timeoutMs?: number;
    /** Erzwingt ein Authentifizierungsverfahren; sonst wird durchprobiert. */
    authScheme?: string | undefined;
  } = {},
): Promise<DownloadResult> {
  const directory = await mkdtemp(join(tmpdir(), 'swissov-gtfs-'));
  const filePath = join(directory, 'gtfs.zip');
  const cleanup = async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  };

  try {
    const headers: Record<string, string> = {
      'user-agent': 'swissov-live/0.1 (+https://github.com)',
      accept: 'application/zip, application/octet-stream, */*',
    };

    // Grosse Downloads brauchen ein deutlich höheres Zeitlimit.
    const requestOptions = { headers, timeoutMs: options.timeoutMs ?? 15 * 60_000, retries: 2 };

    // Der Permalink ist öffentlich zugänglich; einen Schlüssel verlangt er nur,
    // wenn die Instanz das so konfiguriert hat. Ohne Schlüssel deshalb schlicht
    // unauthentifiziert laden — mit Schlüssel die Verfahren durchprobieren.
    const response = options.apiKey
      ? (await authorizedRequest(url, options.apiKey, requestOptions, options.authScheme)).response
      : await httpRequest(url, requestOptions);

    if (!response.body) throw new Error(`Antwort ohne Body von ${url}`);

    const hash = createHash('sha256');
    const hashing = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      hashing,
      createWriteStream(filePath),
    );

    const info = await stat(filePath);
    return {
      filePath,
      checksum: hash.digest('hex'),
      sizeBytes: info.size,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export interface ArchiveEntry {
  fileName: string;
  stream: Readable;
}

/**
 * Iteriert über die Einträge eines ZIP-Archivs. Nur die in `wanted`
 * aufgeführten Dateien werden geöffnet; alles andere wird übersprungen.
 *
 * Wichtig: Der Stream eines Eintrags muss vollständig konsumiert werden,
 * bevor der nächste geliefert wird — yauzl liest sequenziell.
 */
export async function forEachEntry(
  zipPath: string,
  wanted: readonly string[],
  handler: (entry: ArchiveEntry) => Promise<void>,
): Promise<string[]> {
  const wantedSet = new Set(wanted.map((name) => name.toLowerCase()));
  const seen: string[] = [];

  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, file) => {
      if (error) reject(error);
      else resolve(file);
    });
  });

  await new Promise<void>((resolve, reject) => {
    let pending: Promise<void> = Promise.resolve();

    zipFile.on('entry', (entry: yauzl.Entry) => {
      // Verzeichnisse und Einträge in Unterordnern ignorieren.
      const baseName = entry.fileName.split('/').pop() ?? entry.fileName;
      if (entry.fileName.endsWith('/') || !wantedSet.has(baseName.toLowerCase())) {
        zipFile.readEntry();
        return;
      }

      zipFile.openReadStream(entry, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        seen.push(baseName);
        pending = pending
          .then(() => handler({ fileName: baseName, stream }))
          .then(() => {
            zipFile.readEntry();
          })
          .catch(reject);
      });
    });

    zipFile.on('end', () => {
      pending.then(resolve).catch(reject);
    });
    zipFile.on('error', reject);
    zipFile.readEntry();
  });

  return seen;
}
