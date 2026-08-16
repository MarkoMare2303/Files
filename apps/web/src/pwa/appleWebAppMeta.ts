/**
 * Ergänzt `<meta name="apple-mobile-web-app-capable" content="yes">`.
 *
 * Warum clientseitig? Next.js behandelt diesen Namen als reservierte
 * Metadatenangabe: aus `appleWebApp.capable` erzeugt es ausschliesslich den
 * standardisierten Namen `mobile-web-app-capable` und filtert eine
 * gleichnamige Angabe aus `metadata.other` heraus. Ein eigenes `<head>` im
 * Root-Layout wird vom App Router ebenfalls verworfen.
 *
 * Warum es trotzdem funktioniert: Safari liest den Kopfbereich erst aus, wenn
 * der Nutzer „Zum Home-Bildschirm" antippt — nicht beim ersten Parsen des
 * Dokuments. Zu diesem Zeitpunkt steht die Angabe längst im DOM.
 *
 * Wen es betrifft: iOS 16.4 bis 17.3. Ab 17.4 versteht Safari den
 * standardisierten Namen. Ohne diese Angabe startet die installierte App auf
 * älteren Geräten mit Safari-Adressleiste statt im Vollbild — sie funktioniert,
 * sieht aber nicht aus wie eine App.
 */
export function ensureAppleWebAppMeta(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('meta[name="apple-mobile-web-app-capable"]')) return;

  const meta = document.createElement('meta');
  meta.name = 'apple-mobile-web-app-capable';
  meta.content = 'yes';
  document.head.appendChild(meta);
}
