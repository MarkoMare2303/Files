import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests der Offline-Warteschlange (§39).
 *
 * AsyncStorage und der API-Client werden ersetzt — geprüft wird ausschliesslich
 * die Warteschlangenlogik: Idempotenz, Verfallszeit, Wiederholungsverhalten.
 */
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

const createReport = vi.fn();

vi.mock('../api/endpoints.js', () => ({
  api: { createReport: (...args: unknown[]) => createReport(...args) },
}));

vi.mock('../api/client.js', async () => {
  class ApiError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      readonly userMessage: string,
    ) {
      super(userMessage);
    }
    get isOffline(): boolean {
      return this.code === 'NETWORK';
    }
  }
  return { ApiError };
});

const { useOfflineQueue, MAX_QUEUE_AGE_MS } = await import('./offline-queue.store.js');
const { ApiError } = await import('../api/client.js');

const input = { categoryKey: 'high_occupancy', tripId: 't-1' };

describe('Offline-Warteschlange', () => {
  beforeEach(() => {
    useOfflineQueue.setState({ items: [], flushing: false });
    createReport.mockReset();
  });

  it('nimmt eine Meldung auf', () => {
    useOfflineQueue.getState().enqueue(input, 'id-1');
    expect(useOfflineQueue.getState().items).toHaveLength(1);
    expect(useOfflineQueue.getState().items[0]!.clientReportId).toBe('id-1');
  });

  it('ersetzt einen Eintrag mit derselben Idempotenz-ID', () => {
    useOfflineQueue.getState().enqueue(input, 'id-1');
    useOfflineQueue.getState().enqueue({ ...input, message: 'neu' }, 'id-1');
    const items = useOfflineQueue.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.input.message).toBe('neu');
  });

  it('sendet wartende Meldungen mit ihrer Idempotenz-ID', async () => {
    createReport.mockResolvedValue({ report: {}, warnings: [] });
    useOfflineQueue.getState().enqueue(input, 'id-1');

    const result = await useOfflineQueue.getState().flush();

    expect(result.sent).toBe(1);
    expect(createReport).toHaveBeenCalledWith(
      expect.objectContaining({ clientReportId: 'id-1', categoryKey: 'high_occupancy' }),
    );
    expect(useOfflineQueue.getState().items).toHaveLength(0);
  });

  it('behält Einträge bei fehlender Verbindung', async () => {
    createReport.mockRejectedValue(new ApiError('NETWORK', 0, 'offline'));
    useOfflineQueue.getState().enqueue(input, 'id-1');

    const result = await useOfflineQueue.getState().flush();

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(1);
  });

  it('verwirft Einträge, die fachlich abgelehnt wurden', async () => {
    createReport.mockRejectedValue(new ApiError('ABUSE_BLOCKED', 422, 'blockiert'));
    useOfflineQueue.getState().enqueue(input, 'id-1');

    await useOfflineQueue.getState().flush();

    // Eine dauerhaft abgelehnte Meldung darf nicht endlos wiederholt werden.
    expect(useOfflineQueue.getState().items).toHaveLength(0);
  });

  it('verwirft zu alte Einträge, statt sie verspätet zu senden', async () => {
    useOfflineQueue.getState().enqueue(input, 'id-alt');
    useOfflineQueue.setState((state) => ({
      items: state.items.map((item) => ({
        ...item,
        queuedAt: Date.now() - MAX_QUEUE_AGE_MS - 1000,
      })),
    }));

    const result = await useOfflineQueue.getState().flush();

    expect(result.dropped).toBe(1);
    expect(createReport).not.toHaveBeenCalled();
  });

  it('begrenzt die Länge der Warteschlange', () => {
    for (let i = 0; i < 40; i += 1) {
      useOfflineQueue.getState().enqueue(input, `id-${i}`);
    }
    expect(useOfflineQueue.getState().items.length).toBeLessThanOrEqual(20);
  });
});
