'use client'

import { useState, useEffect } from 'react'
import { Users, Search, Phone, MapPin, ChevronRight, Loader2, AlertCircle, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Cliente, Pedido, Cobro } from '@/types'

interface ClienteConDeuda extends Cliente {
  deuda_pendiente: number
}

interface DetalleCliente {
  cliente: ClienteConDeuda
  pedidos: Pedido[]
  cobros: Cobro[]
}

const estadoColors: Record<string, string> = {
  activo: 'bg-green-100 text-green-700',
  inactivo: 'bg-gray-100 text-gray-600',
  deudor: 'bg-amber-100 text-amber-700',
  de_baja: 'bg-red-100 text-red-700',
}

const estadoLabels: Record<string, string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  deudor: 'Deudor',
  de_baja: 'De Baja',
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<ClienteConDeuda[]>([])
  const [filtrados, setFiltrados] = useState<ClienteConDeuda[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detalle, setDetalle] = useState<DetalleCliente | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    async function cargarClientes() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: clientesData } = await supabase
        .from('clientes')
        .select('*')
        .eq('vendedor_id', user.id)
        .order('razon_social')

      if (!clientesData) {
        setLoading(false)
        return
      }

      // Obtener cobros del día para calcular deuda (usando campo total en vez de monto_total)
      const ids = clientesData.map((c) => c.id)
      const { data: cobros } = await supabase
        .from('cobros')
        .select('cliente_id, total')
        .in('cliente_id', ids)

      const deudaPorCliente: Record<string, number> = {}
      cobros?.forEach((c: any) => {
        deudaPorCliente[c.cliente_id] = (deudaPorCliente[c.cliente_id] ?? 0) + (c.total ?? 0)
      })

      const clientesConDeuda: ClienteConDeuda[] = clientesData.map((c) => ({
        ...c,
        deuda_pendiente: deudaPorCliente[c.id] ?? 0,
      }))

      setClientes(clientesConDeuda)
      setFiltrados(clientesConDeuda)
      setLoading(false)
    }

    cargarClientes()
  }, [])

  useEffect(() => {
    if (!search.trim()) {
      setFiltrados(clientes)
      return
    }
    const q = search.toLowerCase()
    setFiltrados(
      clientes.filter(
        (c) =>
          c.razon_social.toLowerCase().includes(q) ||
          (c.codigo ?? '').toLowerCase().includes(q) ||
          (c.telefono ?? '').includes(q)
      )
    )
  }, [search, clientes])

  async function verDetalle(cliente: ClienteConDeuda) {
    setLoadingDetalle(true)
    setDetalle({ cliente, pedidos: [], cobros: [] })

    const [{ data: pedidos }, { data: cobros }] = await Promise.all([
      supabase
        .from('pedidos')
        .select('*')
        .eq('cliente_id', cliente.id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('cobros')
        .select('*')
        .eq('cliente_id', cliente.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    setDetalle({
      cliente,
      pedidos: (pedidos ?? []) as Pedido[],
      cobros: (cobros ?? []) as Cobro[],
    })
    setLoadingDetalle(false)
  }

  const estadoPedidoBadge: Record<string, string> = {
    borrador: 'bg-gray-100 text-gray-700',
    enviado: 'bg-blue-100 text-blue-700',
    validado: 'bg-indigo-100 text-indigo-700',
    facturado: 'bg-purple-100 text-purple-700',
    despachado: 'bg-orange-100 text-orange-700',
    entregado: 'bg-green-100 text-green-700',
    cancelado: 'bg-red-100 text-red-700',
  }

  if (detalle) {
    const { cliente, pedidos, cobros } = detalle
    return (
      <div className="min-h-full">
        {/* Header detalle */}
        <div className="bg-green-600 text-white px-4 pt-6 pb-4">
          <button
            onClick={() => setDetalle(null)}
            className="flex items-center gap-1 text-green-200 text-sm mb-3 hover:text-white"
          >
            <X className="w-4 h-4" />
            Volver a clientes
          </button>
          <h1 className="text-xl font-bold">{cliente.razon_social}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoColors[cliente.estado] ?? 'bg-gray-100 text-gray-700'}`}>
              {estadoLabels[cliente.estado] ?? cliente.estado}
            </span>
            {cliente.codigo && (
              <span className="text-green-200 text-xs">{cliente.codigo}</span>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Datos del cliente */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              {cliente.direccion && (
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <MapPin className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                  {cliente.direccion}
                </div>
              )}
              {cliente.telefono && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <a href={`tel:${cliente.telefono}`} className="text-green-600 font-medium">
                    {cliente.telefono}
                  </a>
                </div>
              )}
              {cliente.deuda_pendiente > 0 && (
                <div className="flex items-center gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <div>
                    <div className="text-xs text-amber-700 font-medium">Deuda pendiente</div>
                    <div className="text-amber-800 font-bold">{formatCurrency(cliente.deuda_pendiente)}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Historial de pedidos */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Últimos Pedidos</h3>
            {loadingDetalle ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-green-600" />
              </div>
            ) : pedidos.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded-xl">
                Sin pedidos registrados
              </div>
            ) : (
              <div className="space-y-2">
                {pedidos.map((p) => (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800">
                        #{p.id.slice(-8).toUpperCase()}
                      </div>
                      <div className="text-xs text-gray-500">{formatDate(p.created_at)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoPedidoBadge[p.estado] ?? 'bg-gray-100 text-gray-700'}`}>
                        {p.estado}
                      </span>
                      <span className="text-sm font-bold text-green-700">
                        {formatCurrency((p as any).total ?? 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historial de cobros */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Últimos Cobros</h3>
            {!loadingDetalle && cobros.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded-xl">
                Sin cobros registrados
              </div>
            ) : (
              <div className="space-y-2">
                {cobros.map((c) => (
                  <div key={c.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800 capitalize">
                        {(c as any).tipo ?? 'Cobro'}
                      </div>
                      <div className="text-xs text-gray-500">{formatDate(c.created_at)}</div>
                    </div>
                    <span className="text-sm font-bold text-green-700">
                      {formatCurrency((c as any).total ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <Users className="w-6 h-6" />
          <h1 className="text-xl font-bold">Mis Clientes</h1>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-300" />
          <input
            type="text"
            placeholder="Buscar por nombre, código o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-3 bg-white/20 placeholder-green-200 text-white rounded-xl text-sm outline-none focus:bg-white/30"
          />
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">
              {search ? 'Sin resultados para tu búsqueda' : 'Sin clientes asignados'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-3">{filtrados.length} clientes</p>
            {filtrados.map((cliente) => (
              <button
                key={cliente.id}
                onClick={() => verDetalle(cliente)}
                className="w-full text-left"
              >
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900 text-sm truncate">
                            {cliente.razon_social}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoColors[cliente.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                            {estadoLabels[cliente.estado] ?? cliente.estado}
                          </span>
                          {cliente.codigo && (
                            <span className="text-xs text-gray-400">{cliente.codigo}</span>
                          )}
                        </div>
                        {cliente.direccion && (
                          <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-500">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate">{cliente.direccion}</span>
                          </div>
                        )}
                        {cliente.telefono && (
                          <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
                            <Phone className="w-3 h-3" />
                            {cliente.telefono}
                          </div>
                        )}
                        {cliente.deuda_pendiente > 0 && (
                          <div className="mt-1.5 text-xs font-medium text-amber-700">
                            Deuda: {formatCurrency(cliente.deuda_pendiente)}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 mt-1 shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
