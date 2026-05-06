'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Loader2, Package, MapPin, Phone, FileText, User } from 'lucide-react'
import type { PedidoListo } from '../lib/types'

type Props = {
  pedido: PedidoListo | null
  open: boolean
  onOpenChange: (o: boolean) => void
}

export default function PedidoDetalleModal({ pedido, open, onOpenChange }: Props) {
  const supabase = createClient()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !pedido) return
    setLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('pedidos_items')
        .select('id, cantidad, precio_unitario, subtotal, productos(codigo, nombre, descripcion, peso_kg, unidades_medida(simbolo))')
        .eq('pedido_id', pedido.id)
      setItems(data ?? [])
      setLoading(false)
    })()
  }, [open, pedido])

  if (!pedido) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pedido {pedido.numero}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Cliente */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shrink-0 border border-gray-200">
                <User className="w-5 h-5 text-gray-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{pedido.cliente_nombre}</p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  {pedido.cliente_ruc ? `RUC ${pedido.cliente_ruc}` : pedido.cliente_dni ? `DNI ${pedido.cliente_dni}` : 'Sin doc.'}
                </p>
                {pedido.cliente_tipo_comprobante && (
                  <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
                    pedido.cliente_tipo_comprobante === 'factura'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-gray-100 text-gray-700 border-gray-200'
                  }`}>
                    <FileText className="w-3 h-3" />
                    Emite {pedido.cliente_tipo_comprobante === 'factura' ? 'Factura' : 'Boleta'}
                  </span>
                )}
              </div>
            </div>

            {pedido.cliente_direccion && (
              <p className="text-sm text-gray-700 flex items-start gap-2 pt-1">
                <MapPin className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                <span>
                  {pedido.zona_nombre && <span className="text-gray-600 font-medium">{pedido.zona_nombre} · </span>}
                  {pedido.cliente_direccion}
                </span>
              </p>
            )}
            {pedido.cliente_telefono && (
              <p className="text-sm text-gray-700 flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400" />
                <a href={`tel:${pedido.cliente_telefono}`} className="text-green-700 hover:underline">
                  {pedido.cliente_telefono}
                </a>
              </p>
            )}
            {pedido.vendedor_nombre && (
              <p className="text-xs text-gray-500">
                Vendedor: <span className="font-medium text-gray-700">{pedido.vendedor_nombre}</span>
              </p>
            )}
          </div>

          {/* Totales */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Ítems</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">{pedido.items_count}</p>
            </div>
            <div className={`bg-white border rounded-xl p-3 text-center ${pedido.tiene_productos_sin_peso ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Peso</p>
              <p className={`text-xl font-bold mt-0.5 font-mono ${pedido.tiene_productos_sin_peso ? 'text-amber-700' : 'text-gray-900'}`}>
                {pedido.peso_kg.toFixed(1)} kg
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Total</p>
              <p className="text-xl font-bold text-green-700 mt-0.5">{formatCurrency(pedido.total)}</p>
            </div>
          </div>

          {/* Items */}
          <div>
            <h3 className="font-semibold text-gray-800 text-sm mb-2 flex items-center gap-1.5">
              <Package className="w-4 h-4 text-gray-500" />
              Productos
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Sin ítems</p>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Producto</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Cant</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Peso</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map((it) => {
                      const pesoItem = (Number(it.productos?.peso_kg) || 0) * Number(it.cantidad)
                      const sinPeso = Number(it.productos?.peso_kg) === 0
                      return (
                        <tr key={it.id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900 text-xs">{it.productos?.descripcion?.trim() || it.productos?.nombre || '—'}</p>
                            <p className="text-[10px] text-gray-400 font-mono">{it.productos?.codigo}</p>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            {Number(it.cantidad)} {it.productos?.unidades_medida?.simbolo ?? ''}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono text-xs ${sinPeso ? 'text-amber-600' : 'text-gray-700'}`}>
                            {sinPeso ? '⚠ —' : `${pesoItem.toFixed(2)} kg`}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900 text-xs">
                            {formatCurrency(it.subtotal ?? 0)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pedido.tiene_productos_sin_peso && (
              <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
                ⚠ Algunos productos no tienen peso configurado. Ve a Maestros → Productos para editar.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
