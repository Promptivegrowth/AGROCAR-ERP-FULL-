import { createClient } from '@/lib/supabase/server'
import PedidosClient from './pedidos-client'

export const dynamic = 'force-dynamic'

async function getPedidosData() {
  const supabase = await createClient()

  const { data: pedidos } = await supabase
    .from('pedidos')
    .select(`
      id, numero, cliente_id, vendedor_id, fecha_pedido, fecha_despacho,
      estado, subtotal, total, descuento_porcentaje, descuento_monto,
      requiere_autorizacion, notas, created_at,
      clientes(id, razon_social, ruc, dni, direccion, telefono, zonas(nombre)),
      profiles!pedidos_vendedor_id_fkey(id, full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  return { pedidos: pedidos ?? [] }
}

export default async function PedidosPage() {
  const { pedidos } = await getPedidosData()
  return <PedidosClient pedidosIniciales={pedidos as any[]} />
}
