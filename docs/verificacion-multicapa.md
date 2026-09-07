# Verificación de lectura multicapa — 2026-09-07

Prueba de humo con Playwright sobre el servidor local de desarrollo, sin
agregar dependencias de test ni acceder a credenciales. No se ejecutó build.

## Casos comprobados

| Caso | Resultado |
|---|---|
| Activar Bioclima y comunas | Ambas aparecen en la leyenda activa |
| Llevar ambos sliders a cero con teclado (`Home`) | Misma imagen y mismo canvas; cero nuevas peticiones a `/data/` |
| Restablecer opacidades | Bioclima vuelve a 0,6 y comunas a su default |
| Apagar comunas | Desaparece su sección de la leyenda |
| Alternar variable climática | Se conserva un solo overlay, con el PNG de la variable elegida |
| Vista de 390 × 844 | Sin overflow horizontal; catálogo y lectura activa son pestañas de una misma tarjeta |
| Inspector en escritorio | Catálogo y lectura activa son dos columnas dentro del mismo borde y sombra |
| Activar Suelos bajo zoom mínimo | Un solo estado accesible de zoom requerido |
| PNG con Bioclima a cero | El raster invisible no participa en `drawImage` |
| PNG con Bioclima a 0,6 + comunas | Dibujo secuencial: imagen con alfa 0,6, luego canvas vectorial con alfa 1 |
| Metadatos PNG | Variable, período, resolución y atribución WorldClim presentes |

Para la prueba del PNG se instrumentaron temporalmente `drawImage`, `fillText`
y `toBlob` **solo en el navegador de prueba**. La segunda exportación produjo
un PNG de 566.537 bytes en aproximadamente 189 ms con recursos ya cacheados.
No es un benchmark de red ni garantiza esa latencia con otros mapas base.

## Repetición manual

1. Ejecutar `npm run dev` y abrir el visor.
2. Activar Bioclima y comunas. Guardar las referencias DOM de la imagen y el
   canvas en `overlayPane`, y observar peticiones en Network.
3. Mover sliders entre 0, 60 y 100 %. Confirmar identidad de nodos y ausencia
   de descargas adicionales. Los bordes de comunas deben mantenerse visibles.
4. Alternar temperatura/precipitación, apagar y encender capas y restablecer
   defaults. La opacidad elegida debe sobrevivir al toggle.
5. Exportar con alfa cero y con 0,6; comparar la composición y el cajetín.
6. Repetir a 390 px: alternar «Catálogo»/«Activas», cambiar variable y opacidad,
   y confirmar que no hay desbordamiento horizontal.
7. Ejecutar `npm run lint` y `npm run typecheck`.

## Límites de esta verificación

- Las consultas CBR no estuvieron disponibles en la sesión local; no se
  verificaron estadísticas, transacciones ni consultas Neon.
- Suelos se probó bajo el zoom mínimo; no se certifica disponibilidad de los
  servicios remotos CIREN/CONAF ni sus respuestas puntuales.
- No se modificaron API, ETL, datos públicos, credenciales ni dependencias.
- El compositor sigue limitado por el canvas vectorial compartido de Leaflet.
  No se añade reordenamiento manual ni nuevas capas.
