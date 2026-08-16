import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithEmail } from '../src/auth/supabase.js';
import { Button, Card, Text } from '../src/components/primitives.js';
import { DataNotice } from '../src/components/states.js';
import { isAuthConfigured } from '../src/config.js';
import { t } from '../src/i18n/index.js';
import { useTheme } from '../src/theme/ThemeProvider.js';

/**
 * Anmeldung (§22).
 *
 * Apple- und Google-Anmeldung benötigen native Credentials (Apple Developer
 * Program bzw. Google OAuth Client IDs). Solange diese fehlen, werden die
 * Schaltflächen nicht als funktionsfähig dargestellt, sondern es wird klar
 * gesagt, was fehlt (§55) — statt eines Buttons, der nichts tut.
 */
export default function LoginScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(): Promise<void> {
    setStatus('sending');
    setError(null);
    const redirectTo = Linking.createURL('/auth-callback');
    const result = await signInWithEmail(email.trim(), redirectTo);
    if (result.ok) {
      setStatus('sent');
    } else {
      setStatus('idle');
      setError(result.message ?? t('error.generic'));
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['bottom']}>
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title1" accessibilityRole="header">
            {t('auth.title')}
          </Text>
          <Text variant="callout" color="textSecondary">
            {t('auth.subtitle')}
          </Text>
        </View>

        {!isAuthConfigured ? (
          <DataNotice message={t('auth.notConfigured')} />
        ) : status === 'sent' ? (
          <Card style={{ backgroundColor: theme.colors.successSubtle }}>
            <Text variant="bodyStrong">{t('auth.emailSent')}</Text>
          </Card>
        ) : (
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              <Text variant="caption" color="textTertiary">
                {t('auth.email')}
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                accessibilityLabel={t('auth.email')}
                placeholder="name@example.ch"
                placeholderTextColor={theme.colors.textTertiary}
                style={{
                  minHeight: theme.minTouchTarget,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceSunken,
                  paddingHorizontal: theme.spacing.md,
                  color: theme.colors.textPrimary,
                  fontSize: theme.typography.body.fontSize,
                }}
              />
              {error ? (
                <Text variant="footnote" style={{ color: theme.colors.danger }}>
                  {error}
                </Text>
              ) : null}
              <Button
                label={t('auth.emailAction')}
                onPress={() => void submit()}
                disabled={!emailValid}
                loading={status === 'sending'}
              />
            </View>
          </Card>
        )}

        <Button
          label={t('auth.continueAsGuest')}
          variant="ghost"
          onPress={() => router.back()}
        />
      </View>
    </SafeAreaView>
  );
}
