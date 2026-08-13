import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import DespachoClient from './despacho-client'
import type { PedidoListo, VehiculoDisponible } from './lib/types'
import { Activity, Package } from 'lucide-react'

export const dynamic = 'force-dynamic'

async function getInitialData() {
  const supabase = await createClient()

  const [{ data: pedidosRaw }, { data: vehiculosRaw }, { data: vcRaw }, { data: confRaw }, { data: flotaRaw }, { data: plantillasRaw }] = await Promise.all([
    (supabase as any)
      .from('pedidos')
      .select(`
        id, numero, total, cliente_id, vendedor_id,
        direccion_entrega_id, direccion_entrega_texto,
        clientes!inner(id, razon_social, ruc, dni, tipo_comprobante_preferido, direccion, telefono, latitud, longitud, zona_id, distrito, zonas(id, nombre)),
        cliente_direcciones!pedidos_direccion_entrega_id_fkey(id, nombre, direccion, latitud, longitud, zona_id, zonas(id, nombre)),
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
    (supabase as any)
      .from('vehiculos_zonas_habituales')
      .select('vehiculo_id, zona_id, dias_semana'),
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
    // Si el pedido tiene una dirección de entrega específica (sucursal),
    // usar sus coordenadas en lugar de las del cliente principal.
    const dirEntrega = p.cliente_direcciones ?? null
    const direccionFinal = dirEntrega?.direccion ?? p.direccion_entrega_texto ?? cli.direccion ?? null
    const latFinal = dirEntrega?.latitud ?? cli.latitud
    const lngFinal = dirEntrega?.longitud ?? cli.longitud
    const zonaIdFinal = dirEntrega?.zona_id ?? cli.zona_id ?? null
    const zonaNombreFinal = dirEntrega?.zonas?.nombre ?? cli.zonas?.nombre ?? null
    return {
      id: p.id,
      numero: p.numero,
      cliente_id: p.cliente_id,
      cliente_nombre: cli.razon_social ?? '—',
      cliente_ruc: cli.ruc ?? null,
      cliente_dni: cli.dni ?? null,
      cliente_tipo_comprobante: cli.tipo_comprobante_preferido ?? null,
      cliente_direccion: direccionFinal,
      cliente_telefono: cli.telefono ?? null,
      cliente_lat: latFinal != null ? Number(latFinal) : null,
      cliente_lng: lngFinal != null ? Number(lngFinal) : null,
      zona_id: zonaIdFinal,
      zona_nombre: zonaNombreFinal,
      distrito: cli.distrito ?? null,
      vendedor_id: p.vendedor_id,
      vendedor_nombre: p.profiles?.full_name ?? null,
      total: Number(p.total ?? 0),
      peso_kg: Number(peso.toFixed(3)),
      items_count: items.length,
      tiene_productos_sin_peso: sinPeso,
    } as PedidoListo
  })

  // Quiénes pueden salir a repartir: el despacho se les asigna para que el
  // reparto del día les aparezca en el celular.
  const { data: repartidoresRaw } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('role', ['repartidor', 'chofer'])
    .eq('activo', true)
    .order('full_name')
  const repartidores = (repartidoresRaw ?? []).map((r: any) => ({
    id: r.id, nombre: r.full_name || r.email,
  }))

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

  // Plantillas del día actual (zona → vehiculo)
  // Día de la semana en Lima (UTC-5): los servidores corren en UTC, hay que ajustar.
  const ahoraLima = new Date(Date.now() - 5 * 60 * 60 * 1000)
  const diaSemanaMap = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
  const diaActual = diaSemanaMap[ahoraLima.getUTCDay()]
  // Mapa: zona_id -> vehiculo_id (primer match gana; si una zona está en dos plantillas el mismo día, se queda con el primero)
  const plantillaDelDia: Record<string, string> = {}
  ;(plantillasRaw ?? []).forEach((p: any) => {
    const dias: string[] = p.dias_semana ?? []
    if (dias.includes(diaActual) && !plantillaDelDia[p.zona_id]) {
      plantillaDelDia[p.zona_id] = p.vehiculo_id
    }
  })

  return { pedidos, vehiculos, almacen, flota, plantillaDelDia, diaActual, repartidores }
}

export default async function DespachoPage() {
  const { pedidos, vehiculos, almacen, flota, plantillaDelDia, diaActual, repartidores } = await getInitialData()
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
      <DespachoClient
        pedidosIniciales={pedidos}
        vehiculos={vehiculos}
        almacen={almacen}
        plantillaDelDia={plantillaDelDia}
        diaActual={diaActual}
        repartidores={repartidores}
      />
    </div>
  )
}
