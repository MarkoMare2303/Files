import { VEHICLE_SPEED_PROFILE, VehicleType } from '@swissov/types';
import { KMH_TO_MPS, bearingDegrees, bearingDeltaDegrees, clamp, haversineMeters } from '../geo.js';
import type {
  Candidate,
  ComponentScore,
  Observation,
  ScoreWeights,
  ScoredCandidate,
} from './types.js';

/**
 * Standardgewichte gemäss Master-Prompt §10. Über `app_config` administrativ
 * änderbar; die Funktion normalisiert die Summe, damit Fehlkonfigurationen
 * das Ergebnis nicht ausserhalb 0..1 schieben.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  shapeDistance: 0.3,
  timeCompatibility: 0.25,
  directionCompatibility: 0.15,
  speedCompatibility: 0.1,
  stopSequence: 0.1,
  realtimeCompatibility: 0.1,
};

/**
 * Neutralwert für Teilscores ohne Datengrundlage.
 *
 * Bewusst unter 1, damit fehlende Evidenz nicht wie bestätigte Evidenz wirkt,
 * aber deutlich über 0, damit eine Fahrt nicht bestraft wird, nur weil der
 * Feed keine Echtzeitdaten liefert.
 */
const NEUTRAL = 0.6;

/** Toleranz gegenüber der Streckenlinie je Fahrzeugtyp (Meter). */
function shapeToleranceMeters(vehicleType: VehicleType): number {
  switch (vehicleType) {
    case VehicleType.RAIL:
    case VehicleType.SUBWAY:
      // Schienenfahrzeuge folgen dem Shape sehr genau; GPS-Fehler im Zug ist der
      // dominierende Faktor (Fenster, Tunnel, Abschattung durch Wagenkasten).
      return 70;
    case VehicleType.TRAM:
      return 40;
    case VehicleType.FUNICULAR:
    case VehicleType.AERIAL_LIFT:
    case VehicleType.CABLE_TRAM:
      return 45;
    case VehicleType.FERRY:
      return 150;
    default:
      // Bus/PostAuto: Shapes sind teils generalisiert, Strassenbreite kommt dazu.
      return 60;
  }
}

function component(raw: number, weight: number, detail: string): ComponentScore {
  const clamped = clamp(raw, 0, 1);
  return { raw: clamped, weight, weighted: clamped * weight, detail };
}

/**
 * 1) Abstand zur Streckenlinie.
 *
 * Verwendet eine Lorentz-Kurve: bei Abstand = Toleranz liegt der Score bei 0.5,
 * er fällt danach schnell, erreicht aber nie exakt 0 — GPS-Ausreisser sollen
 * eine ansonsten perfekt passende Fahrt nicht vollständig ausschliessen.
 */
export function scoreShapeDistance(candidate: Candidate, latest: Observation): ComponentScore {
  const weight = 1;
  if (!candidate.projection) {
    return component(NEUTRAL, weight, 'Kein Streckenverlauf im Feed hinterlegt');
  }
  const tolerance = shapeToleranceMeters(candidate.vehicleType);
  // Ungenauigkeit der Messung wird zur Hälfte als zusätzliche Toleranz gewertet.
  const accuracySlack = Math.min(150, (latest.accuracyMeters ?? 0) * 0.5);
  const effective = Math.max(0, candidate.projection.distanceMeters - accuracySlack);
  const ratio = effective / tolerance;
  const raw = 1 / (1 + ratio * ratio);
  return component(
    raw,
    weight,
    `${candidate.projection.distanceMeters.toFixed(0)} m zur Linie (Toleranz ${tolerance} m)`,
  );
}

/**
 * 2) Zeitliche Passung.
 *
 * Zwei Anteile:
 *  a) Liegt der Beobachtungszeitpunkt im Fahrtfenster (inkl. Verspätung)?
 *  b) Wie gut passt die beobachtete Position zur planmässigen Position?
 */
export function scoreTimeCompatibility(candidate: Candidate, latest: Observation): ComponentScore {
  const weight = 1;
  const now = latest.timestamp.getTime();
  const delayMs = (candidate.realtime?.delaySeconds ?? 0) * 1000;
  const start = candidate.scheduledStart.getTime();
  const end = candidate.scheduledEnd.getTime() + Math.max(0, delayMs);

  // a) Fahrtfenster mit weichen Rändern (5 min davor, 10 min danach).
  const preGrace = 5 * 60 * 1000;
  const postGrace = 10 * 60 * 1000;
  let windowScore: number;
  if (now >= start && now <= end) {
    windowScore = 1;
  } else if (now < start) {
    windowScore = clamp(1 - (start - now) / preGrace, 0, 1);
  } else {
    windowScore = clamp(1 - (now - end) / postGrace, 0, 1);
  }

  // b) Fahrplantreue: Abstand zwischen erwarteter und beobachteter Position.
  let adherenceScore = NEUTRAL;
  let adherenceDetail = 'keine Sollposition berechenbar';
  if (candidate.expectedPosition) {
    const distance = haversineMeters(latest, candidate.expectedPosition);
    // 800 m entsprechen bei einem IC etwa 30 s Fahrzeit — ab hier wird es unscharf.
    const ratio = distance / 800;
    adherenceScore = 1 / (1 + ratio * ratio);
    adherenceDetail = `${distance.toFixed(0)} m von der Sollposition`;
  }

  const raw = windowScore * 0.5 + adherenceScore * 0.5;
  return component(
    raw,
    weight,
    `Fahrtfenster ${(windowScore * 100).toFixed(0)} %, ${adherenceDetail}`,
  );
}

/**
 * 3) Richtungskompatibilität.
 *
 * Bevorzugt den gemessenen Kurs; fehlt dieser, wird er aus zwei Beobachtungen
 * abgeleitet. Ohne Bewegung ist die Richtung bedeutungslos → Neutralwert.
 */
export function scoreDirection(candidate: Candidate, observations: Observation[]): ComponentScore {
  const weight = 1;
  const latest = observations[observations.length - 1]!;
  const shapeBearing = candidate.projection?.bearingDegrees ?? null;
  if (shapeBearing === null) {
    return component(NEUTRAL, weight, 'Keine Streckenrichtung verfügbar');
  }

  let heading = latest.headingDegrees;
  let source = 'Gerätekurs';
  if (heading === undefined && observations.length >= 2) {
    const previous = observations[observations.length - 2]!;
    const moved = haversineMeters(previous, latest);
    if (moved >= 15) {
      heading = bearingDegrees(previous, latest);
      source = 'aus Positionsverlauf';
    }
  }
  if (heading === undefined) {
    return component(NEUTRAL, weight, 'Kein Kurs verfügbar (Fahrzeug steht oder GPS ohne Kurs)');
  }

  const speed = latest.speedMps ?? 0;
  if (speed > 0 && speed < 1.5) {
    return component(NEUTRAL, weight, 'Zu langsam für eine belastbare Richtungsaussage');
  }

  const delta = bearingDeltaDegrees(heading, shapeBearing);
  // (1 + cos δ) / 2 → 0° = 1.0, 90° = 0.5, 180° = 0.0
  const raw = (1 + Math.cos((delta * Math.PI) / 180)) / 2;
  return component(raw, weight, `Kursabweichung ${delta.toFixed(0)}° (${source})`);
}

/**
 * 4) Geschwindigkeitskompatibilität.
 *
 * Stillstand ist bei jedem Verkehrsmittel plausibel (Halt), deshalb wird
 * langsame Fahrt nur leicht abgewertet. Übersteigt die Geschwindigkeit die
 * Bauartgrenze des Fahrzeugtyps, ist die Fahrt ausgeschlossen.
 */
export function scoreSpeed(candidate: Candidate, observations: Observation[]): ComponentScore {
  const weight = 1;
  const latest = observations[observations.length - 1]!;
  let speed = latest.speedMps;

  if (speed === undefined && observations.length >= 2) {
    const previous = observations[observations.length - 2]!;
    const dt = (latest.timestamp.getTime() - previous.timestamp.getTime()) / 1000;
    if (dt >= 1) speed = haversineMeters(previous, latest) / dt;
  }
  if (speed === undefined) {
    return component(NEUTRAL, weight, 'Keine Geschwindigkeit verfügbar');
  }

  const profile = VEHICLE_SPEED_PROFILE[candidate.vehicleType];
  const typicalMps = profile.typical * KMH_TO_MPS;
  const maxMps = profile.max * KMH_TO_MPS;
  const speedKmh = speed * 3.6;

  if (speed > maxMps * 1.05) {
    return component(
      0,
      weight,
      `${speedKmh.toFixed(0)} km/h übersteigt die Bauartgrenze (${profile.max} km/h)`,
    );
  }
  if (speed <= typicalMps) {
    // 0 m/s → 0.75 (Halt), typische Reisegeschwindigkeit → 1.0
    const raw = 0.75 + 0.25 * (typicalMps > 0 ? speed / typicalMps : 1);
    return component(raw, weight, `${speedKmh.toFixed(0)} km/h (typisch ${profile.typical} km/h)`);
  }
  const over = (speed - typicalMps) / Math.max(1, maxMps - typicalMps);
  const raw = 1 - 0.45 * over;
  return component(raw, weight, `${speedKmh.toFixed(0)} km/h (typisch ${profile.typical} km/h)`);
}

/**
 * 5) Haltestellensequenz / Fortschritt entlang der Fahrt.
 *
 * Bewertet, ob sich der Nutzer in der Fahrtrichtung entlang der Linie bewegt
 * und ob der zurückgelegte Weg zur verstrichenen Zeit passt.
 */
export function scoreStopSequence(candidate: Candidate, observations: Observation[]): ComponentScore {
  const weight = 1;
  const latest = observations[observations.length - 1]!;
  const first = observations[0]!;

  const hasProgression =
    candidate.projection !== null &&
    candidate.previousProjection !== null &&
    observations.length >= 2;

  if (hasProgression) {
    const projection = candidate.projection!;
    const previous = candidate.previousProjection!;
    const elapsedSeconds = (latest.timestamp.getTime() - first.timestamp.getTime()) / 1000;
    const travelled =
      (projection.fraction - previous.fraction) * projection.shapeLengthMeters;

    if (elapsedSeconds >= 5) {
      if (travelled < -50) {
        return component(
          0.05,
          weight,
          `Bewegung entgegen der Fahrtrichtung (${travelled.toFixed(0)} m)`,
        );
      }
      const directDistance = haversineMeters(first, latest);
      if (directDistance < 30) {
        // Nutzer steht — kein Erkenntnisgewinn, aber auch kein Widerspruch.
        return component(NEUTRAL, weight, 'Position nahezu unverändert');
      }
      // Der entlang der Linie zurückgelegte Weg sollte der Luftlinie ähneln.
      const ratio = travelled / Math.max(1, directDistance);
      const raw = clamp(1 - Math.abs(1 - ratio) * 0.8, 0, 1);
      return component(
        raw,
        weight,
        `${travelled.toFixed(0)} m entlang der Linie bei ${directDistance.toFixed(0)} m Luftlinie`,
      );
    }
  }

  // Fallback: Liegt die Position plausibel zwischen zwei aufeinanderfolgenden Halten?
  if (candidate.previousStop && candidate.nextStop) {
    const between = haversineMeters(candidate.previousStop, candidate.nextStop);
    const toPrev = haversineMeters(latest, candidate.previousStop);
    const toNext = haversineMeters(latest, candidate.nextStop);
    // Dreiecksungleichung: auf der Verbindung gilt toPrev + toNext ≈ between.
    const detour = toPrev + toNext - between;
    const raw = clamp(1 - detour / Math.max(300, between), 0, 1);
    return component(
      raw,
      weight,
      `Zwischen ${candidate.previousStop.stopName} und ${candidate.nextStop.stopName} (Umweg ${detour.toFixed(0)} m)`,
    );
  }

  return component(NEUTRAL, weight, 'Zu wenig Positionsverlauf für eine Sequenzbewertung');
}

/**
 * 6) Kompatibilität mit GTFS-Realtime.
 *
 * Liegen Echtzeitdaten vor, wird geprüft, ob die Verspätung die beobachtete
 * Position erklärt. Ausgefallene Fahrten werden praktisch ausgeschlossen.
 */
export function scoreRealtime(candidate: Candidate, latest: Observation): ComponentScore {
  const weight = 1;
  const rt = candidate.realtime;
  if (!rt) {
    return component(NEUTRAL, weight, 'Keine Echtzeitdaten für diese Fahrt');
  }
  if (rt.cancelled) {
    return component(0.02, weight, 'Fahrt ist laut Echtzeitdaten ausgefallen');
  }

  const parts: string[] = [];
  let raw = 0.85;

  if (rt.updatedAt) {
    const ageMinutes = (latest.timestamp.getTime() - rt.updatedAt.getTime()) / 60_000;
    if (ageMinutes > 15) {
      raw -= 0.15;
      parts.push(`Echtzeitdaten ${ageMinutes.toFixed(0)} min alt`);
    } else {
      raw += 0.1;
      parts.push('Echtzeitdaten aktuell');
    }
  }

  if (rt.delaySeconds !== null && candidate.nextStop?.scheduledArrival) {
    const expectedArrival = candidate.nextStop.scheduledArrival.getTime() + rt.delaySeconds * 1000;
    const minutesToNext = (expectedArrival - latest.timestamp.getTime()) / 60_000;
    if (minutesToNext >= -3 && minutesToNext <= 45) {
      raw += 0.05;
      parts.push(`nächster Halt in ${minutesToNext.toFixed(0)} min`);
    } else {
      raw -= 0.25;
      parts.push('Prognose passt nicht zur Position');
    }
  }

  return component(raw, weight, parts.join(', ') || 'Echtzeitdaten vorhanden');
}

/** Bewertet eine einzelne Kandidatenfahrt. */
export function scoreCandidate(
  candidate: Candidate,
  observations: Observation[],
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoredCandidate {
  if (observations.length === 0) {
    throw new Error('scoreCandidate benötigt mindestens eine Beobachtung');
  }
  const sorted = [...observations].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const latest = sorted[sorted.length - 1]!;

  const shapeDistance = { ...scoreShapeDistance(candidate, latest), weight: weights.shapeDistance };
  const timeCompatibility = {
    ...scoreTimeCompatibility(candidate, latest),
    weight: weights.timeCompatibility,
  };
  const directionCompatibility = {
    ...scoreDirection(candidate, sorted),
    weight: weights.directionCompatibility,
  };
  const speedCompatibility = { ...scoreSpeed(candidate, sorted), weight: weights.speedCompatibility };
  const stopSequence = { ...scoreStopSequence(candidate, sorted), weight: weights.stopSequence };
  const realtimeCompatibility = {
    ...scoreRealtime(candidate, latest),
    weight: weights.realtimeCompatibility,
  };

  const components = [
    shapeDistance,
    timeCompatibility,
    directionCompatibility,
    speedCompatibility,
    stopSequence,
    realtimeCompatibility,
  ];
  for (const c of components) c.weighted = c.raw * c.weight;

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const confidence = totalWeight > 0
    ? clamp(components.reduce((sum, c) => sum + c.weighted, 0) / totalWeight, 0, 1)
    : 0;

  return {
    candidate,
    confidence: Math.round(confidence * 1000) / 1000,
    breakdown: {
      shapeDistance,
      timeCompatibility,
      directionCompatibility,
      speedCompatibility,
      stopSequence,
      realtimeCompatibility,
    },
  };
}

/** Bewertet alle Kandidaten und sortiert absteigend nach Confidence. */
export function scoreCandidates(
  candidates: Candidate[],
  observations: Observation[],
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, observations, weights))
    .sort((a, b) => b.confidence - a.confidence);
}
