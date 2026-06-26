'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Lock, Unlock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

interface Periodo {
  id: string
  anio: number
  mes: number
  estado: string
  total_debe: number
  total_haber: number
  utilidad_periodo: number
  cerrado_at: string | null
  notas: string | null
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

export default function PeriodosPage() {
  const router = useRouter()
  const supabase = createClient()
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any)
      .from('periodos_contables')
      .select('*')
      .order('anio', { ascending: false })
      .order('mes', { ascending: false })
    setPeriodos((data ?? []) as Periodo[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const cerrar = async (p: Periodo) => {
    if (!confirm(`¿Cerrar el período ${MESES[p.mes - 1]} ${p.anio}? Después de cerrar no se pueden editar los asientos del período.`)) return
    const { data, error } = await (supabase.rpc as any)('cerrar_periodo_contable', { p_anio: p.anio, p_mes: p.mes })
    if (error) { toast.error('No se pudo cerrar', { description: error.message }); return }
    toast.success(`Período ${data.periodo} cerrado`, {
      description: `Utilidad: ${formatCurrency(data.utilidad)}`,
    })
    cargar()
  }

  const reabrir = async (p: Periodo) => {
    const motivo = prompt('Motivo de reapertura (mín 10 caracteres) — queda registrado:')
    if (!motivo || motivo.trim().length < 10) return
    const { error } = await (supabase.rpc as any)('reabrir_periodo_contable', {
      p_anio: p.anio, p_mes: p.mes, p_motivo: motivo,
    })
    if (error) { toast.error('No se pudo reabrir', { description: error.message }); return }
    toast.success('Período reabierto')
    cargar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Períodos Contables</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cierre mensual de libros · exigencia SUNAT
          </p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
        <strong>⚠ Importante:</strong> Al cerrar un período, los asientos del mes quedan
        bloqueados (no se pueden modificar ni borrar). Para corregir un asiento en un
        período cerrado debe generarse un asiento de ajuste en un período abierto.
        Solo el administrador puede reabrir un período cerrado y queda registrado el motivo.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600">Período</th>
                <th className="text-center p-2 font-semibold text-gray-600 w-32">Estado</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Total Debe</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Total Haber</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Utilidad</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-40">Cerrado</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className="p-2 font-semibold">{MESES[p.mes - 1]} {p.anio}</td>
                  <td className="p-2 text-center">
                    {p.estado === 'abierto' && (
                      <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded font-bold">
                        <Unlock className="w-3 h-3" /> ABIERTO
                      </span>
                    )}
                    {p.estado === 'cerrado' && (
                      <span className="inline-flex items-center gap-1 text-xs bg-gray-200 text-gray-800 px-2 py-0.5 rounded font-bold">
                        <Lock className="w-3 h-3" /> CERRADO
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-right font-mono">{formatCurrency(p.total_debe)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(p.total_haber)}</td>
                  <td className={`p-2 text-right font-mono font-bold ${p.utilidad_periodo >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(p.utilidad_periodo)}
                  </td>
                  <td className="p-2 text-xs text-gray-500">
                    {p.cerrado_at ? new Date(p.cerrado_at).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="p-2 text-right">
                    {p.estado === 'abierto' ? (
                      <Button size="sm" variant="outline" onClick={() => cerrar(p)}
                        className="text-xs h-7 gap-1 text-gray-700 hover:bg-gray-50">
                        <Lock className="w-3 h-3" />
                        Cerrar
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => reabrir(p)}
                        className="text-xs h-7 gap-1 text-amber-700 hover:bg-amber-50">
                        <Unlock className="w-3 h-3" />
                        Reabrir
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {periodos.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">Sin períodos. Se crearán automáticamente al hacer asientos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
