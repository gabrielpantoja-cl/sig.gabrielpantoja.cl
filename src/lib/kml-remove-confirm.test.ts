import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KmlRemoveConfirm } from '@/components/KmlRemoveConfirm';

describe('KmlRemoveConfirm', () => {
  it('muestra el nombre de la capa y las dos acciones explícitas', () => {
    const html = renderToStaticMarkup(
      createElement(KmlRemoveConfirm, {
        label: 'Sector Norte',
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );

    expect(html).toContain('Sector Norte');
    expect(html).toContain('¿Quitar');
    expect(html).toContain('Quitar');
    expect(html).toContain('Cancelar');
    expect(html).toContain('role="group"');
  });

  it('no usa window.confirm ni alert (es un control inline del DOM)', () => {
    const html = renderToStaticMarkup(
      createElement(KmlRemoveConfirm, {
        label: 'Sector Norte',
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );

    expect(html).not.toContain('confirm(');
    expect(html).not.toContain('alert(');
  });

  it('expone el nombre completo en title para lectores de pantalla', () => {
    const html = renderToStaticMarkup(
      createElement(KmlRemoveConfirm, {
        label: 'Una capa con nombre muy largo que se trunca visualmente',
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );

    expect(html).toContain(
      'title="Una capa con nombre muy largo que se trunca visualmente"',
    );
  });

  it('asocia el grupo de confirmación al aria-label del botón Quitar', () => {
    const html = renderToStaticMarkup(
      createElement(KmlRemoveConfirm, {
        id: 'kml-remove-confirm-abc',
        label: 'Sector Norte',
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );

    expect(html).toContain('id="kml-remove-confirm-abc"');
    expect(html).toContain('aria-label="Confirmar quitar la capa Sector Norte"');
  });
});
