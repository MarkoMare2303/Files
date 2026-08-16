'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { Button, Text } from '../../src/components/primitives';
import { DataNotice } from '../../src/components/states';
import { t } from '../../src/i18n/index';
import { useLocation } from '../../src/location/useLocation';
import { useInstallPrompt } from '../../src/pwa/useInstallPrompt';
import { useSessionStore } from '../../src/state/session.store';

/**
 * Onboarding (§58/§59).
 *
 * Drei Schritte, dann die Standortfrage — in dieser Reihenfolge, weil ein
 * Systemdialog ohne vorherige Erklärung fast immer abgelehnt wird und danach
 * nur noch über die Browsereinstellungen zurückgeholt werden kann.
 *
 * Der Standortdialog erscheint ausschliesslich auf ausdrückliche Aktion.
 * „Später" ist eine vollwertige Antwort: die App bleibt komplett benutzbar.
 */
const STEPS = [
  { titleKey: 'onboarding.1.title', bodyKey: 'onboarding.1.body' },
  { titleKey: 'onboarding.2.title', bodyKey: 'onboarding.2.body' },
  { titleKey: 'onboarding.3.title', bodyKey: 'onboarding.3.body' },
] as const;

export default function OnboardingPage(): React.JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const completeOnboarding = useSessionStore((state) => state.completeOnboarding);
  const setPermission = useSessionStore((state) => state.setLocationPermission);
  const { requestPermission, supported } = useLocation();
  const install = useInstallPrompt();

  function finish(): void {
    completeOnboarding();
    router.push('/map');
  }

  const isLocationStep = step === STEPS.length;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-between gap-lg px-lg py-xxxl">
      <div className="flex flex-col gap-lg">
        {isLocationStep ? (
          <>
            <Text variant="title1" as="h1">
              {t('location.title')}
            </Text>
            <Text variant="body" color="textSecondary">
              {t('location.body')}
            </Text>
            <DataNotice message={t('location.foregroundOnly')} />
            {!supported ? <DataNotice message={t('location.unsupported')} /> : null}
          </>
        ) : (
          <>
            <Text variant="title1" as="h1">
              {t(STEPS[step]!.titleKey)}
            </Text>
            <Text variant="body" color="textSecondary">
              {t(STEPS[step]!.bodyKey)}
            </Text>
            {step === 2 && install.method === 'IOS_MANUAL' ? (
              <DataNotice message={`${t('pwa.iosTitle')}: ${t('pwa.iosStep1')} ${t('pwa.iosStep2')}`} />
            ) : null}
          </>
        )}
      </div>

      <div className="flex flex-col gap-md">
        <ol className="flex justify-center gap-xs" aria-label={`Schritt ${step + 1} von ${STEPS.length + 1}`}>
          {Array.from({ length: STEPS.length + 1 }, (_, index) => (
            <li
              key={index}
              aria-hidden="true"
              className={`h-2 w-2 rounded-pill ${index === step ? 'bg-brand' : 'bg-border-strong'}`}
            />
          ))}
        </ol>

        {isLocationStep ? (
          <>
            <Button
              label={t('location.enable')}
              disabled={!supported}
              onClick={() => {
                void requestPermission().then(finish);
              }}
              data-testid="onboarding-location"
            />
            <Button
              label={t('common.later')}
              variant="ghost"
              onClick={() => {
                setPermission('later');
                finish();
              }}
            />
          </>
        ) : (
          <>
            <Button
              label={step === STEPS.length - 1 ? t('onboarding.start') : t('onboarding.next')}
              onClick={() => setStep((current) => current + 1)}
              data-testid="onboarding-next"
            />
            <Button label={t('onboarding.skip')} variant="ghost" onClick={finish} />
          </>
        )}
      </div>
    </div>
  );
}
