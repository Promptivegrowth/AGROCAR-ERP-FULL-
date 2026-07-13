'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Upload, Landmark, Zap, Link2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

interface Conciliacion {
  id: string
  banco: string
  anio: number
  mes: number
  archivo_nombre: string | null
  total_lineas_banco: number
  conciliados: number
  pendientes_banco: number
  pendientes_sistema: number
  estado: string
}

interface MovBanco {
  id: string
  fecha: string
  descripcion: string | null
  monto: number
  operacion: string | null
  match_estado: string
  partida_id: string | null
}

interface PartidaSist {
  partida_id: string
  fecha: string
  glosa: string
  numero_asiento: string
  debe: number
  haber: number
}

const ESTADO_LABEL: Record<string, { label: string; cls: string }> = {
  pendiente: { label: 'PENDIENTE', cls: 'bg-red-100 text-red-800' },
  auto_exacto: { label: '✓ EXACTO', cls: 'bg-green-100 text-green-800' },
  auto_cercano: { label: '~ CERCANO', cls: 'bg-emerald-100 text-emerald-700' },
  manual: { label: '✓ MANUAL', cls: 'bg-blue-100 text-blue-800' },
  ignorado: { label: 'IGNORADO', cls: 'bg-gray-100 text-gray-500' },
}

export default function ConciliacionPage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [conc, setConc] = useState<Conciliacion | null>(null)
  const [movs, setMovs] = useState<MovBanco[]>([])
  const [sinConciliar, setSinConciliar] = useState<PartidaSist[]>([])
  const [loading, setLoading] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [matcheando, setMatcheando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Match manual: mov del banco seleccionado
  const [movSel, setMovSel] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data: c } = await (supabase as any)
      .from('conciliaciones_bancarias')
      .select('*')
      .eq('anio', anio).eq('mes', mes).eq('banco', 'BCP')
      .maybeSingle()
    setConc(c as any)
    if (c) {
      const { data: m } = await (supabase as any)
        .from('banco_movimientos')
        .select('*')
        .eq('conciliacion_id', (c as any).id)
        .order('fecha')
      setMovs((m ?? []) as MovBanco[])
    } else {
      setMovs([])
    }
    const { data: sc } = await (supabase.rpc as any)('partidas_banco_sin_conciliar', { p_anio: anio, p_mes: mes })
    setSinConciliar((sc ?? []) as PartidaSist[])
    setLoading(false)
  }, [supabase, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  // ── Parsear archivo del banco (CSV/TXT de BCP o similar)
  const procesarArchivo = async (file: File) => {
    setSubiendo(true)
    try {
      const texto = await file.text()
      const lineas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0)

      // Parse tolerante: detecta fecha (DD/MM/YYYY o YYYY-MM-DD), montos con decimales
      const parsed: { fecha: string; descripcion: string; monto: number; operacion: string | null }[] = []
      for (const linea of lineas) {
        const campos = linea.split(/[,;|\t]/).map((c) => c.trim().replace(/^"|"$/g, ''))
        let fecha: string | null = null
        let monto: number | null = null
        let operacion: string | null = null
        const descripciones: string[] = []

        for (const campo of campos) {
          // Fecha DD/MM/YYYY
          const m1 = campo.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
          if (m1 && !fecha) { fecha = `${m1[3]}-${m1[2]}-${m1[1]}`; continue }
          // Fecha YYYY-MM-DD
          if (/^\d{4}-\d{2}-\d{2}$/.test(campo) && !fecha) { fecha = campo; continue }
          // Monto con decimales (posiblemente con signo o paréntesis para negativos)
          const limpio = campo.replace(/,/g, '')
          if (/^-?\(?\d+\.\d{2}\)?$/.test(limpio)) {
            const val = parseFloat(limpio.replace(/[()]/g, ''))
            monto = limpio.includes('(') ? -val : val
            continue
          }
          // Número de operación (dígitos largos)
          if (/^\d{6,}$/.test(campo) && !operacion) { operacion = campo; continue }
          if (campo.length > 3) descripciones.push(campo)
        }

        if (fecha && monto !== null && monto !== 0) {
          parsed.push({ fecha, descripcion: descripciones.join(' ').slice(0, 200) || null as any, monto, operacion })
        }
      }

      if (parsed.length === 0) {
        toast.error('No se pudieron leer movimientos', {
          description: 'Verifica que el archivo tenga columnas de fecha (DD/MM/YYYY) y monto con decimales. Exporta el estado de cuenta BCP como CSV.',
        })
        setSubiendo(false)
        return
      }

      // Crear/reemplazar conciliación del mes
      let concId = conc?.id
      if (!concId) {
        const { data: nueva, error } = await (supabase as any)
          .from('conciliaciones_bancarias')
          .insert({ banco: 'BCP', anio, mes, archivo_nombre: file.name, total_lineas_banco: parsed.length })
          .select().single()
        if (error) throw new Error(error.message)
        concId = (nueva as any).id
      } else {
        // Reimportar: borra movimientos previos
        await (supabase as any).from('banco_movimientos').delete().eq('conciliacion_id', concId)
        await (supabase as any).from('conciliaciones_bancarias')
          .update({ archivo_nombre: file.name, total_lineas_banco: parsed.length })
          .eq('id', concId)
      }

      // Insertar en lotes de 100
      for (let i = 0; i < parsed.length; i += 100) {
        const lote = parsed.slice(i, i + 100).map((p) => ({ ...p, conciliacion_id: concId }))
        const { error } = await (supabase as any).from('banco_movimientos').insert(lote)
        if (error) throw new Error(error.message)
      }

      toast.success(`${parsed.length} movimientos importados de ${file.name}`)
      await cargar()
    } catch (e: any) {
      toast.error('Error al importar', { description: e?.message })
    }
    setSubiendo(false)
  }

  const ejecutarMatch = async () => {
    if (!conc) return
    setMatcheando(true)
    const { data, error } = await (supabase.rpc as any)('conciliar_banco_auto', { p_conciliacion_id: conc.id })
    setMatcheando(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(`Match: ${data.exactos} exactos · ${data.cercanos} cercanos · ${data.pendientes} pendientes`)
    cargar()
  }

  const matchManual = async (partidaId: string) => {
    if (!movSel) return
    await (supabase as any).from('banco_movimientos')
      .update({ match_estado: 'manual', partida_id: partidaId })
      .eq('id', movSel)
    toast.success('Match manual registrado')
    setMovSel(null)
    // Recalcular contadores
    if (conc) await (supabase.rpc as any)('conciliar_banco_auto', { p_conciliacion_id: conc.id })
    cargar()
  }

  const ignorarMov = async (movId: string) => {
    await (supabase as any).from('banco_movimientos')
      .update({ match_estado: 'ignorado' })
      .eq('id', movId)
    cargar()
  }

  const pendientesBanco = movs.filter((m) => m.match_estado === 'pendiente')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-sky-700" />
            Conciliación Bancaria
          </h1>
          <p className="text-sm text-gray-500">
            Importa el estado de cuenta BCP y haz match contra los movimientos del sistema (cuentas 104x)
          </p>
        </div>
        <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {[anio + 1, anio, anio - 1].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) procesarArchivo(f); e.target.value = '' }} />
        <Button onClick={() => fileRef.current?.click()} disabled={subiendo} className="bg-sky-700 hover:bg-sky-800 gap-1">
          {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Importar estado de cuenta
        </Button>
        {conc && (
          <Button variant="outline" onClick={ejecutarMatch} disabled={matcheando} className="gap-1 border-yellow-400 text-yellow-700">
            {matcheando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Match automático
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : !conc ? (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
          <Landmark className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-semibold">Sin conciliación para {MESES[mes - 1]} {anio}</p>
          <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
            Exporta el estado de cuenta desde la banca por internet BCP (formato CSV) y súbelo aquí.
            El sistema detecta fechas y montos automáticamente.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Líneas del banco</p>
              <p className="text-2xl font-bold">{conc.total_lineas_banco}</p>
              <p className="text-[10px] text-gray-400 truncate">{conc.archivo_nombre}</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-[10px] text-green-700 uppercase font-semibold">✓ Conciliados</p>
              <p className="text-2xl font-bold text-green-900">{conc.conciliados}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-[10px] text-red-700 uppercase font-semibold">En banco, no en sistema</p>
              <p className="text-2xl font-bold text-red-900">{conc.pendientes_banco}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-[10px] text-amber-700 uppercase font-semibold">En sistema, no en banco</p>
              <p className="text-2xl font-bold text-amber-900">{conc.pendientes_sistema}</p>
            </div>
          </div>

          {/* Vista dividida */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Movimientos del banco */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900 border-b border-sky-100">
                🏦 Movimientos del banco ({movs.length})
              </div>
              <div className="max-h-[55vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {movs.map((m) => (
                      <tr key={m.id}
                        className={`border-b border-gray-100 ${movSel === m.id ? 'bg-yellow-100' : m.match_estado === 'pendiente' ? 'hover:bg-yellow-50 cursor-pointer' : ''}`}
                        onClick={() => m.match_estado === 'pendiente' && setMovSel(movSel === m.id ? null : m.id)}>
                        <td className="p-2 font-mono w-20">{formatDate(m.fecha)}</td>
                        <td className="p-2 truncate max-w-[180px]" title={m.descripcion ?? ''}>{m.descripcion ?? '—'}</td>
                        <td className={`p-2 text-right font-mono w-24 ${m.monto >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {formatCurrency(m.monto)}
                        </td>
                        <td className="p-2 w-24 text-center">
                          <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${ESTADO_LABEL[m.match_estado]?.cls}`}>
                            {ESTADO_LABEL[m.match_estado]?.label}
                          </span>
                        </td>
                        <td className="p-1 w-8 text-center">
                          {m.match_estado === 'pendiente' && (
                            <button onClick={(e) => { e.stopPropagation(); ignorarMov(m.id) }}
                              className="text-gray-400 hover:text-gray-600" title="Ignorar (ej: comisiones bancarias ya registradas)">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Partidas del sistema sin conciliar */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 border-b border-amber-100 flex items-center justify-between">
                <span>📒 Sistema sin conciliar ({sinConciliar.length})</span>
                {movSel && <span className="text-[10px] font-normal bg-yellow-200 px-2 py-0.5 rounded animate-pulse">Selecciona la partida para vincular ↓</span>}
              </div>
              <div className="max-h-[55vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {sinConciliar.map((p) => (
                      <tr key={p.partida_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="p-2 font-mono w-20">{formatDate(p.fecha)}</td>
                        <td className="p-2 truncate max-w-[180px]" title={p.glosa}>{p.glosa}</td>
                        <td className="p-2 text-right font-mono w-24">
                          {Number(p.debe) > 0
                            ? <span className="text-emerald-700">+{formatCurrency(p.debe)}</span>
                            : <span className="text-red-700">-{formatCurrency(p.haber)}</span>}
                        </td>
                        <td className="p-1 w-16 text-center">
                          {movSel && (
                            <button onClick={() => matchManual(p.partida_id)}
                              className="text-[10px] px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold inline-flex items-center gap-0.5">
                              <Link2 className="w-2.5 h-2.5" /> Vincular
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {sinConciliar.length === 0 && (
                      <tr><td className="text-center py-8 text-gray-400">Todo el sistema está conciliado ✓</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {pendientesBanco.length === 0 && sinConciliar.length === 0 && movs.length > 0 && (
            <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6 text-center">
              <p className="text-green-800 font-bold text-lg">✓ Conciliación completa</p>
              <p className="text-green-600 text-sm mt-1">Banco y sistema cuadran perfectamente para {MESES[mes - 1]} {anio}.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
