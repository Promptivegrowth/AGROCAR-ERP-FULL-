export type DiaSemana = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom'

export const DIAS: { key: DiaSemana; label: string; short: string }[] = [
  { key: 'lun', label: 'Lunes', short: 'L' },
  { key: 'mar', label: 'Martes', short: 'M' },
  { key: 'mie', label: 'Miércoles', short: 'M' },
  { key: 'jue', label: 'Jueves', short: 'J' },
  { key: 'vie', label: 'Viernes', short: 'V' },
  { key: 'sab', label: 'Sábado', short: 'S' },
  { key: 'dom', label: 'Domingo', short: 'D' },
]

const JS_DAY_TO_KEY: DiaSemana[] = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

export function diaHoy(): DiaSemana {
  return JS_DAY_TO_KEY[new Date().getDay()]
}

export function clienteVisitaHoy(diasVisita: string[] | null | undefined): boolean {
  if (!diasVisita || diasVisita.length === 0) return false
  return diasVisita.includes(diaHoy())
}

/** Atajos comunes de programación */
export const ATAJOS_DIAS: Record<string, DiaSemana[]> = {
  'L-V': ['lun', 'mar', 'mie', 'jue', 'vie'],
  'L-S': ['lun', 'mar', 'mie', 'jue', 'vie', 'sab'],
  Todos: ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'],
}

/** Etiqueta legible: "L M V" o "Todos los días" */
export function labelDias(dias: string[] | null | undefined): string {
  if (!dias || dias.length === 0) return 'Sin programar'
  if (dias.length === 7) return 'Todos los días'
  if (dias.length === 6 && !dias.includes('dom')) return 'Lun–Sáb'
  if (dias.length === 5 && dias.every((d) => ATAJOS_DIAS['L-V'].includes(d as DiaSemana))) return 'Lun–Vie'
  return DIAS.filter((d) => dias.includes(d.key)).map((d) => d.short).join(' ')
}
