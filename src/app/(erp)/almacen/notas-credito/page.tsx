'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  FileMinus, Loader2, Search, ChevronLeft, ChevronRight, Eye, Building2,
  Calendar, ShoppingCart, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const PAGE_SIZE = 15

interface NCRow {
  id: string
  numero: string
  fecha_emision: string
  motivo: string
  subtotal: number
  igv: number
  total: number
  estado: 'emitida' | 'anulada'
  compra_id: string
  proveedor_id: string
  compras: { numero_factura_proveedor: string | null; fecha: string; estado: string } | null
  proveedores: { razon_social: string; ruc: string | null } | null
}

export default function NotasCreditoComprasPage() {
  const supabase = createClient()

  const [notas, setNotas] = useState<NCRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [page, setPage] = useState(0)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailNC, setDetailNC] = useState<NCRow | null>(null)
  const [detailItems, setDetailItems] = useState<any[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data, error } = await (supabase as any)
      .from('notas_credito_compras')
      .select(`
        id, numero, fecha_emision, motivo, subtotal, igv, total, estado,
        compra_id, proveedor_id,
        compras(numero_factura_proveedor, fecha, estado),
        proveedores(razon_social, ruc)
      `)
      .order('fecha_emision', { ascending: false })

    if (error) toast.error('Error al cargar NC', { description: error.message })
    setNotas((data ?? []) as any[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtradas = notas.filter((nc) => {
    if (!debouncedSearch) return true
    const q = debouncedSearch.toLowerCase()
    return (
      nc.numero.toLowerCase().includes(q) ||
      (nc.proveedores?.razon_social ?? '').toLowerCase().includes(q) ||
      (nc.proveedores?.ruc ?? '').toLowerCase().includes(q) ||
      (nc.compras?.numero_factura_proveedor ?? '').toLowerCase().includes(q)
    )
  })

  const totalPages = Math.ceil(filtradas.length / PAGE_SIZE)
  const pageItems = filtradas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // KPIs
  const totalEmitidas = notas.filter((n) => n.estado === 'emitida').reduce((acc, n) => acc + Number(n.total ?? 0), 0)
  const cantidadEmitidas = notas.filter((n) => n.estado === 'emitida').length

  const openDetail = async (nc: NCRow) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailNC(nc)
    setDetailItems([])
    const { data } = await (supabase as any)
      .from('notas_credito_compras_items')
      .select(`
        id, cantidad, precio_unitario, subtotal,
        productos(codigo, nombre, descripcion, unidades_medida(simbolo))
      `)
      .eq('nota_credito_id', nc.id)
    setDetailItems(data ?? [])
    setDetailLoading(false)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileMinus className="w-6 h-6 text-amber-600" />
          Notas de Crédito de Compras
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Notas de crédito generadas automáticamente por diferencias entre lo facturado por
          el proveedor y la mercadería realmente recibida.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total emitidas</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{formatCurrency(totalEmitidas)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">acumulado, sin anuladas</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Cantidad emitidas</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{cantidadEmitidas}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">documentos vigentes</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Anuladas</p>
            <p className="text-2xl font-bold text-gray-400 mt-1">
              {notas.filter((n) => n.estado === 'anulada').length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtro */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar por número, proveedor o factura origen..."
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Listado */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : pageItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <FileMinus className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">
                {notas.length === 0
                  ? 'No hay notas de crédito generadas todavía'
                  : 'Sin resultados para el filtro'}
              </p>
              {notas.length === 0 && (
                <p className="text-xs text-gray-400 mt-1 max-w-md text-center">
                  Las NC se generan automáticamente al aplicar una compra cuando la
                  cantidad recibida es menor a la facturada.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['N° NC', 'Fecha', 'Proveedor', 'Factura origen', 'Subtotal', 'IGV', 'Total', 'Estado', ''].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageItems.map((nc) => (
                    <tr key={nc.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-gray-700">{nc.numero}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{formatDate(nc.fecha_emision)}</td>
                      <td className="py-3 px-4 font-medium text-gray-900 truncate max-w-[220px]">
                        {nc.proveedores?.razon_social ?? '—'}
                        {nc.proveedores?.ruc && (
                          <div className="text-[10px] text-gray-400 font-mono">{nc.proveedores.ruc}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-500 font-mono text-xs">
                        {nc.compras?.numero_factura_proveedor ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-gray-700 text-right font-mono">{formatCurrency(nc.subtotal)}</td>
                      <td className="py-3 px-4 text-gray-700 text-right font-mono">{formatCurrency(nc.igv)}</td>
                      <td className="py-3 px-4 font-semibold text-amber-700 text-right">{formatCurrency(nc.total)}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          nc.estado === 'emitida'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {nc.estado === 'emitida' ? 'Emitida' : 'Anulada'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" onClick={() => openDetail(nc)} className="h-7 gap-1 text-xs">
                          <Eye className="w-3.5 h-3.5 text-gray-500" /> Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">{filtradas.length} NC</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="h-7 w-7 p-0">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-sm text-gray-600 px-2">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} className="h-7 w-7 p-0">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileMinus className="w-5 h-5 text-amber-600" />
              Detalle de Nota de Crédito
            </DialogTitle>
          </DialogHeader>
          {detailLoading || !detailNC ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-amber-600 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-start gap-2.5">
                  <FileMinus className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] text-gray-500 uppercase">N° NC</p>
                    <p className="font-mono font-semibold text-gray-900">{detailNC.numero}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] text-gray-500 uppercase">Fecha</p>
                    <p className="text-gray-900">{formatDate(detailNC.fecha_emision)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Building2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-gray-500 uppercase">Proveedor</p>
                    <p className="font-medium text-gray-900 truncate">{detailNC.proveedores?.razon_social ?? '—'}</p>
                    {detailNC.proveedores?.ruc && (
                      <p className="text-[11px] font-mono text-gray-500">{detailNC.proveedores.ruc}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShoppingCart className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] text-gray-500 uppercase">Factura origen</p>
                    <p className="font-mono text-gray-900">{detailNC.compras?.numero_factura_proveedor ?? '—'}</p>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{detailNC.motivo}</span>
              </div>

              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Productos con diferencia ({detailItems.length})</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Producto</th>
                        <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Cant.</th>
                        <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">P. Unit.</th>
                        <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {detailItems.map((it) => {
                        const prod = it.productos as any
                        const nombre = prod?.descripcion?.trim() || prod?.nombre || '—'
                        return (
                          <tr key={it.id}>
                            <td className="py-2 px-3">
                              <p className="font-medium text-gray-900">{nombre}</p>
                            </td>
                            <td className="py-2 px-2 text-right text-gray-700 font-mono">{Number(it.cantidad).toFixed(2)}</td>
                            <td className="py-2 px-2 text-right text-gray-700 font-mono">{formatCurrency(it.precio_unitario)}</td>
                            <td className="py-2 px-3 text-right font-medium text-gray-900">{formatCurrency(it.subtotal)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totales */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatCurrency(detailNC.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">IGV</span>
                  <span className="font-medium">{formatCurrency(detailNC.igv)}</span>
                </div>
                <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-1">
                  <span>Total NC</span>
                  <span className="text-amber-700">{formatCurrency(detailNC.total)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
