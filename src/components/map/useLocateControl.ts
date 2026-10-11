'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import { track } from '@/lib/analytics';
import {
  GEO_MAX_ZOOM,
  GEO_OPTIONS,
  geoErrorCode,
  geoErrorMessage,
  geoSuccessMessage,
  type GeoErrorCode,
} from '@/lib/geolocalizacion';

const ICON_LOCATE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8"/>' +
  '<path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>';

/**
 * «Ir a mi ubicación»: botón en la esquina inferior derecha del mapa, sobre la
 * atribución (en las esquinas inferiores Leaflet apila el control nuevo
 * ENCIMA de los existentes). Un clic pide UNA posición al GPS del dispositivo
 * (`getCurrentPosition`, no `watchPosition`: no se sigue al usuario ni se
 * gasta batería), centra el mapa ajustado al círculo de precisión y deja el
 * punto azul con ese círculo. La precisión se informa siempre: una ubicación
 * por IP o wifi puede errar por kilómetros y el perito tiene que saberlo.
 *
 * La posición nunca sale del navegador. El punto y el círculo no son
 * interactivos, así que no interceptan el `identify` de las capas remotas.
 */
export function useLocateControl({ mapRef }: { mapRef: RefObject<L.Map | null> }): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let dot: L.Marker | null = null;
    let accuracy: L.Circle | null = null;
    let messageTimer = 0;
    let disposed = false;

    const control = new L.Control({ position: 'bottomright' });
    let button: HTMLButtonElement | null = null;
    let message: HTMLDivElement | null = null;

    const showMessage = (text: string, isError: boolean) => {
      if (!message) return;
      window.clearTimeout(messageTimer);
      message.textContent = text;
      message.dataset.error = isError ? 'true' : 'false';
      message.hidden = false;
      messageTimer = window.setTimeout(() => {
        if (message) message.hidden = true;
      }, isError ? 7000 : 4000);
    };

    const setBusy = (busy: boolean) => {
      if (!button) return;
      button.disabled = busy;
      button.setAttribute('aria-busy', busy ? 'true' : 'false');
      button.classList.toggle('sig-ubicacion-buscando', busy);
    };

    const fail = (code: GeoErrorCode) => {
      setBusy(false);
      showMessage(geoErrorMessage(code), true);
      track('locate', { ok: false, error: code });
    };

    const locate = () => {
      if (!('geolocation' in navigator) || !window.isSecureContext) {
        fail('unsupported');
        return;
      }
      setBusy(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (disposed || !mapRef.current) return;
          setBusy(false);
          const { latitude, longitude, accuracy: metros } = position.coords;
          const latlng = L.latLng(latitude, longitude);
          const radius = Number.isFinite(metros) && metros > 0 ? metros : 0;

          dot?.remove();
          accuracy?.remove();
          accuracy = L.circle(latlng, {
            radius,
            color: '#2563eb',
            weight: 1,
            fillColor: '#2563eb',
            fillOpacity: 0.12,
            interactive: false,
          }).addTo(map);
          dot = L.marker(latlng, {
            icon: L.divIcon({
              className: 'geo-focus',
              html: '<span class="geo-focus-ring"></span><span class="geo-focus-dot"></span>',
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            }),
            interactive: false,
            keyboard: false,
            zIndexOffset: 1100,
          }).addTo(map);

          if (radius > 0) {
            map.flyToBounds(accuracy.getBounds(), { maxZoom: GEO_MAX_ZOOM, padding: [40, 40], duration: 1.2 });
          } else {
            map.flyTo(latlng, GEO_MAX_ZOOM - 1, { duration: 1.2 });
          }
          showMessage(geoSuccessMessage(radius), false);
          track('locate', { ok: true });
        },
        (error) => {
          if (disposed) return;
          fail(geoErrorCode(error.code));
        },
        GEO_OPTIONS,
      );
    };

    control.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-bar sig-ubicacion');
      button = L.DomUtil.create('button', 'sig-ubicacion-boton', container) as HTMLButtonElement;
      button.type = 'button';
      button.title = 'Ir a mi ubicación';
      button.setAttribute('aria-label', 'Ir a mi ubicación (GPS del dispositivo)');
      button.innerHTML = ICON_LOCATE;
      message = L.DomUtil.create('div', 'sig-ubicacion-mensaje', container) as HTMLDivElement;
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      message.hidden = true;
      // Ni el clic ni el doble clic deben llegar al mapa (zoom, identify).
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, 'click', locate);
      return container;
    };
    control.addTo(map);

    return () => {
      disposed = true;
      window.clearTimeout(messageTimer);
      control.remove();
      dot?.remove();
      accuracy?.remove();
    };
  }, [mapRef]);
}
