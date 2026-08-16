import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '../src/components/primitives.js';
import { t } from '../src/i18n/index.js';
import { useLocation } from '../src/location/useLocation.js';
import { useSessionStore } from '../src/state/session.store.js';
import { useTheme } from '../src/theme/ThemeProvider.js';

/**
 * Onboarding (§58/§59).
 *
 * Der Standortdialog erscheint erst nach der Erklärung — nie ungefragt beim
 * ersten Start. „Später" ist eine gleichwertige Option: die App bleibt ohne
 * Standort vollständig nutzbar (§12).
 */
const SLIDES = [
  { title: 'onboarding.1.title', body: 'onboarding.1.body' },
  { title: 'onboarding.2.title', body: 'onboarding.2.body' },
  { title: 'onboarding.3.title', body: 'onboarding.3.body' },
] as const;

export default function OnboardingScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [askingLocation, setAskingLocation] = useState(false);

  const completeOnboarding = useSessionStore((state) => state.completeOnboarding);
  const setLocationPermission = useSessionStore((state) => state.setLocationPermission);
  const { requestPermission } = useLocation();

  const finish = (): void => {
    completeOnboarding();
    router.replace('/');
  };

  if (askingLocation) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.xl,
            gap: theme.spacing.lg,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.brandSubtle,
            }}
          />
          <Text variant="title1" accessibilityRole="header">
            {t('location.title')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('location.body')}
          </Text>

          <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.xl }}>
            <Button
              label={t('location.enable')}
              onPress={async () => {
                await requestPermission();
                finish();
              }}
            />
            <Button
              label={t('common.later')}
              variant="ghost"
              onPress={() => {
                setLocationPermission('later');
                finish();
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const slide = SLIDES[index]!;
  const isLast = index === SLIDES.length - 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.xl }}>
        <View style={{ alignItems: 'flex-end', paddingTop: theme.spacing.md }}>
          <Pressable
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.skip')}
            hitSlop={12}
          >
            <Text variant="callout" color="textTertiary">
              {t('onboarding.skip')}
            </Text>
          </Pressable>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
          <View
            style={{
              width: width * 0.5,
              height: width * 0.5,
              borderRadius: theme.radius.xxl,
              backgroundColor: index === 0 ? theme.colors.brandSubtle : theme.colors.signalSubtle,
            }}
          />
          <Text variant="display" accessibilityRole="header">
            {t(slide.title)}
          </Text>
          <Text variant="body" color="textSecondary">
            {t(slide.body)}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.xl }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'center' }}>
            {SLIDES.map((item, dotIndex) => (
              <View
                key={item.title}
                style={{
                  width: dotIndex === index ? 20 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor:
                    dotIndex === index ? theme.colors.brand : theme.colors.borderStrong,
                }}
              />
            ))}
          </View>

          <Button
            label={isLast ? t('onboarding.start') : t('onboarding.next')}
            onPress={() => {
              if (isLast) setAskingLocation(true);
              else setIndex(index + 1);
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
