import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Package, TrendingDown } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

async function getInventario() {
  const supabase = await createClient()

  const { data: stocks, error } = await supabase
    .from('stock')
    .select(`
      id, cantidad, cantidad_reservada, costo_promedio, updated_at,
      productos(codigo, nombre, activo, unidades_medida(simbolo))
    `)
    .order('updated_at', { ascending: false })

  if (error) return { stocks: [], stockBajo: [] }

  const stockBajo = (stocks ?? []).filter((s) => ((s as any).cantidad ?? 0) < 10)

  return { stocks: stocks ?? [], stockBajo }
}

export default async function AlmacenPage() {
  const { stocks, stockBajo } = await getInventario()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Almacén e Inventario</h1>
          <p className="text-sm text-gray-500 mt-0.5">Stock actual de productos</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/almacen/compras"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Compras
          </Link>
          <Link
            href="/almacen/ajustes"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Ajustes
          </Link>
        </div>
      </div>

      {/* Alertas stock bajo */}
      {stockBajo.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {stockBajo.length} producto{stockBajo.length !== 1 ? 's' : ''} con stock bajo (&lt;10 unidades)
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {stockBajo.slice(0, 8).map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 border border-orange-200 rounded-full text-xs text-orange-700"
                  >
                    <TrendingDown className="w-2.5 h-2.5" />
                    {(s.productos as any)?.nombre ?? '—'} ({(s as any).cantidad})
                  </span>
                ))}
                {stockBajo.length > 8 && (
                  <span className="text-xs text-orange-600">+{stockBajo.length - 8} más</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPIs rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total Productos</p>
                <p className="text-xl font-bold text-gray-900">{stocks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Stock Bajo</p>
                <p className="text-xl font-bold text-gray-900">{stockBajo.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Valor Inventario</p>
                <p className="text-xl font-bold text-gray-900">
                  {formatCurrency(
                    stocks.reduce((acc, s) => acc + ((s as any).cantidad ?? 0) * ((s as any).costo_promedio ?? 0), 0)
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabla inventario */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800">Stock Actual</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stocks.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No hay registros de stock</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Código', 'Producto', 'Disponible', 'Reservado', 'Costo Prom.', 'Última Act.', 'Estado'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stocks.map((s) => {
                    const producto = s.productos as any
                    const disponible = (s as any).cantidad ?? 0
                    const esBajo = disponible < 10
                    return (
                      <tr key={s.id} className={`hover:bg-gray-50/50 transition-colors ${esBajo ? 'bg-orange-50/30' : ''}`}>
                        <td className="py-3 px-4 font-mono text-xs text-gray-500">{producto?.codigo ?? '—'}</td>
                        <td className="py-3 px-4 font-medium text-gray-900 max-w-[240px] truncate">{producto?.nombre ?? '—'}</td>
                        <td className="py-3 px-4">
                          <span className={`font-bold ${esBajo ? 'text-orange-600' : 'text-gray-800'}`}>
                            {disponible.toLocaleString('es-PE')}
                          </span>
                          <span className="text-xs text-gray-400 ml-1">{producto?.unidades_medida?.simbolo}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-600">
                          {((s as any).cantidad_reservada ?? 0).toLocaleString('es-PE')}
                          <span className="text-xs text-gray-400 ml-1">{producto?.unidades_medida?.simbolo}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-700">{formatCurrency((s as any).costo_promedio ?? 0)}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">
                          {s.updated_at ? formatDate(s.updated_at) : '—'}
                        </td>
                        <td className="py-3 px-4">
                          {esBajo ? (
                            <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200">Stock Bajo</Badge>
                          ) : (
                            <Badge className="text-xs bg-green-100 text-green-700 border-green-200">OK</Badge>
                          )}
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
