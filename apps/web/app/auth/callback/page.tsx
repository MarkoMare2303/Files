'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { getSupabase } from '../../../src/auth/supabase';
import { Text } from '../../../src/components/primitives';
import { DataNotice } from '../../../src/components/states';
import { t } from '../../../src/i18n/index';

/**
 * Rückkehr aus dem Magic-Link bzw. der OAuth-Anmeldung.
 *
 * Diese Route gibt es nur im Web: nativ kam die Sitzung über einen
 * App-Link zurück. Der Supabase-Client löst den Code selbst ein
 * (`detectSessionInUrl`); danach wird die URL bereinigt, damit kein
 * Anmeldecode im Verlauf oder in geteilten Links stehen bleibt.
 */
export default function AuthCallbackPage(): React.JSX.Element {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setFailed(true);
      return;
    }

    let cancelled = false;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        // Code und Token dürfen nicht in der Adresszeile stehen bleiben.
        window.history.replaceState({}, '', '/auth/callback');
        if (error || !data.session) {
          setFailed(true);
          return;
        }
        router.replace('/map');
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-lg px-lg">
      {failed ? (
        <DataNotice message={t('auth.callbackFailed')} />
      ) : (
        <Text variant="callout" color="textSecondary">
          {t('common.loading')}
        </Text>
      )}
    </div>
  );
}
