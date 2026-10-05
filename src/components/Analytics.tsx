'use client';

import { useEffect } from 'react';
import { applyOptOutParam, track } from '@/lib/analytics';

// Fuera del componente: el doble montaje de StrictMode en desarrollo no debe
// registrar dos páginas vistas.
let pageviewSent = false;

/**
 * Registra la página vista (con referrer y utm_*) y, cada vez que la pestaña
 * se oculta, los segundos de uso ACTIVO acumulados (con la pestaña visible),
 * que es lo que distingue a quien trabaja en el mapa de quien rebota.
 * Se monta en el layout, junto al monitor de despliegues.
 *
 * `?analytics=off` en la URL excluye a este navegador (visitas del
 * administrador); `?analytics=on` lo vuelve a incluir.
 */
export function Analytics() {
  useEffect(() => {
    if (!pageviewSent) {
      pageviewSent = true;
      const params = new URLSearchParams(window.location.search);
      applyOptOutParam(params);
      const props: Record<string, string> = {};
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
        const value = params.get(key);
        if (value) props[key] = value;
      }
      let referrer: string | undefined;
      try {
        const host = document.referrer ? new URL(document.referrer).host : '';
        if (host && host !== window.location.host) referrer = host;
      } catch {
        // referrer malformado: se ignora
      }
      track('pageview', props, referrer ? { r: referrer } : undefined);
    }

    let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
    let activeMs = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince != null) activeMs += Date.now() - visibleSince;
        visibleSince = null;
        if (activeMs >= 1000) track('leave', { active_s: Math.round(activeMs / 1000) });
      } else {
        visibleSince = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return null;
}
