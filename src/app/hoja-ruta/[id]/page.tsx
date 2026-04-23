import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import HojaRutaActions from './hoja-ruta-actions'
import HojaRutaMapa from './hoja-ruta-mapa'

export const dynamic = 'force-dynamic'

async function getData(id: string) {
  const supabase = await createClient()

  const [{ data: despacho }, { data: confRaw }] = await Promise.all([
    (supabase as any)
      .from('despachos')
      .select(`
        id, numero, fecha_despacho, estado, total_pedidos, total_monto, peso_total_kg,
        orden_entrega, hoja_ruta_emitida_at, notas,
        vehiculos(id, placa, descripcion, tipo, capacidad_kg),
        profiles!despachos_conductor_id_fkey(id, full_name, telefono)
      `)
      .eq('id', id)
      .maybeSingle(),
    (supabase as any)
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['almacen_nombre', 'almacen_direccion', 'almacen_lat', 'almacen_lng', 'empresa_razon_social', 'empresa_ruc', 'empresa_direccion']),
  ])

  if (!despacho) return null

  const conf: Record<string, string> = {}
  ;(confRaw ?? []).forEach((c: any) => { conf[c.clave] = c.valor })

  // Traer items del despacho + pedido + cliente
  const { data: items } = await (supabase as any)
    .from('despachos_items')
    .select(`
      id, pedido_id, estado, notas_entrega,
      pedidos(
        id, numero, total, notas,
        clientes(id, razon_social, ruc, dni, tipo_comprobante_preferido, direccion, telefono, latitud, longitud, zonas(nombre), distrito),
        profiles!pedidos_vendedor_id_fkey(id, full_name),
        pedidos_items(cantidad, productos(codigo, nombre, peso_kg, unidades_medida(simbolo)))
      )
    `)
    .eq('despacho_id', id)

  // Ordenar items según orden_entrega
  const ordenMap = new Map<string, number>()
  ;(despacho.orden_entrega ?? []).forEach((o: any) => ordenMap.set(o.pedido_id, o.secuencia))
  const distMap = new Map<string, { distancia_km: number; distancia_acumulada_km: number }>()
  ;(despacho.orden_entrega ?? []).forEach((o: any) =>
    distMap.set(o.pedido_id, {
      distancia_km: o.distancia_km,
      distancia_acumulada_km: o.distancia_acumulada_km,
    }),
  )

  const paradas = (items ?? [])
    .map((it: any) => {
      const ped = it.pedido
      return {
        item_id: it.id,
        pedido_id: it.pedido_id,
        estado: it.estado,
        numero: it.pedidos?.numero ?? '—',
        cliente: it.pedidos?.clientes?.razon_social ?? '—',
        ruc: it.pedidos?.clientes?.ruc ?? null,
        dni: it.pedidos?.clientes?.dni ?? null,
        tipo_comprobante: it.pedidos?.clientes?.tipo_comprobante_preferido ?? null,
        direccion: it.pedidos?.clientes?.direccion ?? '—',
        zona: it.pedidos?.clientes?.zonas?.nombre ?? null,
        distrito: it.pedidos?.clientes?.distrito ?? null,
        telefono: it.pedidos?.clientes?.telefono ?? null,
        lat: it.pedidos?.clientes?.latitud ?? null,
        lng: it.pedidos?.clientes?.longitud ?? null,
        vendedor: it.pedidos?.profiles?.full_name ?? null,
        total: Number(it.pedidos?.total ?? 0),
        peso_kg: (it.pedidos?.pedidos_items ?? []).reduce(
          (acc: number, x: any) => acc + Number(x.productos?.peso_kg ?? 0) * Number(x.cantidad ?? 0),
          0,
        ),
        items: (it.pedidos?.pedidos_items ?? []).map((x: any) => ({
          cantidad: Number(x.cantidad),
          simbolo: x.productos?.unidades_medida?.simbolo ?? '',
          nombre: x.productos?.nombre ?? '—',
          codigo: x.productos?.codigo ?? '',
        })),
        secuencia: ordenMap.get(it.pedido_id) ?? 999,
        distancia_km: distMap.get(it.pedido_id)?.distancia_km ?? 0,
        distancia_acumulada_km: distMap.get(it.pedido_id)?.distancia_acumulada_km ?? 0,
      }
    })
    .sort((a: any, b: any) => a.secuencia - b.secuencia)

  return {
    despacho,
    almacen: {
      nombre: conf.almacen_nombre ?? 'AGROCAR',
      direccion: conf.almacen_direccion ?? '',
      lat: Number(conf.almacen_lat ?? '-18.01465'),
      lng: Number(conf.almacen_lng ?? '-70.25362'),
    },
    empresa: {
      razon_social: conf.empresa_razon_social ?? 'AGROCAR S.R.L.',
      ruc: conf.empresa_ruc ?? '20519883296',
      direccion: conf.empresa_direccion ?? '',
    },
    paradas,
  }
}

export default async function HojaRutaPage({ params }: { params: { id: string } }) {
  const data = await getData(params.id)
  if (!data) return notFound()

  const { despacho, almacen, empresa, paradas } = data
  const v = despacho.vehiculos as any
  const conductor = despacho.profiles as any
  const distanciaTotal = paradas.reduce((a: number, p: any) => a + (p.distancia_km ?? 0), 0)
  const pctCapacidad = v?.capacidad_kg ? (Number(despacho.peso_total_kg) / Number(v.capacidad_kg)) * 100 : 0
  const fecha = new Date(despacho.fecha_despacho).toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' })

  const mapaCoords: [number, number][] = [[almacen.lat, almacen.lng]]
  paradas.forEach((p: any) => {
    if (p.lat != null && p.lng != null) mapaCoords.push([Number(p.lat), Number(p.lng)])
  })
  mapaCoords.push([almacen.lat, almacen.lng])

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .page-break-inside-avoid { page-break-inside: avoid; }
          .parada-card { page-break-inside: avoid; }
        }
      `}</style>

      {/* Acciones (no se imprimen) */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-gray-900">Hoja de Ruta {despacho.numero}</h1>
            <p className="text-xs text-gray-500">Vista previa antes de imprimir</p>
          </div>
          <HojaRutaActions telefono={conductor?.telefono ?? null} numero={despacho.numero} />
        </div>
      </div>

      {/* Hoja imprimible */}
      <div className="max-w-4xl mx-auto bg-white p-8 print:p-0 print:shadow-none shadow-sm my-4 print:my-0">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b-2 border-gray-900">
          <div className="flex items-start gap-3">
            <Image src="/logo-agrocar.png" alt="AGROCAR" width={56} height={56} className="object-contain" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">{empresa.razon_social}</h1>
              <p className="text-xs text-gray-600 font-mono">RUC {empresa.ruc}</p>
              {empresa.direccion && <p className="text-xs text-gray-500">{empresa.direccion}</p>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Hoja de Ruta</div>
            <div className="text-2xl font-bold text-gray-900 font-mono">{despacho.numero}</div>
            <div className="text-xs text-gray-600 mt-0.5">{fecha}</div>
          </div>
        </div>

        {/* Resumen vehiculo / conductor */}
        <div className="grid grid-cols-3 gap-4 mt-4 page-break-inside-avoid">
          <div className="col-span-1 border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Vehículo</p>
            <p className="text-2xl font-bold text-gray-900 font-mono">{v?.placa ?? '—'}</p>
            <p className="text-xs text-gray-600">{v?.descripcion ?? ''}</p>
            <div className="mt-2 text-[11px] text-gray-600">
              <div>Capacidad: <span className="font-mono font-semibold">{v?.capacidad_kg ?? 0} kg</span></div>
              <div>Carga real: <span className="font-mono font-semibold">{Number(despacho.peso_total_kg).toFixed(1)} kg ({Math.round(pctCapacidad)}%)</span></div>
            </div>
          </div>
          <div className="col-span-1 border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Conductor</p>
            <p className="font-semibold text-gray-900">{conductor?.full_name ?? 'Por asignar'}</p>
            {conductor?.telefono && <p className="text-xs text-gray-600">📞 {conductor.telefono}</p>}
            <p className="text-[11px] text-gray-500 mt-2">Origen: <span className="font-medium">{almacen.nombre}</span></p>
          </div>
          <div className="col-span-1 border border-gray-200 rounded-lg p-3 bg-gray-50">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Resumen</p>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <div>Paradas:</div><div className="text-right font-semibold">{despacho.total_pedidos}</div>
              <div>Peso total:</div><div className="text-right font-semibold font-mono">{Number(despacho.peso_total_kg).toFixed(1)} kg</div>
              <div>Distancia:</div><div className="text-right font-semibold font-mono">{distanciaTotal.toFixed(1)} km</div>
              <div className="col-span-2 mt-1 pt-1 border-t border-gray-300">
                <div className="flex justify-between">
                  <span>A cobrar:</span>
                  <span className="font-bold text-green-700">S/ {Number(despacho.total_monto).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mini-mapa */}
        <div className="mt-4 page-break-inside-avoid">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Mapa de ruta</p>
          <HojaRutaMapa
            almacen={{ lat: almacen.lat, lng: almacen.lng, nombre: almacen.nombre }}
            paradas={paradas.map((p: any) => ({ secuencia: p.secuencia, cliente: p.cliente, lat: p.lat, lng: p.lng, direccion: p.direccion }))}
          />
        </div>

        {/* Paradas en detalle */}
        <div className="mt-6">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3 pb-1 border-b border-gray-200">
            Orden de Entrega (optimizado por cercanía)
          </p>
          <div className="space-y-3">
            {paradas.map((p: any) => (
              <div key={p.item_id} className="parada-card border border-gray-200 rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-gray-900 text-white rounded-full flex items-center justify-center font-bold text-lg">
                    {p.secuencia}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 uppercase tracking-wide">{p.cliente}</p>
                        <p className="text-[11px] text-gray-600 font-mono">
                          {p.ruc ? `RUC ${p.ruc}` : p.dni ? `DNI ${p.dni}` : 'Sin doc.'}
                          {p.vendedor && <> · Vendedor: <span className="font-semibold">{p.vendedor}</span></>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-gray-500 uppercase">Pedido</div>
                        <div className="font-mono text-sm font-semibold">{p.numero}</div>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-12 gap-2 text-xs">
                      <div className="col-span-7">
                        <div className="text-gray-600">
                          📍 {p.zona && <span className="font-semibold">{p.zona} · </span>}{p.direccion}
                        </div>
                        {p.telefono && <div className="text-gray-600 mt-0.5">📞 {p.telefono}</div>}
                      </div>
                      <div className="col-span-5 text-right space-y-0.5">
                        <div>
                          <span className="text-gray-500">Peso:</span>{' '}
                          <span className="font-mono font-semibold">{p.peso_kg.toFixed(1)} kg</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Total:</span>{' '}
                          <span className="font-bold text-green-700">S/ {p.total.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                            p.tipo_comprobante === 'factura'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-gray-50 text-gray-700 border-gray-200'
                          }`}>
                            {p.tipo_comprobante === 'factura' ? 'FACTURA' : 'BOLETA'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Productos compactos */}
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-[10px] uppercase text-gray-500 mb-0.5">Productos</p>
                      <div className="text-[11px] text-gray-700 leading-snug">
                        {p.items.map((x: any, i: number) => (
                          <span key={i}>
                            <span className="font-semibold">{x.cantidad}{x.simbolo}</span> {x.nombre}
                            {i < p.items.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Checkbox firma */}
                    <div className="mt-2 pt-2 border-t border-dashed border-gray-200 grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-2 text-[10px] text-gray-500">
                        {p.distancia_km > 0 && <>~{p.distancia_km.toFixed(1)} km</>}
                      </div>
                      <div className="col-span-6 flex items-center gap-2">
                        <div className="w-4 h-4 border border-gray-400 rounded-sm" />
                        <span className="text-[10px] text-gray-500">Entregado</span>
                        <div className="w-4 h-4 border border-gray-400 rounded-sm ml-3" />
                        <span className="text-[10px] text-gray-500">Rechazado</span>
                      </div>
                      <div className="col-span-4 border-b border-gray-300 h-6 text-[9px] text-gray-400 text-right">
                        firma / sello
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Firmas */}
        <div className="mt-8 grid grid-cols-2 gap-12 page-break-inside-avoid">
          <div className="text-center">
            <div className="border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-700">Firma del conductor</p>
              <p className="text-[10px] text-gray-500">{conductor?.full_name ?? ''}</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-700">Firma del repartidor</p>
              <p className="text-[10px] text-gray-500">Cierre de ruta</p>
            </div>
          </div>
        </div>

        <p className="text-center text-[10px] text-gray-400 mt-6">
          Documento generado {new Date().toLocaleString('es-PE')} · AGROCAR ERP
        </p>
      </div>
    </div>
  )
}
