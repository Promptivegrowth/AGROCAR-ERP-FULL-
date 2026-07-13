'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, CalendarCheck, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { hoyLima } from '@/lib/fechas-pe'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

const TIPOS = [
  { value: 'normal', label: 'Asistió', cls: 'bg-green-100 text-green-800' },
  { value: 'tardanza', label: 'Tardanza', cls: 'bg-amber-100 text-amber-800' },
  { value: 'falta', label: 'Falta', cls: 'bg-red-100 text-red-800' },
  { value: 'permiso', label: 'Permiso', cls: 'bg-blue-100 text-blue-800' },
  { value: 'descanso_medico', label: 'D. Médico', cls: 'bg-purple-100 text-purple-800' },
  { value: 'vacaciones', label: 'Vacaciones', cls: 'bg-cyan-100 text-cyan-800' },
]

interface Fila {
  trabajador_id: string
  codigo: string
  nombre: string
  tipo: string
  hora_entrada: string
  hora_salida: string
  existente: boolean
}

export default function AsistenciaPage() {
  const router = useRouter()
  const supabase = createClient()
  const [fecha, setFecha] = useState(hoyLima())
  const [filas, setFilas] = useState<Fila[]>([])
  const [resumen, setResumen] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [vista, setVista] = useState<'dia' | 'mes'>('dia')
  const ahora = new Date()
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)

  const cargarDia = useCallback(async () => {
    setLoading(true)
    const [{ data: trabs }, { data: asis }] = await Promise.all([
      (supabase as any).from('trabajadores')
        .select('id, codigo, nombres, apellido_paterno')
        .eq('estado', 'activo').order('codigo'),
      (supabase as any).from('asistencias').select('*').eq('fecha', fecha),
    ])
    const asisMap = new Map<string, any>()
    ;((asis ?? []) as any[]).forEach((a) => asisMap.set(a.trabajador_id, a))
    setFilas(((trabs ?? []) as any[]).map((t) => {
      const a = asisMap.get(t.id)
      return {
        trabajador_id: t.id,
        codigo: t.codigo,
        nombre: `${t.nombres} ${t.apellido_paterno}`,
        tipo: a?.tipo ?? 'normal',
        hora_entrada: a?.hora_entrada?.slice(0, 5) ?? '08:00',
        hora_salida: a?.hora_salida?.slice(0, 5) ?? '17:00',
        existente: !!a,
      }
    }))
    setLoading(false)
  }, [supabase, fecha])

  const cargarMes = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase.rpc as any)('resumen_asistencia_mes', { p_anio: anio, p_mes: mes })
    setResumen((data ?? []) as any[])
    setLoading(false)
  }, [supabase, anio, mes])

  useEffect(() => {
    if (vista === 'dia') cargarDia()
    else cargarMes()
  }, [vista, cargarDia, cargarMes])

  const setCampo = (id: string, campo: keyof Fila, valor: string) => {
    setFilas((prev) => prev.map((f) => f.trabajador_id === id ? { ...f, [campo]: valor } : f))
  }

  const guardarDia = async () => {
    setSaving(true)
    for (const f of filas) {
      const requiereHoras = ['normal', 'tardanza'].includes(f.tipo)
      await (supabase as any).from('asistencias').upsert({
        trabajador_id: f.trabajador_id,
        fecha,
        tipo: f.tipo,
        hora_entrada: requiereHoras ? f.hora_entrada : null,
        hora_salida: requiereHoras ? f.hora_salida : null,
        fuente: 'manual',
      }, { onConflict: 'trabajador_id,fecha' })
    }
    setSaving(false)
    toast.success(`Asistencia del ${fecha} guardada (${filas.length} trabajadores)`)
    cargarDia()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-teal-600" />
            Control de Asistencia
          </h1>
          <p className="text-sm text-gray-500">
            Registro manual · preparado para integrar equipo biométrico
          </p>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setVista('dia')}
            className={`px-3 py-1.5 text-xs font-semibold rounded ${vista === 'dia' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Registro diario
          </button>
          <button onClick={() => setVista('mes')}
            className={`px-3 py-1.5 text-xs font-semibold rounded ${vista === 'mes' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Resumen mensual
          </button>
        </div>
      </div>

      {vista === 'dia' ? (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-end gap-3">
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Fecha</p>
              <Input type="date" value={fecha} max={hoyLima()} onChange={(e) => setFecha(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="flex-1" />
            <Button onClick={guardarDia} disabled={saving || filas.length === 0} className="bg-teal-600 hover:bg-teal-700 gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar asistencia del día
            </Button>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : filas.length === 0 ? (
              <p className="text-center py-12 text-gray-400 text-sm">Sin trabajadores activos</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Trabajador</th>
                    <th className="text-center p-2 font-semibold text-gray-600 w-96">Estado</th>
                    <th className="text-center p-2 font-semibold text-gray-600 w-28">Entrada</th>
                    <th className="text-center p-2 font-semibold text-gray-600 w-28">Salida</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const conHoras = ['normal', 'tardanza'].includes(f.tipo)
                    return (
                      <tr key={f.trabajador_id} className="border-b border-gray-100">
                        <td className="p-2">
                          <span className="font-mono text-[10px] text-gray-400 mr-1">{f.codigo}</span>
                          {f.nombre}
                          {f.existente && <span className="ml-2 text-[9px] text-teal-600">✓ registrado</span>}
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1 justify-center flex-wrap">
                            {TIPOS.map((t) => (
                              <button key={t.value} onClick={() => setCampo(f.trabajador_id, 'tipo', t.value)}
                                className={`text-[10px] px-2 py-1 rounded font-bold transition-all ${
                                  f.tipo === t.value ? t.cls + ' ring-2 ring-offset-1 ring-gray-400' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                                }`}>
                                {t.label}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <Input type="time" value={f.hora_entrada} disabled={!conHoras}
                            onChange={(e) => setCampo(f.trabajador_id, 'hora_entrada', e.target.value)}
                            className="h-8 w-24 mx-auto font-mono text-xs" />
                        </td>
                        <td className="p-2 text-center">
                          <Input type="time" value={f.hora_salida} disabled={!conHoras}
                            onChange={(e) => setCampo(f.trabajador_id, 'hora_salida', e.target.value)}
                            className="h-8 w-24 mx-auto font-mono text-xs" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
            <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
              className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
              {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
              className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
              {[anio + 1, anio, anio - 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Trabajador</th>
                    <th className="text-center p-2 font-semibold text-green-700 w-28">Días asistidos</th>
                    <th className="text-center p-2 font-semibold text-red-700 w-20">Faltas</th>
                    <th className="text-center p-2 font-semibold text-amber-700 w-24">Tardanzas</th>
                    <th className="text-center p-2 font-semibold text-blue-700 w-24">Permisos</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-28">Total horas</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((r: any) => (
                    <tr key={r.trabajador_id} className="border-b border-gray-100">
                      <td className="p-2">
                        <span className="font-mono text-[10px] text-gray-400 mr-1">{r.codigo}</span>
                        {r.nombre}
                      </td>
                      <td className="p-2 text-center font-mono font-bold text-green-800">{r.dias_asistidos}</td>
                      <td className={`p-2 text-center font-mono ${r.faltas > 0 ? 'font-bold text-red-700' : 'text-gray-300'}`}>{r.faltas}</td>
                      <td className={`p-2 text-center font-mono ${r.tardanzas > 0 ? 'font-bold text-amber-700' : 'text-gray-300'}`}>{r.tardanzas}</td>
                      <td className={`p-2 text-center font-mono ${r.permisos > 0 ? 'text-blue-700' : 'text-gray-300'}`}>{r.permisos}</td>
                      <td className="p-2 text-right font-mono">{Number(r.total_horas).toFixed(1)} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
