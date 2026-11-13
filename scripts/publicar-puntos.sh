#!/usr/bin/env bash
# publicar-puntos.sh — publica el conjunto de /api/points como archivo estático.
#
# Pensado para correr justo después de restaurar la copia diaria del respaldo,
# contra esa copia local (nunca contra una base en línea: el objetivo es que la
# carga del mapa sin filtros no gaste cuota de transferencia de ninguna base).
#
#   PUNTOS_PSQL   comando psql que llega a la copia, p. ej.
#                 "docker exec -i <contenedor> psql -U postgres -d postgres"
#   PUNTOS_DEST   destino rclone del bucket PÚBLICO de puntos, p. ej. "remoto:bucket/sig"
#                 (un bucket solo para esto; nunca el de los respaldos)
#   PUNTOS_MIN    opcional: mínimo de filas aceptable (por defecto 90 % del
#                 manifiesto vigente) — una copia rota no reemplaza a la buena
#
# Publica, en este orden:
#   1. points-<token>.json.gz  inmutable (Cache-Control 1 año, immutable)
#   2. manifest.json           cuál es el vigente (Cache-Control 5 min)
# El nombre lleva el token del conjunto: un archivo nunca cambia de contenido,
# así que una versión nunca se mezcla con otra y un deploy no vacía nada.
#
# Requiere: bash, gzip, rclone y el psql de PUNTOS_PSQL. Sin jq ni Node.
set -euo pipefail

: "${PUNTOS_PSQL:?falta PUNTOS_PSQL}"
: "${PUNTOS_DEST:?falta PUNTOS_DEST}"

DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

psql_file() { $PUNTOS_PSQL -X -q < "$1"; }

token="$(psql_file "$DIR/db/token-puntos.sql" | tr -d '[:space:]')"
if ! [[ "$token" =~ ^[0-9]+\.[0-9]+$ ]]; then
  echo "token inválido: '$token'" >&2
  exit 1
fi
filas="${token%%.*}"

# Guarda contra una copia rota: no publicar si trae muchas menos filas que el
# manifiesto vigente (mismo criterio que la restauración diaria).
if [[ -z "${PUNTOS_MIN:-}" ]]; then
  previo="$(rclone cat "$PUNTOS_DEST/manifest.json" 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p' || true)"
  PUNTOS_MIN=$(( ${previo:-0} * 9 / 10 ))
fi
if (( filas < PUNTOS_MIN )); then
  echo "la copia trae $filas filas, menos que el mínimo $PUNTOS_MIN: no se publica" >&2
  exit 2
fi

archivo="points-$token.json.gz"
if rclone lsf "$PUNTOS_DEST/$archivo" 2>/dev/null | grep -q .; then
  echo "ya publicado: $archivo (sin cambios en el conjunto)"
else
  psql_file "$DIR/db/exportar-puntos.sql" > "$TMP/points.json"
  bytes="$(wc -c < "$TMP/points.json" | tr -d '[:space:]')"
  # Sanidad mínima: un arreglo JSON, no vacío, del tamaño esperable.
  primer="$(head -c 1 "$TMP/points.json")"
  if [[ "$primer" != "[" ]] || (( bytes < filas * 50 )); then
    echo "exportación inesperada ($bytes bytes para $filas filas)" >&2
    exit 1
  fi
  gzip -9 -n -c "$TMP/points.json" > "$TMP/$archivo"
  rclone copyto "$TMP/$archivo" "$PUNTOS_DEST/$archivo" \
    --header-upload "Content-Type: application/json" \
    --header-upload "Content-Encoding: gzip" \
    --header-upload "Cache-Control: public, max-age=31536000, immutable"
  echo "publicado: $archivo ($bytes bytes sin comprimir, $(wc -c < "$TMP/$archivo") gzip)"
fi

if [[ -z "${bytes:-}" ]]; then
  bytes="$(rclone cat "$PUNTOS_DEST/manifest.json" 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p' || true)"
  bytes="${bytes:-0}"
fi

# El manifiesto va al final: si algo falló antes, sigue apuntando al anterior.
printf '{"version":1,"token":"%s","count":%s,"file":"%s","bytes":%s,"generatedAt":"%s"}\n' \
  "$token" "$filas" "$archivo" "$bytes" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP/manifest.json"
rclone copyto "$TMP/manifest.json" "$PUNTOS_DEST/manifest.json" \
  --header-upload "Content-Type: application/json" \
  --header-upload "Cache-Control: public, max-age=300"
echo "manifest.json → $archivo"

# Limpieza: versiones de más de 14 días, nunca la vigente (el primer filtro
# que calza gana en rclone, así que el --exclude va antes).
rclone delete "$PUNTOS_DEST" --exclude "$archivo" --include "points-*.json.gz" --min-age 14d
