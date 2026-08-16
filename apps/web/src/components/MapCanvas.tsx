'use client';

import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import React, { useEffect, useRef } from 'react';
import { SWITZERLAND_CENTER, SWITZERLAND_DEFAULT_ZOOM, config, isMapConfigured } from '../config';
import { t } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './primitives';

/**
 * Karte (§13).
 *
 * Dargestellt wird ausschliesslich, was wir wirklich wissen: die eigene
 * Position, Haltestellen und Meldungen. Es werden KEINE Fahrzeugpositionen
 * gezeichnet — in der Schweiz gibt es keinen offenen Fahrzeug-GPS-Feed, und
 * eine interpolierte Position wäre eine Behauptung, keine Information (§9).
 *
 * MapLibre wird nur im Browser geladen; die Karte ist bewusst kein
 * Server-Component.
 */
export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  color: string;
  label: string;
  kind: 'STOP' | 'REPORT' | 'SELF';
  onClick?: () => void;
}

export function MapCanvas({
  center,
  zoom,
  markers,
  className,
}: {
  center?: { lat: number; lon: number } | null;
  zoom?: number;
  markers: MapMarker[];
  className?: string;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<Marker[]>([]);
  const { resolved } = useTheme();

  useEffect(() => {
    if (!container.current || !isMapConfigured || map.current) return undefined;

    const instance = new maplibregl.Map({
      container: container.current,
      style: config.mapStyleUrl,
      center: [center?.lon ?? SWITZERLAND_CENTER.longitude, center?.lat ?? SWITZERLAND_CENTER.latitude],
      zoom: zoom ?? SWITZERLAND_DEFAULT_ZOOM,
      attributionControl: { compact: true },
      // Kein Bearing/Pitch: eine gedrehte Karte hilft im ÖV nicht und
      // erschwert das Lesen von Haltestellennamen.
      pitchWithRotate: false,
      dragRotate: false,
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.touchZoomRotate.disableRotation();
    map.current = instance;

    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      instance.remove();
      map.current = null;
    };
    // Absichtlich nur einmal: Zentrum und Zoom werden unten nachgeführt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zentrum nachführen, ohne den Nutzer zu bevormunden: nur sanft schwenken.
  useEffect(() => {
    if (!map.current || !center) return;
    map.current.easeTo({ center: [center.lon, center.lat], zoom: zoom ?? map.current.getZoom() });
  }, [center, zoom]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = markers.map((entry) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', entry.label);
      element.dataset.markerKind = entry.kind;
      element.style.cssText = [
        `width:${entry.kind === 'SELF' ? 18 : 22}px`,
        `height:${entry.kind === 'SELF' ? 18 : 22}px`,
        'border-radius:999px',
        `background:${entry.color}`,
        'border:2px solid #FFFFFF',
        'box-shadow:0 1px 4px rgba(0,0,0,0.35)',
        'cursor:pointer',
        'padding:0',
      ].join(';');
      if (entry.onClick) element.addEventListener('click', entry.onClick);

      return new maplibregl.Marker({ element }).setLngLat([entry.lon, entry.lat]).addTo(instance);
    });
  }, [markers]);

  if (!isMapConfigured) {
    // Ehrlich statt leer: ohne Style-URL gibt es keine Karte (§55).
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-border bg-surface-sunken p-lg ${className ?? ''}`}
      >
        <Text variant="footnote" color="textSecondary" className="text-center">
          {t('error.mapUnavailable')}
        </Text>
      </div>
    );
  }

  return (
    <div
      ref={container}
      data-testid="map-canvas"
      data-theme-mode={resolved}
      role="application"
      aria-label={t('tab.map')}
      className={`overflow-hidden rounded-lg border border-border ${className ?? ''}`}
    />
  );
}
