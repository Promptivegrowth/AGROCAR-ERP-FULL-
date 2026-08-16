/**
 * Matriz de acceso por rol.
 * Define a qué rutas base puede entrar cada rol del ERP/PWA.
 *
 * Reglas:
 * - gerente / administrador: TODO (ERP completo)
 * - facturador: Dashboard, Pedidos, Facturación, Maestros (solo lectura desde UI)
 * - almacenero: Dashboard, Almacén, Compras, Ajustes, Despacho, Maestros (productos)
 * - contador: Dashboard, Caja, Cobranzas, Contabilidad, Reportes
 * - caja: Dashboard, Caja, Cobranzas, Facturación (cajero-facturador)
 * - vendedor / repartidor / chofer: SOLO PWA — si entran al ERP se les redirige a su home PWA
 */

export type UserRole =
  | 'gerente' | 'administrador' | 'facturador' | 'almacenero'
  | 'contador' | 'vendedor' | 'repartidor' | 'chofer' | 'caja'

export const ROLE_HOME: Record<UserRole, string> = {
  gerente: '/dashboard',
  administrador: '/dashboard',
  facturador: '/facturacion',
  almacenero: '/almacen',
  contador: '/caja',
  caja: '/caja',
  vendedor: '/pwa/pedidos',
  repartidor: '/pwa/cobros',
  chofer: '/pwa/cobros',
}

// Prefijos permitidos por rol en el ERP. Si no aparece, el rol no entra.
const ERP_ACCESS: Record<UserRole, string[] | '*'> = {
  gerente: '*',
  administrador: '*',
  facturador: [
    '/dashboard',
    '/pedidos',
    '/facturacion',
    '/solicitudes-cliente',
    '/maestros/clientes',
    '/maestros/productos',
    '/maestros/familias',
    '/maestros/proveedores',
    '/maestros/zonas',
    '/configuracion',
  ],
  almacenero: [
    '/dashboard',
    '/almacen',
    '/despacho',
    '/maestros/productos',
    '/maestros/familias',
    '/maestros/proveedores',
    '/maestros/vehiculos',
    '/configuracion',
  ],
  contador: [
    '/dashboard',
    '/caja',
    '/caja-chica',
    '/cobranzas',
    '/contabilidad',
    '/planillas',
    '/reportes',
    '/facturacion',
    '/vendedores',
    '/configuracion',
    // La contadora pidió gestionar anexos: crear clientes, proveedores y
    // terceros desde contabilidad (reunión 1). RLS controla qué puede escribir.
    '/maestros/clientes',
    '/maestros/proveedores',
    '/maestros/terceros',
    // Reportes contables de inventario (kardex valorizado y compras)
    '/almacen/valorizado',
    '/almacen/compras',
  ],
  caja: [
    '/dashboard',
    '/caja',
    '/caja-chica',
    '/cobranzas',
    '/facturacion',
    '/configuracion',
  ],
  vendedor: [],
  repartidor: [],
  chofer: [],
}

/**
 * Rutas del PWA permitidas por rol (reunión con Daniel):
 *
 * - vendedor: "solamente sus cuotas mensuales, sus clientes y sus cobranzas...
 *   tenemos vendedores que se van y vienen y no quisiera que vea todo el
 *   movimiento que hay dentro".
 * - repartidor / chofer: "las ventas del día, deben tener opción para hacer
 *   cobranza y la venta directa tienen que tener acceso ellos". No manejan
 *   cuota ni zona propia ni check-in de visitas, así que esas quedan fuera.
 */
const PWA_ACCESS: Record<string, string[]> = {
  vendedor: [
    '/pwa/mi-zona',
    '/pwa/pedidos',
    '/pwa/clientes',
    '/pwa/cobros',
    '/pwa/checkin',
    '/pwa/mis-cuotas',
    '/pwa/mis-cobranzas',
    '/pwa/mi-reporte',
    '/pwa/deposito',       // depositar al banco sin cargar efectivo
    '/pwa/cuenta',
  ],
  // Daniel, 02/08: "el repartidor SOLO tiene que tener acceso al reparto del
  // día, venta directa, cobranza, activar cliente y condición de venta".
  //
  // Ese "solo" es sobre no ver el movimiento de los demás ni el del negocio
  // —"no quisiera que vea todo el movimiento que hay dentro"—, no sobre
  // quitarle sus propias herramientas. En la misma reunión pidió que el
  // repartidor rinda la venta del día y que el personal deposite en el banco
  // para no cargar efectivo, así que su reporte, sus cobranzas pendientes y
  // sus depósitos se quedan: los tres muestran únicamente lo suyo.
  //
  // Fuera quedan las herramientas de la ruta programada del vendedor (zona
  // propia y check-in de visitas), las cuotas —el repartidor no tiene meta
  // asignada— y todo el ERP.
  repartidor: [
    '/pwa/reparto',        // lo que le toca entregar hoy
    '/pwa/pedidos',        // venta directa, con condición contado o crédito
    '/pwa/clientes',       // buscar y activar al cliente al que le va a vender
    '/pwa/cobros',         // cobranza del día
    // NO lleva /pwa/mis-cobranzas. Daniel lo revisó pantalla por pantalla:
    // "mis cuentas por cobrar por cliente con deuda, eso hay que sacarlo; el
    // repartidor no va a cobrar [deudas], eso solamente sería del vendedor".
    // El repartidor cobra lo que vende en el día, no persigue deuda antigua.
    '/pwa/mi-reporte',     // su rendición del día
    '/pwa/deposito',       // depositar sin cargar el efectivo de vuelta
    '/pwa/cuenta',         // su perfil y cerrar sesión
  ],
}
PWA_ACCESS.chofer = PWA_ACCESS.repartidor // Daniel: el chofer trabaja igual que el repartidor

export function canAccessPwaPath(role: string, pathname: string): boolean {
  const permitidas = PWA_ACCESS[role]
  // Roles del ERP que entren al PWA se manejan aparte (el middleware los saca)
  if (!permitidas) return true
  return permitidas.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function pwaPathsForRole(role: string): string[] {
  return PWA_ACCESS[role] ?? []
}

export function canAccessErpPath(role: string, pathname: string): boolean {
  const r = role as UserRole
  const access = ERP_ACCESS[r]
  if (access === '*') return true
  if (!access || access.length === 0) return false
  // Permitir /maestros index
  if (pathname === '/maestros' && access.some((p) => p.startsWith('/maestros'))) return true
  return access.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function homeForRole(role: string): string {
  return ROLE_HOME[(role as UserRole)] ?? '/dashboard'
}

export function isPwaRole(role: string): boolean {
  return role === 'vendedor' || role === 'repartidor' || role === 'chofer'
}
