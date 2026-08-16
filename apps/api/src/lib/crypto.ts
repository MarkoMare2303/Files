import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pseudonymisierung von IP-Adressen (§23).
 *
 * IP-Adressen sind personenbezogene Daten. Für Rate Limiting und
 * Missbrauchserkennung wird kein Klartext benötigt — ein schlüsselgebundener
 * HMAC genügt und ist nicht ohne Schlüssel rückrechenbar.
 */
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizeIp(ip)).digest('hex').slice(0, 32);
}

/**
 * Normalisiert IPv6-mapped IPv4 (`::ffff:1.2.3.4`) und kürzt IPv6 auf das
 * /64-Präfix — feiner ist für Missbrauchserkennung weder nötig noch zulässig.
 */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  if (trimmed.includes(':')) {
    const groups = trimmed.split(':');
    return groups.slice(0, 4).join(':');
  }
  return trimmed;
}

/** Zeitkonstanter Vergleich für Tokens/Signaturen. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Erzeugt ein stabiles, nicht rückführbares Pseudonym für die Anzeige.
 * Aus der Nutzer-ID abgeleitet, damit derselbe Nutzer immer denselben Alias
 * hat — ohne dass daraus die Identität ableitbar wäre.
 */
const ALIAS_ADJECTIVES = [
  'Ruhig', 'Flink', 'Pünktlich', 'Sonnig', 'Klar', 'Sicher', 'Leise', 'Wach',
  'Frisch', 'Weit', 'Hell', 'Munter', 'Still', 'Rasch', 'Fair', 'Warm',
];
const ALIAS_NOUNS = [
  'Pendler', 'Reisender', 'Fahrgast', 'Bergsteiger', 'Wanderer', 'Kondukteur',
  'Perron', 'Gleis', 'Passagier', 'Begleiter', 'Nachbar', 'Kollege',
  'Beobachter', 'Melder', 'Späher', 'Lotse',
];

export function generateAlias(userId: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(userId).digest();
  const adjective = ALIAS_ADJECTIVES[digest[0]! % ALIAS_ADJECTIVES.length]!;
  const noun = ALIAS_NOUNS[digest[1]! % ALIAS_NOUNS.length]!;
  const number = ((digest[2]! << 8) | digest[3]!) % 900 + 100;
  return `${adjective}er ${noun} ${number}`;
}
