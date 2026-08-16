'use client';

import React from 'react';

/**
 * Basisbausteine der Oberfläche (§29/§30/§46).
 *
 * Gegenüber der nativen Fassung ist der wichtigste Unterschied kein visueller,
 * sondern ein semantischer: Aktionen sind echte `<button>`- bzw. `<a>`-Elemente.
 * Damit funktionieren Tastaturbedienung, Fokusreihenfolge, Screenreader-Rollen
 * und Kontextmenüs ohne eigenen Code.
 *
 * Mindestgrösse für Touch-Ziele: 44 px (§46).
 */

export type TextVariant =
  | 'display'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'body'
  | 'bodyStrong'
  | 'callout'
  | 'footnote'
  | 'caption'
  | 'mono';

const TEXT_CLASS: Record<TextVariant, string> = {
  display: 'text-[32px] leading-[38px] font-bold tracking-[-0.5px]',
  title1: 'text-[26px] leading-8 font-bold tracking-[-0.3px]',
  title2: 'text-[21px] leading-[27px] font-semibold tracking-[-0.2px]',
  title3: 'text-[17px] leading-[23px] font-semibold',
  body: 'text-[16px] leading-[23px] font-normal',
  bodyStrong: 'text-[16px] leading-[23px] font-semibold',
  callout: 'text-[15px] leading-[21px] font-normal',
  footnote: 'text-[13px] leading-[18px] font-normal tracking-[0.1px]',
  caption: 'text-[12px] leading-4 font-medium tracking-[0.2px]',
  mono: 'text-[16px] leading-[22px] font-semibold tracking-[0.5px] tabular-nums',
};

export type TextColor =
  | 'textPrimary'
  | 'textSecondary'
  | 'textTertiary'
  | 'textInverse'
  | 'brand'
  | 'danger'
  | 'success'
  | 'warning';

const TEXT_COLOR: Record<TextColor, string> = {
  textPrimary: 'text-text-primary',
  textSecondary: 'text-text-secondary',
  textTertiary: 'text-text-tertiary',
  textInverse: 'text-text-inverse',
  brand: 'text-brand',
  danger: 'text-danger',
  success: 'text-success',
  warning: 'text-warning',
};

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function Text({
  variant = 'body',
  color = 'textPrimary',
  as: Component = 'p',
  className,
  children,
  ...rest
}: {
  variant?: TextVariant;
  color?: TextColor;
  as?: 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'div' | 'label';
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  return (
    <Component className={cx(TEXT_CLASS[variant], TEXT_COLOR[color], className)} {...rest}>
      {children}
    </Component>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'signal';

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-text-on-brand border-brand hover:bg-brand-strong',
  // Die Melden-Aktion ist die einzige, die Signalfarbe tragen darf (§29).
  signal: 'bg-signal text-on-community border-signal hover:bg-signal-strong',
  secondary: 'bg-surface text-text-primary border-border-strong hover:bg-surface-sunken',
  ghost: 'bg-transparent text-brand border-transparent hover:bg-brand-subtle',
  danger: 'bg-danger-subtle text-danger border-danger hover:brightness-95',
};

export function Button({
  label,
  variant = 'primary',
  fullWidth = true,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: {
  label?: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-[44px] items-center justify-center gap-sm rounded-lg border px-lg',
        'text-[16px] font-semibold leading-[23px] transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-50',
        fullWidth ? 'w-full' : 'w-auto',
        BUTTON_CLASS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children ?? label}
    </button>
  );
}

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-pill border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

export function Card({
  className,
  children,
  onClick,
  href,
  ariaLabel,
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  ariaLabel?: string;
}): React.JSX.Element {
  const base = cx(
    'block rounded-lg border border-border bg-surface p-lg text-left',
    (onClick || href) &&
      'transition-colors hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    className,
  );

  if (href) {
    return (
      <a href={href} aria-label={ariaLabel} className={base}>
        {children}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} className={cx(base, 'w-full')}>
        {children}
      </button>
    );
  }
  return <div className={base}>{children}</div>;
}

export function Badge({
  label,
  color,
  background,
  className,
}: {
  label: string;
  /** Textfarbe als CSS-Wert. Ohne Angabe: gedämpfte Standardfarbe. */
  color?: string;
  background?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-pill border border-border px-sm py-xxs',
        'text-[12px] font-medium leading-4 tracking-[0.2px]',
        !color && 'text-text-secondary',
        !background && 'bg-surface-sunken',
        className,
      )}
      style={{
        ...(color ? { color } : {}),
        ...(background ? { backgroundColor: background, borderColor: background } : {}),
      }}
    >
      {label}
    </span>
  );
}

export function Divider({ className }: { className?: string }): React.JSX.Element {
  return <hr className={cx('border-0 border-t border-border', className)} />;
}

export function Skeleton({
  height = 16,
  width = '100%',
  className,
}: {
  height?: number;
  width?: number | string;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx('block animate-pulse rounded-sm bg-skeleton', className)}
      style={{ height, width }}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  description?: string;
}): React.JSX.Element {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-lg py-xs">
      <span className="flex flex-col gap-xxs">
        <Text variant="body" as="span">
          {label}
        </Text>
        {description ? (
          <Text variant="footnote" color="textTertiary" as="span">
            {description}
          </Text>
        ) : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={cx(
          'h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-pill border border-border-strong bg-surface-sunken',
          'relative transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          'checked:border-brand checked:bg-brand',
          'after:absolute after:left-[2px] after:top-[2px] after:h-[18px] after:w-[18px] after:rounded-pill',
          'after:bg-surface after:transition-transform checked:after:translate-x-5',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        )}
      />
    </label>
  );
}
