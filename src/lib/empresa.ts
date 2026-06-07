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
  correo: 'info@agrocarsrl.com',
  rubro: 'Distribuidor de Línea de Frío',
}

/**
 * Nombre de la clase CSS para la tipografía del slogan
 * (variable CSS configurada en src/app/layout.tsx con Great Vibes).
 * Usar style={{ fontFamily: 'var(--font-slogan), cursive' }} en lugares
 * con estilos inline (comprobantes en server components).
 */
export const SLOGAN_FONT_STACK = 'var(--font-slogan), "Great Vibes", "Allura", "Brush Script MT", cursive'
