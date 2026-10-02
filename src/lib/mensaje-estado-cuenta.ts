import { lineasDatosPago } from '@/lib/empresa'

/** S/ 1,914.08: con separador de miles, como en el resto del sistema. */
const soles = (n: number) => `S/ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Un comprobante pendiente, tal como va en el mensaje. */
export interface PendienteMensaje {
  documento: string        // F002-00000014
  fecha: string            // 01/10/2026
  vence: string | null     // 31/10/2026
  dias_vencidos: number    // > 0 vencido, <= 0 por vencer
  total: number
  abonado: number
  saldo: number
}

/** Cuántos comprobantes se detallan en el mensaje; el resto, en el enlace. */
const TOPE_DETALLE = 20

/**
 * El mensaje del estado de cuenta, detallado.
 *
 * Daniel, 01/10: "así está el mensaje para los clientes, solo indica el monto
 * total, debería ser detallado". Ahora lista cada comprobante pendiente con su
 * fecha, vencimiento y saldo, separa lo vencido de lo por vencer y cierra con
 * las cuentas para pagar.
 */
export function mensajeEstadoCuenta(p: {
  clienteNombre: string
  saldo: number
  aFavor: number
  pendientes: PendienteMensaje[]
  reporteUrl: string
  hoy: string
}): string {
  if (p.saldo <= 0) {
    return [
      `Hola ${p.clienteNombre}, le compartimos su estado de cuenta con AGROCAR S.R.L. al ${p.hoy}.`,
      '✓ Cuenta al día — sin saldo pendiente.',
      ...(p.aFavor > 0.01 ? [`Tiene ${soles(p.aFavor)} a favor para su próxima compra.`] : []),
      '',
      `Detalle: ${p.reporteUrl}`,
      '',
      '¡Gracias por su confianza!',
      '— AGROCAR S.R.L.',
    ].join('\n')
  }

  const lineas = [
    `Hola ${p.clienteNombre}, le compartimos su estado de cuenta con AGROCAR S.R.L. al ${p.hoy}.`,
    '',
    `*Comprobantes pendientes (${p.pendientes.length}):*`,
  ]
  for (const d of p.pendientes.slice(0, TOPE_DETALLE)) {
    const estado = d.dias_vencidos > 0
      ? `vencido hace ${d.dias_vencidos} día${d.dias_vencidos === 1 ? '' : 's'}`
      : d.vence ? `vence ${d.vence}` : 'al contado'
    lineas.push(`• ${d.documento} del ${d.fecha} — saldo *${soles(d.saldo)}* (${estado})`)
    if (d.abonado > 0.01) {
      lineas.push(`   Total ${soles(d.total)} · abonado ${soles(d.abonado)}`)
    }
  }
  if (p.pendientes.length > TOPE_DETALLE) {
    lineas.push(`• … y ${p.pendientes.length - TOPE_DETALLE} más (ver el detalle completo en el enlace)`)
  }

  const vencido = p.pendientes.filter((d) => d.dias_vencidos > 0).reduce((a, d) => a + d.saldo, 0)
  const porVencer = p.saldo - vencido
  lineas.push('')
  lineas.push(`*Saldo total: ${soles(p.saldo)}*`)
  if (vencido > 0.01 && porVencer > 0.01) {
    lineas.push(`Vencido: ${soles(vencido)} · Por vencer: ${soles(porVencer)}`)
  }
  lineas.push('')
  lineas.push(`Detalle completo: ${p.reporteUrl}`)
  lineas.push('')
  lineas.push(...lineasDatosPago())
  lineas.push('')
  lineas.push('Si ya realizó su pago, por favor envíenos el comprobante. ¡Gracias!')
  lineas.push('— AGROCAR S.R.L.')
  return lineas.join('\n')
}
