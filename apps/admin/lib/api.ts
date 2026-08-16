import type {
  AdminDashboard,
  AdminReport,
  AdminUser,
  AuditLog,
  FeatureFlag,
  ModerationAction,
  ReportCategory,
  RuntimeConfig,
} from '@swissov/types';
import { getAdminSession } from './supabase';

/**
 * Zugriff auf die Admin-API.
 *
 * Wichtig (§33/§42): Das Portal führt KEINE eigenen Datenbankzugriffe aus.
 * Jede Aktion läuft über die API, die die Rolle serverseitig prüft und die
 * Änderung im Audit-Log protokolliert. Ein manipuliertes Frontend erhält
 * dadurch keine zusätzlichen Rechte.
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const session = await getAdminSession();
  if (!session) throw new AdminApiError(401, 'UNAUTHENTICATED', 'Nicht angemeldet');

  const url = new URL(`${API_URL}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    // Admin-Daten dürfen nie zwischengespeichert werden.
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; userMessage?: { de?: string } } }
      | null;
    throw new AdminApiError(
      response.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.userMessage?.de ?? payload?.error?.message ?? `HTTP ${response.status}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const adminApi = {
  dashboard: () => request<AdminDashboard>('/v1/admin/dashboard'),

  reports: (query: Record<string, string | number | undefined>) =>
    request<{ items: AdminReport[]; total: number }>('/v1/admin/reports', { query }),

  moderateReport: (reportId: string, action: 'APPROVE' | 'REMOVE' | 'RESTORE', reason: string) =>
    request<{ report: AdminReport }>(`/v1/admin/reports/${reportId}/moderate`, {
      method: 'POST',
      body: { action, reason },
    }),

  users: (query: Record<string, string | number | undefined>) =>
    request<{ items: AdminUser[]; total: number }>('/v1/admin/users', { query }),

  moderateUser: (
    userId: string,
    action: 'WARN' | 'SHADOW_FLAG' | 'SUSPEND' | 'REINSTATE',
    reason: string,
    durationHours?: number,
  ) =>
    request<{ user: AdminUser }>(`/v1/admin/users/${userId}/moderate`, {
      method: 'POST',
      body: { action, reason, ...(durationHours ? { durationHours } : {}) },
    }),

  userHistory: (userId: string) =>
    request<{ actions: ModerationAction[] }>(`/v1/admin/users/${userId}/history`),

  categories: () => request<{ categories: ReportCategory[] }>('/v1/admin/categories'),

  upsertCategory: (key: string, body: unknown) =>
    request<{ category: ReportCategory }>(`/v1/admin/categories/${key}`, { method: 'PUT', body }),

  config: () => request<RuntimeConfig>('/v1/admin/config'),

  updateConfig: (section: keyof RuntimeConfig, body: unknown) =>
    request<RuntimeConfig>(`/v1/admin/config/${section}`, { method: 'PUT', body }),

  featureFlags: () => request<{ flags: FeatureFlag[] }>('/v1/admin/feature-flags'),

  updateFeatureFlag: (key: string, body: { enabled?: boolean; rolloutPercentage?: number }) =>
    request<{ flag: FeatureFlag }>(`/v1/admin/feature-flags/${key}`, { method: 'PATCH', body }),

  auditLogs: (query: Record<string, string | number | undefined>) =>
    request<{ items: AuditLog[]; total: number }>('/v1/admin/audit-logs', { query }),
};
