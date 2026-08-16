'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore, type LocationPermission } from '../state/session.store';

/**
 * Standortzugriff im Browser (§59/§60).
 *
 * Grundsätze — unverändert gegenüber der nativen App:
 *   • Die Berechtigung wird NIE ungefragt beim Start angefordert — erst nach
 *     der Erklärung im Onboarding oder auf ausdrückliche Aktion.
 *   • Es wird kein Verlauf persistiert: der Ringpuffer lebt im Speicher und
 *     endet mit der Seite.
 *
 * Browser-spezifisch und ehrlich benannt:
 *   • Es gibt **keine** Hintergrundortung. `watchPosition` läuft nur, solange
 *     das Dokument sichtbar ist. Ist der Tab im Hintergrund oder das Telefon
 *     gesperrt, drosseln alle Browser die Aufrufe oder stoppen sie ganz.
 *     Wir tun deshalb NICHT so, als liefe die Erkennung weiter — die Ortung
 *     wird bei `visibilitychange` sauber beendet (§55: keine Fake-Funktionen).
 *   • Es gibt keine API, um einen Berechtigungsdialog zu erzwingen. Der
 *     Dialog erscheint erst beim ersten `getCurrentPosition`. `permissions.query`
 *     darf ausschliesslich zum LESEN des Status verwendet werden.
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

const GEO_OPTIONS: PositionOptions = {
  // `true` würde durchgehend GPS aktivieren. Im Zug reicht die netzbasierte
  // Ortung, und der Akku hält deutlich länger. Die Erkennung arbeitet mit
  // Toleranzen (§47).
  enableHighAccuracy: false,
  timeout: 15_000,
  maximumAge: 10_000,
};

export function toObservation(position: GeolocationPosition): Observation {
  const { coords } = position;
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    ...(coords.accuracy !== null && coords.accuracy !== undefined && Number.isFinite(coords.accuracy)
      ? { accuracy: Math.max(0, coords.accuracy) }
      : {}),
    // Browser liefern `null` für „unbekannt"; das darf nicht als 0 m/s gelten.
    ...(coords.speed !== null && coords.speed !== undefined && Number.isFinite(coords.speed) && coords.speed >= 0
      ? { speed: coords.speed }
      : {}),
    ...(coords.heading !== null &&
    coords.heading !== undefined &&
    Number.isFinite(coords.heading) &&
    coords.heading >= 0
      ? { heading: coords.heading }
      : {}),
    timestamp: new Date(position.timestamp).toISOString(),
  };
}

/** Übersetzt einen Geolocation-Fehler in einen Übersetzungsschlüssel. */
export function errorKeyFor(error: GeolocationPositionError | { code: number }): string {
  switch (error.code) {
    case 1:
      return 'location.denied';
    case 2:
      return 'location.unavailable';
    case 3:
      return 'location.timeout';
    default:
      return 'error.generic';
  }
}

export function isGeolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export interface UseLocationResult {
  observations: Observation[];
  latest: Observation | null;
  permission: LocationPermission;
  supported: boolean;
  /** `true`, solange die Ortung aktiv Punkte liefert. */
  watching: boolean;
  errorKey: string | null;
  requestPermission(): Promise<boolean>;
  /** Einmalige Positionsbestimmung, z. B. für „Haltestellen in der Nähe". */
  getCurrent(): Promise<Observation | null>;
}

export function useLocation(options: { watch?: boolean } = {}): UseLocationResult {
  const permission = useSessionStore((state) => state.locationPermission);
  const setPermission = useSessionStore((state) => state.setLocationPermission);

  const [observations, setObservations] = useState<Observation[]>([]);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const watchId = useRef<number | null>(null);

  const push = useCallback((observation: Observation) => {
    setObservations((previous) => [...previous, observation].slice(-HISTORY_SIZE));
  }, []);

  // Beim ersten Rendern den bereits erteilten Status übernehmen, ohne einen
  // Dialog auszulösen. Wird die Berechtigung in den Browsereinstellungen
  // geändert, zieht die App nach.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return undefined;

    let cancelled = false;

    const apply = (state: PermissionState): void => {
      if (cancelled) return;
      if (state === 'granted') setPermission('granted');
      else if (state === 'denied') setPermission('denied');
    };

    void navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((result) => {
        if (cancelled) return;
        apply(result.state);
        result.addEventListener('change', () => apply(result.state));
      })
      .catch(() => {
        // Safari < 16 kennt `permissions.query` für Geolocation nicht.
        // Kein Problem: der Status ergibt sich aus dem ersten Aufruf.
      });

    return () => {
      cancelled = true;
    };
  }, [setPermission]);

  const readPosition = useCallback(
    (positionOptions: PositionOptions = GEO_OPTIONS): Promise<GeolocationPosition> =>
      new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, positionOptions);
      }),
    [],
  );

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isGeolocationSupported()) {
      setErrorKey('location.unsupported');
      return false;
    }
    try {
      const position = await readPosition();
      setPermission('granted');
      setErrorKey(null);
      push(toObservation(position));
      return true;
    } catch (error) {
      const key = errorKeyFor(error as GeolocationPositionError);
      setErrorKey(key);
      // Nur eine echte Ablehnung ist eine Ablehnung. Ein Timeout bedeutet
      // lediglich, dass gerade keine Position ermittelt werden konnte.
      if ((error as GeolocationPositionError).code === 1) setPermission('denied');
      return false;
    }
  }, [push, readPosition, setPermission]);

  const getCurrent = useCallback(async (): Promise<Observation | null> => {
    if (!isGeolocationSupported() || permission !== 'granted') return null;
    try {
      const observation = toObservation(await readPosition());
      push(observation);
      setErrorKey(null);
      return observation;
    } catch (error) {
      setErrorKey(errorKeyFor(error as GeolocationPositionError));
      return null;
    }
  }, [permission, push, readPosition]);

  useEffect(() => {
    if (!options.watch || permission !== 'granted' || !isGeolocationSupported()) return undefined;

    const start = (): void => {
      if (watchId.current !== null) return;
      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          push(toObservation(position));
          setErrorKey(null);
        },
        (error) => setErrorKey(errorKeyFor(error)),
        GEO_OPTIONS,
      );
      setWatching(true);
    };

    const stop = (): void => {
      if (watchId.current === null) return;
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setWatching(false);
    };

    // Im Hintergrund wird nicht geortet. Das ist keine Sparmassnahme, sondern
    // eine Tatsache des Browsers — die App behauptet nichts anderes.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [options.watch, permission, push]);

  return {
    observations,
    latest: observations[observations.length - 1] ?? null,
    permission,
    supported: isGeolocationSupported(),
    watching,
    errorKey,
    requestPermission,
    getCurrent,
  };
}
