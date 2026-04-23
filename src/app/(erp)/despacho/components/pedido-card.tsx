'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { MapPin, Package, AlertTriangle, FileText } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { PedidoListo } from '../lib/types'

type Props = {
  pedido: PedidoListo
  compact?: boolean
  onClick?: () => void
  /** Si está en modo detalle dentro de un vehículo, muestra la secuencia */
  secuencia?: number
  /** Color del marcador/vehículo para stripe lateral */
  color?: string
}

export default function PedidoCard({ pedido, compact, onClick, secuencia, color }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: pedido.id,
    data: { pedido },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  }

  const tipoBadge = pedido.cliente_tipo_comprobante === 'factura'
    ? { label: 'Factura', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
    : { label: 'Boleta', cls: 'bg-gray-50 text-gray-700 border-gray-200' }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`
        group relative cursor-grab active:cursor-grabbing
        bg-white border border-gray-200 rounded-xl p-3
        hover:border-gray-300 hover:shadow-md transition-all
        ${compact ? 'py-2' : ''}
      `}
    >
      {color && (
        <div
          className="absolute left-0 top-3 bottom-3 w-1 rounded-r"
          style={{ backgroundColor: color }}
        />
      )}
      <div className={color ? 'pl-2' : ''}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {secuencia != null && (
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white shrink-0"
                  style={{ backgroundColor: color ?? '#2563eb' }}
                >
                  {secuencia}
                </span>
              )}
              <p className="font-semibold text-gray-900 text-sm truncate">
                {pedido.cliente_nombre}
              </p>
            </div>
            <p className="text-[11px] text-gray-500 font-mono mt-0.5">
              {pedido.numero} · {pedido.cliente_ruc ? `RUC ${pedido.cliente_ruc}` : pedido.cliente_dni ? `DNI ${pedido.cliente_dni}` : 'Sin doc.'}
            </p>
          </div>
          {!compact && (
            <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${tipoBadge.cls}`}>
              <FileText className="w-2.5 h-2.5 mr-0.5" /> {tipoBadge.label}
            </span>
          )}
        </div>

        {!compact && pedido.cliente_direccion && (
          <p className="text-[11px] text-gray-500 mt-1.5 flex items-start gap-1">
            <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />
            <span className="truncate">
              {pedido.zona_nombre && <span className="text-gray-600 font-medium">{pedido.zona_nombre} · </span>}
              {pedido.cliente_direccion}
            </span>
          </p>
        )}

        <div className={`flex items-center justify-between mt-${compact ? '1' : '2'} text-xs`}>
          <div className="flex items-center gap-2 text-gray-500">
            <span className="flex items-center gap-0.5">
              <Package className="w-3 h-3" />
              {pedido.items_count} {pedido.items_count === 1 ? 'ítem' : 'ítems'}
            </span>
            <span className={`font-mono font-semibold ${pedido.tiene_productos_sin_peso ? 'text-amber-600' : 'text-gray-700'}`}>
              {pedido.peso_kg.toFixed(1)} kg
              {pedido.tiene_productos_sin_peso && (
                <AlertTriangle className="inline w-3 h-3 ml-0.5 text-amber-500" />
              )}
            </span>
          </div>
          <span className="font-bold text-green-700">{formatCurrency(pedido.total)}</span>
        </div>
      </div>
    </div>
  )
}
