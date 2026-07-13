'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, CalendarClock, Save, Copy } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Parametro {
  id: string
  anio: number
  clave: string
  valor: number
  descripcion: string | null
}

const LABELS: Record<string, string> = {
  uit: 'UIT — Unidad Impositiva Tributaria',
  rmv: 'RMV — Remuneración Mínima Vital',
  essalud_tasa: 'Tasa EsSalud (%)',
  onp_tasa: 'Tasa ONP (%)',
  asignacion_familiar_pct: 'Asignación familiar (% de RMV)',
  he_25_recargo: 'Recargo horas extras — primeras 2h (%)',
  he_35_recargo: 'Recargo horas extras — resto/domingos (%)',
}

export default function ParametrosPage() {
  const router = useRouter()
  const supabase = createClient()
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [params, setParams] = useState<Parametro[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any)
      .from('parametros_planilla').select('*').eq('anio', anio).order('clave')
    setParams((data ?? []) as Parametro[])
    setEdits({})
    setLoading(false)
  }, [supabase, anio])

  useEffect(() => { cargar() }, [cargar])

  const guardar = async (p: Parametro) => {
    const nuevo = parseFloat(edits[p.id])
    if (isNaN(nuevo) || nuevo < 0) { toast.error('Valor inválido'); return }
    setSaving(true)
    const { error } = await (supabase as any)
      .from('parametros_planilla').update({ valor: nuevo }).eq('id', p.id)
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(`${LABELS[p.clave] ?? p.clave} actualizado`)
    cargar()
  }

  const copiarAnioAnterior = async () => {
    const { data: prev } = await (supabase as any)
      .from('parametros_planilla').select('*').eq('anio', anio - 1)
    if (!prev?.length) { toast.error(`Sin parámetros en ${anio - 1}`); return }
    for (const p of prev as any[]) {
      await (supabase as any).from('parametros_planilla')
        .upsert({ anio, clave: p.clave, valor: p.valor, descripcion: p.descripcion }, { onConflict: 'anio,clave' })
    }
    toast.success(`Parámetros copiados de ${anio - 1}`, { description: 'Actualiza la UIT y RMV con los valores oficiales del año.' })
    cargar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-amber-600" />
            Parámetros de Planilla
          </h1>
          <p className="text-sm text-gray-500">UIT, RMV y tasas — actualizables cada año sin tocar código</p>
        </div>
        <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {[anio + 1, anio, anio - 1, anio - 2].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        {params.length === 0 && !loading && (
          <Button variant="outline" onClick={copiarAnioAnterior} className="gap-1">
            <Copy className="w-4 h-4" /> Copiar de {anio - 1}
          </Button>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
        <strong>📌 Cada enero:</strong> actualizar la UIT (la aprueba el MEF por Decreto Supremo en diciembre)
        y verificar la RMV. Las planillas usan los valores del año que corresponde al período calculado.
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : params.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">
            Sin parámetros para {anio}. Usa &ldquo;Copiar de {anio - 1}&rdquo; y ajusta los valores.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-3 font-semibold text-gray-600">Parámetro</th>
                <th className="text-right p-3 font-semibold text-gray-600 w-40">Valor</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => {
                const editVal = edits[p.id] ?? p.valor.toString()
                const cambiado = editVal !== p.valor.toString()
                return (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="p-3">
                      <p className="font-medium">{LABELS[p.clave] ?? p.clave}</p>
                      {p.descripcion && <p className="text-[10px] text-gray-400">{p.descripcion}</p>}
                    </td>
                    <td className="p-3 text-right">
                      <Input type="number" step="0.01" value={editVal}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-32 h-8 text-right font-mono ml-auto" />
                    </td>
                    <td className="p-3 text-center">
                      <button onClick={() => guardar(p)} disabled={saving || !cambiado}
                        className="text-blue-600 hover:bg-blue-50 disabled:text-gray-300 rounded p-1.5" title="Guardar">
                        <Save className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
