import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreateReportInput } from '@swissov/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ApiError } from '../api/client.js';
import { api } from '../api/endpoints.js';

/**
 * Offline-Warteschlange für Meldungen (§39).
 *
 * ÖV-Fahrzeuge fahren durch Funklöcher. Eine Meldung darf deshalb nie
 * verloren gehen, aber auch nicht Stunden später als „aktuell" erscheinen:
 * Einträge, die zu alt sind, werden verworfen statt verspätet gesendet.
 */
export const MAX_QUEUE_AGE_MS = 30 * 60 * 1000;
const MAX_QUEUE_LENGTH = 20;
const MAX_ATTEMPTS = 5;

export interface QueuedReport {
  /** Idempotenzschlüssel — verhindert Duplikate beim erneuten Senden. */
  clientReportId: string;
  input: CreateReportInput;
  queuedAt: number;
  attempts: number;
  lastError: string | null;
}

interface QueueState {
  items: QueuedReport[];
  flushing: boolean;
  enqueue(input: CreateReportInput, clientReportId: string): void;
  remove(clientReportId: string): void;
  /** Sendet alle noch relevanten Einträge. Gibt zurück, wie viele gesendet wurden. */
  flush(): Promise<{ sent: number; dropped: number; remaining: number }>;
  pruneExpired(now?: number): number;
}

export const useOfflineQueue = create<QueueState>()(
  persist(
    (set, get) => ({
      items: [],
      flushing: false,

      enqueue: (input, clientReportId) =>
        set((state) => ({
          items: [
            ...state.items.filter((item) => item.clientReportId !== clientReportId),
            { clientReportId, input, queuedAt: Date.now(), attempts: 0, lastError: null },
          ].slice(-MAX_QUEUE_LENGTH),
        })),

      remove: (clientReportId) =>
        set((state) => ({
          items: state.items.filter((item) => item.clientReportId !== clientReportId),
        })),

      pruneExpired: (now = Date.now()) => {
        const before = get().items.length;
        set((state) => ({
          items: state.items.filter((item) => now - item.queuedAt <= MAX_QUEUE_AGE_MS),
        }));
        return before - get().items.length;
      },

      flush: async () => {
        if (get().flushing) return { sent: 0, dropped: 0, remaining: get().items.length };
        set({ flushing: true });

        const dropped = get().pruneExpired();
        let sent = 0;

        try {
          for (const item of [...get().items]) {
            try {
              await api.createReport({ ...item.input, clientReportId: item.clientReportId });
              get().remove(item.clientReportId);
              sent += 1;
            } catch (error) {
              const apiError = error instanceof ApiError ? error : null;
              // Offline: abbrechen und später erneut versuchen.
              if (apiError?.isOffline) break;

              // Fachliche Ablehnung (z. B. Dublette, Sperre): nicht wiederholen.
              const permanent =
                apiError !== null && apiError.status >= 400 && apiError.status < 500 && apiError.status !== 429;

              set((state) => ({
                items: state.items
                  .map((entry) =>
                    entry.clientReportId === item.clientReportId
                      ? {
                          ...entry,
                          attempts: entry.attempts + 1,
                          lastError: apiError?.userMessage ?? 'Fehler',
                        }
                      : entry,
                  )
                  .filter(
                    (entry) =>
                      !(
                        entry.clientReportId === item.clientReportId &&
                        (permanent || entry.attempts >= MAX_ATTEMPTS)
                      ),
                  ),
              }));
            }
          }
        } finally {
          set({ flushing: false });
        }

        return { sent, dropped, remaining: get().items.length };
      },
    }),
    {
      name: 'swissov-offline-queue',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
