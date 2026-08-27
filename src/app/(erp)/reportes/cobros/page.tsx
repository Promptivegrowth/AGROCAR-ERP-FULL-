'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA } from '@/lib/empresa'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Wallet, Search, Loader2, Calendar, Printer } from 'lucide-react'

/**
 * Cobranzas recibidas — quién pagó, cuánto y cómo.
 *
 * El estado de cuenta contesta cuánto DEBE un cliente. Faltaba la pregunta de
 * al lado, que es la que se hace al cuadrar la caja o al revisar un reclamo:
 * qué entró en estos días, de quién y por qué medio.
 *
 * De ahí las columnas separadas por método: un cobro no es "S/ 745", es
 * "S/ 245 en efectivo y S/ 500 por Yape con operación 11623043". Cuando hay
 * que rastrear un depósito, ese número de operación es lo único que sirve.
 *
 * La columna "Aplicado a" cierra el círculo: contra qué boletas se imputó cada
 * cobro. Si dice "a cuenta" es plata que el cliente adelantó y todavía no
 * tiene factura; desde la migración 101 se descuenta sola de la siguiente.
 */

interface Aplic {
  monto: number
  a_cuenta: boolean
  comprobante: string | null
}

interface CobroRow {
  id: string
  numero: string
  fecha: string
  cliente: string
  doc: string
  cobrador: string
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  total: number
  nro_operacion: string | null
  aplicaciones: Aplic[]
}

const METODOS = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'yape', label: 'Yape' },
  { key: 'plin', label: 'Plin' },
  { key: 'transferencia', label: 'Transferencia' },
] as const

export default function ReporteCobrosPage() {
  const supabase = createClient()

  const hoy = hoyLima()
  const [desde, setDesde] = useState(hoy)
  const [hasta, setHasta] = useState(hoy)
  const [cobradorId, setCobradorId] = useState('todos')
  const [metodo, setMetodo] = useState('todos')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [cobradores, setCobradores] = useState<{ id: string; full_name: string }[]>([])
  const [cobros, setCobros] = useState<CobroRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('activo', true)
        .order('full_name')
      setCobradores((data ?? []) as any)
    })()
  }, [supabase])

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      let q = (supabase as any)
        .from('cobros')
        .select(`
          id, numero, fecha, efectivo, yape, plin, transferencia, total, nro_operacion,
          cliente_externo_nombre, cliente_externo_doc,
          clientes(razon_social, ruc, dni),
          profiles!cobros_cobrador_id_fkey(id, full_name),
          cobros_aplicaciones(monto_aplicado, es_a_cuenta, comprobantes(serie, numero))
        `)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: true })
        .order('numero', { ascending: true })

      if (cobradorId !== 'todos') q = q.eq('cobrador_id', cobradorId)

      const { data, error } = await q
      if (error) {
        console.error(error)
        setCobros([])
        return
      }

      setCobros(((data ?? []) as any[]).map((c) => ({
        id: c.id,
        numero: c.numero ?? '—',
        fecha: c.fecha,
        // Un cobro puede ser de un cliente registrado o de uno de paso; en el
        // segundo caso el nombre viaja suelto en el propio cobro.
        cliente: c.clientes?.razon_social ?? c.cliente_externo_nombre ?? 'Consumidor final',
        doc: c.clientes?.ruc ?? c.clientes?.dni ?? c.cliente_externo_doc ?? '—',
        cobrador: c.profiles?.full_name ?? '—',
        efectivo: Number(c.efectivo ?? 0),
        yape: Number(c.yape ?? 0),
        plin: Number(c.plin ?? 0),
        transferencia: Number(c.transferencia ?? 0),
        total: Number(c.total ?? 0),
        nro_operacion: c.nro_operacion,
        aplicaciones: ((c.cobros_aplicaciones ?? []) as any[]).map((a) => ({
          monto: Number(a.monto_aplicado ?? 0),
          a_cuenta: !!a.es_a_cuenta || !a.comprobantes,
          comprobante: a.comprobantes ? `${a.comprobantes.serie}-${a.comprobantes.numero}` : null,
        })),
      })))
    } finally {
      setLoading(false)
    }
  }, [supabase, desde, hasta, cobradorId])

  useEffect(() => { cargar() }, [cargar])

  const filas = useMemo(() => {
    const q = filtroCliente.trim().toLowerCase()
    return cobros.filter((c) => {
      if (q && !c.cliente.toLowerCase().includes(q) && !c.doc.toLowerCase().includes(q)) return false
      // Filtrar por método deja solo los cobros que usaron ese medio; el
      // importe que se muestra sigue siendo el del cobro completo, porque un
      // mismo recibo puede mezclar efectivo y Yape.
      if (metodo !== 'todos' && (c as any)[metodo] <= 0) return false
      return true
    })
  }, [cobros, filtroCliente, metodo])

  const totales = useMemo(() => ({
    cobros: filas.length,
    clientes: new Set(filas.map((f) => f.cliente)).size,
    efectivo: filas.reduce((a, f) => a + f.efectivo, 0),
    yape: filas.reduce((a, f) => a + f.yape, 0),
    plin: filas.reduce((a, f) => a + f.plin, 0),
    transferencia: filas.reduce((a, f) => a + f.transferencia, 0),
    total: filas.reduce((a, f) => a + f.total, 0),
  }), [filas])

  const setRango = (dias: number) => {
    const d = new Date(hoy + 'T00:00:00-05:00')
    d.setDate(d.getDate() - dias)
    setDesde(d.toISOString().slice(0, 10))
    setHasta(hoy)
  }

  const ahora = new Date()
  const selloFecha = ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })
  const selloHora = ahora.toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Lima',
  })
  const fechaCorta = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Lima' })

  const resumenAplicacion = (c: CobroRow) => {
    const comps = c.aplicaciones.filter((a) => a.comprobante).map((a) => a.comprobante!)
    const aCuenta = c.aplicaciones.filter((a) => a.a_cuenta).reduce((a, x) => a + x.monto, 0)
    const partes: string[] = []
    if (comps.length) partes.push(comps.join(' · '))
    if (aCuenta > 0.01) partes.push(`a cuenta ${aCuenta.toFixed(2)}`)
    return partes.join(' · ') || '—'
  }

  return (
    <div className="space-y-4 print:space-y-0">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .simple-table { table-layout: fixed !important; width: 100% !important; }
          .simple-table td, .simple-table th { overflow: hidden; }
          .simple-table .col-cliente { white-space: normal; word-break: break-word; }
          .simple-table .nowrap { white-space: nowrap !important; }
          tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
        .print-only { display: none; }
      `}</style>

      {/* ── Pantalla ─────────────────────────────────────────────────────── */}
      <div className="no-print space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Wallet className="w-6 h-6 text-emerald-600" />
              Cobranzas recibidas
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Quién pagó, cuánto y por qué medio — con número de operación
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
            >
              <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
            </button>
            <div className="text-right bg-black text-white rounded-lg px-4 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-400">Total cobrado</p>
              <p className="text-xl font-bold text-[#FBE600]">{formatCurrency(totales.total)}</p>
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-1">
              <button onClick={() => { setDesde(hoy); setHasta(hoy) }}
                className={`px-2 py-1.5 text-xs font-semibold rounded border ${
                  desde === hoy && hasta === hoy ? 'bg-[#FBE600] border-yellow-500' : 'bg-white border-gray-300 hover:bg-gray-50'
                }`}>
                <Calendar className="w-3 h-3 inline mr-0.5" />Hoy
              </button>
              <button onClick={() => setRango(6)}
                className="px-2 py-1.5 text-xs font-semibold rounded border bg-white border-gray-300 hover:bg-gray-50">
                7 días
              </button>
              <button onClick={() => setRango(29)}
                className="px-2 py-1.5 text-xs font-semibold rounded border bg-white border-gray-300 hover:bg-gray-50">
                30 días
              </button>
            </div>
            <div>
              <Label className="text-[10px] text-gray-500">Desde</Label>
              <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-36 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] text-gray-500">Hasta</Label>
              <Input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className="w-36 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] text-gray-500">Cobrador</Label>
              <Select value={cobradorId} onValueChange={setCobradorId}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {cobradores.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-gray-500">Método de pago</Label>
              <Select value={metodo} onValueChange={setMetodo}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {METODOS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <Label className="text-[10px] text-gray-500">Cliente (nombre o documento)</Label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}
                  className="pl-7 h-8 text-xs" placeholder="Buscar..." />
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            {totales.cobros} cobros · {totales.clientes} clientes
          </p>
        </div>

        {/* Totales por método: es el corte con el que se cuadra la caja. */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-xs text-emerald-700 font-semibold">EFECTIVO</p>
            <p className="text-lg font-bold text-emerald-900">{formatCurrency(totales.efectivo)}</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="text-xs text-purple-700 font-semibold">YAPE</p>
            <p className="text-lg font-bold text-purple-900">{formatCurrency(totales.yape)}</p>
          </div>
          <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3">
            <p className="text-xs text-cyan-700 font-semibold">PLIN</p>
            <p className="text-lg font-bold text-cyan-900">{formatCurrency(totales.plin)}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-700 font-semibold">TRANSFERENCIA</p>
            <p className="text-lg font-bold text-blue-900">{formatCurrency(totales.transferencia)}</p>
          </div>
          <div className="bg-gray-900 border border-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-300 font-semibold">TOTAL</p>
            <p className="text-lg font-bold text-[#FBE600]">{formatCurrency(totales.total)}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : filas.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">
              No hay cobros en el período seleccionado.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr className="border-b border-gray-200">
                    <th className="text-left p-2 font-semibold text-gray-600 w-20">Fecha</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-32">Recibo</th>
                    <th className="text-left p-2 font-semibold text-gray-600">Cliente</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-28">Cobrador</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-20">Efectivo</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-20">Yape</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-20">Plin</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-20">Transf.</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-24">Total</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-28">N° Oper.</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-40">Aplicado a</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-emerald-50/40">
                      <td className="p-2 font-mono text-[10px] text-gray-700">{fechaCorta(c.fecha)}</td>
                      <td className="p-2 font-mono text-[10px] text-gray-700">{c.numero}</td>
                      <td className="p-2">
                        <span className="font-medium text-gray-900">{c.cliente}</span>
                        <span className="text-[10px] text-gray-500 ml-1 font-mono">{c.doc}</span>
                      </td>
                      <td className="p-2 text-gray-600 text-[11px]">{c.cobrador}</td>
                      <td className="p-2 text-right font-mono">{c.efectivo > 0 ? c.efectivo.toFixed(2) : '—'}</td>
                      <td className="p-2 text-right font-mono">{c.yape > 0 ? c.yape.toFixed(2) : '—'}</td>
                      <td className="p-2 text-right font-mono">{c.plin > 0 ? c.plin.toFixed(2) : '—'}</td>
                      <td className="p-2 text-right font-mono">{c.transferencia > 0 ? c.transferencia.toFixed(2) : '—'}</td>
                      <td className="p-2 text-right font-mono font-bold">{formatCurrency(c.total)}</td>
                      <td className="p-2 font-mono text-[10px] text-gray-600">{c.nro_operacion ?? '—'}</td>
                      <td className="p-2 font-mono text-[10px] text-gray-600">{resumenAplicacion(c)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 sticky bottom-0">
                  <tr className="border-t-2 border-gray-300 font-bold">
                    <td colSpan={4} className="p-2 text-right">TOTALES</td>
                    <td className="p-2 text-right font-mono">{totales.efectivo.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{totales.yape.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{totales.plin.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{totales.transferencia.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(totales.total)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Impresión: misma estructura simple que la hoja de reparto ────── */}
      <div className="print-only">
        <div className="flex items-baseline justify-between pb-1 border-b-2 border-black">
          <span className="font-bold text-[10pt] whitespace-nowrap">{EMPRESA.razon_social}</span>
          <h1 className="text-[12pt] font-bold text-gray-900 underline">COBRANZAS RECIBIDAS</h1>
          <span className="text-[8pt] text-gray-600 whitespace-nowrap">{selloFecha} · {selloHora}</span>
        </div>

        <div className="flex items-center gap-4 py-1.5 text-[11px] text-gray-700 border-b border-gray-200">
          <span><strong>Del:</strong> {fechaCorta(desde)} <strong>al</strong> {fechaCorta(hasta)}</span>
          <span><strong>Cobrador:</strong> {cobradorId === 'todos' ? 'Todos' : (cobradores.find((c) => c.id === cobradorId)?.full_name ?? '—')}</span>
          <span><strong>Método:</strong> {metodo === 'todos' ? 'Todos' : (METODOS.find((m) => m.key === metodo)?.label ?? '—')}</span>
          <span><strong>Cobros:</strong> {totales.cobros}</span>
          <span><strong>Clientes:</strong> {totales.clientes}</span>
          <span className="ml-auto font-bold">Total: S/ {totales.total.toFixed(2)}</span>
        </div>

        <table className="simple-table w-full mt-1" style={{ borderCollapse: 'collapse', lineHeight: 1.15, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '6%' }} />{/* Fecha */}
            <col style={{ width: '11%' }} />{/* Recibo */}
            <col style={{ width: '22%' }} />{/* Cliente */}
            <col style={{ width: '8%' }} />{/* Doc */}
            <col style={{ width: '11%' }} />{/* Cobrador */}
            <col style={{ width: '6%' }} />{/* Efectivo */}
            <col style={{ width: '6%' }} />{/* Yape */}
            <col style={{ width: '5%' }} />{/* Plin */}
            <col style={{ width: '6%' }} />{/* Transf */}
            <col style={{ width: '7%' }} />{/* Total */}
            <col style={{ width: '12%' }} />{/* Aplicado a / operación */}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-400">
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Fecha</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Recibo</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Cliente</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Doc.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Cobrador</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Efect.</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Yape</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Plin</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Transf.</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Total</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Aplicado a / Oper.</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.id} className="border-b border-dotted border-gray-200" style={{ lineHeight: 1.1 }}>
                <td className="nowrap px-1 py-0 font-mono text-[8pt] text-gray-700">{fechaCorta(c.fecha)}</td>
                <td className="nowrap px-1 py-0 font-mono text-[8pt] text-gray-700">{c.numero}</td>
                <td className="col-cliente px-1 py-0 text-[8.5pt] text-gray-900 uppercase">{c.cliente}</td>
                <td className="nowrap px-1 py-0 font-mono text-[8pt] text-gray-700">{c.doc}</td>
                <td className="px-1 py-0 text-[8pt] text-gray-700">{c.cobrador}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right">{c.efectivo > 0 ? c.efectivo.toFixed(2) : ''}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right">{c.yape > 0 ? c.yape.toFixed(2) : ''}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right">{c.plin > 0 ? c.plin.toFixed(2) : ''}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right">{c.transferencia > 0 ? c.transferencia.toFixed(2) : ''}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right font-semibold">{c.total.toFixed(2)}</td>
                <td className="px-1 py-0 font-mono text-[7pt] text-gray-600">
                  {resumenAplicacion(c)}
                  {c.nro_operacion ? ` · op.${c.nro_operacion}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={5} className="px-1 py-1.5 text-[9pt] font-bold text-right">TOTALES:</td>
              <td className="nowrap px-1 py-1.5 text-[8.5pt] font-bold text-right">{totales.efectivo.toFixed(2)}</td>
              <td className="nowrap px-1 py-1.5 text-[8.5pt] font-bold text-right">{totales.yape.toFixed(2)}</td>
              <td className="nowrap px-1 py-1.5 text-[8.5pt] font-bold text-right">{totales.plin.toFixed(2)}</td>
              <td className="nowrap px-1 py-1.5 text-[8.5pt] font-bold text-right">{totales.transferencia.toFixed(2)}</td>
              <td className="nowrap px-1 py-1.5 text-[10pt] font-bold text-right">S/ {totales.total.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
