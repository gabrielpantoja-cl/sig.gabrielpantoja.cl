'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import { track } from '@/lib/analytics';
import { resumenMedicion, type ModoMedicion, type Punto } from '@/lib/medicion';

/** Etiqueta de una medición fijada: el export PNG la pinta en ese punto. */
export type MedicionFijada = { anchor: L.LatLng; texto: string };

const ICON_RULER =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/></svg>';

const COLOR = '#ea580c';
/** Radio de «tocar el vértice» para cerrar o terminar, en píxeles. */
const RADIO_CIERRE_PX = 12;

const HINT: Record<ModoMedicion, string> = {
  distancia: 'Toca el mapa para marcar puntos. Toca el último punto (o «Fijar») para terminar.',
  superficie: 'Toca el mapa para marcar los vértices. Toca el primero (o «Fijar») para cerrar.',
};

/**
 * «Medir»: distancias y superficies sobre el mapa, en la esquina inferior
 * derecha sobre «Ir a mi ubicación». Mientras está activa, los clics del mapa
 * marcan vértices: `activeRef` le avisa a la consulta integrada que no
 * dispare, y un popup de capa que se abra en el mismo clic se cierra. El
 * doble clic deja de hacer zoom (su segundo clic cae sobre el último vértice y
 * termina la medición).
 *
 * Las mediciones fijadas quedan en el mapa hasta «Borrar» y salen en el PNG:
 * líneas y vértices se dibujan en el canvas vectorial (`preferCanvas`), que el
 * export ya captura, y las etiquetas — que son DOM — se publican en
 * `fixedRef` para que el export las pinte.
 *
 * «Analizar predio» (solo en modo superficie) entrega el polígono —el borrador
 * si tiene 3+ vértices, si no la última superficie fijada— a `onAnalizarRef`,
 * que abre la ficha del predio (`/api/analisis/predio`), y apaga la
 * herramienta para que los clics vuelvan a la consulta del mapa.
 *
 * Nada de esto sale del navegador por la analítica: el evento `measure` lleva
 * el modo y el número de vértices, nunca coordenadas ni resultados.
 */
export function useMeasureControl({
  mapRef,
  activeRef,
  fixedRef,
  onAnalizarRef,
}: {
  mapRef: RefObject<L.Map | null>;
  activeRef: RefObject<boolean>;
  fixedRef: RefObject<MedicionFijada[]>;
  onAnalizarRef?: RefObject<((vertices: Punto[]) => void) | undefined>;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let modo: ModoMedicion = 'distancia';
    let puntos: L.LatLng[] = [];
    let cursor: L.LatLng | null = null;
    const borrador = L.layerGroup().addTo(map);
    const fijadas = L.layerGroup().addTo(map);
    const etiquetas: L.Tooltip[] = [];
    /** Vértices de la última superficie fijada: lo que analiza «Analizar predio». */
    let ultimaSuperficie: Punto[] | null = null;
    const publicadas = fixedRef.current;
    let doubleClickZoomPrevio = map.doubleClickZoom.enabled();
    let cursorPrevio = '';

    let boton: HTMLButtonElement | null = null;
    let panel: HTMLDivElement | null = null;
    let resultado: HTMLDivElement | null = null;
    let ayuda: HTMLParagraphElement | null = null;
    const botonesModo: Partial<Record<ModoMedicion, HTMLButtonElement>> = {};
    let botonFijar: HTMLButtonElement | null = null;
    let botonDeshacer: HTMLButtonElement | null = null;
    let botonBorrar: HTMLButtonElement | null = null;
    let botonAnalizar: HTMLButtonElement | null = null;

    const estiloLinea = (borradorActivo: boolean): L.PolylineOptions => ({
      color: COLOR,
      weight: 3,
      opacity: 0.95,
      dashArray: borradorActivo ? '6 6' : undefined,
      interactive: false,
    });
    const halo: L.PolylineOptions = { color: '#fff', weight: 6, opacity: 0.85, interactive: false };

    const dibujarForma = (grupo: L.LayerGroup, vertices: L.LatLng[], cerrada: boolean, borradorActivo: boolean) => {
      if (vertices.length >= 2) {
        if (cerrada && vertices.length >= 3) {
          L.polygon(vertices, { ...halo, fill: false }).addTo(grupo);
          L.polygon(vertices, { ...estiloLinea(borradorActivo), fillColor: COLOR, fillOpacity: 0.12 }).addTo(grupo);
        } else {
          L.polyline(vertices, halo).addTo(grupo);
          L.polyline(vertices, estiloLinea(borradorActivo)).addTo(grupo);
        }
      }
      for (const v of vertices) {
        L.circleMarker(v, {
          radius: 4, color: COLOR, weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false,
        }).addTo(grupo);
      }
    };

    const actualizarPanel = () => {
      if (!resultado || !ayuda) return;
      const vista = cursor && puntos.length > 0 ? [...puntos, cursor] : puntos;
      resultado.textContent = vista.length >= 2 ? resumenMedicion(modo, vista) : 'Sin puntos todavía';
      ayuda.textContent = HINT[modo];
      for (const [m, b] of Object.entries(botonesModo) as [ModoMedicion, HTMLButtonElement][]) {
        b.setAttribute('aria-pressed', m === modo ? 'true' : 'false');
      }
      const minimo = modo === 'distancia' ? 2 : 3;
      if (botonFijar) botonFijar.disabled = puntos.length < minimo;
      if (botonDeshacer) botonDeshacer.disabled = puntos.length === 0;
      if (botonBorrar) botonBorrar.disabled = puntos.length === 0 && etiquetas.length === 0;
      if (botonAnalizar) {
        botonAnalizar.hidden = modo !== 'superficie' || !onAnalizarRef;
        botonAnalizar.disabled = puntos.length < 3 && ultimaSuperficie === null;
      }
    };

    const redibujar = () => {
      borrador.clearLayers();
      dibujarForma(borrador, puntos, modo === 'superficie', true);
      if (cursor && puntos.length > 0) {
        L.polyline([puntos[puntos.length - 1], cursor], { ...estiloLinea(true), opacity: 0.6 }).addTo(borrador);
      }
      actualizarPanel();
    };

    const descartar = () => {
      puntos = [];
      cursor = null;
      redibujar();
    };

    const fijar = () => {
      const minimo = modo === 'distancia' ? 2 : 3;
      if (puntos.length < minimo) return;
      const texto = resumenMedicion(modo, puntos);
      const grupo = L.layerGroup().addTo(fijadas);
      dibujarForma(grupo, puntos, modo === 'superficie', false);
      const anchor = modo === 'superficie' ? L.polygon(puntos).getBounds().getCenter() : puntos[puntos.length - 1];
      const etiqueta = L.tooltip({
        permanent: true,
        direction: modo === 'superficie' ? 'center' : 'right',
        offset: modo === 'superficie' ? [0, 0] : [8, 0],
        className: 'sig-medir-etiqueta',
        interactive: false,
      })
        .setLatLng(anchor)
        .setContent(texto)
        .addTo(map);
      etiquetas.push(etiqueta);
      publicadas.push({ anchor, texto });
      if (modo === 'superficie') ultimaSuperficie = puntos.map(({ lat, lng }) => ({ lat, lng }));
      track('measure', { mode: modo, vertices: puntos.length });
      descartar();
    };

    const borrarTodo = () => {
      fijadas.clearLayers();
      for (const e of etiquetas) e.remove();
      etiquetas.length = 0;
      publicadas.length = 0;
      ultimaSuperficie = null;
      descartar();
    };

    const analizar = () => {
      if (modo !== 'superficie') return;
      if (puntos.length >= 3) fijar();
      const vertices = ultimaSuperficie;
      if (!vertices) return;
      desactivar();
      onAnalizarRef?.current?.(vertices);
    };

    const cercaDe = (a: L.LatLng, b: L.LatLng) =>
      map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b)) <= RADIO_CIERRE_PX;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (!activeRef.current) return;
      const n = puntos.length;
      // Tocar el último vértice termina una distancia; tocar el primero cierra
      // una superficie. También es lo que hace el segundo clic de un doble clic.
      if (n >= 2 && modo === 'distancia' && cercaDe(e.latlng, puntos[n - 1])) return fijar();
      if (n >= 3 && modo === 'superficie' && (cercaDe(e.latlng, puntos[0]) || cercaDe(e.latlng, puntos[n - 1]))) {
        return fijar();
      }
      if (n >= 1 && cercaDe(e.latlng, puntos[n - 1])) return;
      puntos = [...puntos, e.latlng];
      redibujar();
    };

    let cuadro = 0;
    const sinCursor = window.matchMedia('(hover: none)').matches;
    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!activeRef.current || puntos.length === 0) return;
      // Sin cursor (pantalla táctil) no hay tramo de vista previa: el toque
      // emula un mousemove que dejaba un tramo fantasma sobre el último.
      if (sinCursor) return;
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => {
        cursor = e.latlng;
        redibujar();
      });
    };
    const onMouseOut = () => {
      cancelAnimationFrame(cuadro);
      if (!cursor) return;
      cursor = null;
      redibujar();
    };

    const onPopupOpen = () => {
      queueMicrotask(() => {
        if (activeRef.current) map.closePopup();
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (puntos.length > 0) descartar();
        else desactivar();
      } else if (e.key === 'Enter') {
        if (target?.closest('button')) return;
        e.preventDefault();
        fijar();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        puntos = puntos.slice(0, -1);
        redibujar();
      }
    };

    const activar = () => {
      if (activeRef.current) return;
      activeRef.current = true;
      map.closePopup();
      doubleClickZoomPrevio = map.doubleClickZoom.enabled();
      map.doubleClickZoom.disable();
      const contenedor = map.getContainer();
      cursorPrevio = contenedor.style.cursor;
      contenedor.style.cursor = 'crosshair';
      map.on('click', onClick);
      map.on('mousemove', onMouseMove);
      map.on('mouseout', onMouseOut);
      map.on('popupopen', onPopupOpen);
      document.addEventListener('keydown', onKeyDown);
      if (panel) panel.hidden = false;
      boton?.setAttribute('aria-pressed', 'true');
      boton?.classList.add('sig-medir-activo');
      redibujar();
    };

    const desactivar = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      descartar();
      if (doubleClickZoomPrevio) map.doubleClickZoom.enable();
      map.getContainer().style.cursor = cursorPrevio;
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
      map.off('popupopen', onPopupOpen);
      document.removeEventListener('keydown', onKeyDown);
      if (panel) panel.hidden = true;
      boton?.setAttribute('aria-pressed', 'false');
      boton?.classList.remove('sig-medir-activo');
    };

    const crearBoton = (padre: HTMLElement, texto: string, clase: string, accion: () => void) => {
      const b = L.DomUtil.create('button', clase, padre) as HTMLButtonElement;
      b.type = 'button';
      b.textContent = texto;
      L.DomEvent.on(b, 'click', (ev) => {
        L.DomEvent.stop(ev);
        accion();
      });
      return b;
    };

    const control = new L.Control({ position: 'bottomright' });
    control.onAdd = () => {
      const contenedor = L.DomUtil.create('div', 'leaflet-bar sig-medir');
      boton = L.DomUtil.create('button', 'sig-ubicacion-boton', contenedor) as HTMLButtonElement;
      boton.type = 'button';
      boton.title = 'Medir distancias y superficies';
      boton.setAttribute('aria-label', 'Medir distancias y superficies');
      boton.setAttribute('aria-pressed', 'false');
      boton.innerHTML = ICON_RULER;
      L.DomEvent.on(boton, 'click', () => (activeRef.current ? desactivar() : activar()));

      panel = L.DomUtil.create('div', 'sig-medir-panel', contenedor) as HTMLDivElement;
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', 'Herramienta de medición');
      panel.hidden = true;

      const modos = L.DomUtil.create('div', 'sig-medir-modos', panel);
      botonesModo.distancia = crearBoton(modos, 'Distancia', 'sig-medir-modo', () => {
        modo = 'distancia';
        descartar();
      });
      botonesModo.superficie = crearBoton(modos, 'Superficie', 'sig-medir-modo', () => {
        modo = 'superficie';
        descartar();
      });
      crearBoton(modos, '×', 'sig-medir-cerrar', desactivar).setAttribute('aria-label', 'Cerrar la herramienta de medición');

      resultado = L.DomUtil.create('div', 'sig-medir-resultado', panel) as HTMLDivElement;
      resultado.setAttribute('role', 'status');
      resultado.setAttribute('aria-live', 'polite');
      ayuda = L.DomUtil.create('p', 'sig-medir-ayuda', panel) as HTMLParagraphElement;

      const acciones = L.DomUtil.create('div', 'sig-medir-acciones', panel);
      botonFijar = crearBoton(acciones, 'Fijar', 'sig-medir-accion sig-medir-principal', fijar);
      botonDeshacer = crearBoton(acciones, 'Deshacer', 'sig-medir-accion', () => {
        puntos = puntos.slice(0, -1);
        redibujar();
      });
      botonBorrar = crearBoton(acciones, 'Borrar todo', 'sig-medir-accion', borrarTodo);
      botonAnalizar = crearBoton(panel, 'Analizar predio', 'sig-medir-accion sig-medir-analizar', analizar);
      botonAnalizar.title =
        'Cruza el polígono con comuna, límite urbano, áreas protegidas y transacciones CBR cercanas';

      const nota = L.DomUtil.create('p', 'sig-medir-nota', panel);
      nota.textContent =
        'Medición referencial: la superficie legal es la del plano o el título. ' +
        'Calculada sobre la esfera (error < 0,5 %); las fijadas salen en el PNG.';
      panel.title = nota.textContent;

      // Ni los clics del panel ni la rueda deben llegar al mapa.
      L.DomEvent.disableClickPropagation(contenedor);
      L.DomEvent.disableScrollPropagation(contenedor);
      return contenedor;
    };
    control.addTo(map);

    return () => {
      cancelAnimationFrame(cuadro);
      desactivar();
      control.remove();
      borrador.remove();
      fijadas.remove();
      for (const e of etiquetas) e.remove();
      publicadas.length = 0;
    };
  }, [mapRef, activeRef, fixedRef, onAnalizarRef]);
}
