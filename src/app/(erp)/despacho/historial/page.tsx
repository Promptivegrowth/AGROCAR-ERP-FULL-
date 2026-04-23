import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Truck, FileText, ArrowLeft, Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  preparacion: { label: 'En Preparación', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  en_ruta: { label: 'En Ruta', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  completado: { label: 'Completado', className: 'bg-green-100 text-green-700 border-green-200' },
  cancelado: { label: 'Cancelado', className: 'bg-gray-100 text-gray-500 border-gray-200' },
}

export default async function HistorialDespachosPage() {
  const supabase = await createClient()
  const { data: despachos } = await (supabase as any)
    .from('despachos')
    .select(`
      id, numero, fecha_despacho, estado, total_pedidos, total_monto, peso_total_kg, hoja_ruta_emitida_at,
      vehiculos(placa, descripcion)
    `)
    .order('fecha_despacho', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(60)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/despacho" className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-1">
            <ArrowLeft className="w-3 h-3" /> Volver a Despacho
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6" /> Historial de Despachos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Últimos 60 despachos consolidados</p>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {(despachos ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Package className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">Aún no hay despachos consolidados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['N°', 'Fecha', 'Vehículo', 'Paradas', 'Peso', 'Total', 'Estado', 'Hoja de Ruta'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(despachos ?? []).map((d: any) => {
                    const cfg = ESTADO_CONFIG[d.estado] ?? ESTADO_CONFIG.preparacion
                    return (
                      <tr key={d.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-gray-800">{d.numero}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs">{formatDate(d.fecha_despacho)}</td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-xs font-semibold text-gray-800">{d.vehiculos?.placa ?? '—'}</div>
                          {d.vehiculos?.descripcion && (
                            <div className="text-[10px] text-gray-500">{d.vehiculos.descripcion}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-700 text-xs font-medium">{d.total_pedidos}</td>
                        <td className="py-3 px-4 text-gray-700 text-xs font-mono">{Number(d.peso_total_kg ?? 0).toFixed(1)} kg</td>
                        <td className="py-3 px-4 text-gray-900 text-xs font-semibold">{formatCurrency(d.total_monto ?? 0)}</td>
                        <td className="py-3 px-4">
                          <Badge className={`text-[10px] ${cfg.className} border`}>{cfg.label}</Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/hoja-ruta/${d.id}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline font-medium"
                          >
                            <FileText className="w-3 h-3" /> Ver / Imprimir
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
