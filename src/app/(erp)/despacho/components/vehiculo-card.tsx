'use client'

import { useDroppable } from '@dnd-kit/core'
import { motion, AnimatePresence } from 'framer-motion'
import { Truck, AlertCircle, Check, FileText, User, MapPin } from 'lucide-react'
import CamionSVG from '@/components/camion-svg'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import PedidoCard from './pedido-card'
import type { PedidoListo, VehiculoDisponible } from '../lib/types'
import { colorDeString } from '../lib/geo-utils'

type Props = {
  vehiculo: VehiculoDisponible
  pedidos: PedidoListo[]
  onRemovePedido: (pedidoId: string) => void
  onConsolidar: () => void
  onPedidoClick: (pedido: PedidoListo) => void
  consolidando: boolean
}

export default function VehiculoCard({ vehiculo, pedidos, onRemovePedido, onConsolidar, onPedidoClick, consolidando }: Props) {
  const { isOver, setNodeRef } = useDroppable({
    id: `vehiculo-${vehiculo.id}`,
    data: { vehiculoId: vehiculo.id },
  })

  const pesoActual = pedidos.reduce((acc, p) => acc + p.peso_kg, 0)
  const montoTotal = pedidos.reduce((acc, p) => acc + p.total, 0)
  const pct = vehiculo.capacidad_kg > 0 ? (pesoActual / vehiculo.capacidad_kg) * 100 : 0
  const pctCapped = Math.min(pct, 100)
  const excede = pct > 100
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-green-500'
  const color = colorDeString(vehiculo.id)

  const zonasUnicas = Array.from(new Set(pedidos.map((p) => p.zona_nombre).filter(Boolean))) as string[]
  const algunSinPeso = pedidos.some((p) => p.tiene_productos_sin_peso)

  return (
    <motion.div
      ref={setNodeRef}
      layout
      className={`
        bg-white rounded-2xl border-2 transition-all overflow-hidden
        ${isOver ? 'border-[#FBE600] shadow-[0_0_0_4px_rgba(251,230,0,0.2)]' : 'border-gray-200 hover:border-gray-300'}
      `}
    >
      {/* Header con camión SVG */}
      <div className="relative bg-gradient-to-br from-gray-50 to-white p-3 pb-0">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0" style={{ width: 120 }}>
            <CamionSVG tipo={vehiculo.tipo} cargaPct={pctCapped} color={color} className="w-full h-auto" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4" style={{ color }} />
              <span className="font-bold text-gray-900 font-mono">{vehiculo.placa}</span>
            </div>
            {vehiculo.descripcion && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{vehiculo.descripcion}</p>
            )}
            {vehiculo.conductor_nombre && (
              <p className="text-[11px] text-gray-600 mt-1 flex items-center gap-1">
                <User className="w-3 h-3" /> {vehiculo.conductor_nombre}
              </p>
            )}
          </div>
        </div>

        {/* Barra de capacidad */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">
              <span className={`font-semibold ${excede ? 'text-red-600' : 'text-gray-800'}`}>
                {pesoActual.toFixed(1)} kg
              </span>
              <span className="text-gray-400"> / {vehiculo.capacidad_kg} kg</span>
            </span>
            <span className={`font-mono font-bold ${excede ? 'text-red-600' : pct >= 85 ? 'text-amber-600' : 'text-gray-700'}`}>
              {Math.round(pct)}%
            </span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden relative">
            <motion.div
              className={`h-full ${barColor} rounded-full`}
              initial={{ width: 0 }}
              animate={{ width: `${pctCapped}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            />
            {excede && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[9px] font-bold text-white">EXCEDIDO</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metadatos */}
      <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
        <Badge className="text-[10px] bg-gray-50 text-gray-700 border border-gray-200">
          {pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'}
        </Badge>
        <Badge className="text-[10px] bg-green-50 text-green-700 border border-green-200">
          S/ {montoTotal.toFixed(2)}
        </Badge>
        {zonasUnicas.slice(0, 3).map((z) => (
          <Badge key={z} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200">
            <MapPin className="w-2.5 h-2.5 mr-0.5" /> {z}
          </Badge>
        ))}
        {zonasUnicas.length > 3 && (
          <Badge className="text-[10px] bg-gray-50 text-gray-500 border border-gray-200">
            +{zonasUnicas.length - 3}
          </Badge>
        )}
        {algunSinPeso && (
          <Badge className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
            <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> Productos sin peso
          </Badge>
        )}
      </div>

      {/* Lista de pedidos dentro del vehículo (drop zone) */}
      <div className={`p-3 pt-2 space-y-2 min-h-[120px] transition-colors ${isOver ? 'bg-yellow-50/50' : ''}`}>
        <AnimatePresence mode="popLayout">
          {pedidos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <Truck className="w-7 h-7 mb-1.5 text-gray-300" />
              <p className="text-xs">Arrastra pedidos aquí</p>
            </div>
          ) : (
            pedidos.map((p, idx) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="group relative"
              >
                <PedidoCard
                  pedido={p}
                  compact
                  secuencia={idx + 1}
                  color={color}
                  onClick={() => onPedidoClick(p)}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemovePedido(p.id)
                  }}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center text-xs font-bold"
                  title="Quitar de este vehículo"
                >
                  ×
                </button>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Botón consolidar */}
      <div className="p-3 pt-0">
        <Button
          onClick={onConsolidar}
          disabled={pedidos.length === 0 || excede || consolidando}
          className="w-full bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {consolidando ? (
            <>
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                <FileText className="w-4 h-4" />
              </motion.div>
              Consolidando...
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              Consolidar y emitir hoja de ruta
            </>
          )}
        </Button>
      </div>
    </motion.div>
  )
}
