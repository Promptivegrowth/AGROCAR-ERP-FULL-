'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, ScrollText, AlertTriangle, TrendingUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface DJ {
  id: string
  numero: string
  fecha: string
  concepto: string
  monto: number
  tercero_id: string | null
  cuenta_contable: string
  metodo_pago: string
  notas: string | null
  tercero_nombre?: string
}
interface Tercero { id: string; nombres: string; apellidos: string | null; numero_doc: string }
interface Cuenta { codigo: string; nombre: string }
interface CentroCosto { id: string; codigo: string; nombre: string }

const METODOS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'yape', label: 'Yape' },
  { value: 'plin', label: 'Plin' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'caja_chica', label: 'Caja Chica' },
]

export default function DJPage() {
  const router = useRouter()
  const supabase = createClient()
  const [djs, setDjs] = useState<DJ[]>([])
  const [tope, setTope] = useState<any>(null)
  const [terceros, setTerceros] = useState<Tercero[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [centros, setCentros] = useState<CentroCosto[]>([])
  const [loading, setLoading] = useState(true)
  const [anio, setAnio] = useState(new Date().getFullYear())

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    fecha: hoyLima(),
    concepto: '',
    monto: '',
    cuenta_contable: '638',
    tercero_id: '',
    centro_costo_id: '',
    metodo_pago: 'efectivo',
    notas: '',
  })

  const cargar = useCallback(async () => {
    setLoading(true)
    const [djsRes, topeRes, terRes, ctaRes, ccRes] = await Promise.all([
      (supabase as any).from('declaraciones_juradas')
        .select(`*, terceros(nombres, apellidos)`)
        .gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`)
        .order('fecha', { ascending: false }),
      (supabase.rpc as any)('porcentaje_djs_anio', { p_anio: anio }),
      (supabase as any).from('terceros').select('id, nombres, apellidos, numero_doc').eq('activo', true).order('nombres'),
      (supabase as any).from('cuentas_contables')
        .select('codigo, nombre')
        .in('codigo', ['631','6311','632','634','638','639','651','656','6561','659','635','637'])
        .order('codigo'),
      (supabase as any).from('centros_costo').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    ])
    setDjs(((djsRes.data ?? []) as any[]).map((d) => ({
      ...d,
      tercero_nombre: d.terceros ? `${d.terceros.nombres} ${d.terceros.apellidos ?? ''}`.trim() : null,
    })))
    setTope(topeRes.data)
    setTerceros((terRes.data ?? []) as Tercero[])
    setCuentas((ctaRes.data ?? []) as Cuenta[])
    setCentros((ccRes.data ?? []) as CentroCosto[])
    setLoading(false)
  }, [supabase, anio])

  useEffect(() => { cargar() }, [cargar])

  const registrar = async () => {
    if (!form.concepto.trim()) { toast.error('Concepto obligatorio'); return }
    const monto = parseFloat(form.monto)
    if (isNaN(monto) || monto <= 0) { toast.error('Monto inválido'); return }
    if (!form.cuenta_contable) { toast.error('Cuenta contable requerida'); return }

    setSaving(true)
    const { error } = await (supabase.rpc as any)('registrar_declaracion_jurada', {
      p_fecha: form.fecha,
      p_concepto: form.concepto,
      p_monto: monto,
      p_cuenta_contable: form.cuenta_contable,
      p_tercero_id: form.tercero_id || null,
      p_centro_costo_id: form.centro_costo_id || null,
      p_metodo_pago: form.metodo_pago,
      p_notas: form.notas || null,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Declaración jurada registrada')
    setOpen(false)
    setForm({ fecha: hoyLima(), concepto: '', monto: '', cuenta_contable: '638', tercero_id: '', centro_costo_id: '', metodo_pago: 'efectivo', notas: '' })
    cargar()
  }

  const pct = Number(tope?.porcentaje_usado ?? 0)
  const estadoColor = pct >= 6 ? 'red' : pct >= 5 ? 'red' : pct >= 3 ? 'amber' : 'emerald'
  const barColor = pct >= 6 ? 'bg-red-500' : pct >= 5 ? 'bg-red-400' : pct >= 3 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-amber-600" />
            Declaraciones Juradas
          </h1>
          <p className="text-sm text-gray-500">
            Gastos sin comprobante formal. Tope legal: 6% de compras acreditadas anuales.
          </p>
        </div>
        <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {[anio + 1, anio, anio - 1, anio - 2].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <Button onClick={() => setOpen(true)} className="bg-amber-600 hover:bg-amber-700 gap-1">
          <Plus className="w-4 h-4" /> Nueva declaración
        </Button>
      </div>

      {/* Tope 6% barra visual */}
      {tope && (
        <div className={`bg-white border-2 border-${estadoColor}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs text-gray-600 uppercase font-semibold">Control del tope 6% anual · {anio}</p>
              <p className="text-lg font-bold flex items-center gap-2">
                {pct.toFixed(2)}% usado
                {pct >= 5 && <AlertTriangle className={`w-4 h-4 text-${estadoColor}-600`} />}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">
                DJs {anio}: <strong>{formatCurrency(tope.djs_total)}</strong> / <strong>{formatCurrency(tope.tope_absoluto)}</strong>
              </p>
              <p className="text-xs text-gray-500">
                Base (compras formales): {formatCurrency(tope.compras_formales)}
              </p>
              <p className={`text-xs font-semibold text-${estadoColor}-700`}>
                Disponible: {formatCurrency(tope.disponible)}
              </p>
            </div>
          </div>
          {/* Barra progresiva */}
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            <div className={`${barColor} h-full transition-all`} style={{ width: `${Math.min(pct / 6 * 100, 100)}%` }}></div>
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
            <span>0%</span><span>3%</span><span>5%</span><span className="font-bold">6% tope</span>
          </div>
          {pct >= 5 && (
            <div className={`mt-2 p-2 rounded bg-${estadoColor}-50 border border-${estadoColor}-200 text-xs text-${estadoColor}-800`}>
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              {pct >= 6
                ? `SUPERASTE EL TOPE. Las DJs adicionales serán observables por SUNAT en la declaración anual.`
                : `Cerca del tope 6%. No hagas DJs adicionales si es posible obtener comprobante formal.`}
            </div>
          )}
        </div>
      )}

      {/* Lista */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : djs.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Sin declaraciones juradas en {anio}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Número</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Fecha</th>
                <th className="text-left p-2 font-semibold text-gray-600">Concepto</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-40">Tercero</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Cuenta</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-28">Pago</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Monto</th>
              </tr>
            </thead>
            <tbody>
              {djs.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="p-2 font-mono text-xs">{d.numero}</td>
                  <td className="p-2 font-mono text-xs">{formatDate(d.fecha)}</td>
                  <td className="p-2">{d.concepto}</td>
                  <td className="p-2 text-xs text-gray-600">{d.tercero_nombre ?? '—'}</td>
                  <td className="p-2 font-mono text-xs">{d.cuenta_contable}</td>
                  <td className="p-2 text-xs capitalize">{d.metodo_pago.replace('_', ' ')}</td>
                  <td className="p-2 text-right font-mono font-semibold text-red-700">{formatCurrency(d.monto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold">
              <tr>
                <td colSpan={6} className="p-2 text-right">TOTAL DJs {anio}</td>
                <td className="p-2 text-right font-mono text-red-800">{formatCurrency(djs.reduce((a, d) => a + Number(d.monto), 0))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Dialog crear */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nueva declaración jurada</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Fecha *</Label>
                <Input type="date" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Concepto *</Label>
                <Input value={form.concepto} onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))}
                  className="mt-1" placeholder="Ej: Movilidad y estiba" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Monto (S/) *</Label>
                <Input type="number" step="0.01" min="0" value={form.monto}
                  onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Cuenta contable *</Label>
                <select value={form.cuenta_contable} onChange={(e) => setForm((f) => ({ ...f, cuenta_contable: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  {cuentas.map((c) => (
                    <option key={c.codigo} value={c.codigo}>{c.codigo} - {c.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Método pago</Label>
                <select value={form.metodo_pago} onChange={(e) => setForm((f) => ({ ...f, metodo_pago: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  {METODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tercero (opcional)</Label>
                <select value={form.tercero_id} onChange={(e) => setForm((f) => ({ ...f, tercero_id: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="">— Ninguno —</option>
                  {terceros.map((t) => (
                    <option key={t.id} value={t.id}>{t.nombres} {t.apellidos ?? ''} · {t.numero_doc}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Centro de costo</Label>
                <select value={form.centro_costo_id} onChange={(e) => setForm((f) => ({ ...f, centro_costo_id: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="">— Sin CC —</option>
                  {centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={registrar} disabled={saving} className="bg-amber-600 hover:bg-amber-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Registrar + Contabilizar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
