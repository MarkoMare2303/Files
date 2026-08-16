import { z } from 'zod';
import { localeSchema } from './enums.js';

/** Bounding Box der Schweiz inkl. Grenzregionen (WGS84). Dient als Plausibilitätsgrenze. */
export const SWITZERLAND_BBOX = {
  minLon: 5.8,
  minLat: 45.7,
  maxLon: 10.6,
  maxLat: 47.85,
} as const;

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const coordinatesSchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
});
export type Coordinates = z.infer<typeof coordinatesSchema>;

/**
 * Eine GPS-Beobachtung des Clients. Bewusst minimal: nur was für das
 * Trip-Matching gebraucht wird (§60 — Datensparsamkeit).
 */
export const gpsObservationSchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
  /** Horizontale Genauigkeit in Metern (aus der Plattform-API). */
  accuracy: z.number().min(0).max(10_000).optional(),
  /** Geschwindigkeit in m/s. Negative Werte der Plattform-APIs bedeuten „unbekannt". */
  speed: z.number().min(0).max(150).optional(),
  /** Bewegungsrichtung in Grad (0 = Norden, im Uhrzeigersinn). */
  heading: z.number().min(0).max(360).optional(),
  /** Zeitpunkt der Messung (ISO 8601). */
  timestamp: z.string().datetime({ offset: true }),
});
export type GpsObservation = z.infer<typeof gpsObservationSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(256).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export type Paginated<T> = { items: T[]; nextCursor: string | null };

/** Mehrsprachiger Text. `de` ist verpflichtend (§45: Deutsch zuerst vollständig). */
export const localizedTextSchema = z
  .object({
    de: z.string(),
    fr: z.string().optional(),
    it: z.string().optional(),
    en: z.string().optional(),
  })
  .describe('Mehrsprachiger Text; Deutsch ist der Fallback.');
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export function pickLocalized(text: LocalizedText, locale: string | undefined): string {
  const parsed = localeSchema.safeParse(locale);
  if (parsed.success) {
    const value = text[parsed.data];
    if (value) return value;
  }
  return text.de;
}

/** Einheitliches Fehlerformat der API (§44 — verständliche Fehler). */
export const apiErrorSchema = z.object({
  error: z.object({
    /** Maschinenlesbarer Code, z. B. `RATE_LIMITED`, `TRIP_NOT_FOUND`. */
    code: z.string(),
    /** Kurze technische Beschreibung (Englisch, für Logs/Entwickler). */
    message: z.string(),
    /** Nutzerlesbarer Text pro Sprache; die App zeigt diesen an, falls vorhanden. */
    userMessage: localizedTextSchema.optional(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** ISO-Datum ohne Zeit (Betriebstag im GTFS-Sinn). */
export const serviceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Erwartet YYYY-MM-DD');
export type ServiceDate = z.infer<typeof serviceDateSchema>;

/** GTFS-Identifikatoren sind Freitext; Länge begrenzen (§42 Input Length Limits). */
export const gtfsIdSchema = z.string().min(1).max(255);

export const uuidSchema = z.string().uuid();
