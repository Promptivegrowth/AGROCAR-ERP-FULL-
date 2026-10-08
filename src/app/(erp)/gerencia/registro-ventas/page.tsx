'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, Loader2, Printer, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA } from '@/lib/empresa'
import {
  type FilaVenta, TIPO_VENTA, normalizarVentas, filtrarVentas, totalesVentas, ventasPorDia, ventasPor,
  anuladaVenta, restarDias, mesAnterior,
} from '@/lib/registros'

/**
 * Registro de ventas para gerencia (Daniel, 07/10/2026): entre dos fechas,
 * con los totales de facturas, boletas y documentos internos, y los filtros
 * para mirar por tipo, condición, vendedor o cliente. Datos de la base
 * (registro_ventas); filtros y totales en lib/registros, igual que el Excel.
 */

const S = (v: number) => formatCurrency(v)

export default function RegistroVentasPage() {
  const supabase = createClient()
  const hoy = hoyLima()
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`)
  const [hasta, setHasta] = useState(hoy)
  const [filas, setFilas] = useState<FilaVenta[]>([])
  const [cargando, setCargando] = useState(false)
  const [tipo, setTipo] = useState('todos')
  const [condicion, setCondicion] = useState('todas')
  const [vendedor, setVendedor] = useState('todos')
  const [anulados, setAnulados] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [vista, setVista] = useState<'detalle' | 'dia' | 'vendedor' | 'cliente'>('detalle')

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return
    setCargando(true)
    const { data, error } = await (supabase.rpc as any)('registro_ventas', { p_desde: desde, p_hasta: hasta })
    setCargando(false)
    if (error) { toast.error('No se pudo cargar el registro', { description: error.message }); return }
    setFilas(normalizarVentas(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])
  useEffect(() => { cargar() }, [cargar])

  const filtros = { tipo, condicion, vendedor, anulados, buscar }
  const visibles = useMemo(() => filtrarVentas(filas, filtros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filas, tipo, condicion, vendedor, anulados, buscar])
  const tot = useMemo(() => totalesVentas(visibles), [visibles])
  const vendedores = useMemo(() => Array.from(new Set(filas.map((f) => f.vendedor || 'Sin vendedor'))).sort(), [filas])
  const excel = `/api/gerencia/registro-ventas/excel?${new URLSearchParams({
    desde, hasta, tipo, condicion, vendedor, anulados: anulados ? '1' : '0', buscar,
  }).toString()}`

  const atajos: [string, string, string][] = [
    ['Hoy', hoy, hoy], ['7 días', restarDias(hoy, 6), hoy], ['Este mes', `${hoy.slice(0, 8)}01`, hoy], ['Mes anterior', ...mesAnterior(hoy)],
  ]
  const campo = 'h-8 rounded-md border border-gray-300 bg-white px-2 text-xs'
  const tab = (k: typeof vista, t: string) => (
    <button type="button" onClick={() => setVista(k)} data-vista={k}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${vista === k ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{t}</button>
  )

  return (
    <div className="space-y-4" data-registro-ventas>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 landscape; margin: 9mm; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          table { font-size: 8pt !important; } th, td { padding: 2px 4px !important; }
          tr { page-break-inside: avoid; } thead { display: table-header-group; }
        }
        .print-only { display: none; }
      ` }} />

      <div className="no-print rounded-xl bg-black p-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP · Gerencia</p>
            <h1 className="text-xl font-bold">Registro de ventas</h1>
            <p className="text-sm text-gray-300">Del {formatDate(desde)} al {formatDate(hasta)} · {tot.vigentes} documentos</p>
          </div>
          <div className="flex gap-2">
            <a href={excel} className="inline-flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold hover:bg-green-800" data-excel>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </a>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md bg-[#FBE600] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#E5D100]">
              <Printer className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {atajos.map(([t, d, h]) => (
            <button key={t} type="button" onClick={() => { setDesde(d); setHasta(h) }}
              className={`rounded border px-2 py-1 text-[11px] font-semibold ${desde === d && hasta === h ? 'border-[#FBE600] bg-[#FBE600] text-black' : 'border-white/30 bg-white/10 hover:bg-white/20'}`}>{t}</button>
          ))}
          <label className="ml-1 text-[11px] text-gray-300">Desde</label>
          <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className={`${campo} text-black`} data-desde />
          <label className="text-[11px] text-gray-300">Hasta</label>
          <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className={`${campo} text-black`} data-hasta />
        </div>
      </div>

      <div className="print-only">
        <p className="text-base font-bold">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
        <p className="text-sm font-semibold">Registro de ventas — del {formatDate(desde)} al {formatDate(hasta)}</p>
      </div>

      {/* Filtros */}
      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo} aria-label="Tipo">
          <option value="todos">Todos los documentos</option>
          {Object.entries(TIPO_VENTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className={campo} aria-label="Condición">
          <option value="todas">Contado y crédito</option>
          <option value="contado">Solo contado</option>
          <option value="credito">Solo crédito</option>
        </select>
        <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} className={`${campo} max-w-[220px]`} aria-label="Vendedor">
          <option value="todos">Todos los vendedores</option>
          {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={anulados} onChange={(e) => setAnulados(e.target.checked)} /> Mostrar anulados
        </label>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-2 h-4 w-4 text-gray-400" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cliente, RUC/DNI o N° (F002-15)"
            className={`${campo} w-full pl-8`} />
        </div>
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {/* Totales por tipo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-kpis>
        <div className="rounded-lg border border-yellow-400 bg-[#FBE600] p-3" data-kpi="total">
          <p className="text-xs font-semibold">TOTAL VENTAS</p>
          <p className="text-xl font-bold">{S(tot.total)}</p>
          <p className="text-[11px]">{tot.vigentes} documentos · ticket prom. {S(tot.ticketPromedio)}</p>
        </div>
        {([['factura', 'FACTURAS', 'border-blue-200 bg-blue-50 text-blue-900'], ['boleta', 'BOLETAS', 'border-emerald-200 bg-emerald-50 text-emerald-900'],
          ['nota_pedido_interna', 'DOC. INTERNOS', 'border-amber-200 bg-amber-50 text-amber-900'], ['nota_credito', 'NOTAS DE CRÉDITO', 'border-red-200 bg-red-50 text-red-900']] as const)
          .map(([k, t, c]) => (
            <div key={k} className={`rounded-lg border p-3 ${c}`} data-kpi={k}>
              <p className="text-xs font-semibold">{t}</p>
              <p className="text-lg font-bold">{k === 'nota_credito' && tot.porTipo[k].total > 0 ? '− ' : ''}{S(tot.porTipo[k].total)}</p>
              <p className="text-[11px] opacity-70">{tot.porTipo[k].cantidad} documento(s)</p>
            </div>
          ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-[11px] font-semibold text-gray-500">VALOR VENTA (F + B − NC)</p><p className="font-bold">{S(tot.valorVentaDeclarable)}</p></div>
        <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-[11px] font-semibold text-gray-500">IGV DE VENTAS (F + B − NC)</p><p className="font-bold">{S(tot.igvDeclarable)}</p></div>
        <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-[11px] font-semibold text-gray-500">CONTADO / CRÉDITO</p><p className="font-bold">{S(tot.contado)} <span className="text-gray-400">/</span> {S(tot.credito)}</p></div>
        <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-[11px] font-semibold text-gray-500">COBRADO</p><p className="font-bold text-emerald-700">{S(tot.cobrado)}</p></div>
        <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-[11px] font-semibold text-gray-500">POR COBRAR</p><p className="font-bold text-red-700">{S(tot.porCobrar)}</p>
          {tot.anulados.cantidad > 0 && <p className="text-[10px] text-gray-400">{tot.anulados.cantidad} anulado(s) por {S(tot.anulados.total)}, no suman</p>}</div>
      </div>

      <div className="no-print flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
        {tab('detalle', `Detalle (${visibles.filter((f) => !anuladaVenta(f) || anulados).length})`)}
        {tab('dia', 'Resumen por día')}
        {tab('vendedor', 'Por vendedor')}
        {tab('cliente', 'Por cliente')}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {vista === 'detalle' && (
          <table className="w-full min-w-[1100px] text-xs" data-tabla="detalle">
            <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>{['Fecha', 'Tipo', 'Documento', 'Cliente', 'RUC / DNI', 'Vendedor', 'Condición', 'Valor venta', 'IGV', 'Total', 'Cobrado', 'Saldo', 'SUNAT']
                .map((h, i) => <th key={h} className={`p-2 ${i >= 7 && i <= 11 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibles.length === 0 ? (
                <tr><td colSpan={13} className="p-8 text-center text-gray-400">{cargando ? 'Cargando…' : 'No hay ventas con estos filtros'}</td></tr>
              ) : visibles.map((f) => {
                const anulado = anuladaVenta(f)
                const interno = f.tipo === 'nota_pedido_interna'
                return (
                  <tr key={f.id} className={anulado ? 'text-gray-400 line-through' : ''} data-fila-venta>
                    <td className="p-2 whitespace-nowrap">{formatDate(f.fecha)}</td>
                    <td className="p-2">{TIPO_VENTA[f.tipo] ?? f.tipo}</td>
                    <td className="p-2 font-mono whitespace-nowrap">{f.serie}-{f.numero}</td>
                    <td className="p-2 max-w-[220px] truncate" title={f.cliente}>{f.cliente}</td>
                    <td className="p-2 font-mono">{f.doc}</td>
                    <td className="p-2 max-w-[150px] truncate">{f.vendedor || '—'}</td>
                    <td className="p-2">{f.condicion === 'credito' ? 'Crédito' : 'Contado'}</td>
                    <td className="p-2 text-right font-mono">{interno ? '—' : S(f.base)}</td>
                    <td className="p-2 text-right font-mono">{interno ? '—' : S(f.igv)}</td>
                    <td className="p-2 text-right font-mono font-semibold">{f.tipo === 'nota_credito' ? '− ' : ''}{S(f.total)}</td>
                    <td className="p-2 text-right font-mono text-emerald-700">{f.tipo === 'nota_credito' ? '—' : S(f.cobrado)}</td>
                    <td className={`p-2 text-right font-mono ${f.total - f.cobrado > 0.005 && f.tipo !== 'nota_credito' && !anulado ? 'text-red-700' : 'text-gray-400'}`}>
                      {f.tipo === 'nota_credito' ? '—' : S(Math.max(0, f.total - f.cobrado))}</td>
                    <td className="p-2 text-[10px]">{interno ? 'No aplica' : anulado ? 'Anulado' : (f.sunat_estado ?? 'Pendiente')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {vista === 'dia' && (
          <table className="w-full min-w-[760px] text-xs" data-tabla="dia">
            <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>{['Fecha', 'Documentos', 'Facturas', 'Boletas', 'Doc. internos', 'Notas de crédito', 'Total del día'].map((h, i) => <th key={h} className={`p-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ventasPorDia(visibles).map((d) => (
                <tr key={d.fecha}>
                  <td className="p-2">{formatDate(d.fecha)}</td><td className="p-2 text-right">{d.documentos}</td>
                  <td className="p-2 text-right font-mono">{S(d.factura)}</td><td className="p-2 text-right font-mono">{S(d.boleta)}</td>
                  <td className="p-2 text-right font-mono">{S(d.interno)}</td><td className="p-2 text-right font-mono">{d.nc ? `− ${S(d.nc)}` : '—'}</td>
                  <td className="p-2 text-right font-mono font-bold">{S(d.total)}</td>
                </tr>
              ))}
              <tr className="bg-gray-900 font-bold text-white">
                <td className="p-2">TOTAL</td><td className="p-2 text-right">{tot.vigentes}</td>
                <td className="p-2 text-right font-mono">{S(tot.porTipo.factura.total)}</td><td className="p-2 text-right font-mono">{S(tot.porTipo.boleta.total)}</td>
                <td className="p-2 text-right font-mono">{S(tot.porTipo.nota_pedido_interna.total)}</td>
                <td className="p-2 text-right font-mono">{tot.porTipo.nota_credito.total ? `− ${S(tot.porTipo.nota_credito.total)}` : '—'}</td>
                <td className="p-2 text-right font-mono">{S(tot.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {(vista === 'vendedor' || vista === 'cliente') && (
          <table className="w-full min-w-[760px] text-xs" data-tabla={vista}>
            <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>{[vista === 'vendedor' ? 'Vendedor' : 'Cliente', 'Documentos', 'Facturas', 'Boletas', 'Doc. internos', 'Total', '% del total', 'Por cobrar']
                .map((h, i) => <th key={h} className={`p-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ventasPor(visibles, vista === 'vendedor' ? (f) => f.vendedor || 'Sin vendedor' : (f) => f.cliente).map((g) => (
                <tr key={g.nombre}>
                  <td className="p-2 max-w-[260px] truncate" title={g.nombre}>{g.nombre}</td><td className="p-2 text-right">{g.documentos}</td>
                  <td className="p-2 text-right font-mono">{S(g.factura)}</td><td className="p-2 text-right font-mono">{S(g.boleta)}</td>
                  <td className="p-2 text-right font-mono">{S(g.interno)}</td><td className="p-2 text-right font-mono font-bold">{S(g.total)}</td>
                  <td className="p-2 text-right">{tot.total ? `${((g.total / tot.total) * 100).toFixed(1)}%` : '—'}</td>
                  <td className={`p-2 text-right font-mono ${g.porCobrar > 0.005 ? 'text-red-700' : 'text-gray-400'}`}>{S(g.porCobrar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-gray-500">
        Lo anulado no suma. Las notas de crédito restan. El valor de venta y el IGV son los de facturas y boletas (lo que se declara a SUNAT);
        el documento interno se cuenta por su total. Cobrado = cobros aplicados al documento.
      </p>
    </div>
  )
}
