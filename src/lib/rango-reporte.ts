/**
 * Rango desde-hasta de los reportes de cuotas (Daniel, 06/11/2026: alcance de
 * objetivos y cumplimiento de cuotas con fecha desde-hasta). Acepta los enlaces
 * viejos con ?anio=&mes= (el mes completo) y por defecto toma el mes en curso
 * hasta hoy.
 */
import { hoyLima } from '@/lib/fechas-pe'

const dos = (n: number) => String(n).padStart(2, '0')

export function rangoMes(anio: number, mes: number): { desde: string; hasta: string } {
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return { desde: `${anio}-${dos(mes)}-01`, hasta: `${anio}-${dos(mes)}-${dos(ultimo)}` }
}

export function rangoInicial(params: URLSearchParams | null): { desde: string; hasta: string } {
  const desde = params?.get('desde'), hasta = params?.get('hasta')
  if (desde && hasta) return { desde, hasta }
  const anio = parseInt(params?.get('anio') ?? ''), mes = parseInt(params?.get('mes') ?? '')
  if (anio && mes >= 1 && mes <= 12) return rangoMes(anio, mes)
  const hoy = hoyLima()
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
}

/** Atajos: este mes (hasta hoy) y el mes anterior completo. */
export function atajosRango(): { etiqueta: string; desde: string; hasta: string }[] {
  const hoy = hoyLima()
  const [a, m] = hoy.split('-').map(Number)
  const ant = m === 1 ? rangoMes(a - 1, 12) : rangoMes(a, m - 1)
  return [
    { etiqueta: 'Este mes', desde: `${hoy.slice(0, 7)}-01`, hasta: hoy },
    { etiqueta: 'Mes anterior', ...ant },
  ]
}

export const fechaCorta = (iso: string) => iso.split('-').reverse().join('/')
