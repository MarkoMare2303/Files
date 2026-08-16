import { openDB, type IDBPDatabase } from 'idb';
import type { StateStorage } from 'zustand/middleware';

/**
 * IndexedDB-Adapter für Zustand-`persist`.
 *
 * Warum nicht `localStorage`? Die Offline-Warteschlange enthält vollständige
 * Meldungs-Payloads. `localStorage` ist synchron (blockiert den Hauptthread),
 * auf ~5 MB begrenzt und in privaten Safari-Fenstern historisch unzuverlässig.
 * IndexedDB ist asynchron, grösser und in allen Zielbrowsern verfügbar.
 *
 * Fällt IndexedDB aus (Privatmodus, deaktivierte Speicherung, Server-
 * Rendering, Tests), wird transparent auf einen Speicher im RAM gewechselt:
 * die App funktioniert weiter, verliert die Warteschlange aber beim Neuladen.
 * Das ist ehrlicher als ein Absturz — und wird in der Oberfläche nicht als
 * „gespeichert" behauptet.
 */
const DB_NAME = 'swissov';
const DB_VERSION = 1;
const STORE = 'keyval';

let dbPromise: Promise<IDBPDatabase> | null = null;
const memory = new Map<string, string>();

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    if (!idbAvailable()) return memory.get(name) ?? null;
    try {
      return (await (await db()).get(STORE, name)) ?? null;
    } catch {
      return memory.get(name) ?? null;
    }
  },

  setItem: async (name, value) => {
    memory.set(name, value);
    if (!idbAvailable()) return;
    try {
      await (await db()).put(STORE, value, name);
    } catch {
      // Kein Speicherplatz oder blockierte Datenbank — der RAM-Wert bleibt.
    }
  },

  removeItem: async (name) => {
    memory.delete(name);
    if (!idbAvailable()) return;
    try {
      await (await db()).delete(STORE, name);
    } catch {
      // Nichts zu tun.
    }
  },
};

/** Nur für Tests: setzt den Speicher zurück. */
export function resetIdbStorageForTests(): void {
  memory.clear();
  dbPromise = null;
}
