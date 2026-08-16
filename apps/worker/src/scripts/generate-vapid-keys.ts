#!/usr/bin/env node
import webpush from 'web-push';

/**
 * Erzeugt ein VAPID-Schlüsselpaar für Web Push.
 *
 *   pnpm --filter @swissov/worker run push:keys
 *
 * Der öffentliche Schlüssel wird über `GET /v1/app-config` an den Browser
 * ausgeliefert — das ist so vorgesehen. Der private Schlüssel gehört
 * ausschliesslich in die Serverumgebung (Worker) und darf niemals in einer
 * `NEXT_PUBLIC_*`-Variable, im Repository oder in einem Log stehen.
 *
 * Wird das Schlüsselpaar später gewechselt, verlieren ALLE bestehenden Abos
 * ihre Gültigkeit: Browser melden sich mit dem alten öffentlichen Schlüssel
 * an, und der Push-Dienst weist die Zustellung mit HTTP 403 ab. Der Wechsel
 * ist deshalb ein bewusster Schritt, kein Routinevorgang.
 */
const keys = webpush.generateVAPIDKeys();

console.log('# In die Serverumgebung eintragen (NICHT committen):');
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('WEB_PUSH_SUBJECT=mailto:push@example.ch');
console.log('');
console.log('# Hinweis: Der öffentliche Schlüssel darf im Browser landen.');
console.log('# Der private Schlüssel darf das NIE.');
