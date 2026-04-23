'use client'

import { useMemo, useState } from 'react'
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sparkles, Package, Warehouse, History, Search, Truck as TruckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import LeafletMap, { type MapMarker, type MapPolyline } from '@/components/maps/leaflet-map'
import PedidoCard from './components/pedido-card'
import VehiculoCard from './components/vehiculo-card'
import PedidoDetalleModal from './components/pedido-detalle-modal'
import { ordenarPorCercania, agruparPorZona, colorDeString, distanciaKm } from './lib/geo-utils'
import type { PedidoListo, VehiculoDisponible, AsignacionState, OrdenEntrega } from './lib/types'

type Props = {
  pedidosIniciales: PedidoListo[]
  vehiculos: VehiculoDisponible[]
  almacen: { nombre: string; direccion: string; lat: number; lng: number }
}

export default function DespachoClient({ pedidosIniciales, vehiculos, almacen }: Props) {
  const supabase = createClient()
  const router = useRouter()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  )

  const [pedidos] = useState<PedidoListo[]>(pedidosIniciales)
  const [asignacion, setAsignacion] = useState<AsignacionState>({ porVehiculo: {} })
  const [activePedidoId, setActivePedidoId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [detalleOpen, setDetalleOpen] = useState(false)
  const [pedidoDetalle, setPedidoDetalle] = useState<PedidoListo | null>(null)
  const [consolidandoVehiculo, setConsolidandoVehiculo] = useState<string | null>(null)
  const [vehiculoFocus, setVehiculoFocus] = useState<string | null>(null)

  const pedidosById = useMemo(() => {
    const m = new Map<string, PedidoListo>()
    pedidos.forEach((p) => m.set(p.id, p))
    return m
  }, [pedidos])

  // Pedidos aún no asignados a ningún vehículo
  const asignados = useMemo(() => new Set(Object.values(asignacion.porVehiculo).flat()), [asignacion])
  const pedidosSinAsignar = useMemo(
    () =>
      pedidos
        .filter((p) => !asignados.has(p.id))
        .filter((p) => {
          if (!search.trim()) return true
          const q = search.toLowerCase()
          return (
            p.cliente_nombre.toLowerCase().includes(q) ||
            p.numero.toLowerCase().includes(q) ||
            (p.cliente_ruc ?? '').includes(q) ||
            (p.cliente_dni ?? '').includes(q) ||
            (p.zona_nombre ?? '').toLowerCase().includes(q)
          )
        }),
    [pedidos, asignados, search],
  )

  // Polyline de ruta del vehículo en foco
  const polylines: MapPolyline[] = useMemo(() => {
    if (!vehiculoFocus) return []
    const pedidosVeh = (asignacion.porVehiculo[vehiculoFocus] ?? [])
      .map((id) => pedidosById.get(id))
      .filter(Boolean) as PedidoListo[]
    const paradas = ordenarPorCercania(
      pedidosVeh.map((p) => ({ id: p.id, lat: p.cliente_lat, lng: p.cliente_lng })),
      { lat: almacen.lat, lng: almacen.lng },
    )
    const coords: [number, number][] = [[almacen.lat, almacen.lng]]
    paradas.forEach((par) => {
      if (par.item.lat != null && par.item.lng != null) {
        coords.push([par.item.lat as number, par.item.lng as number])
      }
    })
    // cierra la ruta volviendo al almacén (opcional, visualización)
    coords.push([almacen.lat, almacen.lng])
    if (coords.length < 2) return []
    return [{ id: 'ruta', positions: coords, color: colorDeString(vehiculoFocus), dashed: false }]
  }, [vehiculoFocus, asignacion, pedidosById, almacen])

  // Marcadores del mapa
  const markers: MapMarker[] = useMemo(() => {
    const base: MapMarker[] = [
      {
        id: 'almacen',
        lat: almacen.lat,
        lng: almacen.lng,
        label: almacen.nombre,
        description: almacen.direccion || 'Punto de partida',
        initials: '🏬',
        color: '#0A0A0A',
      },
    ]

    if (vehiculoFocus) {
      // mostrar ruta optimizada del vehículo en foco
      const pedidosVeh = (asignacion.porVehiculo[vehiculoFocus] ?? [])
        .map((id) => pedidosById.get(id))
        .filter(Boolean) as PedidoListo[]
      const paradas = ordenarPorCercania(
        pedidosVeh.map((p) => ({ id: p.id, lat: p.cliente_lat, lng: p.cliente_lng, _p: p })),
        { lat: almacen.lat, lng: almacen.lng },
      )
      const color = colorDeString(vehiculoFocus)
      paradas.forEach((par) => {
        if (par.item.lat == null || par.item.lng == null) return
        base.push({
          id: par.item.id,
          lat: par.item.lat,
          lng: par.item.lng,
          label: (par.item as any)._p.cliente_nombre,
          description: `${par.secuencia}. ${(par.item as any)._p.cliente_direccion ?? ''}`,
          initials: String(par.secuencia),
          color,
        })
      })
    } else {
      // mostrar todos los pedidos pendientes
      pedidos.forEach((p) => {
        if (p.cliente_lat == null || p.cliente_lng == null) return
        base.push({
          id: p.id,
          lat: p.cliente_lat,
          lng: p.cliente_lng,
          label: p.cliente_nombre,
          description: p.cliente_direccion ?? '',
          color: asignados.has(p.id) ? '#9ca3af' : '#2563eb',
        })
      })
    }

    return base
  }, [pedidos, vehiculoFocus, asignacion, pedidosById, almacen, asignados])

  // ──────────────────────────────────────────────────────────────────────
  // DnD handlers
  // ──────────────────────────────────────────────────────────────────────
  function handleDragStart(e: DragStartEvent) {
    setActivePedidoId(String(e.active.id))
  }

  function handleDragEnd(e: DragEndEvent) {
    setActivePedidoId(null)
    if (!e.over) return
    const pedidoId = String(e.active.id)
    const overId = String(e.over.id)
    if (!overId.startsWith('vehiculo-')) return
    const vehiculoId = overId.slice('vehiculo-'.length)

    const pedido = pedidosById.get(pedidoId)
    if (!pedido) return
    const vehiculo = vehiculos.find((v) => v.id === vehiculoId)
    if (!vehiculo) return

    // Validar capacidad ANTES de mover
    const actualesIds = asignacion.porVehiculo[vehiculoId] ?? []
    const pesoActual = actualesIds.reduce((acc, id) => acc + (pedidosById.get(id)?.peso_kg ?? 0), 0)
    if (pesoActual + pedido.peso_kg > vehiculo.capacidad_kg) {
      toast.error('No cabe en el vehículo', {
        description: `${vehiculo.placa} quedaría con ${(pesoActual + pedido.peso_kg).toFixed(1)} kg (capacidad ${vehiculo.capacidad_kg} kg).`,
      })
      return
    }
    if (pedido.tiene_productos_sin_peso) {
      toast.warning('Pedido con productos sin peso', {
        description: 'Algunos productos no tienen peso configurado. La capacidad puede no ser exacta.',
      })
    }

    // Quitar de otros vehículos y agregar al destino
    setAsignacion((prev) => {
      const nuevo: Record<string, string[]> = {}
      for (const [vid, ids] of Object.entries(prev.porVehiculo)) {
        nuevo[vid] = ids.filter((id) => id !== pedidoId)
      }
      nuevo[vehiculoId] = [...(nuevo[vehiculoId] ?? []), pedidoId]
      return { porVehiculo: nuevo }
    })
  }

  function removerPedido(vehiculoId: string, pedidoId: string) {
    setAsignacion((prev) => ({
      porVehiculo: {
        ...prev.porVehiculo,
        [vehiculoId]: (prev.porVehiculo[vehiculoId] ?? []).filter((id) => id !== pedidoId),
      },
    }))
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sugerir asignación automática (por zona, respetando capacidad)
  // ──────────────────────────────────────────────────────────────────────
  function sugerirAsignacion() {
    if (vehiculos.length === 0) {
      toast.error('No hay vehículos activos.')
      return
    }
    const porVehiculo: Record<string, string[]> = {}
    vehiculos.forEach((v) => { porVehiculo[v.id] = [] })

    // Agrupa por zona, ordena grupos por # de pedidos descendente
    const grupos = agruparPorZona(pedidosSinAsignar)
    const gruposOrdenados = Array.from(grupos.entries()).sort((a, b) => b[1].length - a[1].length)

    // Asigna cada grupo (zona) al vehículo con más capacidad restante que pueda absorberlo
    for (const [, items] of gruposOrdenados) {
      for (const pedido of items) {
        // Encuentra el vehículo con más capacidad restante donde quepa el pedido
        const candidatos = vehiculos
          .map((v) => {
            const ids = porVehiculo[v.id]
            const peso = ids.reduce((a, id) => a + (pedidosById.get(id)?.peso_kg ?? 0), 0)
            return { v, restante: v.capacidad_kg - peso }
          })
          .filter((c) => c.restante >= pedido.peso_kg)
          .sort((a, b) => b.restante - a.restante)
        if (candidatos.length === 0) continue
        porVehiculo[candidatos[0].v.id].push(pedido.id)
      }
    }

    setAsignacion({ porVehiculo })
    const asignadosCount = Object.values(porVehiculo).reduce((a, ids) => a + ids.length, 0)
    toast.success(`Asignación sugerida: ${asignadosCount} pedidos`, {
      description: asignadosCount < pedidosSinAsignar.length
        ? `${pedidosSinAsignar.length - asignadosCount} pedidos no caben — revisa capacidad o divide por fechas.`
        : 'Todos los pedidos fueron asignados.',
    })
  }

  function limpiarAsignacion() {
    setAsignacion({ porVehiculo: {} })
  }

  // ──────────────────────────────────────────────────────────────────────
  // Consolidar despacho (genera hoja de ruta + cambia estado)
  // ──────────────────────────────────────────────────────────────────────
  async function consolidar(vehiculoId: string) {
    const vehiculo = vehiculos.find((v) => v.id === vehiculoId)
    if (!vehiculo) return
    const ids = asignacion.porVehiculo[vehiculoId] ?? []
    if (ids.length === 0) {
      toast.error('Este vehículo no tiene pedidos asignados.')
      return
    }
    const pedidosVeh = ids.map((id) => pedidosById.get(id)).filter(Boolean) as PedidoListo[]
    const pesoTotal = pedidosVeh.reduce((a, p) => a + p.peso_kg, 0)
    const montoTotal = pedidosVeh.reduce((a, p) => a + p.total, 0)

    // Calcular orden de entrega optimizado
    const paradas = ordenarPorCercania(
      pedidosVeh.map((p) => ({ id: p.id, lat: p.cliente_lat, lng: p.cliente_lng })),
      { lat: almacen.lat, lng: almacen.lng },
    )
    const ordenEntrega: OrdenEntrega[] = paradas.map((par) => ({
      pedido_id: par.item.id,
      secuencia: par.secuencia,
      distancia_km: par.distancia_km,
      distancia_acumulada_km: par.distancia_acumulada_km,
    }))

    setConsolidandoVehiculo(vehiculoId)
    try {
      // 1. Crear despacho
      const fecha = new Date().toISOString().split('T')[0]
      const numero = `D-${fecha.replace(/-/g, '')}-${String(Date.now()).slice(-4)}`
      const { data: despacho, error: e1 } = await (supabase as any)
        .from('despachos')
        .insert({
          numero,
          vehiculo_id: vehiculoId,
          fecha_despacho: fecha,
          estado: 'preparacion',
          total_pedidos: pedidosVeh.length,
          total_monto: montoTotal,
          peso_total_kg: pesoTotal,
          orden_entrega: ordenEntrega,
          hoja_ruta_emitida_at: new Date().toISOString(),
        })
        .select('id, numero')
        .single()
      if (e1) throw e1

      // 2. Crear items del despacho
      const itemsInsert = pedidosVeh.map((p) => ({
        despacho_id: despacho.id,
        pedido_id: p.id,
        estado: 'pendiente',
      }))
      const { error: e2 } = await (supabase as any).from('despachos_items').insert(itemsInsert)
      if (e2) throw e2

      // 3. Marcar pedidos como despachados
      const { error: e3 } = await (supabase as any)
        .from('pedidos')
        .update({ estado: 'despachado', updated_at: new Date().toISOString() })
        .in('id', pedidosVeh.map((p) => p.id))
      if (e3) throw e3

      toast.success('Hoja de ruta emitida', { description: `Despacho ${despacho.numero} creado con ${pedidosVeh.length} paradas.` })
      // Abre la hoja de ruta en nueva pestaña
      window.open(`/hoja-ruta/${despacho.id}`, '_blank')
      // Refresca la página (los pedidos ya no aparecerán como 'facturados')
      router.refresh()
    } catch (err: any) {
      toast.error('No se pudo consolidar', { description: err?.message ?? 'Error desconocido' })
    } finally {
      setConsolidandoVehiculo(null)
    }
  }

  const activePedido = activePedidoId ? pedidosById.get(activePedidoId) : null
  const pesoTotalPendiente = pedidosSinAsignar.reduce((a, p) => a + p.peso_kg, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TruckIcon className="w-6 h-6" /> Despacho
          </h1>
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
            <Warehouse className="w-3.5 h-3.5" />
            Desde: <span className="font-medium text-gray-700">{almacen.nombre}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={sugerirAsignacion} className="gap-2 bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 font-semibold">
            <Sparkles className="w-4 h-4 text-amber-500" /> Sugerir asignación
          </Button>
          {Object.values(asignacion.porVehiculo).some((a) => a.length > 0) && (
            <Button onClick={limpiarAsignacion} variant="outline" className="gap-2">
              Limpiar
            </Button>
          )}
          <a href="/despacho/historial" className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">
            <History className="w-4 h-4" /> Historial
          </a>
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-12 gap-4">
          {/* Panel pedidos pendientes */}
          <div className="col-span-12 lg:col-span-3">
            <Card className="border-gray-200 shadow-sm h-full">
              <CardContent className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-gray-500" />
                    Pendientes ({pedidosSinAsignar.length})
                  </h3>
                  <span className="text-xs font-mono text-gray-500">{pesoTotalPendiente.toFixed(1)} kg</span>
                </div>

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <Input
                    placeholder="Buscar por cliente, RUC, zona..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>

                <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
                  {pedidosSinAsignar.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                      <Package className="w-8 h-8 mb-2 text-gray-300" />
                      <p className="text-xs text-center">
                        {pedidos.length === 0 ? 'No hay pedidos facturados' : 'Todos los pedidos están asignados'}
                      </p>
                    </div>
                  ) : (
                    pedidosSinAsignar.map((p) => (
                      <PedidoCard
                        key={p.id}
                        pedido={p}
                        onClick={() => {
                          setPedidoDetalle(p)
                          setDetalleOpen(true)
                        }}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Mapa central */}
          <div className="col-span-12 lg:col-span-5">
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 text-sm">
                    {vehiculoFocus
                      ? `Ruta: ${vehiculos.find((v) => v.id === vehiculoFocus)?.placa}`
                      : 'Mapa de pedidos'}
                  </h3>
                  {vehiculoFocus && (
                    <button
                      onClick={() => setVehiculoFocus(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      Ver todos
                    </button>
                  )}
                </div>
                <LeafletMap
                  height="calc(100vh - 230px)"
                  markers={markers}
                  polylines={polylines}
                  fitBounds={markers.length > 1}
                />
              </CardContent>
            </Card>
          </div>

          {/* Panel vehículos */}
          <div className="col-span-12 lg:col-span-4 space-y-3 max-h-[calc(100vh-160px)] overflow-y-auto pr-1">
            {vehiculos.length === 0 ? (
              <Card className="border-gray-200 shadow-sm">
                <CardContent className="p-6 text-center text-gray-400">
                  <TruckIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No hay vehículos activos. Crea uno en Maestros → Vehículos.</p>
                </CardContent>
              </Card>
            ) : (
              vehiculos.map((v) => {
                const ids = asignacion.porVehiculo[v.id] ?? []
                const pedidosVeh = ids.map((id) => pedidosById.get(id)).filter(Boolean) as PedidoListo[]
                // Ordenar visualmente por secuencia (nearest-neighbor) si tiene pedidos con coords
                const ordenados = pedidosVeh.length > 0
                  ? (() => {
                      const paradas = ordenarPorCercania(
                        pedidosVeh.map((p) => ({ id: p.id, lat: p.cliente_lat, lng: p.cliente_lng })),
                        { lat: almacen.lat, lng: almacen.lng },
                      )
                      return paradas.map((par) => pedidosById.get(par.item.id)!).filter(Boolean)
                    })()
                  : pedidosVeh
                return (
                  <div
                    key={v.id}
                    onClick={() => setVehiculoFocus(v.id === vehiculoFocus ? null : v.id)}
                    className="cursor-pointer"
                  >
                    <VehiculoCard
                      vehiculo={v}
                      pedidos={ordenados}
                      onRemovePedido={(pid) => removerPedido(v.id, pid)}
                      onConsolidar={() => consolidar(v.id)}
                      onPedidoClick={(p) => {
                        setPedidoDetalle(p)
                        setDetalleOpen(true)
                      }}
                      consolidando={consolidandoVehiculo === v.id}
                    />
                  </div>
                )
              })
            )}
          </div>
        </div>

        <DragOverlay>
          {activePedido && <PedidoCard pedido={activePedido} />}
        </DragOverlay>
      </DndContext>

      <PedidoDetalleModal
        pedido={pedidoDetalle}
        open={detalleOpen}
        onOpenChange={setDetalleOpen}
      />
    </div>
  )
}
