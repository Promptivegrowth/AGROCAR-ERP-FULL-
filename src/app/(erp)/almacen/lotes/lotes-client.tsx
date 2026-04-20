'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Boxes, Calendar, Package, Search, ShieldAlert, TrendingDown } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface LotesClientProps {
  initialLotes: any[]
  productos: { id: string; nombre: string }[]
}

type EstadoLote = 'vencido' | 'por_vencer' | 'al_dia'

function calcularEstado(fechaVencimiento: string | null): EstadoLote {
  if (!fechaVencimiento) return 'al_dia'
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const venc = new Date(fechaVencimiento + 'T00:00:00')
  const diffDias = Math.floor((venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDias < 0) return 'vencido'
  if (diffDias < 30) return 'por_vencer'
  return 'al_dia'
}

function diasParaVencer(fechaVencimiento: string | null): number | null {
  if (!fechaVencimiento) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const venc = new Date(fechaVencimiento + 'T00:00:00')
  return Math.floor((venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
}

const ESTADO_CONFIG: Record<EstadoLote, { label: string; className: string; rowClassName: string }> = {
  vencido: {
    label: 'Vencido',
    className: 'bg-red-100 text-red-700 border-red-200',
    rowClassName: 'bg-red-50/50',
  },
  por_vencer: {
    label: 'Por vencer',
    className: 'bg-amber-100 text-amber-700 border-amber-200',
    rowClassName: 'bg-amber-50/40',
  },
  al_dia: {
    label: 'Al día',
    className: 'bg-green-100 text-green-700 border-green-200',
    rowClassName: '',
  },
}

export default function LotesClient({ initialLotes, productos }: LotesClientProps) {
  const [search, setSearch] = useState('')
  const [filtroProducto, setFiltroProducto] = useState<string>('todos')
  const [filtroEstado, setFiltroEstado] = useState<string>('todos')

  const lotesConDatos = useMemo(
    () =>
      initialLotes.map((l) => {
        const estado = calcularEstado(l.fecha_vencimiento)
        const dias = diasParaVencer(l.fecha_vencimiento)
        const costo = Number(l.productos?.stock?.[0]?.costo_promedio ?? 0)
        const cantActual = Number(l.cantidad_actual ?? 0)
        return {
          ...l,
          _estado: estado,
          _dias: dias,
          _costo: costo,
          _valor: cantActual * costo,
        }
      }),
    [initialLotes]
  )

  const lotesFiltrados = useMemo(() => {
    const q = search.toLowerCase()
    return lotesConDatos.filter((l) => {
      if (filtroProducto !== 'todos' && l.productos?.id !== filtroProducto) return false
      if (filtroEstado !== 'todos' && l._estado !== filtroEstado) return false
      if (!q) return true
      return (
        (l.numero_lote ?? '').toLowerCase().includes(q) ||
        (l.productos?.nombre ?? '').toLowerCase().includes(q) ||
        (l.productos?.codigo ?? '').toLowerCase().includes(q)
      )
    })
  }, [lotesConDatos, search, filtroProducto, filtroEstado])

  // KPIs
  const lotesActivos = lotesConDatos.filter((l) => Number(l.cantidad_actual ?? 0) > 0)
  const vencidos = lotesActivos.filter((l) => l._estado === 'vencido')
  const porVencer = lotesActivos.filter((l) => l._estado === 'por_vencer')
  const valorTotal = lotesActivos.reduce((acc, l) => acc + l._valor, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lotes y Vencimientos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gestión de lotes de la línea de frío · Control FIFO-FEFO
          </p>
        </div>
        <Link
          href="/almacen"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
        >
          Inventario
        </Link>
      </div>

      {/* Alertas */}
      {vencidos.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">
                {vencidos.length} lote{vencidos.length !== 1 ? 's' : ''} vencido{vencidos.length !== 1 ? 's' : ''} con stock disponible
              </p>
              <p className="text-xs text-red-700 mt-1">
                Retira del inventario o haz un ajuste de salida por merma.
              </p>
            </div>
          </div>
        </div>
      )}

      {porVencer.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {porVencer.length} lote{porVencer.length !== 1 ? 's' : ''} por vencer en los próximos 30 días
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Prioriza su despacho (FIFO-FEFO) para evitar mermas.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <Boxes className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Lotes activos</p>
                <p className="text-xl font-bold text-gray-900">{lotesActivos.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                <Calendar className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Por vencer (30d)</p>
                <p className="text-xl font-bold text-amber-700">{porVencer.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Vencidos</p>
                <p className="text-xl font-bold text-red-700">{vencidos.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Valor total</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(valorTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar por producto o lote..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filtroProducto} onValueChange={setFiltroProducto}>
              <SelectTrigger>
                <SelectValue placeholder="Producto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los productos</SelectItem>
                {productos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger>
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="al_dia">Al día</SelectItem>
                <SelectItem value="por_vencer">Por vencer (&lt;30d)</SelectItem>
                <SelectItem value="vencido">Vencidos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de lotes */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800">
            Lotes {lotesFiltrados.length !== lotesConDatos.length && `(${lotesFiltrados.length} de ${lotesConDatos.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lotesFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Boxes className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No hay lotes que coincidan con los filtros</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Producto', 'N° Lote', 'Vencimiento', 'Días', 'Cant. disp.', 'Valor', 'Estado'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {lotesFiltrados.map((l) => {
                    const cfg = ESTADO_CONFIG[l._estado as EstadoLote]
                    const simbolo = l.productos?.unidades_medida?.simbolo ?? ''
                    return (
                      <tr key={l.id} className={`hover:bg-gray-50/50 transition-colors ${cfg.rowClassName}`}>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{l.productos?.nombre ?? '—'}</p>
                          <p className="text-xs text-gray-500 font-mono">{l.productos?.codigo ?? '—'}</p>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-gray-700">{l.numero_lote ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs whitespace-nowrap">
                          {l.fecha_vencimiento ? formatDate(l.fecha_vencimiento) : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs whitespace-nowrap">
                          {l._dias === null ? (
                            <span className="text-gray-400">—</span>
                          ) : l._dias < 0 ? (
                            <span className="font-bold text-red-700">Hace {Math.abs(l._dias)}d</span>
                          ) : l._dias < 30 ? (
                            <span className="font-semibold text-amber-700">En {l._dias}d</span>
                          ) : (
                            <span className="text-gray-600">En {l._dias}d</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-800">
                          {Number(l.cantidad_actual ?? 0).toLocaleString('es-PE')}
                          <span className="text-xs text-gray-400 ml-1">{simbolo}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-700">{formatCurrency(l._valor)}</td>
                        <td className="py-3 px-4">
                          <Badge className={`text-xs border ${cfg.className}`}>
                            {cfg.label}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
