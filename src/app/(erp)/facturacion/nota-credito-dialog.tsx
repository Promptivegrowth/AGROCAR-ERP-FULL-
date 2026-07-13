'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, FileMinus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  comprobanteId: string | null
  onCreated: () => void
}

interface Comp {
  id: string; tipo: string; serie: string; numero: number; total: number
  cliente_id: string | null
  cliente_externo_nombre: string | null
}

interface Item {
  id: string
  producto_id: string | null
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

const MOTIVOS_SUNAT = [
  { code: '01', label: '01 - Anulación de la operación' },
  { code: '02', label: '02 - Anulación por error en el RUC' },
  { code: '03', label: '03 - Corrección por error en la descripción' },
  { code: '04', label: '04 - Descuento global' },
  { code: '05', label: '05 - Descuento por ítem' },
  { code: '06', label: '06 - Devolución total' },
  { code: '07', label: '07 - Devolución por ítem' },
  { code: '08', label: '08 - Bonificación' },
  { code: '09', label: '09 - Disminución en cantidad' },
  { code: '10', label: '10 - Otros conceptos' },
  { code: '13', label: '13 - Ajustes intereses/comisiones' },
]

export default function NotaCreditoDialog({ open, onOpenChange, comprobanteId, onCreated }: Props) {
  const supabase = createClient()
  const [comp, setComp] = useState<Comp | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<Map<string, number>>(new Map()) // itemId → cantidad a devolver
  const [motivo, setMotivo] = useState('06')
  const [notas, setNotas] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !comprobanteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: c }, { data: its }] = await Promise.all([
        (supabase as any).from('comprobantes').select('id, tipo, serie, numero, total, cliente_id, cliente_externo_nombre').eq('id', comprobanteId).single(),
        (supabase as any).from('comprobantes_items').select('id, producto_id, descripcion, cantidad, precio_unitario, subtotal').eq('comprobante_id', comprobanteId),
      ])
      if (cancelled) return
      setComp(c as any)
      setItems((its ?? []) as Item[])
      // Preseleccionar todos los ítems al 100%
      const m = new Map<string, number>()
      ;(its ?? []).forEach((i: any) => m.set(i.id, Number(i.cantidad)))
      setSelected(m)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [open, comprobanteId, supabase])

  const setCant = (itemId: string, cant: number) => {
    setSelected((prev) => {
      const next = new Map(prev)
      const item = items.find((i) => i.id === itemId)
      const maxCant = item ? Number(item.cantidad) : 0
      const cantClamped = Math.max(0, Math.min(cant, maxCant))
      if (cantClamped === 0) next.delete(itemId)
      else next.set(itemId, cantClamped)
      return next
    })
  }

  const itemsPayload = items
    .filter((i) => (selected.get(i.id) ?? 0) > 0)
    .map((i) => {
      const cant = selected.get(i.id) ?? 0
      const sub = cant * Number(i.precio_unitario)
      return {
        producto_id: i.producto_id,
        descripcion: i.descripcion,
        cantidad: cant,
        precio_unitario: Number(i.precio_unitario),
        subtotal: sub,
      }
    })

  const subtotal = itemsPayload.reduce((a, i) => a + i.subtotal, 0)
  const igv = Math.round(subtotal * 0.18 * 100) / 100
  const total = subtotal + igv

  const emitir = async () => {
    if (!comp || itemsPayload.length === 0) {
      toast.error('Selecciona al menos un ítem con cantidad > 0'); return
    }
    setSaving(true)
    const { error } = await (supabase.rpc as any)('emitir_nota_credito', {
      p_comprobante_original_id: comp.id,
      p_motivo_sunat: motivo,
      p_items: itemsPayload,
      p_notas: notas || null,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Nota de crédito emitida')
    onOpenChange(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileMinus className="w-5 h-5 text-red-600" />
            Emitir Nota de Crédito
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : comp && (
          <div className="space-y-4 mt-2">
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm">
              <p className="font-semibold">
                Comprobante original: {comp.tipo.toUpperCase()} {comp.serie}-{String(comp.numero).padStart(8, '0')}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Total original: {formatCurrency(comp.total)}</p>
            </div>

            <div>
              <Label className="text-xs">Motivo SUNAT (catálogo 09) *</Label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                {MOTIVOS_SUNAT.map((m) => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Ítems a devolver *</Label>
              <div className="border border-gray-200 rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left p-2">Descripción</th>
                      <th className="text-right p-2 w-24">P. Unit</th>
                      <th className="text-right p-2 w-24">Cant. Orig.</th>
                      <th className="text-right p-2 w-32">Devolver</th>
                      <th className="text-right p-2 w-28">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const cant = selected.get(i.id) ?? 0
                      const sub = cant * Number(i.precio_unitario)
                      return (
                        <tr key={i.id} className="border-b border-gray-100">
                          <td className="p-2 text-xs">{i.descripcion}</td>
                          <td className="p-2 text-right font-mono text-xs">{formatCurrency(i.precio_unitario)}</td>
                          <td className="p-2 text-right font-mono">{Number(i.cantidad)}</td>
                          <td className="p-2 text-right">
                            <Input type="number" min="0" step="0.01" max={Number(i.cantidad)}
                              value={cant} onChange={(e) => setCant(i.id, parseFloat(e.target.value) || 0)}
                              className="h-7 text-right font-mono text-xs" />
                          </td>
                          <td className="p-2 text-right font-mono">{formatCurrency(sub)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                    <tr>
                      <td colSpan={4} className="p-2 text-right">Subtotal:</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(subtotal)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="p-2 text-right">IGV 18%:</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(igv)}</td>
                    </tr>
                    <tr className="bg-red-50">
                      <td colSpan={4} className="p-2 text-right">TOTAL NC:</td>
                      <td className="p-2 text-right font-mono text-red-700">{formatCurrency(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={notas} onChange={(e) => setNotas(e.target.value)} className="mt-1" placeholder="Motivo detallado (opcional)" />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={emitir} disabled={saving || itemsPayload.length === 0}
                className="bg-red-600 hover:bg-red-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                <FileMinus className="w-4 h-4 mr-1" />
                Emitir Nota de Crédito
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
