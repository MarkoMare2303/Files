#!/usr/bin/env node
//
// Ergänzt fehlende Werte in einer .env — und nur die.
//
//     node configure-env.mjs <.env> SCHLUESSEL=WERT …
//
// Ein `!` vor dem Schlüssel überschreibt auch einen bereits gesetzten Wert —
// gedacht für ausdrückliche Angaben auf der Kommandozeile, die stärker wiegen
// als das, was zufällig schon in der Datei steht.
//
// Ausgabe: je gesetztem Schlüssel eine Zeile `GESETZT <schluessel>`,
// je übernommenem eine Zeile `BEHALTEN <schluessel>`.
//
// Warum ein eigenes Programm statt `sed -i`: Werte wie ein Datenbankpasswort
// oder ein base64-Secret enthalten regelmässig `/`, `&`, `+` und `=`. `sed`
// liest `/` als Trennzeichen und `&` als Rückverweis auf den Treffer — die
// Zeile käme still verfälscht heraus, und der Fehler zeigte sich erst als
// „Passwort falsch" beim ersten Start.
//
// Vorhandene, echte Werte werden NIE überschrieben: `install.sh` ist mehrfach
// ausführbar, und ein zweiter Lauf darf weder ein erzeugtes VAPID-Schlüsselpaar
// noch eine von Hand angepasste Zeile verlieren.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , envPath, ...zuweisungen] = process.argv;
if (!envPath) {
  console.error('Aufruf: configure-env.mjs <.env> SCHLUESSEL=WERT …');
  process.exit(2);
}

/**
 * Gilt ein Wert als „noch nicht gesetzt"?
 *
 * Leer ist eindeutig. Dazu kommen die Platzhalter aus `.env.example`: wer sie
 * stehen lässt, hat den Wert nicht gesetzt, sondern übersehen.
 */
function istPlatzhalter(wert) {
  const w = wert.trim();
  if (w.length === 0) return true;
  return (
    w.includes('DEINE-DOMAIN') ||
    w.includes('benutzer:passwort') ||
    w.includes('change-me') ||
    w === 'CHANGEME'
  );
}

const zeilen = readFileSync(envPath, 'utf8').split('\n');
const ergebnis = [];

for (const zuweisung of zuweisungen) {
  const trenner = zuweisung.indexOf('=');
  if (trenner === -1) continue;
  const erzwingen = zuweisung.startsWith('!');
  const schluessel = zuweisung.slice(erzwingen ? 1 : 0, trenner);
  const wert = zuweisung.slice(trenner + 1);

  const index = zeilen.findIndex((zeile) => zeile.startsWith(`${schluessel}=`));
  if (index === -1) {
    zeilen.push(`${schluessel}=${wert}`);
    ergebnis.push(`GESETZT ${schluessel}`);
    continue;
  }

  const vorhanden = zeilen[index].slice(schluessel.length + 1);
  if (erzwingen || istPlatzhalter(vorhanden)) {
    zeilen[index] = `${schluessel}=${wert}`;
    ergebnis.push(`GESETZT ${schluessel}`);
  } else {
    ergebnis.push(`BEHALTEN ${schluessel}`);
  }
}

writeFileSync(envPath, zeilen.join('\n'));
console.log(ergebnis.join('\n'));
