# Estructura del Detalle Catastral — SII

> **Documento oficial del Servicio de Impuestos Internos.**
> 
> Especificación completa de la estructura de archivos del **Catastro de Bienes Raíces** (CBR Catastral)
> por comuna e histórico nacional. Fuente: `estructura_detalle_catastral.pdf` (raíz del proyecto).
>
> **⚠ Distinción importante:** Esto es DIFERENTE del **Conservador de Bienes Raíces** (CBR Conservador).
> El Conservador es donde viven nuestras **85k transacciones** (inscripciones de compraventa).
> Este documento describe la estructura catastral para CRUZAR y ENRIQUECER esos datos de transacciones.

## Resumen ejecutivo

El SII publica cuatro archivos de Detalle Catastral por comuna:

| Archivo | Registros | Propósito |
|---|---|---|
| **Roles agrícolas** | 1 por rol de avalúo | Información básica de predios agrícolas |
| **Suelos/construcciones agrícolas** | N por rol (tantos como líneas) | Desglose de suelos y construcciones |
| **Roles no agrícolas** | 1 por rol de avalúo | Información básica de predios urbanos/comerciales |
| **Terrenos/construcciones no agrícolas** | N por rol | Desglose de terrenos y construcciones |

Todos los archivos son **sin encabezados**, campos separados por tabulador `|`, codificados en UTF-8.

## 1. Serie Agrícola

### 1.1 Información Roles Agrícolas (BRORGA2441A_NAC, BRTMPCATASA_COMUNAS)

Un registro por rol de avalúo. Campos:

| # | Campo | Descripción |
|---|---|---|
| 1 | Código SII de la Comuna | 4 dígitos: 1101 = Arica, 6101 = Rancagua, etc. |
| 2 | Número de Manzana | Identificador de manzana catastral |
| 3 | Número de Predial | Identificador único del predio dentro de la manzana |
| 4 | Dirección o nombre del predio | Texto libre (ej. "Fundo Los Robles") |
| 5 | **Avalúo fiscal total** | CLP, el valor que el SII usa para contribuciones |
| 6 | Contribución semestral (con aseo) | CLP, impuesto semestral |
| 7 | **Código de destino principal** | Letra: A (agrícola), B (agroindustrial), etc. |
| 8 | Avalúo exento de la propiedad | CLP, avalúo de bienes exentos |
| 9 | Código de Ubicación | (ver tabla de Ubicación abajo) |

### 1.2 Información Suelos y Construcciones Agrícolas (BRORGA2441AL_NAC, BRTMPCATASAL_COMUNAS)

Varios registros por rol (uno por línea de suelo/construcción). Campos:

| # | Campo | Descripción |
|---|---|---|
| 1 | Código SII de la Comuna | (igual a roles) |
| 2 | Número de Manzana | |
| 3 | Número de Predial | |
| 4 | **Código de Suelo** | 1R–8: clase de riego/secano (ver tabla abajo) |
| 5 | **Superficie de Suelo** | Hectáreas, últimas 2 cifras son decimales |
| 6 | Número correlativo de la línea de construcción | Secuencial por rol |
| 7 | **Código del material estructural** | GA (acero), GB (hormigón armado), GC (albañilería), etc. |
| 8 | **Código de calidad** | 1 (superior)–5 (inferior) |
| 9 | **Superficie de la línea de construcción** | m², sin decimales |
| 10 | **Código de destino de la línea** | Letra: A, B, C, etc. (puede diferir del destino principal) |
| 11 | **Código de condición especial** | AL (altillo), CA (abierta), SB (subterráneo), etc. |
| 12 | Número de Pisos | |

## 2. Serie No Agrícola

### 2.1 Información Roles No Agrícolas (BRORGA2441N_NAC, BRTMPCATASN_COMUNAS)

Un registro por rol de avalúo. Campos:

| # | Campo | Descripción |
|---|---|---|
| 1 | Código SII de la Comuna | |
| 2 | Número de Manzana | |
| 3 | Número de Predial | |
| 4 | Dirección o nombre del predio | |
| 5 | **Avalúo fiscal total** | CLP |
| 6 | Contribución semestral (con aseo) | CLP |
| 7 | **Código de destino principal** | H (habitacional), C (comercio), I (industria), etc. |
| 8 | Avalúo exento de la propiedad | CLP |
| 9–11 | Código SII/Manzana/Predial del Rol Bien Común 1 | Cuando el predio tiene bienes comunes asociados |
| 12–14 | Código SII/Manzana/Predial del Rol Bien Común 2 | Cuando hay un segundo bien común |
| 15 | **Superficie total del terreno** | m², sin decimales (DATO CLAVE para $/m²) |
| 16 | Código de Ubicación | |
| 17–19 | Código SII/Manzana/Predial del Rol Padre | Para lotes que pertenecen a un rol padre |

### 2.2 Información Terrenos y Construcciones No Agrícolas (BRORGA2441NL_NAC, BRTMPCATASNL_COMUNAS)

Varios registros por rol. Campos:

| # | Campo | Descripción |
|---|---|---|
| 1 | Código SII de la Comuna | |
| 2 | Número de Manzana | |
| 3 | Número de Predial | |
| 4 | Número correlativo de la línea de construcción | Secuencial |
| 5 | **Código del material estructural** | GA, GB, GC, GE, etc. |
| 6 | **Código de calidad** | 1–5 |
| 7 | **Año de la línea de construcción** | AAAA (ej. 2005) |
| 8 | **Superficie de la línea de construcción** | m² o m³ según tipo, sin decimales |
| 9 | **Código de destino de la línea** | H, C, I, etc. |
| 10 | **Código de condición especial** | AL, CA, CI, MS, PZ, SB, TM |
| 11 | Número de Pisos | |

## 3. Tablas de Codificación

### 3.1 Tipos de Suelo (Serie Agrícola)

| Código | Descripción |
|---|---|
| 1R | Primera de riego |
| 2R | Segunda de riego |
| 3R | Tercera de riego |
| 1–4 | Clase secano arable (1=mejor, 4=peor) |
| 5–8 | Clase secano no arable (5–8) |

### 3.2 Códigos de Destino (Tabla Destinos)

**Interpretación clave para el mapa de calor:** Los códigos de destino clasifican el uso del suelo. En CBR usamos estos códigos para filtrar, porque el $/m² varía **261× entre destinos** (H vs A).

| Código | Destino | Código | Destino |
|---|---|---|---|
| **A** | Agrícola | **M** | Minería |
| **B** | Agroindustrial | **O** | Oficina |
| **C** | Comercio | **P** | Adm. Pública / Casa Patronal (agrícola) |
| **D** | Deporte y Recreación | **Q** | Culto |
| **E** | Educación y Cultura | **S** | Salud |
| **F** | Forestal | **T** | Transporte y Telecomunicaciones |
| **G** | Hotel, Motel | **V** | Otros no considerados |
| **H** | **Habitacional** (urbano) | **W** | Sitio Eriazo (terreno sin uso) |
| **I** | Industria | **Y** | Gallineros, chancheras y otros |
| **L** | Bodega y Almacenaje | **Z** | Estacionamiento |

**Nota para el mapa de calor:** El destino principal de un rol NO es necesariamente el destino de cada línea de construcción. Los mejores datos están en la tabla de líneas (NL para no agrícola, AL para agrícola).

### 3.3 Códigos de Material Estructural

Construcción = estructura (acero, hormigón, ladrillo, madera, adobe) + otros elementos (silos, estanques, marquesinas, etc.).

| Código | Material |
|---|---|
| GA, OA | Acero |
| GB, OB | Hormigón Armado |
| **GC** | **Albañilería** (ladrillo, piedra, bloque cemento/hormigón) |
| **GE, OE** | **Madera** |
| GL | Madera Laminada |
| **GF** | **Adobe** |
| SA, SB | Silos (acero / hormigón) |
| EA, EB | Estanques (acero / hormigón) |
| M | Marquesina |
| P | Pavimento |
| W | Piscina |
| TA, TE, TL | Techumbre Apoyada (acero / madera / laminada) |

**Para construcciones sin etiqueta de material, el código en el campo 5 puede ser:**

| Código | Material |
|---|---|
| A | Acero A en tubos y perfiles |
| B | Hormigón armado |
| **C** | **Albañilería de ladrillo, piedra, bloque** |
| E | Madera |
| F | Adobe |
| G | Perfiles metálicos |
| K | Estructura con elementos prefabricados |

### 3.4 Código de Calidad

| Código | Nivel |
|---|---|
| 1 | Superior |
| 2 | Media Superior |
| 3 | Media |
| 4 | Media Inferior |
| 5 | Inferior |

### 3.5 Condición Especial

| Código | Condición |
|---|---|
| AL | Altillo |
| CA | Construcción Abierta |
| CI | Construcción Interior |
| MS | Mansarda |
| PZ | Posi Zócalo |
| SB | Subterráneo |
| TM | Catástrofe 20/02/2010 |

### 3.6 Tabla de Comunas (Extracto)

Ver archivo completo en el PDF. Ejemplos clave para el SIG:

| Código | Comuna |
|---|---|
| 1101 | Arica |
| 2201 | Antofagasta |
| 3201 | Copiapó |
| 4101 | La Serena |
| 5301 | Valparaíso |
| 6101 | Rancagua |
| 7201 | Talca |
| 8101 | Chillán |
| 9201 | Temuco |
| 10301 | Puerto Montt |
| 13101 | Santiago |
| 16302 | Pirque |
| 16404 | Paine |

## 4. Implicaciones para el SIG

### 4.1 Para el Mapa de Calor de Valor ($/m²)

1. **Campo de referencia:** `superficieTerreno` en CBR viene del campo 15 (no agrícola) o del campo 5 (agrícola). Es el **único denominador válido** para $/m².

2. **Destino obligatorio:** El mapa de calor DEBE filtrar por destino único porque:
   - H (habitacional): mediana ~$349k/m²
   - A (agrícola): mediana ~$1.3k/m² (261× menor)
   - Otros destinos tienen curvas distintas

3. **Líneas vs. roles:** Cada rol puede tener VARIAS líneas de construcción con DISTINTOS destinos. El destino principal del rol NO es suficiente — hay que agregar por línea.

4. **Material y calidad:** Potencial para futuras capas temáticas (calidad constructiva, material dominante por zona, etc.).

5. **Diccionario de destinos en la UI (implementado 2026-08-28):** la tabla § 3.2 está transcrita en `DESTINO_SII_NAMES` (`src/lib/hexbins.ts`). Antes de tener este documento la interfaz mostraba la letra cruda (`Destino W`) con la mediana de superficie como desambiguador, porque la base en Neon guarda el código y no hay tabla de lookup. Ahora el selector, la leyenda, el popup de celda y el cajetín del PNG exportado rotulan con el nombre oficial y dejan el código entre paréntesis (`Sitio Eriazo (W)`), que es como aparece en un certificado de avalúo. Se cargaron los 20 códigos de la tabla, no solo los 11 presentes hoy en la base.

### 4.2 Para Catastro Frutícola y otras capas temáticas

La estructura de líneas de construcción permite:
- Identificar especie/uso específico de cada línea (campo destino)
- Cruzar con Catastro Frutícola por ROL + comuna
- Detectar cambios de destino (predios con múltiples usos)

### 4.3 Para mejoras futuras

1. **Catastro completo:** Cargar ambas series (agrícola + no agrícola) para cobertura nacional 100%.
2. **Filtros por calidad/material:** Layer temática de construcción residencial superior vs. media vs. inferior.
3. **Análisis de subdivisión:** Rol padre vs. rol hijo (campo 17-19 en no agrícola) para detectar fraccionamientos.
4. **Año de construcción:** Campo 7 en NL permite análisis temporal de construcción.

## 5. Referencias

- **Formato:** Tab-separated values (TSV), sin encabezados
- **Enumeración:** Uno o más registros por rol según serie y tipo
- **Ubicación oficial:** Descargables por comuna desde el sitio del SII
- **Actualización:** Cambios catastrales se reflejan periódicamente (frecuencia depende del SII)

---

**Nota de mantenimiento:** Este documento traduce la especificación oficial `estructura_detalle_catastral.pdf`. Mantenlo sincronizado si el SII publica una nueva versión del documento.
