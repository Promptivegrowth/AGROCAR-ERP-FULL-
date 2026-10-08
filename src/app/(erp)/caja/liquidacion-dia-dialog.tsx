'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { horaLima } from '@/lib/fechas-pe'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * La liquidación de un día, desde Caja → Acumulado por fechas (Daniel,
 * 07/10): al tocar un día se ve quién cobró cuánto (con su hoja de rendición)
 * y cada cobro —cliente, a qué comprobante se aplicó, medio de pago y N° de
 * operación— para verificar los pagos de los clientes.
 */

interface Cobro {
  id: string; numero: string | null; created_at: string
  cliente: string; cobrador_id: string | null; cobrador: string
  efectivo: number; yape: number; plin: number; transferencia: number; total: number
  nro_operacion: string | null; notas: string | null; aplicado: string
}

const S = (v: number) => formatCurrency(v)
const medios = (c: Cobro) => [
  c.efectivo > 0 && `Efectivo ${S(c.efectivo)}`, c.yape > 0 && `Yape ${S(c.yape)}`,
  c.plin > 0 && `Plin ${S(c.plin)}`, c.transferencia > 0 && `Transf. ${S(c.transferencia)}`,
].filter(Boolean).join(' · ')

export default function LiquidacionDiaDialog({ fecha, onClose }: { fecha: string | null; onClose: () => void }) {
  const supabase = createClient()
  const [cobros, setCobros] = useState<Cobro[] | null>(null)
  const [cobrador, setCobrador] = useState('todos')
  const [buscar, setBuscar] = useState('')

  useEffect(() => {
    if (!fecha) return
    setCobros(null); setCobrador('todos'); setBuscar('')
    ;(async () => {
      // Por función de la base: con los permisos de cada tabla, el rol caja no
      // veía clientes, cobradores ni comprobantes (migración 136).
      const { data, error } = await (supabase.rpc as any)('liquidacion_dia', { p_fecha: fecha })
      if (error) { setCobros([]); return }
      setCobros(((data ?? []) as any[]).map((c) => ({
        id: c.id, numero: c.numero, created_at: c.created_at,
        cliente: c.cliente, cobrador_id: c.cobrador_id, cobrador: c.cobrador,
        efectivo: Number(c.efectivo ?? 0), yape: Number(c.yape ?? 0), plin: Number(c.plin ?? 0),
        transferencia: Number(c.transferencia ?? 0), total: Number(c.total ?? 0),
        nro_operacion: c.nro_operacion, notas: c.notas, aplicado: c.aplicado,
      })))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha])

  const porCobrador = useMemo(() => {
    const m = new Map<string, { id: string | null; nombre: string; n: number; efectivo: number; digital: number; total: number }>()
    for (const c of cobros ?? []) {
      const k = c.cobrador_id ?? 'sin'
      const g = m.get(k) ?? { id: c.cobrador_id, nombre: c.cobrador, n: 0, efectivo: 0, digital: 0, total: 0 }
      g.n++; g.efectivo += c.efectivo; g.digital += c.yape + c.plin + c.transferencia; g.total += c.total
      m.set(k, g)
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total)
  }, [cobros])

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return (cobros ?? []).filter((c) => (cobrador === 'todos' || (c.cobrador_id ?? 'sin') === cobrador)
      && (!q || `${c.cliente} ${c.numero ?? ''} ${c.aplicado} ${c.nro_operacion ?? ''}`.toLowerCase().includes(q)))
  }, [cobros, cobrador, buscar])
  const totalVisible = visibles.reduce((a, c) => a + c.total, 0)
  const totalDia = (cobros ?? []).reduce((a, c) => a + c.total, 0)

  return (
    <Dialog open={!!fecha} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto" data-liquidacion-dia>
        <DialogHeader>
          <DialogTitle>Liquidación del {fecha ? formatDate(fecha) : ''} · {(cobros ?? []).length} cobros · {S(totalDia)}</DialogTitle>
        </DialogHeader>
        {!cobros ? (
          <p className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando cobros…</p>
        ) : (
          <div className="space-y-4">
            {/* Por cobrador, con su hoja de rendición */}
            <table className="w-full text-xs">
              <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
                <tr><th className="p-2 text-left">Cobrador</th><th className="p-2 text-right">Cobros</th><th className="p-2 text-right">Efectivo</th>
                  <th className="p-2 text-right">Yape / Plin / Transf.</th><th className="p-2 text-right">Total</th><th className="p-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {porCobrador.map((g) => (
                  <tr key={g.id ?? 'sin'} className={cobrador === (g.id ?? 'sin') ? 'bg-yellow-50' : ''}>
                    <td className="p-2">
                      <button type="button" className="font-semibold text-gray-900 hover:underline" onClick={() => setCobrador(cobrador === (g.id ?? 'sin') ? 'todos' : (g.id ?? 'sin'))}>
                        {g.nombre}
                      </button>
                    </td>
                    <td className="p-2 text-right">{g.n}</td>
                    <td className="p-2 text-right font-mono">{S(g.efectivo)}</td>
                    <td className="p-2 text-right font-mono">{S(g.digital)}</td>
                    <td className="p-2 text-right font-mono font-bold">{S(g.total)}</td>
                    <td className="p-2 text-right">
                      {g.id && (
                        <a href={`/rendicion/${g.id}?fecha=${fecha}`} target="_blank" rel="noopener noreferrer" data-rendicion
                          className="inline-flex items-center gap-1 rounded bg-[#FBE600] px-2 py-1 text-[11px] font-semibold text-black hover:bg-[#E5D100]">
                          🧾 Rendición
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cada cobro */}
            <div className="flex flex-wrap items-center gap-2">
              <select value={cobrador} onChange={(e) => setCobrador(e.target.value)} aria-label="Cobrador"
                className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs">
                <option value="todos">Todos los cobradores</option>
                {porCobrador.map((g) => <option key={g.id ?? 'sin'} value={g.id ?? 'sin'}>{g.nombre}</option>)}
              </select>
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-2 top-2 h-4 w-4 text-gray-400" />
                <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cliente, recibo, boleta o N° de operación"
                  className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 pl-8 text-xs" />
              </div>
              <span className="text-xs text-gray-500">{visibles.length} cobros · <b>{S(totalVisible)}</b></span>
            </div>
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="w-full min-w-[900px] text-xs" data-cobros-dia>
                <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>{['Hora', 'Recibo', 'Cliente', 'Pagó', 'Cobró', 'Medio de pago', 'N° operación', 'Total'].map((h, i) =>
                    <th key={h} className={`p-2 ${i === 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibles.map((c) => (
                    <tr key={c.id} data-cobro-dia>
                      <td className="p-2 whitespace-nowrap">{horaLima(c.created_at)}</td>
                      <td className="p-2 font-mono whitespace-nowrap">
                        <a href={`/boleta/${c.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{c.numero ?? '—'}</a>
                      </td>
                      <td className="p-2 max-w-[220px] truncate" title={c.cliente}>{c.cliente}</td>
                      <td className="p-2 font-mono text-[11px]">{c.aplicado}</td>
                      <td className="p-2 max-w-[160px] truncate">{c.cobrador}</td>
                      <td className="p-2 text-[11px]">{medios(c)}{c.notas ? <span className="block text-amber-700" title={c.notas}>{c.notas}</span> : null}</td>
                      <td className="p-2 font-mono">{c.nro_operacion ?? '—'}</td>
                      <td className="p-2 text-right font-mono font-semibold">{S(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
