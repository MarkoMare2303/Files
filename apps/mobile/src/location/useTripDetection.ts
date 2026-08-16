import type { TripCandidate, TripDetectionResponse } from '@swissov/types';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api/endpoints.js';
import { useSessionStore } from '../state/session.store.js';
import type { Observation } from './useLocation.js';

/**
 * Fahrtenerkennung im Client (§10/§11).
 *
 * Die Bewertung selbst passiert serverseitig — dort liegen Fahrplan, Strecken
 * und Echtzeitdaten. Der Client schickt bewusst nur die zuletzt gemessenen
 * Punkte und speichert sie nicht (§60).
 */
export interface TripDetectionState {
  decision: TripDetectionResponse['decision'] | 'IDLE';
  candidates: TripCandidate[];
  best: TripCandidate | null;
  isLoading: boolean;
  error: unknown;
  refetch(): void;
}

/** Nur abfragen, wenn die Beobachtungen aussagekräftig sind. */
function isUsable(observations: Observation[]): boolean {
  const latest = observations[observations.length - 1];
  if (!latest) return false;
  // Bei sehr ungenauem GPS (Tunnel, Gebäude) lohnt die Abfrage nicht.
  return (latest.accuracy ?? 0) <= 500;
}

export function useTripDetection(
  observations: Observation[],
  options: { enabled?: boolean } = {},
): TripDetectionState {
  const autoDetection = useSessionStore((state) => state.settings?.autoTripDetection ?? true);
  const enabled = (options.enabled ?? true) && autoDetection && isUsable(observations);

  // Der Cache-Schlüssel rundet die Position auf ~100 m: kleine GPS-Zuckungen
  // lösen dadurch keine neue Abfrage aus.
  const latest = observations[observations.length - 1];
  const key = latest
    ? `${latest.lat.toFixed(3)}:${latest.lon.toFixed(3)}:${Math.floor(
        new Date(latest.timestamp).getTime() / 30_000,
      )}`
    : 'none';

  const query = useQuery({
    queryKey: ['trip-detection', key],
    enabled,
    staleTime: 20_000,
    gcTime: 60_000,
    retry: 1,
    queryFn: () => api.detectTrip({ observations: observations.slice(-5), limit: 5 }),
  });

  return useMemo<TripDetectionState>(
    () => ({
      decision: query.data?.decision ?? 'IDLE',
      candidates: query.data?.candidates ?? [],
      best: query.data?.candidates[0] ?? null,
      isLoading: query.isLoading,
      error: query.error,
      refetch: () => void query.refetch(),
    }),
    [query],
  );
}
