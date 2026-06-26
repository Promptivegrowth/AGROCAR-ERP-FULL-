'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, RefreshCw, Zap, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface Transaccion {
  tipo: 'venta' | 'cobro' | 'compra'
  id: string
  fecha: string
  referencia: string
  detalle: string
  monto: number
}

export default function AsientosAutomaticosPage() {
  const router = useRouter()
  const supabase = createClient()
  const hoy = hoyLima()
  const desdeDefault = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00'); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })()

  const [desde, setDesde] = useState(desdeDefault)
  const [hasta, setHasta] = useState(hoy)
  const [pendientes, setPendientes] = useState<Transaccion[]>([])
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'venta' | 'cobro' | 'compra'>('todos')

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any)
      .from('v_transacciones_sin_asiento')
      .select('*')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .limit(500)
    setPendientes((data ?? []) as Transaccion[])
    setLoading(false)
  }, [supabase, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const filtradas = useMemo(() => {
    if (filtroTipo === 'todos') return pendientes
    return pendientes.filter((p) => p.tipo === filtroTipo)
  }, [pendientes, filtroTipo])

  const conteos = useMemo(() => {
    const c = { venta: 0, cobro: 0, compra: 0 }
    pendientes.forEach((p) => { c[p.tipo]++ })
    return c
  }, [pendientes])

  const generar = async () => {
    if (!confirm(`Generar asientos contables automáticos para ${pendientes.length} transacciones del rango ${desde} al ${hasta}?\n\nLos asientos quedarán en estado BORRADOR para que el contador los revise antes de asentar.`)) return
    setGenerando(true)
    const { data, error } = await (supabase.rpc as any)('generar_asientos_pendientes', {
      p_desde: desde, p_hasta: hasta,
    })
    setGenerando(false)
    if (error) {
      toast.error('Error al generar', { description: error.message })
      return
    }
    const total = (data?.ventas ?? 0) + (data?.cobros ?? 0) + (data?.compras ?? 0)
    const errores = (data?.errores ?? []) as string[]
    if (errores.length > 0) {
      toast.warning(`${total} asientos generados, ${errores.length} con error`, {
        description: errores.slice(0, 2).join(' · '),
      })
    } else {
      toast.success(`${total} asientos generados en borrador`, {
        description: `${data.ventas} ventas · ${data.cobros} cobros · ${data.compras} compras. Ve al Libro Diario para revisarlos.`,
      })
    }
    cargar()
  }

  const COLOR_TIPO: Record<string, string> = {
    venta: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    cobro: 'bg-blue-100 text-blue-800 border-blue-200',
    compra: 'bg-amber-100 text-amber-800 border-amber-200',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-500" />
            Asientos Automáticos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Genera asientos contables desde transacciones operativas (ventas, cobros, compras)
          </p>
        </div>
      </div>

      {/* Aviso de coherencia con el flujo de Daniel */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 space-y-1">
        <p><strong>📋 Esquema contable aplicado (PCGE Modificado):</strong></p>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li><strong>Ventas</strong> (factura/boleta no anulada):
            <span className="text-blue-700"> 1212 (CxC cartera) D = 70111 (Ventas mercaderías) + 40111 (IGV propia) H</span>
          </li>
          <li><strong>Cobros</strong>:
            <span className="text-blue-700"> 1011 Caja MN / 1012 Yape-Plin / 1041 Bancos D = 1212 CxC + 759 a-cuenta H</span>
          </li>
          <li><strong>Compras</strong> a proveedores:
            <span className="text-blue-700"> 6011 (Compras mercaderías) + 40112 (IGV crédito fiscal) D = 4212 (CxP) H</span>
          </li>
        </ul>
        <p className="mt-1 pt-1 border-t border-blue-200">
          <strong>💡 Detracciones SPOT 4%</strong>: cuando un cliente empresarial detraiga al pagar,
          registra el cobro indicando el monto neto recibido + el 4% en cuenta 40115. El contador
          ajusta el asiento de cobro generado si es necesario.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[10px] text-gray-500">Desde</Label>
          <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-36 h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Hasta</Label>
          <Input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className="w-36 h-8 text-xs" />
        </div>
        <Button variant="outline" size="sm" onClick={cargar} disabled={loading} className="gap-1 h-8 text-xs">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Recargar
        </Button>
        <div className="flex-1" />
        <Button onClick={generar} disabled={generando || pendientes.length === 0}
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold gap-1">
          {generando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Generar {pendientes.length} asientos
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <button
          onClick={() => setFiltroTipo('todos')}
          className={`text-left p-3 rounded-lg border-2 transition-colors ${
            filtroTipo === 'todos' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-400'
          }`}
        >
          <p className="text-xs uppercase font-semibold opacity-70">TOTAL pendiente</p>
          <p className="text-2xl font-bold mt-0.5">{pendientes.length}</p>
        </button>
        <button onClick={() => setFiltroTipo('venta')}
          className={`text-left p-3 rounded-lg border-2 transition-colors ${
            filtroTipo === 'venta' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 border-emerald-200 hover:border-emerald-400'
          }`}>
          <p className="text-xs uppercase font-semibold opacity-70">VENTAS</p>
          <p className="text-2xl font-bold mt-0.5">{conteos.venta}</p>
        </button>
        <button onClick={() => setFiltroTipo('cobro')}
          className={`text-left p-3 rounded-lg border-2 transition-colors ${
            filtroTipo === 'cobro' ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 border-blue-200 hover:border-blue-400'
          }`}>
          <p className="text-xs uppercase font-semibold opacity-70">COBROS</p>
          <p className="text-2xl font-bold mt-0.5">{conteos.cobro}</p>
        </button>
        <button onClick={() => setFiltroTipo('compra')}
          className={`text-left p-3 rounded-lg border-2 transition-colors ${
            filtroTipo === 'compra' ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 border-amber-200 hover:border-amber-400'
          }`}>
          <p className="text-xs uppercase font-semibold opacity-70">COMPRAS</p>
          <p className="text-2xl font-bold mt-0.5">{conteos.compra}</p>
        </button>
      </div>

      {/* Lista */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : filtradas.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No hay transacciones pendientes de contabilizar en este rango.</p>
            <p className="text-xs mt-1">Todas las ventas, cobros y compras ya tienen su asiento.</p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-600 w-20">Tipo</th>
                  <th className="text-left p-2 font-semibold text-gray-600 w-24">Fecha</th>
                  <th className="text-left p-2 font-semibold text-gray-600 w-32">Referencia</th>
                  <th className="text-left p-2 font-semibold text-gray-600">Detalle</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-28">Monto</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((t, i) => (
                  <tr key={`${t.tipo}-${t.id}`} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="p-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${COLOR_TIPO[t.tipo]}`}>
                        {t.tipo.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-xs">{formatDate(t.fecha)}</td>
                    <td className="p-2 font-mono text-xs">{t.referencia}</td>
                    <td className="p-2 text-xs truncate max-w-[300px]">{t.detalle}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(t.monto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-gray-100 z-10 border-t-2 border-gray-300 font-bold">
                <tr>
                  <td colSpan={4} className="p-2 text-right">TOTAL {filtroTipo !== 'todos' ? filtroTipo.toUpperCase() + 's' : ''}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(filtradas.reduce((a, t) => a + t.monto, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 text-center">
        Los asientos se crean en estado <strong>BORRADOR</strong>.{' '}
        Revísalos en el <a href="/contabilidad/diario" className="underline text-blue-700">Libro Diario</a>{' '}
        y asiéntalos cuando el contador esté conforme.
      </div>
    </div>
  )
}
