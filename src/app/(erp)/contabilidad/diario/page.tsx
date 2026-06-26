'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Trash2, FileText, ChevronDown, ChevronUp, Check, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface Cuenta {
  id: string
  codigo: string
  nombre: string
  naturaleza: string
  es_movimiento: boolean
}

interface Partida {
  cuenta_id: string
  debe: string
  haber: string
  glosa_partida: string
}

interface Asiento {
  id: string
  numero: string
  fecha: string
  glosa: string
  origen: string
  estado: string
  total_debe: number
  total_haber: number
  notas: string | null
  created_at: string
}

export default function LibroDiarioPage() {
  const router = useRouter()
  const supabase = createClient()
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [asientos, setAsientos] = useState<Asiento[]>([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [detalles, setDetalles] = useState<Map<string, any[]>>(new Map())
  // Nuevo asiento
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    fecha: hoyLima(),
    glosa: '',
    notas: '',
  })
  const [partidas, setPartidas] = useState<Partida[]>([
    { cuenta_id: '', debe: '', haber: '', glosa_partida: '' },
    { cuenta_id: '', debe: '', haber: '', glosa_partida: '' },
  ])

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: cu }, { data: ai }] = await Promise.all([
      (supabase as any).from('cuentas_contables').select('id, codigo, nombre, naturaleza, es_movimiento')
        .eq('activo', true).eq('es_movimiento', true).order('codigo'),
      (supabase as any).from('asientos_contables').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    ])
    setCuentas((cu ?? []) as Cuenta[])
    setAsientos((ai ?? []) as Asiento[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const cargarDetalle = async (asientoId: string) => {
    if (detalles.has(asientoId)) return
    const { data } = await (supabase as any)
      .from('asientos_partidas')
      .select(`*, cuentas_contables(codigo, nombre)`)
      .eq('asiento_id', asientoId).order('orden')
    setDetalles((prev) => new Map(prev).set(asientoId, (data ?? []) as any[]))
  }

  const totales = partidas.reduce(
    (acc, p) => ({
      debe: acc.debe + (parseFloat(p.debe) || 0),
      haber: acc.haber + (parseFloat(p.haber) || 0),
    }),
    { debe: 0, haber: 0 },
  )
  const cuadrado = Math.abs(totales.debe - totales.haber) < 0.005 && totales.debe > 0

  const agregarPartida = () => setPartidas((p) => [...p, { cuenta_id: '', debe: '', haber: '', glosa_partida: '' }])
  const quitarPartida = (idx: number) => {
    if (partidas.length <= 2) {
      toast.error('Mínimo 2 partidas')
      return
    }
    setPartidas((p) => p.filter((_, i) => i !== idx))
  }
  const actualizarPartida = (idx: number, campo: keyof Partida, valor: string) => {
    setPartidas((p) => p.map((q, i) => {
      if (i !== idx) return q
      const next = { ...q, [campo]: valor }
      // Si pone debe > 0, vaciar haber. Y viceversa.
      if (campo === 'debe' && parseFloat(valor) > 0) next.haber = ''
      if (campo === 'haber' && parseFloat(valor) > 0) next.debe = ''
      return next
    }))
  }

  const guardar = async () => {
    if (!form.glosa.trim()) { toast.error('Glosa requerida'); return }
    if (!cuadrado) { toast.error('Asiento descuadrado', { description: `Debe: ${totales.debe.toFixed(2)} ≠ Haber: ${totales.haber.toFixed(2)}` }); return }
    const partidasValidas = partidas.filter((p) => p.cuenta_id && (parseFloat(p.debe) > 0 || parseFloat(p.haber) > 0))
    if (partidasValidas.length < 2) { toast.error('Mínimo 2 partidas con cuenta y monto'); return }

    setSaving(true)
    const { data, error } = await (supabase.rpc as any)('crear_asiento_manual', {
      p_fecha: form.fecha,
      p_glosa: form.glosa,
      p_partidas: partidasValidas.map((p) => ({
        cuenta_id: p.cuenta_id,
        debe: parseFloat(p.debe) || 0,
        haber: parseFloat(p.haber) || 0,
        glosa_partida: p.glosa_partida || null,
      })),
      p_notas: form.notas || null,
    })
    setSaving(false)
    if (error) { toast.error('Error al crear asiento', { description: error.message }); return }
    toast.success(`Asiento ${data.numero} creado en borrador`, {
      description: 'Revisa y asienta para hacerlo definitivo.',
    })
    setNuevoOpen(false)
    setForm({ fecha: hoyLima(), glosa: '', notas: '' })
    setPartidas([
      { cuenta_id: '', debe: '', haber: '', glosa_partida: '' },
      { cuenta_id: '', debe: '', haber: '', glosa_partida: '' },
    ])
    cargar()
  }

  const asentar = async (asientoId: string) => {
    if (!confirm('¿Asentar este asiento? Después de asentar no se puede modificar.')) return
    const { error } = await (supabase.rpc as any)('asentar_asiento', { p_asiento_id: asientoId })
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Asiento asentado')
    cargar()
  }

  const anular = async (asientoId: string) => {
    const motivo = prompt('Motivo de anulación (mín 5 caracteres):')
    if (!motivo || motivo.trim().length < 5) return
    const { error } = await (supabase.rpc as any)('anular_asiento', { p_asiento_id: asientoId, p_motivo: motivo })
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Asiento anulado')
    cargar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Libro Diario</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {asientos.length} asientos · {asientos.filter((a) => a.estado === 'borrador').length} en borrador
          </p>
        </div>
        <Button onClick={() => setNuevoOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
          <Plus className="w-4 h-4" />
          Nuevo asiento
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : asientos.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aún no hay asientos. Crea el primero.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Número</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Fecha</th>
                <th className="text-left p-2 font-semibold text-gray-600">Glosa</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-20">Origen</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Debe</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Haber</th>
                <th className="text-center p-2 font-semibold text-gray-600 w-24">Estado</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {asientos.map((a) => {
                const exp = expandido === a.id
                return (
                  <>
                    <tr key={a.id} className={`border-b border-gray-100 hover:bg-gray-50/60 cursor-pointer ${a.estado === 'anulado' ? 'opacity-50' : ''}`}
                      onClick={() => { setExpandido(exp ? null : a.id); if (!exp) cargarDetalle(a.id) }}>
                      <td className="p-2 font-mono text-xs">
                        {exp ? <ChevronUp className="w-3 h-3 inline mr-1" /> : <ChevronDown className="w-3 h-3 inline mr-1" />}
                        {a.numero}
                      </td>
                      <td className="p-2 font-mono text-xs">{formatDate(a.fecha)}</td>
                      <td className="p-2">{a.glosa}</td>
                      <td className="p-2 text-[10px] uppercase text-gray-500">{a.origen}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(a.total_debe)}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(a.total_haber)}</td>
                      <td className="p-2 text-center">
                        {a.estado === 'borrador' && (
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">BORRADOR</span>
                        )}
                        {a.estado === 'asentado' && (
                          <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold">ASENTADO</span>
                        )}
                        {a.estado === 'anulado' && (
                          <span className="text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-bold">ANULADO</span>
                        )}
                      </td>
                      <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                        {a.estado === 'borrador' && (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => asentar(a.id)} title="Asentar"
                              className="text-green-700 hover:bg-green-50 rounded p-1"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => anular(a.id)} title="Anular"
                              className="text-red-700 hover:bg-red-50 rounded p-1"><XCircle className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {exp && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="bg-gray-50 p-3 border-b border-gray-200">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500">
                                  <th className="text-left p-1.5 w-24">Cuenta</th>
                                  <th className="text-left p-1.5">Nombre</th>
                                  <th className="text-right p-1.5 w-28">Debe</th>
                                  <th className="text-right p-1.5 w-28">Haber</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(detalles.get(a.id) ?? []).map((p: any) => (
                                  <tr key={p.id} className="border-t border-gray-200">
                                    <td className="p-1.5 font-mono">{p.cuentas_contables?.codigo}</td>
                                    <td className="p-1.5">{p.cuentas_contables?.nombre}
                                      {p.glosa_partida && <span className="block text-[10px] text-gray-500 italic">{p.glosa_partida}</span>}
                                    </td>
                                    <td className="p-1.5 text-right font-mono">{Number(p.debe) > 0 ? formatCurrency(p.debe) : ''}</td>
                                    <td className="p-1.5 text-right font-mono">{Number(p.haber) > 0 ? formatCurrency(p.haber) : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {a.notas && <p className="text-[10px] text-gray-500 italic mt-2">Notas: {a.notas}</p>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog nuevo asiento */}
      <Dialog open={nuevoOpen} onOpenChange={(o) => { if (!saving) setNuevoOpen(o) }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo asiento contable</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Fecha *</Label>
                <Input type="date" value={form.fecha} onChange={(e) => setForm((p) => ({ ...p, fecha: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-semibold">Glosa *</Label>
                <Input value={form.glosa} onChange={(e) => setForm((p) => ({ ...p, glosa: e.target.value }))} className="mt-1"
                  placeholder="Ej: Provisión sueldos enero" />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Partidas</Label>
              <div className="border border-gray-200 rounded-lg overflow-hidden mt-1">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left p-2 w-44">Cuenta</th>
                      <th className="text-left p-2">Glosa partida</th>
                      <th className="text-right p-2 w-28">Debe</th>
                      <th className="text-right p-2 w-28">Haber</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {partidas.map((p, idx) => (
                      <tr key={idx} className="border-b border-gray-100 last:border-0">
                        <td className="p-1.5">
                          <select value={p.cuenta_id} onChange={(e) => actualizarPartida(idx, 'cuenta_id', e.target.value)}
                            className="w-full h-8 px-1.5 text-xs border border-gray-300 rounded bg-white">
                            <option value="">— Selecciona —</option>
                            {cuentas.map((c) => (
                              <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <Input value={p.glosa_partida} onChange={(e) => actualizarPartida(idx, 'glosa_partida', e.target.value)}
                            className="h-8 text-xs" />
                        </td>
                        <td className="p-1.5">
                          <Input type="number" step="0.01" min="0" value={p.debe}
                            onChange={(e) => actualizarPartida(idx, 'debe', e.target.value)}
                            className="h-8 text-xs text-right font-mono" />
                        </td>
                        <td className="p-1.5">
                          <Input type="number" step="0.01" min="0" value={p.haber}
                            onChange={(e) => actualizarPartida(idx, 'haber', e.target.value)}
                            className="h-8 text-xs text-right font-mono" />
                        </td>
                        <td className="p-1.5 text-center">
                          <button onClick={() => quitarPartida(idx)} className="text-red-600 hover:bg-red-50 rounded p-1"
                            disabled={partidas.length <= 2}>
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className={`${cuadrado ? 'bg-green-50' : 'bg-red-50'} border-t-2 ${cuadrado ? 'border-green-300' : 'border-red-300'}`}>
                    <tr>
                      <td colSpan={2} className="p-2 text-right font-bold">
                        {cuadrado ? '✓ Cuadrado' : '⚠ Descuadrado'}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">{formatCurrency(totales.debe)}</td>
                      <td className="p-2 text-right font-mono font-bold">{formatCurrency(totales.haber)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Button variant="outline" size="sm" onClick={agregarPartida} className="mt-2 gap-1">
                <Plus className="w-3 h-3" />
                Agregar partida
              </Button>
            </div>

            <div>
              <Label className="text-xs font-semibold">Notas (opcional)</Label>
              <Input value={form.notas} onChange={(e) => setForm((p) => ({ ...p, notas: e.target.value }))} className="mt-1" />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setNuevoOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving || !cuadrado} className="bg-emerald-600 hover:bg-emerald-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Crear asiento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
