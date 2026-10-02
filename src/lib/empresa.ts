/**
 * Datos oficiales de la empresa. Se usan en todos los comprobantes,
 * hojas de ruta, recibos y reportes impresos para mantener consistencia.
 *
 * Mantener este archivo como única fuente de verdad — al cambiar algún
 * dato aquí, se actualiza en TODOS los documentos.
 */

export const EMPRESA = {
  razon_social: 'AGROCAR S.R.L.',
  ruc: '20519883296',
  slogan: 'Pasión hecha a mano',
  direccion_comercial: 'CALLE EMILIO FORERO 553-A · PARA GRANDE · TACNA',
  direccion_fundo: 'FUNDO PARA GRANDE · PARCELA 31 SUB.LT.1 · TACNA',
  telefono: '952901119',
  correo: 'Administracion@agrocar.com.pe',
  rubro: 'Distribuidor de Línea de Frío',
}

/**
 * Dónde paga el cliente. Daniel, 01/10: "para poder enviar los saldos
 * pendientes de cobranza … mi cuenta corriente BCP y mi número de Yape;
 * inclúyelos en todos los canales que corresponda". Se usan en los mensajes
 * de WhatsApp y correo (lineasDatosPago) y en los impresos (DatosDePago).
 * Si cambia una cuenta, se cambia acá y nada más.
 */
export const EMPRESA_PAGO = {
  titular: 'AGROCAR S.R.L.',
  banco: 'BCP',
  tipo_cuenta: 'Cuenta corriente en soles',
  cuenta: '540-2109937-0-38',
  cci: '00254000210993703835',
  yape: '952901119',
}

/** Los datos de pago como líneas de texto, para WhatsApp y correo. */
export function lineasDatosPago(): string[] {
  return [
    'Para su pago:',
    `• ${EMPRESA_PAGO.banco} ${EMPRESA_PAGO.tipo_cuenta}: ${EMPRESA_PAGO.cuenta}`,
    `• CCI: ${EMPRESA_PAGO.cci}`,
    `• Yape: ${EMPRESA_PAGO.yape}`,
    `Titular: ${EMPRESA_PAGO.titular}`,
  ]
}

/**
 * Nombre de la clase CSS para la tipografía del slogan
 * (variable CSS configurada en src/app/layout.tsx con Great Vibes).
 * Usar style={{ fontFamily: 'var(--font-slogan), cursive' }} en lugares
 * con estilos inline (comprobantes en server components).
 */
export const SLOGAN_FONT_STACK = 'var(--font-slogan), "Great Vibes", "Allura", "Brush Script MT", cursive'
