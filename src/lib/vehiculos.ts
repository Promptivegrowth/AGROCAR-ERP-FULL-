// Helpers para el módulo de vehículos: mantenimientos, multas, conductores.

export type EstadoVencimiento = 'vigente' | 'por_vencer' | 'vencido' | 'sin_fecha'

/**
 * Calcula el estado de vencimiento de un documento/mantenimiento.
 * - sin_fecha:   fecha null/undefined o vacía.
 * - vencido:     fecha < hoy.
 * - por_vencer:  hoy <= fecha <= hoy + 15 días.
 * - vigente:     fecha > hoy + 15 días.
 */
export function calcularEstadoVencimiento(
  fecha: string | null | undefined
): EstadoVencimiento {
  if (!fecha) return 'sin_fecha'
  const f = new Date(fecha + 'T00:00:00')
  if (isNaN(f.getTime())) return 'sin_fecha'

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const diffMs = f.getTime() - hoy.getTime()
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDias < 0) return 'vencido'
  if (diffDias <= 15) return 'por_vencer'
  return 'vigente'
}

export const ESTADO_VENCIMIENTO_CONFIG: Record<
  EstadoVencimiento,
  { label: string; className: string }
> = {
  vigente: {
    label: 'Vigente',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  por_vencer: {
    label: 'Por vencer',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  vencido: {
    label: 'Vencido',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
  sin_fecha: {
    label: 'Sin fecha',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
}

export const TIPO_MANT_LABELS: Record<string, string> = {
  soat: 'SOAT',
  revision_tecnica: 'Revisión Técnica',
  cambio_aceite: 'Cambio de Aceite',
  cambio_filtro: 'Cambio de Filtro',
  cambio_llantas: 'Cambio de Llantas',
  mantenimiento_general: 'Mantenimiento General',
  reparacion: 'Reparación',
  otro: 'Otro',
}

export const TIPO_MANT_OPCIONES: { value: string; label: string }[] = Object.entries(
  TIPO_MANT_LABELS
).map(([value, label]) => ({ value, label }))

export const CLASE_LICENCIA_OPCIONES: string[] = [
  'A-I',
  'A-IIa',
  'A-IIb',
  'A-IIIa',
  'A-IIIb',
  'A-IIIc',
  'B-I',
  'B-IIa',
  'B-IIb',
  'B-IIc',
]

export const ESTADO_ALERTA_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  vigente: 'Vigente',
  vencido: 'Vencido',
  cumplido: 'Cumplido',
}

export const ESTADO_MULTA_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  pagada: 'Pagada',
  apelada: 'Apelada',
  anulada: 'Anulada',
}

export const ESTADO_MULTA_CONFIG: Record<string, { label: string; className: string }> = {
  pendiente: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  pagada: { label: 'Pagada', className: 'bg-green-100 text-green-700 border-green-200' },
  apelada: { label: 'Apelada', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  anulada: { label: 'Anulada', className: 'bg-gray-100 text-gray-600 border-gray-200' },
}
