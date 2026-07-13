'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Gift, Palmtree, Calculator, Zap, Plus, Printer } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

type Tab = 'provisiones' | 'vacaciones' | 'liquidacion'

interface Trabajador { id: string; codigo: string; nombres: string; apellido_paterno: string; estado: string; fecha_ingreso: string }

export default function BeneficiosPage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [tab, setTab] = useState<Tab>('provisiones')
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)

  const [provisiones, setProvisiones] = useState<any[]>([])
  const [vacaciones, setVacaciones] = useState<any[]>([])
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([])

  // Vacaciones dialog
  const [vacOpen, setVacOpen] = useState(false)
  const [vacForm, setVacForm] = useState({ trabajador_id: '', fecha_inicio: hoyLima(), fecha_fin: hoyLima(), notas: '' })
  const [saving, setSaving] = useState(false)

  // Liquidación
  const [liqTrabajador, setLiqTrabajador] = useState('')
  const [liqFecha, setLiqFecha] = useState(hoyLima())
  const [liqResult, setLiqResult] = useState<any>(null)
  const [liqCalc, setLiqCalc] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: provs }, { data: vacs }, { data: trabs }] = await Promise.all([
      (supabase as any).from('provisiones_beneficios')
        .select(`*, trabajadores(codigo, nombres, apellido_paterno)`)
        .eq('anio', anio).eq('mes', mes),
      (supabase as any).from('vacaciones')
        .select(`*, trabajadores(codigo, nombres, apellido_paterno)`)
        .order('fecha_inicio', { ascending: false }).limit(50),
      (supabase as any).from('trabajadores')
        .select('id, codigo, nombres, apellido_paterno, estado, fecha_ingreso')
        .order('codigo'),
    ])
    setProvisiones((provs ?? []) as any[])
    setVacaciones((vacs ?? []) as any[])
    setTrabajadores((trabs ?? []) as Trabajador[])
    setLoading(false)
  }, [supabase, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  const generarProvisiones = async () => {
    if (!confirm(`¿Generar provisiones de ${MESES[mes-1]} ${anio}?\n\nSe devengan vacaciones (1/12), gratificación (1/6) y CTS ((rem+1/6)/12) de cada trabajador activo en UN asiento consolidado.`)) return
    setGenerando(true)
    const { data, error } = await (supabase.rpc as any)('generar_provisiones_mes', { p_anio: anio, p_mes: mes })
    setGenerando(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    if (!data?.trabajadores) { toast.info(data?.mensaje ?? 'Sin pendientes'); return }
    toast.success(`Provisiones generadas: ${data.trabajadores} trabajadores`, {
      description: `Vac ${formatCurrency(data.total_vacaciones)} · Grati ${formatCurrency(data.total_gratificacion)} · CTS ${formatCurrency(data.total_cts)} → Asiento ${data.numero_asiento}`,
    })
    cargar()
  }

  const guardarVacaciones = async () => {
    if (!vacForm.trabajador_id) { toast.error('Selecciona trabajador'); return }
    const ini = new Date(vacForm.fecha_inicio), fin = new Date(vacForm.fecha_fin)
    if (fin < ini) { toast.error('Rango de fechas inválido'); return }
    const dias = Math.round((fin.getTime() - ini.getTime()) / 86400000) + 1
    if (dias > 30) {
      toast.warning(`${dias} días programados`, { description: 'El descanso vacacional anual es de 30 días. Verifica.' })
    }
    setSaving(true)
    const { error } = await (supabase as any).from('vacaciones').insert({
      trabajador_id: vacForm.trabajador_id,
      fecha_inicio: vacForm.fecha_inicio,
      fecha_fin: vacForm.fecha_fin,
      dias,
      notas: vacForm.notas || null,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(`Vacaciones programadas (${dias} días)`)
    setVacOpen(false)
    cargar()
  }

  const marcarGozada = async (id: string) => {
    await (supabase as any).from('vacaciones').update({ estado: 'gozada' }).eq('id', id)
    cargar()
  }

  const calcularLiq = async () => {
    if (!liqTrabajador) { toast.error('Selecciona trabajador'); return }
    setLiqCalc(true)
    const { data, error } = await (supabase.rpc as any)('calcular_liquidacion', {
      p_trabajador_id: liqTrabajador, p_fecha_cese: liqFecha,
    })
    setLiqCalc(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    setLiqResult(data)
  }

  // Totales de provisiones para KPIs
  const totProv = { vacaciones: 0, gratificacion: 0, cts: 0 }
  provisiones.forEach((p) => { (totProv as any)[p.tipo] += Number(p.monto) })

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 14mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Gift className="w-6 h-6 text-pink-600" />
            Beneficios Sociales
          </h1>
          <p className="text-sm text-gray-500">Provisiones mensuales · vacaciones · liquidaciones de cese</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 no-print">
        {([
          { key: 'provisiones', label: 'Provisiones mensuales', icon: Zap },
          { key: 'vacaciones', label: 'Vacaciones', icon: Palmtree },
          { key: 'liquidacion', label: 'Liquidación de cese', icon: Calculator },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-1.5 ${
              tab === t.key ? 'border-pink-600 text-pink-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'provisiones' && (
        <>
          <div className="flex items-center gap-3 no-print">
            <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
              className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
              {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
              className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
              {[anio + 1, anio, anio - 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="flex-1" />
            <Button onClick={generarProvisiones} disabled={generando} className="bg-pink-600 hover:bg-pink-700 gap-1">
              {generando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Generar provisiones del mes
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 no-print">
            <strong>Norma (D.L. 728):</strong> Vacaciones = rem. computable ÷ 12 ·
            Gratificación = rem. ÷ 6 (jul y dic) · CTS = (rem. + 1/6 grati) ÷ 12 (depósitos may y nov).
            Remuneración computable incluye asignación familiar.
          </div>

          {provisiones.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <p className="text-[10px] text-emerald-700 uppercase font-semibold">🌴 Vacaciones</p>
                <p className="text-xl font-bold font-mono text-emerald-900">{formatCurrency(totProv.vacaciones)}</p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <p className="text-[10px] text-purple-700 uppercase font-semibold">🎁 Gratificación</p>
                <p className="text-xl font-bold font-mono text-purple-900">{formatCurrency(totProv.gratificacion)}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-[10px] text-amber-700 uppercase font-semibold">💰 CTS</p>
                <p className="text-xl font-bold font-mono text-amber-900">{formatCurrency(totProv.cts)}</p>
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : provisiones.length === 0 ? (
              <p className="text-center py-12 text-gray-400 text-sm">
                Sin provisiones para {MESES[mes - 1]} {anio}. Genera con el botón superior.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Trabajador</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-32">Base computable</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-28">Vacaciones</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-28">Gratificación</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-28">CTS</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(provisiones.reduce((acc: any, p: any) => {
                    const key = p.trabajador_id
                    if (!acc[key]) acc[key] = {
                      nombre: `${p.trabajadores?.nombres} ${p.trabajadores?.apellido_paterno}`,
                      codigo: p.trabajadores?.codigo,
                      base: Number(p.base_computable),
                      vacaciones: 0, gratificacion: 0, cts: 0,
                    }
                    acc[key][p.tipo] = Number(p.monto)
                    return acc
                  }, {})).map((f: any) => (
                    <tr key={f.codigo} className="border-b border-gray-100">
                      <td className="p-2"><span className="font-mono text-[10px] text-gray-400 mr-1">{f.codigo}</span>{f.nombre}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(f.base)}</td>
                      <td className="p-2 text-right font-mono text-emerald-700">{formatCurrency(f.vacaciones)}</td>
                      <td className="p-2 text-right font-mono text-purple-700">{formatCurrency(f.gratificacion)}</td>
                      <td className="p-2 text-right font-mono text-amber-700">{formatCurrency(f.cts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'vacaciones' && (
        <>
          <div className="flex justify-end no-print">
            <Button onClick={() => { setVacForm({ trabajador_id: '', fecha_inicio: hoyLima(), fecha_fin: hoyLima(), notas: '' }); setVacOpen(true) }}
              className="bg-emerald-600 hover:bg-emerald-700 gap-1">
              <Plus className="w-4 h-4" /> Programar vacaciones
            </Button>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {vacaciones.length === 0 ? (
              <p className="text-center py-12 text-gray-400 text-sm">Sin vacaciones registradas</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Trabajador</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-28">Inicio</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-28">Fin</th>
                    <th className="text-center p-2 font-semibold text-gray-600 w-16">Días</th>
                    <th className="text-center p-2 font-semibold text-gray-600 w-28">Estado</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {vacaciones.map((v: any) => (
                    <tr key={v.id} className="border-b border-gray-100">
                      <td className="p-2">
                        <span className="font-mono text-[10px] text-gray-400 mr-1">{v.trabajadores?.codigo}</span>
                        {v.trabajadores?.nombres} {v.trabajadores?.apellido_paterno}
                      </td>
                      <td className="p-2 font-mono text-xs">{formatDate(v.fecha_inicio)}</td>
                      <td className="p-2 font-mono text-xs">{formatDate(v.fecha_fin)}</td>
                      <td className="p-2 text-center font-mono font-bold">{v.dias}</td>
                      <td className="p-2 text-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          v.estado === 'programada' ? 'bg-blue-100 text-blue-800' :
                          v.estado === 'gozada' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-500'
                        }`}>
                          {v.estado.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-2 text-right">
                        {v.estado === 'programada' && (
                          <button onClick={() => marcarGozada(v.id)}
                            className="text-[10px] px-2 py-1 bg-green-50 hover:bg-green-100 text-green-700 font-semibold rounded">
                            ✓ Marcar gozada
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'liquidacion' && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-4 no-print">
            <p className="text-sm font-semibold text-gray-700 mb-3">Simular / calcular liquidación de beneficios sociales</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label className="text-xs">Trabajador *</Label>
                <select value={liqTrabajador} onChange={(e) => setLiqTrabajador(e.target.value)}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="">— Seleccionar —</option>
                  {trabajadores.map((t) => (
                    <option key={t.id} value={t.id}>{t.codigo} · {t.nombres} {t.apellido_paterno} ({t.estado})</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Fecha de cese</Label>
                <Input type="date" value={liqFecha} onChange={(e) => setLiqFecha(e.target.value)} className="mt-1" />
              </div>
              <Button onClick={calcularLiq} disabled={liqCalc} className="bg-pink-600 hover:bg-pink-700 gap-1 h-9">
                {liqCalc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                Calcular liquidación
              </Button>
            </div>
          </div>

          {liqResult && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 print:border-0 print:p-0">
              {/* Header impresión */}
              <div className="hidden print:block pb-3 border-b-2 border-black mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
                    <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 13 }}>{EMPRESA.slogan}</p>
                  </div>
                  <p className="font-bold text-sm">LIQUIDACIÓN DE BENEFICIOS SOCIALES</p>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-bold text-lg">{liqResult.trabajador}</p>
                  <p className="text-xs text-gray-500">
                    Ingreso: {formatDate(liqResult.fecha_ingreso)} · Cese: {formatDate(liqResult.fecha_cese)} ·
                    Base computable: {formatCurrency(liqResult.base_computable)}
                  </p>
                </div>
                <button onClick={() => window.print()}
                  className="no-print inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
                  <Printer className="w-3.5 h-3.5" /> Imprimir
                </button>
              </div>

              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Concepto</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-40">Tiempo computable</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-32">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="p-2">🌴 Vacaciones truncas</td>
                    <td className="p-2 text-xs text-gray-500">
                      {liqResult.vacaciones_truncas.meses} meses {liqResult.vacaciones_truncas.dias} días
                    </td>
                    <td className="p-2 text-right font-mono">{formatCurrency(liqResult.vacaciones_truncas.monto)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="p-2">🎁 Gratificación trunca</td>
                    <td className="p-2 text-xs text-gray-500">{liqResult.gratificacion_trunca.meses} meses del semestre</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(liqResult.gratificacion_trunca.monto)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="p-2 pl-6 text-gray-600">+ Bonificación extraordinaria 9% (Ley 30334)</td>
                    <td className="p-2"></td>
                    <td className="p-2 text-right font-mono">{formatCurrency(liqResult.gratificacion_trunca.bonificacion_9pct)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="p-2">💰 CTS trunca</td>
                    <td className="p-2 text-xs text-gray-500">
                      {liqResult.cts_trunca.meses} meses {liqResult.cts_trunca.dias} días desde último depósito
                    </td>
                    <td className="p-2 text-right font-mono">{formatCurrency(liqResult.cts_trunca.monto)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-[#FBE600] border-t-2 border-yellow-500 font-bold">
                    <td colSpan={2} className="p-3 text-right">TOTAL LIQUIDACIÓN</td>
                    <td className="p-3 text-right font-mono text-lg">{formatCurrency(liqResult.total_liquidacion)}</td>
                  </tr>
                </tfoot>
              </table>

              <p className="text-[10px] text-gray-400 mt-4 italic">
                Cálculo referencial según D.L. 728, D.S. 001-97-TR (CTS) y Ley 27735 (gratificaciones).
                No incluye remuneraciones pendientes del mes ni descuentos por préstamos/adelantos.
                Verificar con el asesor laboral antes del pago.
              </p>
            </div>
          )}
        </>
      )}

      {/* Dialog programar vacaciones */}
      <Dialog open={vacOpen} onOpenChange={setVacOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Programar vacaciones</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs">Trabajador *</Label>
              <select value={vacForm.trabajador_id} onChange={(e) => setVacForm((f) => ({ ...f, trabajador_id: e.target.value }))}
                className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                <option value="">— Seleccionar —</option>
                {trabajadores.filter((t) => t.estado === 'activo').map((t) => (
                  <option key={t.id} value={t.id}>{t.codigo} · {t.nombres} {t.apellido_paterno}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Desde *</Label>
                <Input type="date" value={vacForm.fecha_inicio}
                  onChange={(e) => setVacForm((f) => ({ ...f, fecha_inicio: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Hasta *</Label>
                <Input type="date" value={vacForm.fecha_fin} min={vacForm.fecha_inicio}
                  onChange={(e) => setVacForm((f) => ({ ...f, fecha_fin: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={vacForm.notas} onChange={(e) => setVacForm((f) => ({ ...f, notas: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setVacOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardarVacaciones} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Programar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
