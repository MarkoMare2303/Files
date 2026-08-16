'use client';

import React from 'react';
import { t } from '../i18n/index';
import { useServiceWorker } from '../pwa/useServiceWorker';
import { Button, Text } from './primitives';

/**
 * Hinweis auf eine neue Version.
 *
 * Erscheint nur, wenn wirklich eine wartende Version existiert — und lädt die
 * Seite ausschliesslich auf Knopfdruck neu. Ein automatischer Reload könnte
 * eine halb geschriebene Meldung verwerfen.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const { updateAvailable, applyUpdate } = useServiceWorker();

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="safe-top fixed inset-x-0 top-0 z-50 flex items-center gap-md border-b border-border bg-surface-elevated px-lg py-md shadow-md"
    >
      <Text variant="callout" className="flex-1">
        {t('pwa.updateAvailable')}
      </Text>
      <Button
        label={t('pwa.updateApply')}
        onClick={applyUpdate}
        variant="primary"
        fullWidth={false}
        className="min-h-[40px] px-md"
      />
    </div>
  );
}
