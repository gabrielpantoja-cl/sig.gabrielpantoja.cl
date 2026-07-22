# Configuración para este repositorio

- ¿Has leido [AGENTS.md](../AGENTS.md) y [CONTRIBUTING.md](../CONTRIBUTING.md)?
- Si este PR agrega una capa nueva, ¿seguiste la receta de
  [docs/arquitectura-capas.md](../docs/arquitectura-capas.md) § "Receta"?
  Checklist:
  - [ ] Fuente oficial elegida (no espejo)
  - [ ] ETL en `scripts/build-<capa>.mjs`
  - [ ] `public/data/<capa>.geojson` + `public/data/<capa>.meta.json`
  - [ ] `src/lib/<capa>.ts` con types + estilo + attribution string
  - [ ] Toggle en `LayersControl.tsx`
  - [ ] Carga en `MapView.tsx`
  - [ ] Mencionado en `docs/arquitectura-capas.md` y en el catálogo del
        README

## Tipo de cambio

- [ ] Bug fix (cambio que arregla un problema sin romper funcionalidad)
- [ ] Nueva funcionalidad (cambio que agrega capacidad sin romper nada)
- [ ] Cambio incompatible (cambio que rompe compatibilidad con el deploy actual)
- [ ] Documentación
- [ ] Refactor / chore (sin cambio funcional)

## ¿Qué cambia y por qué?

<!-- Descripción técnica clara. Si el cambio toca PII, endpoint, capa o
configuración de seguridad, marcalo explícitamente abajo. -->

## ¿Cómo se prueba?

- [ ] `npm run lint` corre limpio localmente
- [ ] Probado en `localhost:3000` con `npm run dev`
- Capturas / GIF / link a un deploy preview si aplica

## Privacidad y datos (obligatorio si el PR toca `/api/` o DB)

- [ ] Ninguna columna PII (`comprador, vendedor, rut, user_id,
      observaciones`) se expone ni se loggea
- [ ] El endpoint nuevo pasa por `enforce()` (origin allowlist + rate
      limit) en `src/lib/security.ts`
- [ ] Si el PR expone una columna nueva de la tabla `referenciales`, se
      justificó en el issue / discusión previa

## Checklist adicional

- [ ] Mi código usa `;` al final de cada statement
- [ ] No agregué `NEXT_PUBLIC_` para credenciales ni otro secreto
- [ ] Actualicé `docs/arquitectura-capas.md` y/o `docs/roadmap.md` si aplica
- [ ] Si agregué una dependencia, justifiqué por qué y revisé que no tenga
      CVEs已知
- [ ] El commit no incluye `.env.local`, screenshots de la raíz, ni
      secretos de Bitwarden