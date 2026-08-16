'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { isAuthConfigured } from '../../src/config';
import { signInWithEmail, signInWithProvider } from '../../src/auth/supabase';
import { Button, Card, Text } from '../../src/components/primitives';
import { DataNotice } from '../../src/components/states';
import { t } from '../../src/i18n/index';

/**
 * Anmeldung (§22).
 *
 * Der Gastmodus bleibt jederzeit erreichbar — lesen darf man ohne Konto.
 * Ist Supabase nicht konfiguriert, sagt die Seite das offen, statt eine
 * Schaltfläche anzubieten, die ins Leere läuft (§55).
 */
export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const redirectTo = typeof window === 'undefined' ? '' : `${window.location.origin}/auth/callback`;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!email.includes('@')) return;
    setStatus('sending');
    const result = await signInWithEmail(email.trim(), redirectTo);
    if (result.ok) {
      setStatus('sent');
      setMessage(null);
    } else {
      setStatus('error');
      setMessage(result.message ?? null);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-lg px-lg py-xxxl">
      <Text variant="title1" as="h1">
        {t('auth.title')}
      </Text>
      <Text variant="callout" color="textSecondary">
        {t('auth.subtitle')}
      </Text>

      {!isAuthConfigured ? (
        <DataNotice message={t('auth.notConfigured')} />
      ) : status === 'sent' ? (
        <Card>
          <Text variant="bodyStrong">{t('auth.emailSent')}</Text>
        </Card>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-md">
          <label className="flex flex-col gap-sm">
            <Text variant="footnote" color="textSecondary" as="span">
              {t('auth.email')}
            </Text>
            <input
              type="email"
              value={email}
              required
              autoComplete="email"
              inputMode="email"
              enterKeyHint="send"
              data-testid="login-email"
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-[48px] w-full rounded-lg border border-border bg-surface px-lg text-[16px] text-text-primary placeholder:text-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            />
          </label>

          <Button
            label={t('auth.emailAction')}
            type="submit"
            loading={status === 'sending'}
            data-testid="login-submit"
          />

          {status === 'error' ? <DataNotice message={message ?? t('error.generic')} /> : null}

          <div className="flex flex-col gap-sm pt-md">
            <Button
              label={t('auth.apple')}
              variant="secondary"
              onClick={() => void signInWithProvider('apple', redirectTo)}
            />
            <Button
              label={t('auth.google')}
              variant="secondary"
              onClick={() => void signInWithProvider('google', redirectTo)}
            />
          </div>
        </form>
      )}

      <Button label={t('auth.continueAsGuest')} variant="ghost" onClick={() => router.push('/map')} />
    </div>
  );
}
