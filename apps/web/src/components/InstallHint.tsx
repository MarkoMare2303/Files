'use client';

import React from 'react';
import { t } from '../i18n/index';
import { useInstallPrompt } from '../pwa/useInstallPrompt';
import { Button, Text } from './primitives';

/**
 * Einladung zur Installation.
 *
 * Regeln:
 *   • Nur zeigen, wenn die App wirklich installierbar ist.
 *   • Nie, wenn sie bereits installiert läuft.
 *   • Nach dem Wegklicken 14 Tage Ruhe.
 *   • Auf iOS keine Schaltfläche, die nichts tut — dort steht die Anleitung.
 */
export function InstallHint(): React.JSX.Element | null {
  const install = useInstallPrompt();

  if (!install.shouldOffer) return null;

  return (
    <aside
      data-testid="install-hint"
      className="safe-bottom fixed inset-x-0 bottom-[64px] z-30 mx-auto max-w-2xl px-lg"
    >
      <div className="flex flex-col gap-sm rounded-lg border border-border bg-surface-elevated p-lg shadow-lg">
        <div className="flex items-start gap-md">
          <div className="flex-1">
            <Text variant="bodyStrong" as="h2">
              {install.method === 'IOS_MANUAL' ? t('pwa.iosTitle') : t('pwa.installTitle')}
            </Text>
            <Text variant="footnote" color="textSecondary" className="mt-xxs">
              {t('pwa.installBody')}
            </Text>
          </div>
          <button
            type="button"
            onClick={install.dismiss}
            aria-label={t('common.close')}
            className="min-h-[44px] min-w-[44px] rounded-md text-text-tertiary hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ✕
          </button>
        </div>

        {install.method === 'PROMPT' ? (
          <Button label={t('pwa.install')} onClick={() => void install.install()} />
        ) : (
          <ol className="flex list-decimal flex-col gap-xxs pl-lg">
            <li>
              <Text variant="footnote" color="textSecondary" as="span">
                {t('pwa.iosStep1')}
              </Text>
            </li>
            <li>
              <Text variant="footnote" color="textSecondary" as="span">
                {t('pwa.iosStep2')}
              </Text>
            </li>
            <li>
              <Text variant="footnote" color="textSecondary" as="span">
                {t('pwa.iosStep3')}
              </Text>
            </li>
          </ol>
        )}
      </div>
    </aside>
  );
}
