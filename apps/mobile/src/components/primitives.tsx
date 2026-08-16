import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider.js';

/**
 * Basiskomponenten des Design Systems (§30).
 *
 * Alle Komponenten sind bewusst klein und ohne eigene Zustandslogik. Sie
 * kümmern sich um Typografie, Abstände, Kontraste, Touch-Ziele und
 * Barrierefreiheit — Layout und Daten liegen in den Screens.
 */

type TextVariant = keyof ReturnType<typeof useTheme>['typography'];
type ColorRole = keyof ReturnType<typeof useTheme>['colors'];

export function Text({
  children,
  variant = 'body',
  color = 'textPrimary',
  style,
  numberOfLines,
  accessibilityRole,
}: {
  children: ReactNode;
  variant?: TextVariant;
  color?: ColorRole;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text' | 'link';
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <RNText
      // Dynamic Type wird bewusst zugelassen, aber begrenzt, damit Layouts
      // bei sehr grossen Schriften nicht auseinanderfallen (§46).
      maxFontSizeMultiplier={1.6}
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      style={[theme.typography[variant], { color: theme.colors[color] }, style]}
    >
      {children}
    </RNText>
  );
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const theme = useTheme();
  const content = (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.lg,
        },
        theme.elevation.sm,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'signal';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  fullWidth = true,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  accessibilityHint?: string;
}): React.JSX.Element {
  const theme = useTheme();

  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: theme.colors.brand, fg: theme.colors.textOnBrand, border: 'transparent' },
    secondary: { bg: theme.colors.surface, fg: theme.colors.brand, border: theme.colors.border },
    ghost: { bg: 'transparent', fg: theme.colors.brand, border: 'transparent' },
    danger: { bg: theme.colors.danger, fg: '#FFFFFF', border: 'transparent' },
    signal: { bg: theme.colors.signal, fg: '#1A0E03', border: 'transparent' },
  };
  const colors = palette[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        {
          minHeight: theme.minTouchTarget,
          paddingHorizontal: theme.spacing.xl,
          borderRadius: theme.radius.pill,
          backgroundColor: colors.bg,
          borderWidth: colors.border === 'transparent' ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.spacing.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator color={colors.fg} /> : icon}
      <RNText
        maxFontSizeMultiplier={1.4}
        style={[theme.typography.bodyStrong, { color: colors.fg }]}
      >
        {label}
      </RNText>
    </Pressable>
  );
}

export function Badge({
  label,
  color,
  background,
  icon,
}: {
  label: string;
  color?: string;
  background?: string;
  icon?: ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xxs + 2,
        borderRadius: theme.radius.sm,
        backgroundColor: background ?? theme.colors.surfaceSunken,
      }}
    >
      {icon}
      <RNText
        maxFontSizeMultiplier={1.3}
        style={[theme.typography.caption, { color: color ?? theme.colors.textSecondary }]}
      >
        {label}
      </RNText>
    </View>
  );
}

/** Ladeplatzhalter — verhindert Layout-Sprünge (§30). */
export function Skeleton({
  height = 16,
  width = '100%',
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { height, width, borderRadius: theme.radius.sm, backgroundColor: theme.colors.skeleton },
        style,
      ]}
    />
  );
}

export function Divider(): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }}
    />
  );
}

export function Screen({
  children,
  padded = true,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingHorizontal: padded ? theme.spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
