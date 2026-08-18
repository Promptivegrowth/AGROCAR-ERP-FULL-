'use client'

import { useRouter, usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

/**
 * Botón de volver global del ERP.
 *
 * Daniel: "aunque sea una flechita para regresar… en todas las opciones que
 * entramos". Vive en el marco y no en cada pantalla, así aparece en las más de
 * treinta sin tener que tocarlas una por una y sin que se olvide en las nuevas.
 *
 * No se muestra en las pantallas raíz de cada módulo (donde no hay a dónde
 * volver) ni al imprimir. Si la pantalla ya trae su propia flecha, esta queda
 * arriba del contenido y no estorba.
 */

// Pantallas reales del ERP. Sirve para que "Volver" caiga siempre en una que
// exista: las de detalle cuelgan de segmentos que NO son páginas
// (/reportes/cliente/<id> vive bajo /reportes/cliente, que no se puede abrir).
// Sale del árbol de rutas; al agregar un módulo nuevo, se agrega acá.
const PANTALLAS = new Set([
  '/almacen',
  '/almacen/ajustes',
  '/almacen/compras',
  '/almacen/lotes',
  '/almacen/movimientos-dia',
  '/almacen/notas-credito',
  '/almacen/valorizado',
  '/caja',
  '/caja-chica',
  '/cobranzas',
  '/configuracion',
  '/configuracion/centros-costo',
  '/configuracion/comisiones',
  '/configuracion/series',
  '/configuracion/tipo-cambio',
  '/contabilidad',
  '/contabilidad/activos-fijos',
  '/contabilidad/automaticos',
  '/contabilidad/balance',
  '/contabilidad/centros-costo',
  '/contabilidad/conciliacion',
  '/contabilidad/cuentas',
  '/contabilidad/declaraciones-juradas',
  '/contabilidad/diario',
  '/contabilidad/estado-resultados',
  '/contabilidad/estados-financieros',
  '/contabilidad/mayor',
  '/contabilidad/mayor-auxiliar',
  '/contabilidad/periodos',
  '/contabilidad/ple',
  '/contabilidad/sire',
  '/dashboard',
  '/despacho',
  '/despacho/historial',
  '/facturacion',
  '/gps',
  '/maestros',
  '/maestros/clientes',
  '/maestros/conductores',
  '/maestros/familias',
  '/maestros/productos',
  '/maestros/proveedores',
  '/maestros/terceros',
  '/maestros/tipos-cliente',
  '/maestros/vehiculos',
  '/maestros/zonas',
  '/pedidos',
  '/planillas',
  '/planillas/asistencia',
  '/planillas/beneficios',
  '/planillas/calculo',
  '/planillas/conceptos',
  '/planillas/parametros',
  '/planillas/trabajadores',
  '/reportes',
  '/reportes/alcance-objetivos',
  '/reportes/catalogo',
  '/reportes/cuentas-por-cobrar',
  '/reportes/cumplimiento-cuotas',
  '/reportes/rendicion-diaria',
  '/reportes/ventas-productos',
  '/solicitudes-cliente',
  '/vendedores',
  '/vendedores/cuotas',
  '/vendedores/cuotas/productos',
])

// Pantallas de primer nivel: son destino del menú lateral, no tienen "atrás"
const RAICES = new Set([
  '/dashboard', '/pedidos', '/despacho', '/facturacion', '/caja', '/caja-chica',
  '/cobranzas', '/gps', '/vendedores', '/reportes', '/contabilidad',
  '/planillas', '/almacen', '/maestros', '/configuracion', '/solicitudes-cliente',
])

export default function BotonVolver() {
  const router = useRouter()
  const pathname = usePathname()

  if (!pathname || RAICES.has(pathname)) return null

  /**
   * A dónde ir cuando no hay historial al que volver.
   *
   * Subir un nivel a secas daba 404 en las pantallas de detalle: desde
   * /reportes/cliente/<id> mandaba a /reportes/cliente, que no es una página
   * —el segmento existe solo para colgar el [id]—. Pasaba en ocho pantallas:
   * los reportes de cliente, persona y cobranzas, el mayor auxiliar y la boleta
   * de planilla.
   *
   * Ahora solo se sube un nivel cuando ese nivel es una pantalla de verdad; si
   * no, se cae al módulo, que siempre existe.
   */
  const partes = pathname.split('/').filter(Boolean)
  let padre = '/' + (partes[0] ?? 'dashboard')
  for (let corte = partes.length - 1; corte > 0; corte--) {
    const candidato = '/' + partes.slice(0, corte).join('/')
    if (PANTALLAS.has(candidato) || RAICES.has(candidato)) { padre = candidato; break }
  }

  return (
    <div className="print:hidden mb-3">
      <button
        type="button"
        onClick={() => {
          // history.back() respeta de dónde vino, pero solo si la página
          // anterior es de la propia aplicación: si el usuario llegó pegando la
          // URL o desde fuera, volver lo sacaría del sistema.
          const mismoOrigen =
            document.referrer && document.referrer.startsWith(window.location.origin)
          if (mismoOrigen && window.history.length > 1) router.back()
          else router.push(padre)
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:text-gray-900 shadow-sm"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Volver
      </button>
    </div>
  )
}
