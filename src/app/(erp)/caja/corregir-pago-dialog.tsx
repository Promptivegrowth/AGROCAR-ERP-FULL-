'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Corregir cómo se pagó un cobro: efectivo, Yape, Plin o transferencia.
 *
 * Daniel, 01/10: Víctor hizo una venta directa desde el aplicativo, cobró por
 * Yape y lo registró como efectivo. El total no cambia; solo el reparto. Queda
 * registrado quién lo corrigió y por qué (tabla cobros_correcciones), y no se
 * permite sobre un cobro de una caja ya cerrada.
 */
export interface CobroACorregir {
  id: string
  cliente_nombre: string
  cobrador_nombre: string
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  total: number
}

const CAMPOS = [
  { clave: 'efectivo', label: 'Efectivo' },
  { clave: 'yape', label: 'Yape' },
  { clave: 'plin', label: 'Plin' },
  { clave: 'transferencia', label: 'Transferencia' },
] as const
type Clave = typeof CAMPOS[number]['clave']

export default function CorregirPagoDialog({ cobro, onClose, onListo }: {
  cobro: CobroACorregir | null
  onClose: () => void
  onListo: () => void
}) {
  const supabase = createClient()
  const [montos, setMontos] = useState<Record<Clave, string>>({ efectivo: '', yape: '', plin: '', transferencia: '' })
  const [operacion, setOperacion] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!cobro) return
    setMontos({
      efectivo: String(cobro.efectivo),
      yape: String(cobro.yape),
      plin: String(cobro.plin),
      transferencia: String(cobro.transferencia),
    })
    setOperacion('')
    setMotivo('')
  }, [cobro])

  if (!cobro) return null
  const n = (v: string) => Number.parseFloat(v || '0') || 0
  const suma = CAMPOS.reduce((a, c) => a + n(montos[c.clave]), 0)
  const cuadra = Math.abs(suma - cobro.total) < 0.005
  const digital = n(montos.yape) + n(montos.plin) + n(montos.transferencia) > 0

  /** Todo a un solo medio: el caso común ("era Yape, no efectivo"). */
  const todoA = (clave: Clave) => setMontos({
    efectivo: '0', yape: '0', plin: '0', transferencia: '0', [clave]: String(cobro.total),
  } as Record<Clave, string>)

  const guardar = async () => {
    if (!cuadra) { toast.error('La suma tiene que ser igual al total del cobro'); return }
    if (!motivo.trim()) { toast.error('Indicá el motivo de la corrección'); return }
    setGuardando(true)
    const { error } = await (supabase.rpc as any)('corregir_medio_pago_cobro', {
      p_cobro_id: cobro.id,
      p_efectivo: n(montos.efectivo),
      p_yape: n(montos.yape),
      p_plin: n(montos.plin),
      p_transferencia: n(montos.transferencia),
      p_nro_operacion: operacion.trim() || null,
      p_motivo: motivo.trim(),
    })
    setGuardando(false)
    if (error) {
      toast.error('No se pudo corregir', { description: error.message, duration: 10000 })
      return
    }
    toast.success('Medio de pago corregido', { description: 'Quedó registrado quién lo corrigió y por qué.' })
    onListo()
    onClose()
  }

  return (
    <Dialog open={!!cobro} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir medio de pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="font-semibold">{cobro.cliente_nombre}</p>
            <p className="text-xs text-gray-500">Cobró {cobro.cobrador_nombre} · Total {formatCurrency(cobro.total)}</p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-gray-500 self-center">Todo en:</span>
            {CAMPOS.map((c) => (
              <Button key={c.clave} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
                onClick={() => todoA(c.clave)} disabled={guardando}>
                {c.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {CAMPOS.map((c) => (
              <div key={c.clave}>
                <Label className="text-xs">{c.label}</Label>
                <Input type="number" step="0.01" min="0" value={montos[c.clave]} disabled={guardando}
                  onChange={(e) => setMontos((m) => ({ ...m, [c.clave]: e.target.value }))}
                  className="h-9 text-right font-mono" />
              </div>
            ))}
          </div>
          <p className={`text-xs font-semibold ${cuadra ? 'text-emerald-700' : 'text-red-700'}`}>
            Suma {formatCurrency(suma)} {cuadra ? '✓ igual al total' : `≠ total ${formatCurrency(cobro.total)}`}
          </p>

          {digital && (
            <div>
              <Label className="text-xs">N° de operación (Yape / Plin / transferencia)</Label>
              <Input value={operacion} onChange={(e) => setOperacion(e.target.value)} disabled={guardando}
                placeholder="Opcional, pero ayuda a cuadrar con el banco" className="h-9" />
            </div>
          )}
          <div>
            <Label className="text-xs">Motivo *</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={guardando}
              placeholder="Ej.: se cobró por Yape y se registró como efectivo" className="h-9" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || !cuadra || !motivo.trim()}
              className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-1">
              {guardando && <Loader2 className="w-4 h-4 animate-spin" />} Guardar corrección
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
