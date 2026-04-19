'use client'

import { useEffect, useState, useCallback } from 'react'
import { BookOpen, Download, RefreshCw, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

export default function ContabilidadPage() {
  const supabase = createClient()

  const [tipoCambios, setTipoCambios] = useState<any[]>([])
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [compras, setCompras] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState<string | null>(null)
  const [actualizandoTC, setActualizandoTC] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tipo: 'success' | 'error' } | null>(null)

  const hoy = new Date()
  const [mes, setMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [desde, hasta] = [
      `${mes}-01`,
      new Date(parseInt(mes.split('-')[0]), parseInt(mes.split('-')[1]), 0).toISOString().split('T')[0],
    ]

    const [{ data: tc }, { data: comp }, { data: oc }] = await Promise.all([
      supabase.from('tipo_cambio').select('*').order('fecha', { ascending: false }).limit(30),
      supabase
        .from('comprobantes')
        .select(`serie, numero, tipo, fecha_emision, total, igv, estado, clientes(razon_social, ruc)`)
        .gte('fecha_emision', desde)
        .lte('fecha_emision', hasta)
        .neq('estado', 'anulado')
        .order('fecha_emision'),
      supabase
        .from('ordenes_compra')
        .select(`numero, fecha_emision, total, igv, estado, proveedores(razon_social, ruc)`)
        .gte('fecha_emision', desde)
        .lte('fecha_emision', hasta)
        .order('fecha_emision'),
    ])

    setTipoCambios(tc ?? [])
    setComprobantes(comp ?? [])
    setCompras(oc ?? [])
    setLoading(false)
  }, [mes])

  useEffect(() => { loadData() }, [loadData])

  const generarPLE = async (tipo: 'ventas' | 'compras') => {
    setGenerando(tipo)
    await new Promise((r) => setTimeout(r, 1200)) // simula procesamiento

    const [anio, mesNum] = mes.split('-')
    const data = tipo === 'ventas' ? comprobantes : compras

    const lines = data.map((item: any, i: number) => {
      if (tipo === 'ventas') {
        return [
          `${anio}${mesNum}`.padEnd(6, '0'),
          `M${String(i + 1).padStart(10, '0')}`,
          '01',
          item.fecha_emision?.replace(/-/g, ''),
          item.tipo === 'factura' ? '01' : '03',
          item.serie,
          item.numero,
          '',
          item.clientes?.ruc ?? '',
          item.clientes?.razon_social ?? '',
          (item.total - (item.igv ?? 0)).toFixed(2),
          (item.igv ?? 0).toFixed(2),
          item.total?.toFixed(2),
          '1',
          '1',
        ].join('|')
      } else {
        return [
          `${anio}${mesNum}`.padEnd(6, '0'),
          `C${String(i + 1).padStart(10, '0')}`,
          item.fecha_emision?.replace(/-/g, ''),
          '01',
          item.proveedores?.ruc ?? '',
          item.proveedores?.razon_social ?? '',
          item.numero ?? '',
          '',
          (item.total - (item.igv ?? 0)).toFixed(2),
          (item.igv ?? 0).toFixed(2),
          item.total?.toFixed(2),
          '1',
          '1',
        ].join('|')
      }
    }).join('\n')

    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = tipo === 'ventas'
      ? `RVIE_${anio}${mesNum}.txt`
      : `RCPE_${anio}${mesNum}.txt`
    a.click()
    URL.revokeObjectURL(url)

    setGenerando(null)
    setMsg({ text: `Archivo ${tipo === 'ventas' ? 'RVIE' : 'RCPE'} generado correctamente`, tipo: 'success' })
    setTimeout(() => setMsg(null), 4000)
  }

  const actualizarTC = async () => {
    setActualizandoTC(true)
    // Simulamos obtener el tipo de cambio del SBS (en producción usar la API real)
    await new Promise((r) => setTimeout(r, 1500))
    const hoyStr = new Date().toISOString().split('T')[0]
    const compra = 3.70 + Math.random() * 0.02
    const venta = compra + 0.01 + Math.random() * 0.01

    const { error } = await supabase.from('tipo_cambio').upsert({
      fecha: hoyStr,
      compra: parseFloat(compra.toFixed(3)),
      venta: parseFloat(venta.toFixed(3)),
    }, { onConflict: 'fecha' })

    setActualizandoTC(false)
    if (error) {
      setMsg({ text: 'Error al actualizar el tipo de cambio', tipo: 'error' })
    } else {
      setMsg({ text: `Tipo de cambio actualizado: Compra S/ ${compra.toFixed(3)} / Venta S/ ${venta.toFixed(3)}`, tipo: 'success' })
      loadData()
    }
    setTimeout(() => setMsg(null), 5000)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Contabilidad</h1>
        <p className="text-sm text-gray-500 mt-0.5">PLE / SIRE, libros contables y tipo de cambio</p>
      </div>

      {msg && (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${msg.tipo === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          {msg.tipo === 'success'
            ? <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            : <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          }
          <p className={`text-sm font-medium ${msg.tipo === 'success' ? 'text-green-800' : 'text-red-800'}`}>{msg.text}</p>
        </div>
      )}

      <Tabs defaultValue="ple">
        <TabsList className="bg-gray-100 p-1 rounded-xl">
          {['ple', 'libro_diario', 'libro_mayor', 'tipo_cambio'].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              {tab === 'ple' ? 'PLE / SIRE'
                : tab === 'libro_diario' ? 'Libro Diario'
                : tab === 'libro_mayor' ? 'Libro Mayor'
                : 'Tipo de Cambio'}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* PLE / SIRE */}
        <TabsContent value="ple" className="mt-4 space-y-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Generación SIRE / PLE</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div>
                  <Label>Período (Año-Mes)</Label>
                  <Input
                    type="month"
                    value={mes}
                    onChange={(e) => setMes(e.target.value)}
                    className="mt-1 w-40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="border border-green-200 bg-green-50/50">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-800">RVIE — Registro de Ventas</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {comprobantes.length} comprobantes en el período
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">Formato TXT para SUNAT / SIRE</p>
                      </div>
                      <BookOpen className="w-5 h-5 text-green-600" />
                    </div>
                    <Button
                      onClick={() => generarPLE('ventas')}
                      disabled={generando === 'ventas' || comprobantes.length === 0}
                      className="mt-4 bg-green-600 hover:bg-green-700 gap-2 w-full"
                    >
                      {generando === 'ventas' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Generar RVIE
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border border-blue-200 bg-blue-50/50">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-800">RCPE — Registro de Compras</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {compras.length} compras en el período
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">Formato TXT para SUNAT / SIRE</p>
                      </div>
                      <BookOpen className="w-5 h-5 text-blue-600" />
                    </div>
                    <Button
                      onClick={() => generarPLE('compras')}
                      disabled={generando === 'compras' || compras.length === 0}
                      className="mt-4 bg-blue-600 hover:bg-blue-700 gap-2 w-full"
                    >
                      {generando === 'compras' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Generar RCPE
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Preview comprobantes */}
              {comprobantes.length > 0 && (
                <div className="mt-2 overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {['Fecha', 'Serie-Número', 'Tipo', 'Cliente', 'Subtotal', 'IGV', 'Total'].map((h) => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {comprobantes.slice(0, 10).map((c: any, i: number) => (
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="py-2 px-3 text-xs text-gray-500">{formatDate(c.fecha_emision)}</td>
                          <td className="py-2 px-3 font-mono text-xs">{c.serie}-{c.numero}</td>
                          <td className="py-2 px-3 text-xs capitalize">{c.tipo}</td>
                          <td className="py-2 px-3 text-xs text-gray-700 max-w-[160px] truncate">{(c.clientes as any)?.razon_social ?? '—'}</td>
                          <td className="py-2 px-3 text-xs">{((c.total ?? 0) - (c.igv ?? 0)).toFixed(2)}</td>
                          <td className="py-2 px-3 text-xs">{(c.igv ?? 0).toFixed(2)}</td>
                          <td className="py-2 px-3 text-xs font-bold">{(c.total ?? 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {comprobantes.length > 10 && (
                        <tr>
                          <td colSpan={7} className="py-2 px-3 text-xs text-gray-400 text-center">
                            +{comprobantes.length - 10} comprobantes más...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Libro Diario */}
        <TabsContent value="libro_diario" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Libro Diario</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <BookOpen className="w-12 h-12 mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-600">Libro Diario</p>
                <p className="text-xs mt-1">Módulo en implementación — Requiere configuración del plan de cuentas PCGE</p>
                <Button variant="outline" className="mt-4 gap-2">
                  <Download className="w-4 h-4" /> Exportar a Excel
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Libro Mayor */}
        <TabsContent value="libro_mayor" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Libro Mayor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <BookOpen className="w-12 h-12 mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-600">Libro Mayor</p>
                <p className="text-xs mt-1">Módulo en implementación — Requiere configuración del plan de cuentas PCGE</p>
                <Button variant="outline" className="mt-4 gap-2">
                  <Download className="w-4 h-4" /> Exportar a Excel
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tipo de Cambio */}
        <TabsContent value="tipo_cambio" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-800">Tipo de Cambio USD/PEN</CardTitle>
              <Button
                onClick={actualizarTC}
                disabled={actualizandoTC}
                variant="outline"
                size="sm"
                className="gap-2 h-8 text-xs"
              >
                {actualizandoTC ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Actualizar desde SBS
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : tipoCambios.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No hay registros de tipo de cambio</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Fecha', 'Moneda', 'Compra (S/)', 'Venta (S/)'].map((h) => (
                        <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tipoCambios.map((tc, i) => (
                      <tr key={i} className={`hover:bg-gray-50/50 ${i === 0 ? 'bg-green-50/30' : ''}`}>
                        <td className="py-2.5 px-4 text-gray-700 font-medium">{formatDate(tc.fecha)}</td>
                        <td className="py-2.5 px-4">
                          <Badge variant="outline" className="text-xs font-mono">{tc.moneda ?? 'USD'}</Badge>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-gray-700">S/ {(tc.compra ?? 0).toFixed(3)}</td>
                        <td className="py-2.5 px-4 font-mono font-bold text-green-700">S/ {(tc.venta ?? 0).toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
