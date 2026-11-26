'use client';

/**
 * Confirmación compacta para quitar una capa KML de «Mis capas».
 *
 * Vive dentro de la fila de la capa, no en un modal: el panel mide 320 px y
 * un `window.confirm` bloquea el hilo y no se puede estilar. Se muestra el
 * nombre efectivo de la capa (truncado solo visualmente, el texto completo
 * queda en el `title` y en el lector de pantalla) y dos acciones explícitas.
 *
 * El foco inicial va a «Cancelar»: Enter sobre la confirmación nunca borra
 * por accidente. Escape cierra la confirmación y detiene la propagación para
 * que el panel de capas no se cierre detrás (ver `LayerSidebar`).
 *
 * Layout a prueba de panel estrecho: `w-full max-w-full min-w-0` en el
 * contenedor raíz para que nunca desborde hacia la derecha, `overflow-hidden`
 * por si acaso, y `flex-wrap` en los botones para que se apilen si no caben
 * lado a lado. El botón «Quitar» es `shrink-0` para que nunca se aplaste.
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
      className="w-full max-w-full min-w-0 box-border overflow-hidden mt-1.5 rounded-md border border-red-600/40 bg-red-600/5 px-2 py-1.5 dark:border-red-400/40 dark:bg-red-400/10"
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
        Se borra del navegador. No se puede deshacer.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="min-h-9 flex-1 min-w-0 shrink-0 rounded-md border border-black/20 bg-[var(--background)] px-2 text-[0.7rem] font-medium hover:bg-black/5 focus-visible:outline-2 dark:border-white/25 dark:hover:bg-white/10"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-9 flex-1 min-w-0 shrink-0 rounded-md bg-red-600 px-2 text-[0.7rem] font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-red-600 dark:hover:bg-red-500"
        >
          Quitar
        </button>
      </div>
    </div>
  );
}
