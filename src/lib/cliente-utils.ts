import type { TipoComprobante } from '@/types/database'

/**
 * Regla SUNAT (2026): un cliente con RUC puede recibir factura;
 * un cliente solo con DNI solo puede recibir boleta. El prefijo del RUC
 * (10/15/17/20) NO es determinante.
 * Fuente: https://orientacion.sunat.gob.pe/02-factura
 */
export function tipoComprobanteSugerido(
  cliente: { ruc?: string | null; dni?: string | null },
): Extract<TipoComprobante, 'factura' | 'boleta'> {
  return cliente.ruc && cliente.ruc.trim() !== '' ? 'factura' : 'boleta'
}

export function puedeEmitirFactura(cliente: { ruc?: string | null }): boolean {
  return !!cliente.ruc && cliente.ruc.trim() !== ''
}

/**
 * Identificador de negocio del cliente (reemplaza al antiguo `codigo`).
 * Devuelve RUC si existe, si no DNI. Nunca ambos.
 */
export function getIdentificador(cliente: { ruc?: string | null; dni?: string | null }): string {
  if (cliente.ruc && cliente.ruc.trim() !== '') return cliente.ruc
  if (cliente.dni && cliente.dni.trim() !== '') return cliente.dni
  return ''
}

/**
 * Label con prefijo ("RUC 20xxxxx" / "DNI 12345678") para mostrar en UI.
 */
export function getIdentificadorLabel(cliente: { ruc?: string | null; dni?: string | null }): string {
  if (cliente.ruc && cliente.ruc.trim() !== '') return `RUC ${cliente.ruc}`
  if (cliente.dni && cliente.dni.trim() !== '') return `DNI ${cliente.dni}`
  return 'Sin documento'
}

export function serieDeTipoComprobante(tipo: TipoComprobante): string {
  if (tipo === 'factura') return 'F001'
  if (tipo === 'boleta') return 'B001'
  return 'NP01'
}

/**
 * Valida RUC peruano: 11 dígitos numéricos, primer dígito 1 o 2.
 */
export function esRucValido(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false
  const pref = ruc.slice(0, 2)
  return ['10', '15', '17', '20'].includes(pref)
}

export function esDniValido(dni: string): boolean {
  return /^\d{8}$/.test(dni)
}
