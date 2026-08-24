/**
 * Líneas de transmisión eléctrica — IDE Energía, Ministerio de Energía.
 *
 * Las geometrías son ejes cartográficos referenciales proporcionados
 * principalmente por el Coordinador Eléctrico Nacional. No representan el
 * ancho ni la extensión jurídica de servidumbres eléctricas.
 */

export interface LineaTransmisionProps {
  NOMBRE: string | null;
  TRAMO: string | null;
  CIRCUITO: string | null;
  TIPO: string | null;
  F_OPERACIO: string | null;
  LONG_KM: number | null;
  PROPIEDAD: string | null;
  TENSION_KV: number | null;
  RCA: string | null;
  SIST_ELECT: string | null;
  ESTADO: string | null;
  FUENTE_BAS: string | null;
  FECH_ACT: string | null;
}

export type TensionGroup = 'kv500' | 'kv220' | 'kv110' | 'kv66' | 'menor66' | 'sinDato';

export const TENSION_GROUPS: Record<
  TensionGroup,
  { label: string; color: string; weight: number }
> = {
  kv500: { label: '500 kV o más', color: '#7f1d1d', weight: 3 },
  kv220: { label: '220–499 kV', color: '#dc2626', weight: 2.6 },
  kv110: { label: '110–219 kV', color: '#f97316', weight: 2.1 },
  kv66: { label: '66–109 kV', color: '#eab308', weight: 1.7 },
  menor66: { label: 'Menos de 66 kV', color: '#84cc16', weight: 1.3 },
  sinDato: { label: 'Tensión no informada', color: '#64748b', weight: 1.2 },
};

export function tensionGroup(value: number | null | undefined): TensionGroup {
  const tension = Number(value);
  if (!Number.isFinite(tension) || tension <= 0) return 'sinDato';
  if (tension >= 500) return 'kv500';
  if (tension >= 220) return 'kv220';
  if (tension >= 110) return 'kv110';
  if (tension >= 66) return 'kv66';
  return 'menor66';
}

export const LINEAS_TRANSMISION_COLOR = TENSION_GROUPS.kv220.color;

export const LINEAS_TRANSMISION_ATTRIBUTION =
  'Fuente: Ministerio de Energía · IDE Energía · información espacial proporcionada por el Coordinador Eléctrico Nacional';

export const LINEAS_TRANSMISION_SOURCE_URL =
  'https://ide-energia.minenergia.cl/server/rest/services/IDE_Energia/Visor_IDE_Energ%C3%ADa/MapServer/10';

export const LINEAS_TRANSMISION_DISCLAIMER =
  'Ejes cartográficos referenciales: no representan fajas de seguridad, servidumbres eléctricas ni gravámenes prediales.';
