'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { UPDATE_POLL_MS, type VersionInfo } from '@/lib/version';

/**
 * Monitor de actualizaciones: avisa en el DOM cuando el servidor está
 * sirviendo un build distinto al que cargó esta pestaña, y ofrece recargar.
 *
 * ## Por qué hace falta
 *
 * El SIG es una single-page app que un perito deja abierta durante horas.
 * Cuando se despliega una versión nueva, esa pestaña sigue ejecutando el
 * bundle viejo indefinidamente: ve los datos antiguos, no tiene las capas
 * nuevas y, si el deploy cambió una ruta de `/api`, puede empezar a fallar de
 * forma inexplicable. El navegador no lo va a avisar solo.
 *
 * ## Reglas de comportamiento
 *
 * - **Sondea el build, no la versión** — un deploy de correcciones puede no
 *   mover `MENOR.PARCHE` y aun así necesitar recarga.
 * - **Solo con la pestaña visible.** Sondear pestañas de fondo es tráfico
 *   regalado; además, al volver a una pestaña olvidada se comprueba de
 *   inmediato, que es cuando más probable es que haya cambiado algo.
 * - **Nunca interrumpe.** El aviso es un banner descartable en una esquina,
 *   jamás un modal ni una recarga automática: recargar bota los filtros, el
 *   encuadre y las capas KML que el usuario cargó desde su equipo.
 * - **Descarte por build.** Si el usuario lo cierra, no vuelve a molestar por
 *   ESE build; el siguiente deploy sí avisa de nuevo.
 * - **Falla en silencio.** Un sondeo caído no debe pintar un error: el aviso
 *   es una cortesía, no una función crítica.
 */
export function UpdateNotice() {
  // Build con el que se cargó esta pestaña. Se fija en el primer sondeo, no
  // en tiempo de compilación: así el componente no necesita que el servidor le
  // inyecte nada y la comparación es siempre contra el mismo origen.
  const loadedBuild = useRef<string | null>(null);
  const dismissed = useRef<string | null>(null);
  const [pending, setPending] = useState<VersionInfo | null>(null);
  const [reloading, setReloading] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const info = (await res.json()) as VersionInfo;
      if (typeof info?.build !== 'string') return;

      if (loadedBuild.current === null) {
        loadedBuild.current = info.build;
        return;
      }
      if (info.build === loadedBuild.current) return;
      if (info.build === dismissed.current) return;
      setPending(info);
    } catch {
      // Red caída, deploy a medias, offline: se reintenta en el próximo ciclo.
    }
  }, []);

  // El sondeo es una suscripción a un sistema externo (el servidor). Vive
  // entero en callbacks — el primer tick se AGENDA con `setTimeout(…, 0)` en
  // vez de llamarse en el cuerpo del efecto — para que ningún `setState`
  // cuelgue de la fase de montaje y el ciclo sea uno solo, encadenado: así dos
  // sondeos nunca se solapan si la red va lenta.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') await check();
      if (!stopped) timer = setTimeout(tick, UPDATE_POLL_MS);
    };
    timer = setTimeout(tick, 0);

    // Volver a una pestaña olvidada es el momento más probable de encontrarse
    // con un deploy nuevo: se comprueba de inmediato, sin esperar al ciclo.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (!pending) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-3 z-[1200] w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-[hsl(153_28%_35%)]/60 bg-[var(--background)]/97 px-3 py-2.5 text-sm shadow-xl backdrop-blur animate-[panel-in_140ms_ease-out]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug">
          Hay una versión nueva del SIG
          <span className="ml-1 font-normal tabular-nums opacity-60">
            (v{pending.version})
          </span>
        </p>
        <button
          type="button"
          onClick={() => {
            dismissed.current = pending.build;
            setPending(null);
          }}
          aria-label="Descartar aviso de actualización"
          className="-mr-1 -mt-1 rounded px-1.5 text-base leading-none opacity-50 hover:opacity-100"
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-xs leading-snug opacity-70">
        Al actualizar se recarga la página: se pierden los filtros, el encuadre
        y las capas KML que hayas cargado.
      </p>
      <button
        type="button"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          window.location.reload();
        }}
        className="mt-2 w-full rounded-md bg-[hsl(153_28%_30%)] py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {reloading ? 'Actualizando…' : 'Actualizar'}
      </button>
    </div>
  );
}
