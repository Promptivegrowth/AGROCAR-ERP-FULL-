/**
 * Helpers para enviar mensajes via WhatsApp deep link (wa.me).
 * No requiere API de WhatsApp — abre la app del usuario con el mensaje prellenado.
 */

/**
 * Valida que un teléfono sea celular peruano válido: 9 dígitos empezando por 9.
 * Acepta formatos con espacios/guiones pero normaliza a solo dígitos.
 */
export function normalizarTelefonoPeruano(input: string | null | undefined): string | null {
  if (!input) return null
  const soloDigitos = String(input).replace(/\D/g, '')
  // Si viene con código de país 51, quitarlo
  const sinCodPais = soloDigitos.startsWith('51') && soloDigitos.length === 11
    ? soloDigitos.slice(2)
    : soloDigitos
  if (/^9\d{8}$/.test(sinCodPais)) return sinCodPais
  return null
}

export function esTelefonoPeruanoValido(input: string | null | undefined): boolean {
  return normalizarTelefonoPeruano(input) !== null
}

/**
 * Construye un link wa.me con número e51 + mensaje pre-llenado.
 */
export function construirLinkWhatsapp(telefono: string, mensaje: string): string | null {
  const tel = normalizarTelefonoPeruano(telefono)
  if (!tel) return null
  const texto = encodeURIComponent(mensaje)
  return `https://wa.me/51${tel}?text=${texto}`
}

/**
 * Link para enviar una boleta de pago al cliente.
 * `baseUrl` debe incluir el protocolo (ej. https://agrocar-erp-full.vercel.app).
 *
 * Si se pasan aplicaciones, el mensaje incluye el detalle de facturas
 * pagadas con su código y monto aplicado.
 */
export function linkEnviarBoletaPago(params: {
  baseUrl: string
  cobroId: string
  clienteNombre: string
  total: number
  telefonoCliente: string
  numeroCobro?: string | null
  aplicaciones?: Array<{ codigo: string; monto: number }>
  saldoRestante?: number | null
}): string | null {
  const moneda = 'S/'
  const lineas: string[] = [
    `Hola ${params.clienteNombre}, gracias por tu pago.`,
    `Monto total: ${moneda} ${params.total.toFixed(2)}`,
  ]
  if (params.numeroCobro) {
    lineas.push(`Recibo: ${params.numeroCobro}`)
  }
  if (params.aplicaciones && params.aplicaciones.length > 0) {
    lineas.push('')
    lineas.push('Aplicado a:')
    for (const a of params.aplicaciones) {
      lineas.push(`• ${a.codigo}: ${moneda} ${a.monto.toFixed(2)}`)
    }
  }
  if (typeof params.saldoRestante === 'number' && params.saldoRestante > 0.001) {
    lineas.push('')
    lineas.push(`Saldo pendiente: ${moneda} ${params.saldoRestante.toFixed(2)}`)
  } else if (typeof params.saldoRestante === 'number' && params.saldoRestante <= 0.001) {
    lineas.push('')
    lineas.push('✅ Cuenta saldada — gracias!')
  }
  lineas.push('')
  lineas.push(`Boleta digital: ${params.baseUrl}/boleta/${params.cobroId}`)
  lineas.push('')
  lineas.push('— AGROCAR S.R.L.')
  return construirLinkWhatsapp(params.telefonoCliente, lineas.join('\n'))
}
