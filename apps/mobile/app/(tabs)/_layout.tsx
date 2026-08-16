import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from '../../src/components/primitives.js';
import { t } from '../../src/i18n/index.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Bottom Navigation (§31).
 *
 * Der zentrale Melden-Button ist bewusst hervorgehoben: er ist die wichtigste
 * Aktion der App und muss aus jedem Kontext in einem Tap erreichbar sein (§69).
 */
function TabIcon({
  focused,
  label,
  shape,
}: {
  focused: boolean;
  label: string;
  shape: 'circle' | 'square' | 'rounded' | 'diamond';
}): React.JSX.Element {
  const theme = useTheme();
  const color = focused ? theme.colors.brand : theme.colors.textTertiary;

  const size = 20;
  const style =
    shape === 'circle'
      ? { borderRadius: size / 2 }
      : shape === 'rounded'
        ? { borderRadius: 6 }
        : shape === 'diamond'
          ? { borderRadius: 4, transform: [{ rotate: '45deg' }] }
          : { borderRadius: 2 };

  return (
    <View style={{ alignItems: 'center', gap: 3, width: 72 }}>
      <View
        style={[
          { width: size, height: size, borderWidth: focused ? 6 : 2, borderColor: color },
          style,
        ]}
      />
      <Text variant="caption" style={{ color }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function ReportTabIcon(): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={t('report.create')}
      style={[
        {
          width: 58,
          height: 58,
          borderRadius: 29,
          backgroundColor: theme.colors.signal,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: Platform.OS === 'ios' ? 18 : 24,
          borderWidth: 4,
          borderColor: theme.colors.surface,
        },
        theme.elevation.md,
      ]}
    >
      <View
        style={{
          width: 22,
          height: 3,
          borderRadius: 2,
          backgroundColor: '#1A0E03',
          position: 'absolute',
        }}
      />
      <View style={{ width: 3, height: 22, borderRadius: 2, backgroundColor: '#1A0E03' }} />
    </View>
  );
}

export default function TabsLayout(): React.JSX.Element {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.map'),
          tabBarAccessibilityLabel: t('tab.map'),
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} label={t('tab.map')} shape="rounded" />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: t('tab.trips'),
          tabBarAccessibilityLabel: t('tab.trips'),
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} label={t('tab.trips')} shape="square" />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: t('tab.report'),
          tabBarAccessibilityLabel: t('report.create'),
          tabBarIcon: () => <ReportTabIcon />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('tab.reports'),
          tabBarAccessibilityLabel: t('tab.reports'),
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} label={t('tab.reports')} shape="diamond" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tab.profile'),
          tabBarAccessibilityLabel: t('tab.profile'),
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} label={t('tab.profile')} shape="circle" />
          ),
        }}
      />
    </Tabs>
  );
}
