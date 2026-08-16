import type { VehicleType } from '@swissov/types';
import type { LatLon } from '../geo.js';

/** Eine normalisierte GPS-Beobachtung, wie sie das Scoring erwartet. */
export interface Observation extends LatLon {
  /** Horizontale Genauigkeit in Metern; `undefined` = unbekannt. */
  accuracyMeters?: number | undefined;
  /** Geschwindigkeit in m/s; `undefined` = unbekannt. */
  speedMps?: number | undefined;
  /** Kurs über Grund in Grad; `undefined` = unbekannt. */
  headingDegrees?: number | undefined;
  timestamp: Date;
}

/** Ein Halt einer Kandidatenfahrt, wie er für das Scoring gebraucht wird. */
export interface CandidateStop {
  stopId: string;
  stopName: string;
  stopSequence: number;
  lat: number;
  lon: number;
  /** Planmässige Ankunft/Abfahrt als absolute Zeitpunkte. */
  scheduledArrival: Date | null;
  scheduledDeparture: Date | null;
}

/** Echtzeitinformationen zu einer Kandidatenfahrt (aus GTFS-RT). */
export interface CandidateRealtime {
  /** Verspätung in Sekunden an der aktuellen Position; positiv = später. */
  delaySeconds: number | null;
  cancelled: boolean;
  /** Zeitpunkt der letzten Aktualisierung. */
  updatedAt: Date | null;
}

/**
 * Projektion der Nutzerposition auf den Streckenverlauf der Kandidatenfahrt.
 * Wird serverseitig von PostGIS berechnet.
 */
export interface ShapeProjection {
  /** Abstand zur Linie in Metern. */
  distanceMeters: number;
  /** Anteil 0..1 entlang der Linie. */
  fraction: number;
  /** Richtung der Linie an der Projektionsstelle in Grad. */
  bearingDegrees: number | null;
  /** Gesamtlänge der Linie in Metern. */
  shapeLengthMeters: number;
}

/** Alles, was zur Bewertung einer einzelnen Kandidatenfahrt benötigt wird. */
export interface Candidate {
  tripId: string;
  serviceDate: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  routeColor: string | null;
  agencyId: string | null;
  agencyName: string | null;
  vehicleType: VehicleType;
  headsign: string | null;
  directionId: number | null;
  origin: string | null;
  destination: string | null;

  /** Planmässiger Fahrtbeginn/-ende als absolute Zeitpunkte. */
  scheduledStart: Date;
  scheduledEnd: Date;

  /** Projektion der jüngsten Beobachtung; `null`, wenn kein Shape vorhanden ist. */
  projection: ShapeProjection | null;
  /** Projektion der ältesten Beobachtung — ermöglicht Fortschrittsbewertung. */
  previousProjection: ShapeProjection | null;

  /** Letzter passierter und nächster Halt gemäss Fahrplan zum Beobachtungszeitpunkt. */
  previousStop: CandidateStop | null;
  nextStop: CandidateStop | null;

  /**
   * Planmässige Fahrzeugposition zum Beobachtungszeitpunkt, interpoliert aus
   * Fahrplan und Streckenverlauf. Grundlage der Fahrplantreue-Bewertung.
   */
  expectedPosition: LatLon | null;

  realtime: CandidateRealtime | null;

  /** Anzahl Halte der Fahrt — kurze Fahrten sind schwerer zu unterscheiden. */
  stopCount: number;
}

/** Gewichte der Teilscores (§10). Summe muss nicht exakt 1 ergeben. */
export interface ScoreWeights {
  shapeDistance: number;
  timeCompatibility: number;
  directionCompatibility: number;
  speedCompatibility: number;
  stopSequence: number;
  realtimeCompatibility: number;
}

export interface ComponentScore {
  raw: number;
  weight: number;
  weighted: number;
  detail: string;
}

export interface ScoredCandidate {
  candidate: Candidate;
  confidence: number;
  breakdown: {
    shapeDistance: ComponentScore;
    timeCompatibility: ComponentScore;
    directionCompatibility: ComponentScore;
    speedCompatibility: ComponentScore;
    stopSequence: ComponentScore;
    realtimeCompatibility: ComponentScore;
  };
  /**
   * Multiplikativer Zeitfaktor (0..1), der auf die gewichtete Summe angewandt
   * wurde. Werte unter 1 bedeuten: die Fahrt verkehrt zum Beobachtungszeitpunkt
   * gar nicht. Siehe `scheduleWindowFactor()`.
   */
  windowFactor: number;
}
