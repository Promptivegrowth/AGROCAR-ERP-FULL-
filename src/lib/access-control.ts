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
