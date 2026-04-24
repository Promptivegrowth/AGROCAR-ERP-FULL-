import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import DespachoClient from './despacho-client'
import type { PedidoListo, VehiculoDisponible } from './lib/types'
import { Activity, Package } from 'lucide-react'

export const dynamic = 'force-dynamic'

async function getInitialData() {
  const supabase = await createClient()

  const [{ data: pedidosRaw }, { data: vehiculosRaw }, { data: vcRaw }, { data: confRaw }, { data: flotaRaw }] = await Promise.all([
    (supabase as any)
      .from('pedidos')
      .select(`
        id, numero, total, cliente_id, vendedor_id,
        clientes!inner(id, razon_social, ruc, dni, tipo_comprobante_preferido, direccion, telefono, latitud, longitud, zona_id, distrito, zonas(id, nombre)),
        profiles!pedidos_vendedor_id_fkey(id, full_name),
        pedidos_items(id, cantidad, productos(peso_kg))
      `)
      .eq('estado', 'facturado')
      .order('created_at', { ascending: true }),
    supabase
      .from('vehiculos')
      .select('id, placa, descripcion, tipo, capacidad_kg, activo')
      .eq('activo', true)
      .order('placa'),
    (supabase as any)
      .from('vehiculos_conductores')
      .select('vehiculo_id, es_principal, conductores(id, nombre_completo)')
      .eq('es_principal', true),
    (supabase as any)
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['almacen_nombre', 'almacen_lat', 'almacen_lng', 'almacen_direccion']),
    (supabase as any)
      .from('v_flota_en_vivo')
      .select('id, placa, numero, estado, pedidos_entregados, total_pedidos')
      .in('estado', ['en_ruta', 'preparacion']),
  ])

  const vcByVehiculo: Record<string, { id: string; nombre: string }> = {}
  ;(vcRaw ?? []).forEach((r: any) => {
    if (r.conductores) {
      vcByVehiculo[r.vehiculo_id] = { id: r.conductores.id, nombre: r.conductores.nombre_completo }
    }
  })

  const pedidos: PedidoListo[] = (pedidosRaw ?? []).map((p: any) => {
    const items = p.pedidos_items ?? []
    let peso = 0
    let sinPeso = false
    for (const it of items) {
      const pk = Number(it.productos?.peso_kg ?? 0)
      if (pk === 0) sinPeso = true
      peso += pk * Number(it.cantidad ?? 0)
    }
    const cli = p.clientes ?? {}
    return {
      id: p.id,
      numero: p.numero,
      cliente_id: p.cliente_id,
      cliente_nombre: cli.razon_social ?? '—',
      cliente_ruc: cli.ruc ?? null,
      cliente_dni: cli.dni ?? null,
      cliente_tipo_comprobante: cli.tipo_comprobante_preferido ?? null,
      cliente_direccion: cli.direccion ?? null,
      cliente_telefono: cli.telefono ?? null,
      cliente_lat: cli.latitud != null ? Number(cli.latitud) : null,
      cliente_lng: cli.longitud != null ? Number(cli.longitud) : null,
      zona_id: cli.zona_id ?? null,
      zona_nombre: cli.zonas?.nombre ?? null,
      distrito: cli.distrito ?? null,
      vendedor_id: p.vendedor_id,
      vendedor_nombre: p.profiles?.full_name ?? null,
      total: Number(p.total ?? 0),
      peso_kg: Number(peso.toFixed(3)),
      items_count: items.length,
      tiene_productos_sin_peso: sinPeso,
    } as PedidoListo
  })

  const vehiculos: VehiculoDisponible[] = (vehiculosRaw ?? []).map((v: any) => ({
    id: v.id,
    placa: v.placa,
    descripcion: v.descripcion,
    tipo: v.tipo,
    capacidad_kg: Number(v.capacidad_kg ?? 500),
    conductor_id: vcByVehiculo[v.id]?.id ?? null,
    conductor_nombre: vcByVehiculo[v.id]?.nombre ?? null,
  }))

  const conf: Record<string, string> = {}
  ;(confRaw ?? []).forEach((c: any) => { conf[c.clave] = c.valor })
  const almacen = {
    nombre: conf.almacen_nombre ?? 'AGROCAR - Almacén Central',
    direccion: conf.almacen_direccion ?? '',
    lat: Number(conf.almacen_lat ?? '-18.01465'),
    lng: Number(conf.almacen_lng ?? '-70.25362'),
  }

  const flota = {
    enRuta: (flotaRaw ?? []).filter((f: any) => f.estado === 'en_ruta'),
    enPreparacion: (flotaRaw ?? []).filter((f: any) => f.estado === 'preparacion'),
  }

  return { pedidos, vehiculos, almacen, flota }
}

export default async function DespachoPage() {
  const { pedidos, vehiculos, almacen, flota } = await getInitialData()
  const total = flota.enRuta.length + flota.enPreparacion.length
  return (
    <div className="space-y-3">
      {total > 0 && (
        <Link
          href="/despacho/historial"
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 transition-colors ${
            flota.enRuta.length > 0
              ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
              : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
          }`}
        >
          <div className="flex items-center gap-3">
            {flota.enRuta.length > 0 ? (
              <Activity className="w-5 h-5 text-blue-600 animate-pulse" />
            ) : (
              <Package className="w-5 h-5 text-amber-600" />
            )}
            <div>
              {flota.enRuta.length > 0 && (
                <p className="text-sm font-semibold text-blue-900">
                  🚛 {flota.enRuta.length} {flota.enRuta.length === 1 ? 'vehículo' : 'vehículos'} en ruta ahora
                </p>
              )}
              {flota.enPreparacion.length > 0 && (
                <p className="text-xs text-amber-800">
                  {flota.enPreparacion.length} {flota.enPreparacion.length === 1 ? 'despacho listo' : 'despachos listos'} para salir
                </p>
              )}
            </div>
          </div>
          <span className="text-xs font-medium text-gray-700">Ver flota →</span>
        </Link>
      )}
      <DespachoClient pedidosIniciales={pedidos} vehiculos={vehiculos} almacen={almacen} />
    </div>
  )
}
