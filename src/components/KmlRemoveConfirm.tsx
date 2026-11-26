'use client';

/**
 * Confirmación compacta para quitar una capa KML de «Mis capas».
 *
 * Vive en el <li> de la capa, como bloque bajo su fila, no en un modal:
 * el panel mide 320 px y
 * un `window.confirm` bloquea el hilo y no se puede estilar. Se muestra el
 * nombre efectivo de la capa (truncado solo visualmente, el texto completo
 * queda en el `title` y en el lector de pantalla) y dos acciones explícitas.
 *
 * El foco inicial va a «Cancelar»: Enter sobre la confirmación nunca borra
 * por accidente. Escape cierra la confirmación y detiene la propagación para
 * que el panel de capas no se cierre detrás (ver `LayerSidebar`).
 *
 * Layout para panel estrecho: bloque a ancho completo, nunca hermano
 * horizontal de la fila (ahí la aplastaba hasta dejar el nombre en una letra).
 * Los botones no llevan `min-w-0`: su ancho mínimo es el texto más el padding,
 * así `flex-wrap` los apila en vez de recortarlos.
 */
export function KmlRemoveConfirm({
  id,
  label,
  onConfirm,
  onCancel,
}: {
  /** Id que enlaza el `aria-controls` del botón que abre la confirmación. */
  id?: string;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      id={id}
      role="group"
      aria-label={`Confirmar quitar la capa ${label}`}
      className="mt-1.5 w-full min-w-0 rounded-md border border-red-600/40 bg-red-600/5 p-2.5 dark:border-red-400/40 dark:bg-red-400/10"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <p className="truncate text-[0.7rem] font-medium" title={label}>
        ¿Quitar «{label}»?
      </p>
      <p className="mt-0.5 text-[0.6rem] leading-snug opacity-70">
        Se quita de este navegador y no se puede deshacer.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="min-h-9 flex-1 whitespace-nowrap rounded-md border border-black/20 bg-[var(--background)] px-3 text-[0.7rem] font-medium hover:bg-black/5 focus-visible:outline-2 dark:border-white/25 dark:hover:bg-white/10"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-9 flex-1 whitespace-nowrap rounded-md bg-red-600 px-3 text-[0.7rem] font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-red-600"
        >
          Quitar
        </button>
      </div>
    </div>
  );
}
