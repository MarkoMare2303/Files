import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '../api/hooks';
import { getSupabase } from '../auth/supabase';

/**
 * Echtzeit-Abonnement für Community-Meldungen (§40).
 *
 * Es wird ausschliesslich nach dem konkreten Bezug gefiltert — nie der
 * gesamte Schweizer Datenstrom. Ohne Supabase-Konfiguration passiert nichts;
 * die Listen aktualisieren sich dann über das reguläre Polling-Intervall.
 */
export function useTripReportsRealtime(tripId: string | null, serviceDate: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !tripId || !serviceDate) return undefined;

    const channel = supabase
      .channel(`reports:trip:${tripId}:${serviceDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          // Es wird bewusst nur invalidiert statt der Payload vertraut: der
          // Server entscheidet, was der Nutzer sehen darf (§42).
          void queryClient.invalidateQueries({
            queryKey: queryKeys.tripReports(tripId, serviceDate),
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, tripId, serviceDate]);
}

/** Abonnement für Meldungen an einer Station. */
export function useStopReportsRealtime(stopId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !stopId) return undefined;

    const channel = supabase
      .channel(`reports:stop:${stopId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports', filter: `stop_id=eq.${stopId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['reports'] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, stopId]);
}
