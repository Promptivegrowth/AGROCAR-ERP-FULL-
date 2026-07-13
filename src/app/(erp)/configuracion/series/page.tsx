'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, ScrollText } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Serie {
  id: string
  tipo_comprobante: string
  serie: string
  correlativo_actual: number
  padding_digitos: number
  activo: boolean
  updated_at: string
}

const TIPO_LABELS: Record<string, string> = {
  factura: 'Factura',
  boleta: 'Boleta',
  nota_credito: 'Nota de Crédito',
  nota_pedido_interna: 'Nota de Pedido Interna',
}

export default function SeriesPage() {
  const router = useRouter()
  const supabase = createClient()
  const [series, setSeries] = useState<Serie[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any)
      .from('series_correlativos')
      .select('*')
      .order('tipo_comprobante')
      .order('serie')
    setSeries((data ?? []) as Serie[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const toggleActivo = async (s: Serie) => {
    setSavingId(s.id)
    // Solo puede haber 1 serie activa por tipo
    if (!s.activo) {
      // Desactivar todas las otras del mismo tipo
      const otras = series.filter((x) => x.tipo_comprobante === s.tipo_comprobante && x.id !== s.id && x.activo)
      for (const o of otras) {
        await (supabase as any).from('series_correlativos').update({ activo: false }).eq('id', o.id)
      }
    }
    await (supabase as any).from('series_correlativos').update({ activo: !s.activo }).eq('id', s.id)
    toast.success(s.activo ? 'Serie desactivada' : 'Serie activada')
    setSavingId(null)
    cargar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-purple-600" />
            Series de Comprobantes
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Autoriza series en SUNAT y activalas aquí para empezar a emitir con nueva numeración
          </p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
        <strong>Importante:</strong> Solo una serie por tipo puede estar activa a la vez. Al
        activar una nueva, la anterior se desactiva automáticamente. Antes de activar,
        asegúrate de haber autorizado la serie en el portal SUNAT.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-40">Tipo</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Serie</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Último N°</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-24">Padding</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-40">Última actualización</th>
                <th className="text-center p-2 font-semibold text-gray-600 w-32">Estado</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.id} className={`border-b border-gray-100 ${s.activo ? 'bg-green-50/30' : ''}`}>
                  <td className="p-2 font-medium">{TIPO_LABELS[s.tipo_comprobante] ?? s.tipo_comprobante}</td>
                  <td className="p-2 font-mono font-bold">{s.serie}</td>
                  <td className="p-2 text-right font-mono">{String(s.correlativo_actual).padStart(s.padding_digitos, '0')}</td>
                  <td className="p-2 text-right text-xs text-gray-500">{s.padding_digitos} dígitos</td>
                  <td className="p-2 text-xs text-gray-500">{new Date(s.updated_at).toLocaleDateString('es-PE')}</td>
                  <td className="p-2 text-center">
                    <button onClick={() => toggleActivo(s)} disabled={savingId === s.id}
                      className={`text-xs px-3 py-1 rounded-md font-semibold ${
                        s.activo ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {savingId === s.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (s.activo ? '✓ ACTIVA' : 'Activar')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
