import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSessionStore } from '../state/session.store.js';

/**
 * Standortzugriff (§59/§60).
 *
 * Grundsätze:
 *   • Die Berechtigung wird NIE ungefragt beim Start angefordert — erst nach
 *     der Erklärung im Onboarding oder auf ausdrückliche Aktion.
 *   • Es wird nur im Vordergrund geortet, solange keine Einwilligung für
 *     Hintergrundortung vorliegt.
 *   • Es wird kein Verlauf persistiert: der Ringpuffer lebt im Speicher und
 *     endet mit dem Prozess.
 */
export interface Observation {
  lat: number;
  lon: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: string;
}

/** Wie viele Punkte für Richtungs- und Fortschrittsbewertung genügen. */
const HISTORY_SIZE = 5;

export function toObservation(location: Location.LocationObject): Observation {
  const { coords } = location;
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    ...(coords.accuracy !== null && coords.accuracy !== undefined
      ? { accuracy: Math.max(0, coords.accuracy) }
      : {}),
    // Plattformen liefern -1 für „unbekannt"; das darf nicht als 0 m/s gelten.
    ...(coords.speed !== null && coords.speed !== undefined && coords.speed >= 0
      ? { speed: coords.speed }
      : {}),
    ...(coords.heading !== null && coords.heading !== undefined && coords.heading >= 0
      ? { heading: coords.heading }
      : {}),
    timestamp: new Date(location.timestamp).toISOString(),
  };
}

export interface UseLocationResult {
  observations: Observation[];
  latest: Observation | null;
  permission: 'unknown' | 'granted' | 'denied' | 'later';
  error: string | null;
  requestPermission(): Promise<boolean>;
  /** Einmalige Positionsbestimmung, z. B. für „Haltestellen in der Nähe". */
  getCurrent(): Promise<Observation | null>;
}

export function useLocation(options: { watch?: boolean } = {}): UseLocationResult {
  const permission = useSessionStore((state) => state.locationPermission);
  const setPermission = useSessionStore((state) => state.setLocationPermission);

  const [observations, setObservations] = useState<Observation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  const push = useCallback((observation: Observation) => {
    setObservations((previous) => [...previous, observation].slice(-HISTORY_SIZE));
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      const granted = result.status === Location.PermissionStatus.GRANTED;
      setPermission(granted ? 'granted' : 'denied');
      return granted;
    } catch (permissionError) {
      setError(permissionError instanceof Error ? permissionError.message : String(permissionError));
      setPermission('denied');
      return false;
    }
  }, [setPermission]);

  const getCurrent = useCallback(async (): Promise<Observation | null> => {
    if (permission !== 'granted') return null;
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const observation = toObservation(location);
      push(observation);
      return observation;
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : String(locationError));
      return null;
    }
  }, [permission, push]);

  useEffect(() => {
    if (!options.watch || permission !== 'granted') return undefined;

    let cancelled = false;

    const start = async (): Promise<void> => {
      try {
        const sub = await Location.watchPositionAsync(
          {
            // Balanced statt Highest: im Zug reicht das und schont den Akku
            // deutlich. Die Erkennung arbeitet mit Toleranzen (§47).
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 10_000,
            distanceInterval: 25,
          },
          (location) => {
            if (!cancelled) push(toObservation(location));
          },
        );
        if (cancelled) sub.remove();
        else subscription.current = sub;
      } catch (watchError) {
        setError(watchError instanceof Error ? watchError.message : String(watchError));
      }
    };

    void start();

    // Ortung im Hintergrund pausieren, solange keine Einwilligung vorliegt (§23).
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        subscription.current?.remove();
        subscription.current = null;
      } else if (!subscription.current && !cancelled) {
        void start();
      }
    });

    return () => {
      cancelled = true;
      subscription.current?.remove();
      subscription.current = null;
      appStateSubscription.remove();
    };
  }, [options.watch, permission, push]);

  return {
    observations,
    latest: observations[observations.length - 1] ?? null,
    permission,
    error,
    requestPermission,
    getCurrent,
  };
}
