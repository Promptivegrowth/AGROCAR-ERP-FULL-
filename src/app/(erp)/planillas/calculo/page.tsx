'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Calculator, Lock, Clock, RefreshCw, Printer } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

interface Planilla {
  id: string
  anio: number
  mes: number
  estado: string
  total_ingresos: number
  total_descuentos: number
  total_neto: number
  total_aportes_empleador: number
  trabajadores_count: number
}

interface Detalle {
  trabajador_id: string
  concepto_id: string
  monto: number
  trabajador_nombre?: string
  concepto_codigo?: string
  concepto_nombre?: string
  concepto_tipo?: string
}

interface TrabajadorHE {
  id: string
  codigo: string
  nombre: string
  horas_25: number
  horas_35: number
}

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  borrador: { label: 'BORRADOR', cls: 'bg-gray-200 text-gray-700' },
  calculada: { label: 'CALCULADA', cls: 'bg-blue-100 text-blue-800' },
  cerrada: { label: '🔒 CERRADA', cls: 'bg-amber-100 text-amber-800' },
  pagada: { label: '✓ PAGADA', cls: 'bg-green-100 text-green-800' },
}

export default function PlanillaCalculoPage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [planilla, setPlanilla] = useState<Planilla | null>(null)
  const [detalles, setDetalles] = useState<Detalle[]>([])
  const [loading, setLoading] = useState(true)
  const [calculando, setCalculando] = useState(false)
  const [cerrando, setCerrando] = useState(false)

  // Horas extras
  const [heOpen, setHeOpen] = useState(false)
  const [heTrabajadores, setHeTrabajadores] = useState<TrabajadorHE[]>([])
  const [heSaving, setHeSaving] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data: p } = await (supabase as any)
      .from('planillas').select('*')
      .eq('anio', anio).eq('mes', mes).maybeSingle()
    setPlanilla(p as any)
    if (p) {
      const { data: d } = await (supabase as any)
        .from('planilla_detalle')
        .select(`
          trabajador_id, concepto_id, monto,
          trabajadores(codigo, nombres, apellido_paterno),
          conceptos_remunerativos(codigo, nombre, tipo, orden)
        `)
        .eq('planilla_id', (p as any).id)
      setDetalles(((d ?? []) as any[]).map((x) => ({
        trabajador_id: x.trabajador_id,
        concepto_id: x.concepto_id,
        monto: Number(x.monto),
        trabajador_nombre: `${x.trabajadores?.nombres} ${x.trabajadores?.apellido_paterno}`,
        trabajador_codigo: x.trabajadores?.codigo,
        concepto_codigo: x.conceptos_remunerativos?.codigo,
        concepto_nombre: x.conceptos_remunerativos?.nombre,
        concepto_tipo: x.conceptos_remunerativos?.tipo,
        concepto_orden: x.conceptos_remunerativos?.orden,
      })))
    } else {
      setDetalles([])
    }
    setLoading(false)
  }, [supabase, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  const calcular = async () => {
    setCalculando(true)
    const { data, error } = await (supabase.rpc as any)('calcular_planilla', { p_anio: anio, p_mes: mes })
    setCalculando(false)
    if (error) { toast.error('Error al calcular', { description: error.message }); return }
    toast.success(`Planilla calculada: ${data.trabajadores} trabajadores`, {
      description: `Neto a pagar: ${formatCurrency(data.total_neto)} · Aportes: ${formatCurrency(data.total_aportes)}`,
    })
    cargar()
  }

  const cerrar = async () => {
    if (!confirm(`¿Cerrar la planilla de ${MESES[mes-1]} ${anio}?\n\n· Se genera el asiento contable automáticamente\n· La planilla queda INMUTABLE\n· Solo se puede reabrir con intervención técnica`)) return
    setCerrando(true)
    const { data, error } = await (supabase.rpc as any)('cerrar_planilla', { p_anio: anio, p_mes: mes })
    setCerrando(false)
    if (error) { toast.error('Error al cerrar', { description: error.message }); return }
    toast.success('Planilla cerrada', {
      description: `Asiento ${data.numero_asiento} generado en borrador. Revísalo en Contabilidad → Libro Diario.`,
    })
    cargar()
  }

  const abrirHorasExtras = async () => {
    const { data: trabs } = await (supabase as any)
      .from('trabajadores').select('id, codigo, nombres, apellido_paterno')
      .eq('estado', 'activo').order('codigo')
    const { data: hes } = planilla ? await (supabase as any)
      .from('planilla_horas_extras').select('*').eq('planilla_id', planilla.id) : { data: [] }
    const heMap = new Map<string, any>()
    ;((hes ?? []) as any[]).forEach((h) => heMap.set(h.trabajador_id, h))
    setHeTrabajadores(((trabs ?? []) as any[]).map((t) => ({
      id: t.id, codigo: t.codigo,
      nombre: `${t.nombres} ${t.apellido_paterno}`,
      horas_25: Number(heMap.get(t.id)?.horas_25 ?? 0),
      horas_35: Number(heMap.get(t.id)?.horas_35 ?? 0),
    })))
    setHeOpen(true)
  }

  const guardarHorasExtras = async () => {
    setHeSaving(true)
    // Asegurar que exista la planilla
    let pid = planilla?.id
    if (!pid) {
      const { data: nueva } = await (supabase as any).from('planillas')
        .insert({ anio, mes }).select().single()
      pid = (nueva as any)?.id
    }
    if (!pid) { toast.error('No se pudo crear la planilla'); setHeSaving(false); return }
    for (const t of heTrabajadores) {
      if (t.horas_25 > 0 || t.horas_35 > 0) {
        await (supabase as any).from('planilla_horas_extras').upsert({
          planilla_id: pid, trabajador_id: t.id,
          horas_25: t.horas_25, horas_35: t.horas_35,
        }, { onConflict: 'planilla_id,trabajador_id' })
      } else {
        await (supabase as any).from('planilla_horas_extras')
          .delete().eq('planilla_id', pid).eq('trabajador_id', t.id)
      }
    }
    setHeSaving(false)
    setHeOpen(false)
    toast.success('Horas extras guardadas', { description: 'Recalcula la planilla para aplicarlas.' })
    cargar()
  }

  // ── Matriz trabajador × concepto para la vista
  const matriz = useMemo(() => {
    const trabMap = new Map<string, { codigo: string; nombre: string; conceptos: Map<string, number>; ingresos: number; descuentos: number }>()
    const conceptosSet = new Map<string, { codigo: string; nombre: string; tipo: string; orden: number }>()
    detalles.forEach((d: any) => {
      if (!trabMap.has(d.trabajador_id)) {
        trabMap.set(d.trabajador_id, { codigo: d.trabajador_codigo, nombre: d.trabajador_nombre!, conceptos: new Map(), ingresos: 0, descuentos: 0 })
      }
      const t = trabMap.get(d.trabajador_id)!
      t.conceptos.set(d.concepto_codigo!, d.monto)
      if (d.concepto_tipo === 'ingreso') t.ingresos += d.monto
      if (d.concepto_tipo === 'descuento') t.descuentos += d.monto
      if (d.concepto_tipo !== 'aporte_empleador') {
        conceptosSet.set(d.concepto_codigo!, { codigo: d.concepto_codigo!, nombre: d.concepto_nombre!, tipo: d.concepto_tipo!, orden: d.concepto_orden ?? 0 })
      }
    })
    const conceptos = Array.from(conceptosSet.values()).sort((a, b) => a.orden - b.orden)
    const filas = Array.from(trabMap.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))
    return { conceptos, filas }
  }, [detalles])

  const editable = !planilla || ['borrador', 'calculada'].includes(planilla.estado)

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 landscape; margin: 10mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
        table { font-size: 8pt !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-emerald-600" />
            Planilla Mensual
            {planilla && (
              <span className={`text-xs px-2 py-0.5 rounded font-bold ${ESTADO_BADGE[planilla.estado]?.cls}`}>
                {ESTADO_BADGE[planilla.estado]?.label}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500">Cálculo automático según normativa laboral peruana</p>
        </div>
        <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {[anio + 1, anio, anio - 1].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        {editable && (
          <>
            <Button variant="outline" onClick={abrirHorasExtras} className="gap-1 h-9">
              <Clock className="w-4 h-4" /> Horas extras
            </Button>
            <Button onClick={calcular} disabled={calculando} className="bg-emerald-600 hover:bg-emerald-700 gap-1 h-9">
              {calculando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {planilla?.estado === 'calculada' ? 'Recalcular' : 'Calcular planilla'}
            </Button>
          </>
        )}
        {planilla?.estado === 'calculada' && (
          <Button onClick={cerrar} disabled={cerrando} variant="outline" className="gap-1 h-9 border-amber-400 text-amber-700">
            {cerrando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Cerrar planilla
          </Button>
        )}
        {planilla && ['calculada', 'cerrada', 'pagada'].includes(planilla.estado) && (
          <button onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
            <Printer className="w-3.5 h-3.5" /> Imprimir
          </button>
        )}
      </div>

      {/* Header impresión */}
      <div className="hidden print:block pb-2 border-b-2 border-black">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
            <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 13 }}>{EMPRESA.slogan}</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold">PLANILLA DE REMUNERACIONES</p>
            <p>{MESES[mes - 1]} {anio} · (Expresado en Soles)</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : !planilla || matriz.filas.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center no-print">
          <Calculator className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-semibold">Sin planilla calculada para {MESES[mes - 1]} {anio}</p>
          <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
            Primero registra a los trabajadores en{' '}
            <Link href="/planillas/trabajadores" className="underline text-blue-700">Planillas → Trabajadores</Link>,
            luego presiona &ldquo;Calcular planilla&rdquo;.
          </p>
          <Button onClick={calcular} disabled={calculando} className="mt-4 bg-emerald-600 hover:bg-emerald-700 gap-1">
            {calculando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            Calcular ahora
          </Button>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 no-print">
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Trabajadores</p>
              <p className="text-xl font-bold">{planilla.trabajadores_count}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-[10px] text-emerald-700 uppercase font-semibold">Ingresos</p>
              <p className="text-xl font-bold font-mono text-emerald-900">{formatCurrency(planilla.total_ingresos)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-[10px] text-red-700 uppercase font-semibold">Descuentos</p>
              <p className="text-xl font-bold font-mono text-red-900">{formatCurrency(planilla.total_descuentos)}</p>
            </div>
            <div className="bg-[#FBE600] border-2 border-yellow-500 rounded-lg p-3">
              <p className="text-[10px] uppercase font-semibold">Neto a pagar</p>
              <p className="text-xl font-bold font-mono">{formatCurrency(planilla.total_neto)}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-[10px] text-blue-700 uppercase font-semibold">Aportes (EsSalud)</p>
              <p className="text-xl font-bold font-mono text-blue-900">{formatCurrency(planilla.total_aportes_empleador)}</p>
            </div>
          </div>

          {/* Matriz */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print:border-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600 sticky left-0 bg-gray-50 min-w-[160px]">Trabajador</th>
                    {matriz.conceptos.map((c) => (
                      <th key={c.codigo} className={`text-right p-2 font-semibold min-w-[80px] ${
                        c.tipo === 'ingreso' ? 'text-emerald-700' : 'text-red-700'
                      }`} title={c.nombre}>
                        {c.codigo}
                      </th>
                    ))}
                    <th className="text-right p-2 font-bold text-gray-800 bg-yellow-50 min-w-[90px]">NETO</th>
                  </tr>
                </thead>
                <tbody>
                  {matriz.filas.map((f) => (
                    <tr key={f.codigo} className="border-b border-gray-100 hover:bg-gray-50/60">
                      <td className="p-2 sticky left-0 bg-white font-medium">
                        <span className="font-mono text-[10px] text-gray-400 mr-1">{f.codigo}</span>
                        {f.nombre}
                      </td>
                      {matriz.conceptos.map((c) => {
                        const monto = f.conceptos.get(c.codigo)
                        return (
                          <td key={c.codigo} className={`p-2 text-right font-mono ${
                            monto ? (c.tipo === 'ingreso' ? 'text-emerald-800' : 'text-red-700') : 'text-gray-300'
                          }`}>
                            {monto ? formatCurrency(monto) : '—'}
                          </td>
                        )
                      })}
                      <td className="p-2 text-right font-mono font-bold bg-yellow-50">
                        {formatCurrency(f.ingresos - f.descuentos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                  <tr>
                    <td className="p-2 sticky left-0 bg-gray-100">TOTALES</td>
                    {matriz.conceptos.map((c) => {
                      const total = matriz.filas.reduce((a, f) => a + (f.conceptos.get(c.codigo) ?? 0), 0)
                      return (
                        <td key={c.codigo} className="p-2 text-right font-mono">
                          {total > 0 ? formatCurrency(total) : ''}
                        </td>
                      )
                    })}
                    <td className="p-2 text-right font-mono bg-[#FBE600]">{formatCurrency(planilla.total_neto)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {planilla.estado === 'cerrada' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 no-print">
              🔒 Esta planilla está cerrada — el asiento contable ya fue generado.
              Revísalo en <Link href="/contabilidad/diario" className="underline font-semibold">Contabilidad → Libro Diario</Link>.
            </div>
          )}
        </>
      )}

      {/* Dialog horas extras */}
      <Dialog open={heOpen} onOpenChange={setHeOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Horas extras · {MESES[mes - 1]} {anio}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="bg-blue-50 border border-blue-100 rounded p-2 text-xs text-blue-800">
              <strong>Norma:</strong> primeras 2 horas diarias al 25% · horas adicionales, domingos y feriados al 35%.
              Valor hora = sueldo ÷ 30 ÷ 8.
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-y border-gray-200">
                <tr>
                  <th className="text-left p-2 text-xs font-semibold text-gray-600">Trabajador</th>
                  <th className="text-center p-2 text-xs font-semibold text-emerald-700 w-32">Horas al 25%</th>
                  <th className="text-center p-2 text-xs font-semibold text-orange-700 w-32">Horas al 35%</th>
                </tr>
              </thead>
              <tbody>
                {heTrabajadores.map((t, i) => (
                  <tr key={t.id} className="border-b border-gray-100">
                    <td className="p-2">
                      <span className="font-mono text-[10px] text-gray-400 mr-1">{t.codigo}</span>
                      {t.nombre}
                    </td>
                    <td className="p-1 text-center">
                      <Input type="number" min="0" step="0.5" value={t.horas_25 || ''}
                        onChange={(e) => setHeTrabajadores((prev) => prev.map((x, j) =>
                          j === i ? { ...x, horas_25: parseFloat(e.target.value) || 0 } : x))}
                        placeholder="0" className="h-8 text-center font-mono w-24 mx-auto" />
                    </td>
                    <td className="p-1 text-center">
                      <Input type="number" min="0" step="0.5" value={t.horas_35 || ''}
                        onChange={(e) => setHeTrabajadores((prev) => prev.map((x, j) =>
                          j === i ? { ...x, horas_35: parseFloat(e.target.value) || 0 } : x))}
                        placeholder="0" className="h-8 text-center font-mono w-24 mx-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setHeOpen(false)} disabled={heSaving}>Cancelar</Button>
              <Button onClick={guardarHorasExtras} disabled={heSaving} className="bg-emerald-600 hover:bg-emerald-700">
                {heSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Guardar horas extras
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
