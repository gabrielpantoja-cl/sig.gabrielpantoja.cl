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

  it('explica la consecuencia sin guiones largos ni semilargos', () => {
    const html = renderToStaticMarkup(
      createElement(KmlRemoveConfirm, {
        label: 'Sector Norte',
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );

    expect(html).toContain('Se quita de este navegador y no se puede deshacer.');
    expect(html).not.toMatch(/[–—]/);
  });

  it('es un bloque a ancho completo con botones que no se recortan', () => {
    const html = renderToStaticMarkup(
      createElement(KmlRemoveConfirm, {
        label: 'Sector Norte',
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const classes = (pattern: RegExp) =>
      [...html.matchAll(pattern)].map((match) => match[1].split(' '));

    expect(classes(/<div[^>]*role="group"[^>]*class="([^"]*)"/g)[0]).toContain('w-full');
    expect(html).toContain('flex-wrap');
    const buttons = classes(/<button[^>]*class="([^"]*)"/g);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toEqual(expect.arrayContaining(['px-3', 'min-h-9', 'whitespace-nowrap']));
      expect(button).not.toContain('min-w-0');
    }
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

  it('expone el id que controla el botón de quitar y nombra el grupo', () => {
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
