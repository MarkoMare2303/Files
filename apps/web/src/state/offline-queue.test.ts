import type { CreateReportInput } from '@swissov/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import { MAX_QUEUE_AGE_MS, useOfflineQueue } from './offline-queue.store';

/**
 * Tests der Offline-Warteschlange (§39).
 *
 * Die entscheidende Eigenschaft ist nicht „nichts geht verloren", sondern
 * „nichts Veraltetes wird gesendet". Eine 40 Minuten alte Kontrollmeldung
 * wäre eine Falschinformation, keine verspätete Information.
 */
const input = (categoryKey: string): CreateReportInput =>
  ({
    categoryKey,
    lat: 47.3779,
    lon: 8.5403,
    observedAt: new Date().toISOString(),
  }) as CreateReportInput;

function reset(): void {
  useOfflineQueue.setState({ items: [], flushing: false });
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => {
  reset();
  setOnline(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Warteschlange', () => {
  it('nimmt Meldungen auf', () => {
    useOfflineQueue.getState().enqueue(input('TICKET_INSPECTION'), 'a');
    expect(useOfflineQueue.getState().items).toHaveLength(1);
  });

  it('ersetzt Einträge mit gleicher Idempotenz-ID statt zu duplizieren', () => {
    useOfflineQueue.getState().enqueue(input('TICKET_INSPECTION'), 'a');
    useOfflineQueue.getState().enqueue(input('DELAY'), 'a');
    const items = useOfflineQueue.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.input.categoryKey).toBe('DELAY');
  });

  it('begrenzt die Länge auf 20 Einträge', () => {
    for (let i = 0; i < 30; i += 1) {
      useOfflineQueue.getState().enqueue(input('DELAY'), `id-${i}`);
    }
    expect(useOfflineQueue.getState().items).toHaveLength(20);
    // Die ältesten fallen heraus, die neuesten bleiben.
    expect(useOfflineQueue.getState().items[0]?.clientReportId).toBe('id-10');
  });

  it('verwirft Einträge, die älter als die TTL sind', () => {
    useOfflineQueue.getState().enqueue(input('DELAY'), 'alt');
    useOfflineQueue.setState((state) => ({
      items: state.items.map((item) => ({
        ...item,
        queuedAt: Date.now() - MAX_QUEUE_AGE_MS - 1000,
      })),
    }));

    const dropped = useOfflineQueue.getState().pruneExpired();
    expect(dropped).toBe(1);
    expect(useOfflineQueue.getState().items).toHaveLength(0);
  });

  it('behält Einträge kurz vor Ablauf der TTL', () => {
    useOfflineQueue.getState().enqueue(input('DELAY'), 'frisch');
    useOfflineQueue.setState((state) => ({
      items: state.items.map((item) => ({
        ...item,
        queuedAt: Date.now() - MAX_QUEUE_AGE_MS + 60_000,
      })),
    }));

    expect(useOfflineQueue.getState().pruneExpired()).toBe(0);
    expect(useOfflineQueue.getState().items).toHaveLength(1);
  });
});

describe('Senden', () => {
  it('sendet alle Einträge und leert die Warteschlange', async () => {
    const create = vi.spyOn(api, 'createReport').mockResolvedValue({
      report: {} as never,
      warnings: [],
    });

    useOfflineQueue.getState().enqueue(input('DELAY'), 'a');
    useOfflineQueue.getState().enqueue(input('CROWDING'), 'b');

    const result = await useOfflineQueue.getState().flush();

    expect(result.sent).toBe(2);
    expect(result.remaining).toBe(0);
    expect(create).toHaveBeenCalledTimes(2);
    // Die Idempotenz-ID muss mitgesendet werden, sonst entstehen Duplikate.
    expect(create.mock.calls[0]?.[0]).toMatchObject({ clientReportId: 'a' });
  });

  it('prüft die Relevanz VOR dem Upload', async () => {
    const create = vi.spyOn(api, 'createReport').mockResolvedValue({
      report: {} as never,
      warnings: [],
    });

    useOfflineQueue.getState().enqueue(input('DELAY'), 'veraltet');
    useOfflineQueue.setState((state) => ({
      items: state.items.map((item) => ({ ...item, queuedAt: Date.now() - MAX_QUEUE_AGE_MS - 1 })),
    }));

    const result = await useOfflineQueue.getState().flush();

    expect(result.dropped).toBe(1);
    expect(result.sent).toBe(0);
    // Kein Upload — das ist der Kern dieses Tests.
    expect(create).not.toHaveBeenCalled();
  });

  it('bricht bei fehlender Verbindung ab und behält die Einträge', async () => {
    const create = vi
      .spyOn(api, 'createReport')
      .mockRejectedValue(new ApiError('NETWORK', 0, 'Keine Verbindung.'));

    useOfflineQueue.getState().enqueue(input('DELAY'), 'a');
    useOfflineQueue.getState().enqueue(input('DELAY'), 'b');

    const result = await useOfflineQueue.getState().flush();

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(2);
    // Nach dem ersten Netzwerkfehler wird abgebrochen statt weiterprobiert.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sendet gar nicht erst, wenn der Browser offline meldet', async () => {
    const create = vi.spyOn(api, 'createReport');
    setOnline(false);
    useOfflineQueue.getState().enqueue(input('DELAY'), 'a');

    const result = await useOfflineQueue.getState().flush();

    expect(create).not.toHaveBeenCalled();
    expect(result.remaining).toBe(1);
  });

  it('verwirft fachlich abgelehnte Meldungen ohne Wiederholung', async () => {
    vi.spyOn(api, 'createReport').mockRejectedValue(
      new ApiError('DUPLICATE_REPORT', 409, 'Diese Meldung gibt es schon.'),
    );

    useOfflineQueue.getState().enqueue(input('DELAY'), 'dublette');
    const result = await useOfflineQueue.getState().flush();

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('behält Meldungen bei Serverfehlern für einen weiteren Versuch', async () => {
    vi.spyOn(api, 'createReport').mockRejectedValue(
      new ApiError('INTERNAL', 500, 'Serverfehler.'),
    );

    useOfflineQueue.getState().enqueue(input('DELAY'), 'a');
    const result = await useOfflineQueue.getState().flush();

    expect(result.remaining).toBe(1);
    expect(useOfflineQueue.getState().items[0]?.attempts).toBe(1);
  });

  it('gibt nach fünf Versuchen auf', async () => {
    vi.spyOn(api, 'createReport').mockRejectedValue(new ApiError('INTERNAL', 500, 'Serverfehler.'));

    useOfflineQueue.getState().enqueue(input('DELAY'), 'a');
    for (let i = 0; i < 5; i += 1) {
      await useOfflineQueue.getState().flush();
    }

    expect(useOfflineQueue.getState().items).toHaveLength(0);
  });

  it('läuft nicht zweimal gleichzeitig', async () => {
    useOfflineQueue.setState({ flushing: true, items: [] });
    const result = await useOfflineQueue.getState().flush();
    expect(result.sent).toBe(0);
  });
});
