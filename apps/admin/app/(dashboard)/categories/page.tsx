import { revalidatePath } from 'next/cache';
import React from 'react';
import { AdminApiError, adminApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Meldungskategorien (§17/§32).
 *
 * Kategorien sind Stammdaten: TTL, Icon, Farbe, Scopes und Moderationspflicht
 * lassen sich hier ändern, ohne die App neu zu veröffentlichen.
 */
async function updateCategory(formData: FormData): Promise<void> {
  'use server';
  const key = String(formData.get('key'));
  const existing = (await adminApi.categories()).categories.find((c) => c.key === key);
  if (!existing) return;

  await adminApi.upsertCategory(key, {
    key,
    label: existing.label,
    description: existing.description,
    icon: String(formData.get('icon') || existing.icon),
    color: String(formData.get('color') || existing.color),
    group: existing.group,
    defaultScope: String(formData.get('defaultScope') || existing.defaultScope),
    allowedScopes: existing.allowedScopes,
    ttlSeconds: Number(formData.get('ttlSeconds') || existing.ttlSeconds),
    ttlUntilTripEnd: formData.get('ttlUntilTripEnd') === 'on',
    requiresTrip: formData.get('requiresTrip') === 'on',
    requiresModeration: formData.get('requiresModeration') === 'on',
    severity: existing.severity,
    sortOrder: Number(formData.get('sortOrder') || existing.sortOrder),
    active: formData.get('active') === 'on',
  });
  revalidatePath('/categories');
}

export default async function CategoriesPage(): Promise<React.JSX.Element> {
  let categories;
  try {
    categories = (await adminApi.categories()).categories;
  } catch (error) {
    return (
      <>
        <h1>Kategorien</h1>
        <div className="notice error">
          {error instanceof AdminApiError ? error.message : 'Unbekannter Fehler'}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Meldungskategorien</h1>
      <p className="subtitle">
        {categories.length} Kategorien. Änderungen erscheinen sofort in der App — ohne Update.
      </p>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Kategorie</th>
              <th>Gruppe</th>
              <th>Scope</th>
              <th>TTL (s)</th>
              <th>Optionen</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.key}>
                <td>
                  <form action={updateCategory} id={`form-${category.key}`}>
                    <input type="hidden" name="key" value={category.key} />
                  </form>
                  <div className="row">
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        background: category.color,
                        display: 'inline-block',
                      }}
                    />
                    <div>
                      <strong>{category.label.de}</strong>
                      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                        <code>{category.key}</code>
                      </div>
                    </div>
                  </div>
                </td>
                <td>{category.group}</td>
                <td>
                  <select
                    name="defaultScope"
                    form={`form-${category.key}`}
                    defaultValue={category.defaultScope}
                  >
                    {category.allowedScopes.map((scope) => (
                      <option key={scope} value={scope}>
                        {scope}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    name="ttlSeconds"
                    form={`form-${category.key}`}
                    defaultValue={category.ttlSeconds}
                    min={60}
                    max={2592000}
                    style={{ width: 110 }}
                  />
                </td>
                <td style={{ fontSize: 13 }}>
                  <label style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      name="ttlUntilTripEnd"
                      form={`form-${category.key}`}
                      defaultChecked={category.ttlUntilTripEnd}
                    />{' '}
                    bis Fahrtende
                  </label>
                  <label style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      name="requiresTrip"
                      form={`form-${category.key}`}
                      defaultChecked={category.requiresTrip}
                    />{' '}
                    Fahrt nötig
                  </label>
                  <label style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      name="requiresModeration"
                      form={`form-${category.key}`}
                      defaultChecked={category.requiresModeration}
                    />{' '}
                    Vormoderation
                  </label>
                  <label style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      name="active"
                      form={`form-${category.key}`}
                      defaultChecked={category.active}
                    />{' '}
                    aktiv
                  </label>
                </td>
                <td>
                  <button type="submit" form={`form-${category.key}`} className="secondary">
                    Speichern
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
