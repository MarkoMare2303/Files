#!/usr/bin/env node
/**
 * Prüft versionierte Dateien auf versehentlich committete Zugangsdaten (§42).
 *
 * Bewusst konservativ: erkannt werden konkrete Schlüsselformate, nicht
 * beliebige lange Zeichenketten — sonst ertrinkt der Check in Fehlalarmen
 * und wird ignoriert.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  {
    name: 'Supabase Service-Role-/Anon-Key (JWT)',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private Key Block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'GitHub Token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack Token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  {
    name: 'PostgreSQL-URL mit echtem Passwort',
    // Lokale Entwicklungs-Zugangsdaten (swissov/postgres) sind erlaubt.
    regex: /postgres(?:ql)?:\/\/(?!swissov:swissov@|postgres:postgres@)[^\s:@/]+:[^\s:@/]{8,}@/,
  },
];

const ALLOWED_PATHS = [/^\.env\.example$/, /^scripts\/check-secrets\.mjs$/, /^pnpm-lock\.yaml$/];
const SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|woff2?|ttf|otf)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const findings = [];

for (const file of files) {
  if (ALLOWED_PATHS.some((pattern) => pattern.test(file))) continue;
  if (SKIP_EXTENSIONS.test(file)) continue;

  try {
    if (statSync(file).size > MAX_FILE_BYTES) continue;
  } catch {
    continue;
  }

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(content);
    if (!match) continue;
    const line = content.slice(0, match.index).split('\n').length;
    findings.push({ file, line, name: pattern.name });
  }
}

if (findings.length > 0) {
  console.error('✗ Mögliche Zugangsdaten im Repository gefunden:\n');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.name}`);
  }
  console.error(
    '\nSecrets gehören ausschliesslich in .env (nicht versioniert) oder in den Secret-Store ' +
      'der Deployment-Plattform. Siehe docs/security.md.',
  );
  process.exit(1);
}

console.log(`✓ Keine Zugangsdaten gefunden (${files.length} Dateien geprüft).`);
