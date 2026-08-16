import type { FeedItem, Report } from '@swissov/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSessionStore } from '../state/session.store';
import { api, type AppConfigResponse } from './endpoints';

/**
 * TanStack-Query-Hooks.
 *
 * Cache-Zeiten sind bewusst pro Datenart gesetzt: Fahrplandaten ändern sich
 * selten, Abfahrten und Meldungen laufend (§38/§47).
 *
 * Web-spezifisch: `refetchOnWindowFocus` ist global aktiviert (siehe
 * `QueryProvider`). Im Browser wechselt man ständig zwischen Tabs — kehrt man
 * zurück, müssen Abfahrtszeiten stimmen. Nativ gab es diesen Fall nicht.
 */

export const queryKeys = {
  appConfig: ['app-config'] as const,
  stopsNearby: (lat: number, lon: number, radius: number) =>
    ['stops', 'nearby', lat.toFixed(3), lon.toFixed(3), radius] as const,
  stop: (stopId: string) => ['stop', stopId] as const,
  departures: (stopId: string) => ['departures', stopId] as const,
  trip: (tripId: string, serviceDate?: string) => ['trip', tripId, serviceDate ?? 'today'] as const,
  tripReports: (tripId: string, serviceDate?: string) =>
    ['trip-reports', tripId, serviceDate ?? 'today'] as const,
  reportsNearby: (lat: number, lon: number) =>
    ['reports', 'nearby', lat.toFixed(2), lon.toFixed(2)] as const,
  search: (q: string) => ['search', q] as const,
  report: (reportId: string) => ['report', reportId] as const,
  session: ['trip-session'] as const,
  me: ['me'] as const,
  myReports: ['my-reports'] as const,
  favorites: ['favorites'] as const,
};

export function useAppConfig(): UseQueryResult<AppConfigResponse> {
  return useQuery({
    queryKey: queryKeys.appConfig,
    queryFn: () => api.appConfig(),
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

export function useNearbyStops(
  lat: number | null,
  lon: number | null,
  radius = 800,
): UseQueryResult<{ stops: Awaited<ReturnType<typeof api.stopsNearby>>['stops'] }> {
  return useQuery({
    queryKey: queryKeys.stopsNearby(lat ?? 0, lon ?? 0, radius),
    enabled: lat !== null && lon !== null,
    queryFn: () => api.stopsNearby(lat!, lon!, radius),
    staleTime: 5 * 60_000,
  });
}

export function useDepartures(stopId: string | null) {
  return useQuery({
    queryKey: queryKeys.departures(stopId ?? ''),
    enabled: Boolean(stopId),
    queryFn: () => api.departures(stopId!),
    // Abfahrtstafeln müssen aktuell wirken, ohne den Server zu fluten.
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

export function useTrip(tripId: string | null, serviceDate?: string) {
  return useQuery({
    queryKey: queryKeys.trip(tripId ?? '', serviceDate),
    enabled: Boolean(tripId),
    queryFn: () => api.trip(tripId!, serviceDate),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useTripReports(tripId: string | null, serviceDate?: string) {
  return useQuery({
    queryKey: queryKeys.tripReports(tripId ?? '', serviceDate),
    enabled: Boolean(tripId),
    queryFn: () => api.tripReports(tripId!, serviceDate),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useNearbyReports(lat: number | null, lon: number | null) {
  return useQuery({
    queryKey: queryKeys.reportsNearby(lat ?? 0, lon ?? 0),
    enabled: lat !== null && lon !== null,
    queryFn: () =>
      api.reports({ lat: lat!, lon: lon!, radiusMeters: 5000, includeOfficial: true, limit: 50 }),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useCurrentSession() {
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const setActiveTrip = useSessionStore((state) => state.setActiveTrip);

  const query = useQuery({
    queryKey: queryKeys.session,
    enabled: signedIn,
    queryFn: () => api.currentSession(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.data) setActiveTrip(query.data.session);
  }, [query.data, setActiveTrip]);

  return query;
}

/** Einzelne Meldung — Ziel eines Push-Deep-Links. */
export function useReport(reportId: string | null) {
  return useQuery({
    queryKey: queryKeys.report(reportId ?? ''),
    enabled: Boolean(reportId),
    queryFn: () => api.report(reportId!),
    staleTime: 15_000,
  });
}

export function useSearch(term: string) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: queryKeys.search(trimmed),
    enabled: trimmed.length >= 2,
    queryFn: () => api.search(trimmed),
    staleTime: 60_000,
  });
}

export function useFavorites() {
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  return useQuery({
    queryKey: queryKeys.favorites,
    enabled: signedIn,
    queryFn: () => api.favorites(),
    staleTime: 60_000,
  });
}

export function useMyReports() {
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  return useQuery({
    queryKey: queryKeys.myReports,
    enabled: signedIn,
    queryFn: () => api.myReports(),
    staleTime: 30_000,
  });
}

/**
 * Abstimmen mit optimistischem Update: der Tap fühlt sich sofort an, wird
 * aber bei Fehlern zurückgerollt (§70 Geschwindigkeit).
 */
export function useVoteReport(tripId?: string, serviceDate?: string) {
  const queryClient = useQueryClient();
  const key = tripId ? queryKeys.tripReports(tripId, serviceDate) : null;

  return useMutation({
    mutationFn: ({ reportId, vote }: { reportId: string; vote: 1 | -1 }) =>
      api.voteReport(reportId, vote),

    onMutate: async ({ reportId, vote }) => {
      if (!key) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: FeedItem[] }>(key);

      queryClient.setQueryData<{ items: FeedItem[] }>(key, (old) => {
        if (!old) return old;
        return {
          items: old.items.map((item) => {
            if (item.source !== 'COMMUNITY' || item.id !== reportId) return item;
            const report = item as Report;
            const hadVote = report.myVote;
            return {
              ...report,
              myVote: vote,
              upvotes: report.upvotes + (vote === 1 ? 1 : 0) - (hadVote === 1 ? 1 : 0),
              downvotes: report.downvotes + (vote === -1 ? 1 : 0) - (hadVote === -1 ? 1 : 0),
            };
          }),
        };
      });
      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (key && context?.previous) queryClient.setQueryData(key, context.previous);
    },

    onSettled: () => {
      if (key) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
