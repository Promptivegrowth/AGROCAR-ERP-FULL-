'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Package, TrendingDown, Eye, Loader2, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatCurrency, formatDate, formatDatetime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const TIPO_MOV_CONFIG: Record<string, { label: string; className: string }> = {
  entrada: { label: 'Entrada', className: 'bg-green-100 text-green-700 border-green-200' },
  salida: { label: 'Salida', className: 'bg-red-100 text-red-700 border-red-200' },
  ajuste: { label: 'Ajuste', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  devolucion: { label: 'Devolución', className: 'bg-blue-100 text-blue-700 border-blue-200' },
}

export default function AlmacenPage() {
  const supabase = createClient()

  const [stocks, setStocks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  // Detalle
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [movimientos, setMovimientos] = useState<any[]>([])
  const [loadingMovs, setLoadingMovs] = useState(false)

  const loadInventario = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('stock')
      .select(`
        id, producto_id, cantidad, cantidad_reservada, costo_promedio, updated_at,
        productos(id, codigo, nombre, activo, familia_id, unidad_medida_id,
          familias(nombre),
          unidades_medida(simbolo, nombre)
        )
      `)
      .order('updated_at', { ascending: false })

    if (error) toast.error('Error al cargar inventario', { description: error.message })
    setStocks(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadInventario() }, [loadInventario])

  const openDetail = async (s: any) => {
    setSelected(s)
    setDetailOpen(true)
    setMovimientos([])
    setLoadingMovs(true)
    const { data, error } = await supabase
      .from('movimientos_stock')
      .select('id, tipo, cantidad, costo_unitario, notas, created_at')
      .eq('producto_id', s.producto_id)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) {
      toast.error('No se pudieron cargar los movimientos', { description: error.message })
    }
    setMovimientos(data ?? [])
    setLoadingMovs(false)
  }

  // Filtrado local por código o nombre
  const stocksFiltrados = stocks.filter((s) => {
    if (!debouncedSearch) return true
    const producto = s.productos as any
    const q = debouncedSearch.toLowerCase()
    return (
      (producto?.codigo ?? '').toLowerCase().includes(q) ||
      (producto?.nombre ?? '').toLowerCase().includes(q)
    )
  })

  const stockBajo = stocksFiltrados.filter((s) => (Number(s.cantidad) ?? 0) < 10)
  const valorInventario = stocks.reduce(
    (acc, s) => acc + (Number(s.cantidad) ?? 0) * (Number(s.costo_promedio) ?? 0),
    0,
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Almacén e Inventario</h1>
          <p className="text-sm text-gray-500 mt-0.5">Stock actual de productos</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/almacen/compras"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Compras
          </Link>
          <Link
            href="/almacen/ajustes"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Ajustes
          </Link>
        </div>
      </div>

      {/* Alertas stock bajo */}
      {stockBajo.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {stockBajo.length} producto{stockBajo.length !== 1 ? 's' : ''} con stock bajo (&lt;10 unidades)
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {stockBajo.slice(0, 8).map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 border border-orange-200 rounded-full text-xs text-orange-700"
                  >
                    <TrendingDown className="w-2.5 h-2.5" />
                    {(s.productos as any)?.nombre ?? '—'} ({Number(s.cantidad)})
                  </span>
                ))}
                {stockBajo.length > 8 && (
                  <span className="text-xs text-orange-600">+{stockBajo.length - 8} más</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPIs rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total Productos</p>
                <p className="text-xl font-bold text-gray-900">{stocks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Stock Bajo</p>
                <p className="text-xl font-bold text-gray-900">{stockBajo.length}</p>
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
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Valor Inventario</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(valorInventario)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Buscador */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar por código o nombre..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stock actual */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800">Stock Actual</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : stocksFiltrados.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No hay registros de stock</div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {stocksFiltrados.map((s) => {
                  const producto = s.productos as any
                  const disponible = Number(s.cantidad) ?? 0
                  const reservada = Number(s.cantidad_reservada) ?? 0
                  const esBajo = disponible < 10
                  const simbolo = producto?.unidades_medida?.simbolo ?? ''
                  return (
                    <div
                      key={s.id}
                      className={`p-4 hover:bg-gray-50/50 ${esBajo ? 'bg-orange-50/30' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{producto?.nombre ?? '—'}</p>
                          <p className="text-xs text-gray-500 font-mono">{producto?.codigo ?? '—'}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs">
                            <span className={`font-bold ${esBajo ? 'text-orange-600' : 'text-gray-800'}`}>
                              {disponible.toLocaleString('es-PE')} {simbolo}
                            </span>
                            <span className="text-gray-500">
                              Reserv. {reservada.toLocaleString('es-PE')}
                            </span>
                          </div>
                        </div>
                        {esBajo
                          ? <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200 shrink-0">Stock Bajo</Badge>
                          : <Badge className="text-xs bg-green-100 text-green-700 border-green-200 shrink-0">OK</Badge>}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-[11px] text-gray-400">
                          Costo {formatCurrency(Number(s.costo_promedio) ?? 0)}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => openDetail(s)} className="h-7 text-xs gap-1">
                          <Eye className="w-3.5 h-3.5" /> Ver detalle
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Vista desktop: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Código', 'Producto', 'Disponible', 'Reservado', 'Costo Prom.', 'Última Act.', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {stocksFiltrados.map((s) => {
                      const producto = s.productos as any
                      const disponible = Number(s.cantidad) ?? 0
                      const reservada = Number(s.cantidad_reservada) ?? 0
                      const esBajo = disponible < 10
                      const simbolo = producto?.unidades_medida?.simbolo ?? ''
                      return (
                        <tr key={s.id} className={`hover:bg-gray-50/50 transition-colors ${esBajo ? 'bg-orange-50/30' : ''}`}>
                          <td className="py-3 px-4 font-mono text-xs text-gray-500">{producto?.codigo ?? '—'}</td>
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-[240px] truncate">{producto?.nombre ?? '—'}</td>
                          <td className="py-3 px-4">
                            <span className={`font-bold ${esBajo ? 'text-orange-600' : 'text-gray-800'}`}>
                              {disponible.toLocaleString('es-PE')}
                            </span>
                            <span className="text-xs text-gray-400 ml-1">{simbolo}</span>
                          </td>
                          <td className="py-3 px-4 text-gray-600">
                            {reservada.toLocaleString('es-PE')}
                            <span className="text-xs text-gray-400 ml-1">{simbolo}</span>
                          </td>
                          <td className="py-3 px-4 text-gray-700">{formatCurrency(Number(s.costo_promedio) ?? 0)}</td>
                          <td className="py-3 px-4 text-gray-500 text-xs">
                            {s.updated_at ? formatDate(s.updated_at) : '—'}
                          </td>
                          <td className="py-3 px-4">
                            {esBajo ? (
                              <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200">Stock Bajo</Badge>
                            ) : (
                              <Badge className="text-xs bg-green-100 text-green-700 border-green-200">OK</Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Button variant="ghost" size="sm" onClick={() => openDetail(s)} className="h-7 w-7 p-0" title="Ver detalle">
                              <Eye className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog Detalle de Stock */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de Stock</DialogTitle>
          </DialogHeader>
          {selected && (() => {
            const producto = selected.productos as any
            const disponible = Number(selected.cantidad) ?? 0
            const reservada = Number(selected.cantidad_reservada) ?? 0
            const libre = disponible - reservada
            const costo = Number(selected.costo_promedio) ?? 0
            const valorTotal = disponible * costo
            const simbolo = producto?.unidades_medida?.simbolo ?? ''
            return (
              <div className="space-y-5 mt-2">
                {/* Cabecera producto */}
                <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
                  <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 truncate">{producto?.nombre ?? '—'}</p>
                    <p className="text-xs text-gray-500 font-mono">{producto?.codigo ?? '—'}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                      {producto?.familias?.nombre && (
                        <Badge variant="secondary" className="text-[10px]">
                          {producto.familias.nombre}
                        </Badge>
                      )}
                      {producto?.unidades_medida?.nombre && (
                        <span className="text-gray-500">
                          UM: {producto.unidades_medida.nombre} ({simbolo})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* KPIs de stock */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Cantidad actual</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">
                      {disponible.toLocaleString('es-PE')} <span className="text-xs text-gray-400">{simbolo}</span>
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Reservada</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">
                      {reservada.toLocaleString('es-PE')} <span className="text-xs text-gray-400">{simbolo}</span>
                    </p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 col-span-2 sm:col-span-1">
                    <p className="text-[10px] text-green-700 uppercase tracking-wide">Disponible</p>
                    <p className="text-lg font-bold text-green-800 mt-0.5">
                      {libre.toLocaleString('es-PE')} <span className="text-xs text-green-500">{simbolo}</span>
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Costo promedio</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(costo)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 col-span-2">
                    <p className="text-[10px] text-blue-700 uppercase tracking-wide">Valor total en stock</p>
                    <p className="text-lg font-bold text-blue-800 mt-0.5">{formatCurrency(valorTotal)}</p>
                  </div>
                </div>

                {/* Últimos movimientos */}
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-2">Últimos 10 movimientos</p>
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    {loadingMovs ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                      </div>
                    ) : movimientos.length === 0 ? (
                      <div className="text-center py-6 text-xs text-gray-400">Sin movimientos registrados</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50/50 border-b border-gray-100">
                          <tr>
                            {['Fecha', 'Tipo', 'Cantidad', 'Notas'].map((h) => (
                              <th key={h} className="text-left py-2 px-3 font-semibold text-gray-500 uppercase tracking-wide">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {movimientos.map((m) => {
                            const tipoCfg = TIPO_MOV_CONFIG[m.tipo] ?? { label: m.tipo, className: 'bg-gray-100 text-gray-700 border-gray-200' }
                            const cantidad = Number(m.cantidad) ?? 0
                            return (
                              <tr key={m.id}>
                                <td className="py-2 px-3 text-gray-500 whitespace-nowrap">
                                  {m.created_at ? formatDatetime(m.created_at) : '—'}
                                </td>
                                <td className="py-2 px-3">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${tipoCfg.className}`}>
                                    {tipoCfg.label}
                                  </span>
                                </td>
                                <td className={`py-2 px-3 font-mono font-semibold ${cantidad < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                  {cantidad > 0 ? '+' : ''}{cantidad.toLocaleString('es-PE')} {simbolo}
                                </td>
                                <td className="py-2 px-3 text-gray-500 max-w-[220px] truncate">{m.notas ?? '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-3 border-t border-gray-100">
                  <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
