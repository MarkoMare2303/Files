/**
 * Zeit- und Kalenderhilfen für GTFS.
 *
 * GTFS-Zeiten sind lokale Zeiten der Agentur und können 24:00:00 überschreiten
 * (Nachtverkehr). Der Betriebstag („service date") ist deshalb nicht identisch
 * mit dem Kalendertag. Diese Datei kapselt die Umrechnung — inklusive
 * Sommerzeitwechsel, die in der Schweiz jährlich zweimal auftreten.
 */

export const SWISS_TIMEZONE = 'Europe/Zurich';

/** Offset der Zeitzone zu UTC in Millisekunden zum gegebenen Zeitpunkt. */
export function timeZoneOffsetMs(instant: Date, timeZone: string = SWISS_TIMEZONE): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  // `hour` kann von Intl als 24 geliefert werden (Mitternacht) — auf 0 normalisieren.
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asUtc - instant.getTime();
}

/** Parst `HH:MM:SS` (auch > 24 h) in Sekunden seit Betriebstagsbeginn. */
export function parseGtfsTime(value: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** Formatiert Sekunden seit Betriebstagsbeginn als `HH:MM:SS` (kann > 24 h sein). */
export function formatGtfsTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(seconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → `{ year, month, day }`. Wirft bei ungültiger Eingabe. */
export function parseServiceDate(serviceDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  if (!match) throw new Error(`Ungültiges Betriebsdatum: ${serviceDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** GTFS-Kompaktformat `YYYYMMDD` → `YYYY-MM-DD`. */
export function normalizeGtfsDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  throw new Error(`Ungültiges GTFS-Datum: ${value}`);
}

/**
 * Wandelt Betriebsdatum + Sekunden-seit-Betriebstagsbeginn in einen absoluten
 * Zeitpunkt um. Der Betriebstag beginnt um 00:00 Ortszeit; Werte ≥ 86400
 * laufen in den Folgetag.
 *
 * Die zweistufige Offsetkorrektur behandelt Sommerzeitwechsel korrekt.
 */
export function serviceDateTimeToUtc(
  serviceDate: string,
  secondsSinceServiceStart: number,
  timeZone: string = SWISS_TIMEZONE,
): Date {
  const { year, month, day } = parseServiceDate(serviceDate);
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0) + secondsSinceServiceStart * 1000;
  // Erste Näherung: Offset am naiven Zeitpunkt.
  const offset1 = timeZoneOffsetMs(new Date(naiveUtc), timeZone);
  const guess = naiveUtc - offset1;
  // Korrektur: Offset am geschätzten realen Zeitpunkt (relevant bei DST-Übergängen).
  const offset2 = timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(naiveUtc - offset2);
}

/** Lokales Kalenderdatum (`YYYY-MM-DD`) eines Zeitpunkts in der Zielzeitzone. */
export function localDateString(instant: Date, timeZone: string = SWISS_TIMEZONE): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(instant);
}

/** Sekunden seit lokalem Mitternacht des Kalendertags, in dem `instant` liegt. */
export function secondsSinceLocalMidnight(instant: Date, timeZone: string = SWISS_TIMEZONE): number {
  const offset = timeZoneOffsetMs(instant, timeZone);
  const local = new Date(instant.getTime() + offset);
  return (
    local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds()
  );
}

/** Verschiebt ein `YYYY-MM-DD`-Datum um `days` Tage. */
export function shiftServiceDate(serviceDate: string, days: number): string {
  const { year, month, day } = parseServiceDate(serviceDate);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Kandidaten für den Betriebstag zu einem Zeitpunkt.
 *
 * Eine Fahrt um 00:30 Uhr kann zum Betriebstag des Vortags gehören (Ankunft
 * 24:30) oder zum aktuellen Tag. Beide müssen bei der Kandidatensuche
 * berücksichtigt werden.
 */
export function candidateServiceDates(
  instant: Date,
  timeZone: string = SWISS_TIMEZONE,
): Array<{ serviceDate: string; secondsSinceServiceStart: number }> {
  const today = localDateString(instant, timeZone);
  const secondsToday = secondsSinceLocalMidnight(instant, timeZone);
  const yesterday = shiftServiceDate(today, -1);
  return [
    { serviceDate: today, secondsSinceServiceStart: secondsToday },
    { serviceDate: yesterday, secondsSinceServiceStart: secondsToday + 86_400 },
  ];
}

/** Wochentagsindex 0 = Montag … 6 = Sonntag für ein Betriebsdatum. */
export function serviceDateWeekday(serviceDate: string): number {
  const { year, month, day } = parseServiceDate(serviceDate);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sonntag
  return (jsDay + 6) % 7;
}

/** Menschenlesbare Relativzeit auf Deutsch, z. B. „vor 4 Minuten". */
export function relativeTimeDe(from: Date, now: Date = new Date()): string {
  const diffSeconds = Math.round((now.getTime() - from.getTime()) / 1000);
  if (diffSeconds < 0) {
    const future = Math.abs(diffSeconds);
    if (future < 60) return 'in wenigen Sekunden';
    if (future < 3600) return `in ${Math.round(future / 60)} Min.`;
    return `in ${Math.round(future / 3600)} Std.`;
  }
  if (diffSeconds < 30) return 'gerade eben';
  if (diffSeconds < 60) return 'vor wenigen Sekunden';
  if (diffSeconds < 3600) {
    const minutes = Math.floor(diffSeconds / 60);
    return `vor ${minutes} Minute${minutes === 1 ? '' : 'n'}`;
  }
  if (diffSeconds < 86_400) {
    const hours = Math.floor(diffSeconds / 3600);
    return `vor ${hours} Stunde${hours === 1 ? '' : 'n'}`;
  }
  const days = Math.floor(diffSeconds / 86_400);
  return `vor ${days} Tag${days === 1 ? '' : 'en'}`;
}
