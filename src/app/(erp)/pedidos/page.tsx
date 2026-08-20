import { createClient } from '@/lib/supabase/server'
import { hoyLima } from '@/lib/fechas-pe'
import PedidosClient from './pedidos-client'

export const dynamic = 'force-dynamic'

/**
 * Pedidos del día, no el histórico entero.
 *
 * Daniel: "cuando ingreso al sistema sigue cargando pedidos pasados, pero esos
 * pedidos ya fueron despachados". La pantalla traía los últimos 200 sin filtrar
 * por fecha, así que al tercer día ya se mezclaban los del 18, 19 y 20 y había
 * que ir separándolos a ojo. Con el ritmo actual —entre 27 y 57 pedidos
 * diarios— en un mes el tope de 200 habría empezado a esconder pedidos.
 *
 * Ahora abre en el día de hoy y el rango se cambia desde la cabecera.
 */
async function getPedidosData(desde: string, hasta: string) {
  const supabase = await createClient()

  const { data: pedidos } = await supabase
    .from('pedidos')
    .select(`
      id, numero, cliente_id, vendedor_id, fecha_pedido, fecha_despacho,
      estado, subtotal, total, descuento_porcentaje, descuento_monto,
      requiere_autorizacion, notas, created_at,
      solicitud_mayorista, lista_precio_aplicada,
      clientes(id, razon_social, ruc, dni, tipo_comprobante_preferido, direccion, telefono, zonas(nombre)),
      profiles!pedidos_vendedor_id_fkey(id, full_name)
    `)
    .gte('fecha_pedido', desde)
    .lte('fecha_pedido', hasta)
    .order('created_at', { ascending: false })
    .limit(500)

  return { pedidos: pedidos ?? [] }
}

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: { desde?: string; hasta?: string }
}) {
  const hoy = hoyLima()
  const desde = searchParams?.desde || hoy
  const hasta = searchParams?.hasta || hoy
  const { pedidos } = await getPedidosData(desde, hasta)
  return <PedidosClient pedidosIniciales={pedidos as any[]} desde={desde} hasta={hasta} />
}
