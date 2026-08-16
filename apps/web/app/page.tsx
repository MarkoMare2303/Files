import Link from 'next/link';
import React from 'react';
import { de } from '../src/i18n/de';

/**
 * Landing-Page (`/`).
 *
 * Bewusst ein Server-Component ohne Hooks: Sie muss auch dann etwas
 * Sinnvolles anzeigen, wenn JavaScript blockiert ist oder erst lädt. Das ist
 * die Seite, die geteilt und indexiert wird — sie erklärt in erster Linie,
 * woher die Daten kommen und was die App über einen weiss.
 *
 * Texte kommen direkt aus dem deutschen Katalog: der Sprachwechsel ist ein
 * Zustand des Clients, den es hier noch nicht gibt.
 */
export default function LandingPage(): React.JSX.Element {
  const features = [
    { title: de['landing.feature1.title'], body: de['landing.feature1.body'] },
    { title: de['landing.feature2.title'], body: de['landing.feature2.body'] },
    { title: de['landing.feature3.title'], body: de['landing.feature3.body'] },
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      <main id="main" className="mx-auto flex max-w-2xl flex-col gap-xxxl px-lg py-xxxl">
        <header className="flex flex-col gap-lg">
          <p className="text-[12px] font-medium uppercase tracking-[0.2px] text-brand">
            Schweizer ÖV Live
          </p>
          <h1 className="text-[32px] font-bold leading-[38px] tracking-[-0.5px] text-text-primary">
            {de['landing.title']}
          </h1>
          <p className="text-[16px] leading-[23px] text-text-secondary">{de['landing.subtitle']}</p>

          <div className="flex flex-wrap gap-md">
            <Link
              href="/map"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-brand bg-brand px-lg text-[16px] font-semibold text-text-on-brand transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {de['landing.cta']}
            </Link>
            <Link
              href="/onboarding"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border-strong bg-surface px-lg text-[16px] font-semibold text-text-primary transition-colors hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              So funktioniert’s
            </Link>
          </div>
        </header>

        <section className="flex flex-col gap-lg" aria-labelledby="features">
          <h2 id="features" className="sr-only">
            Funktionen
          </h2>
          {features.map((feature) => (
            <article key={feature.title} className="rounded-lg border border-border bg-surface p-lg">
              <h3 className="text-[17px] font-semibold leading-[23px] text-text-primary">
                {feature.title}
              </h3>
              <p className="mt-sm text-[15px] leading-[21px] text-text-secondary">{feature.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-lg border border-border bg-surface-sunken p-lg" aria-labelledby="privacy">
          <h2 id="privacy" className="text-[17px] font-semibold leading-[23px] text-text-primary">
            {de['landing.privacyTitle']}
          </h2>
          <p className="mt-sm text-[15px] leading-[21px] text-text-secondary">
            {de['landing.privacyBody']}
          </p>
        </section>

        <footer className="flex flex-col gap-sm border-t border-border pt-lg">
          <p className="text-[13px] leading-[18px] text-text-tertiary">
            Fahrplan- und Echtzeitdaten stammen von den Schweizer Verkehrsbetrieben
            (opentransportdata.swiss). Community-Meldungen stammen von Fahrgästen und sind
            ungeprüft — beide Quellen sind in der App jederzeit unterscheidbar gekennzeichnet.
          </p>
          <p className="text-[13px] leading-[18px] text-text-tertiary">
            Diese Anwendung ist kein Angebot der SBB oder eines anderen Verkehrsbetriebs.
          </p>
        </footer>
      </main>
    </div>
  );
}
