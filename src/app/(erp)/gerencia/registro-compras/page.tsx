'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, Loader2, Printer, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA } from '@/lib/empresa'
import {
  type FilaCompra, TIPO_COMPRA, normalizarCompras, filtrarCompras, totalesCompras, comprasPorProveedor, comprasPorDia,
  anuladaCompra, restarDias, mesAnterior,
} from '@/lib/registros'

/**
 * Registro de compras para gerencia (Daniel, 07/10/2026): entre dos fechas,
 * con los totales de facturas, documentos internos (sin comprobante) y
 * facturas que regularizan internos, el crédito fiscal y el detalle por
 * proveedor. Datos de la base (registro_compras); filtros y totales en
 * lib/registros, igual que el Excel.
 */

const S = (v: number) => formatCurrency(v)
const ESTADO: Record<string, string> = { registrada: 'Registrada', recibida: 'Recibida', aplicada: 'Aplicada', anulada: 'Anulada' }

export default function RegistroComprasPage() {
  const supabase = createClient()
  const hoy = hoyLima()
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`)
  const [hasta, setHasta] = useState(hoy)
  const [filas, setFilas] = useState<FilaCompra[]>([])
  const [cargando, setCargando] = useState(false)
  const [tipo, setTipo] = useState('todos')
  const [proveedor, setProveedor] = useState('todos')
  const [anuladas, setAnuladas] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [vista, setVista] = useState<'detalle' | 'proveedor' | 'dia'>('detalle')

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return
    setCargando(true)
    const { data, error } = await (supabase.rpc as any)('registro_compras', { p_desde: desde, p_hasta: hasta })
    setCargando(false)
    if (error) { toast.error('No se pudo cargar el registro', { description: error.message }); return }
    setFilas(normalizarCompras(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])
  useEffect(() => { cargar() }, [cargar])

  const visibles = useMemo(() => filtrarCompras(filas, { tipo, proveedor, anuladas, buscar }), [filas, tipo, proveedor, anuladas, buscar])
  const tot = useMemo(() => totalesCompras(visibles), [visibles])
  const proveedores = useMemo(() => Array.from(new Set(filas.map((f) => f.proveedor))).sort(), [filas])
  const excel = `/api/gerencia/registro-compras/excel?${new URLSearchParams({
    desde, hasta, tipo, proveedor, anuladas: anuladas ? '1' : '0', buscar,
  }).toString()}`

  const atajos: [string, string, string][] = [
    ['Hoy', hoy, hoy], ['7 días', restarDias(hoy, 6), hoy], ['Este mes', `${hoy.slice(0, 8)}01`, hoy], ['Mes anterior', ...mesAnterior(hoy)],
  ]
  const campo = 'h-8 rounded-md border border-gray-300 bg-white px-2 text-xs'
  const tab = (k: typeof vista, t: string) => (
    <button type="button" onClick={() => setVista(k)} data-vista={k}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${vista === k ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{t}</button>
  )
  const nVigentes = tot.porTipo.factura.cantidad + tot.porTipo.interno.cantidad + tot.porTipo.regulariza.cantidad

  return (
    <div className="space-y-4" data-registro-compras>
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
            <h1 className="text-xl font-bold">Registro de compras</h1>
            <p className="text-sm text-gray-300">Del {formatDate(desde)} al {formatDate(hasta)} · {nVigentes} documentos</p>
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
        <p className="text-sm font-semibold">Registro de compras — del {formatDate(desde)} al {formatDate(hasta)}</p>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo} aria-label="Tipo">
          <option value="todos">Todos los documentos</option>
          {Object.entries(TIPO_COMPRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={`${campo} max-w-[260px]`} aria-label="Proveedor">
          <option value="todos">Todos los proveedores</option>
          {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={anuladas} onChange={(e) => setAnuladas(e.target.checked)} /> Mostrar anuladas
        </label>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-2 h-4 w-4 text-gray-400" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar proveedor, RUC o N° de documento"
            className={`${campo} w-full pl-8`} />
        </div>
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-kpis>
        <div className="rounded-lg border border-yellow-400 bg-[#FBE600] p-3" data-kpi="total">
          <p className="text-xs font-semibold">TOTAL COMPRAS</p><p className="text-xl font-bold">{S(tot.total)}</p>
          <p className="text-[11px]">{nVigentes} documentos</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900" data-kpi="factura">
          <p className="text-xs font-semibold">CON FACTURA</p><p className="text-lg font-bold">{S(tot.conComprobante)}</p>
          <p className="text-[11px] opacity-70">{tot.porTipo.factura.cantidad + tot.porTipo.regulariza.cantidad} documento(s){tot.porTipo.regulariza.cantidad ? ` · ${tot.porTipo.regulariza.cantidad} regulariza internos` : ''}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900" data-kpi="interno">
          <p className="text-xs font-semibold">DOC. INTERNOS (SIN COMPROBANTE)</p><p className="text-lg font-bold">{S(tot.sinComprobante)}</p>
          <p className="text-[11px] opacity-70">{tot.porTipo.interno.cantidad} documento(s)</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900" data-kpi="igv">
          <p className="text-xs font-semibold">IGV CRÉDITO FISCAL</p><p className="text-lg font-bold">{S(tot.creditoFiscal)}</p>
          <p className="text-[11px] opacity-70">Valor compra {S(tot.valorCompra)}</p>
        </div>
      </div>
      {tot.anuladas.cantidad > 0 && <p className="text-[11px] text-gray-500">{tot.anuladas.cantidad} compra(s) anulada(s) por {S(tot.anuladas.total)}: no suman.</p>}

      <div className="no-print flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
        {tab('detalle', `Detalle (${visibles.length})`)}
        {tab('proveedor', 'Por proveedor')}
        {tab('dia', 'Resumen por día')}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {vista === 'detalle' && (
          <table className="w-full min-w-[980px] text-xs" data-tabla="detalle">
            <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>{['Fecha', 'Tipo', 'Documento', 'Proveedor', 'RUC', 'Valor compra', 'IGV', 'Total', 'Estado']
                .map((h, i) => <th key={h} className={`p-2 ${i >= 5 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibles.length === 0 ? (
                <tr><td colSpan={9} className="p-8 text-center text-gray-400">{cargando ? 'Cargando…' : 'No hay compras con estos filtros'}</td></tr>
              ) : visibles.map((f) => (
                <tr key={f.id} className={anuladaCompra(f) ? 'text-gray-400 line-through' : ''} data-fila-compra>
                  <td className="p-2 whitespace-nowrap">{formatDate(f.fecha)}</td>
                  <td className="p-2">{TIPO_COMPRA[f.tipo]}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{f.documento}</td>
                  <td className="p-2 max-w-[260px] truncate" title={f.proveedor}>{f.proveedor}</td>
                  <td className="p-2 font-mono">{f.ruc || '—'}</td>
                  <td className="p-2 text-right font-mono">{S(f.base)}</td>
                  <td className="p-2 text-right font-mono">{f.tipo === 'interno' ? '—' : S(f.igv)}</td>
                  <td className="p-2 text-right font-mono font-semibold">{S(f.total)}</td>
                  <td className="p-2">{ESTADO[f.estado] ?? f.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {vista === 'proveedor' && (
          <table className="w-full min-w-[860px] text-xs" data-tabla="proveedor">
            <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>{['Proveedor', 'RUC', 'Documentos', 'Con factura', 'Doc. internos', 'IGV', 'Total', '% del total']
                .map((h, i) => <th key={h} className={`p-2 ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {comprasPorProveedor(visibles).map((g) => (
                <tr key={g.nombre}>
                  <td className="p-2 max-w-[280px] truncate" title={g.nombre}>{g.nombre}</td><td className="p-2 font-mono">{g.ruc || '—'}</td>
                  <td className="p-2 text-right">{g.documentos}</td>
                  <td className="p-2 text-right font-mono">{S(g.factura + g.regulariza)}</td><td className="p-2 text-right font-mono">{S(g.interno)}</td>
                  <td className="p-2 text-right font-mono">{S(g.igv)}</td><td className="p-2 text-right font-mono font-bold">{S(g.total)}</td>
                  <td className="p-2 text-right">{tot.total ? `${((g.total / tot.total) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
              <tr className="bg-gray-900 font-bold text-white">
                <td className="p-2" colSpan={2}>TOTAL</td><td className="p-2 text-right">{nVigentes}</td>
                <td className="p-2 text-right font-mono">{S(tot.conComprobante)}</td><td className="p-2 text-right font-mono">{S(tot.sinComprobante)}</td>
                <td className="p-2 text-right font-mono">{S(tot.creditoFiscal)}</td><td className="p-2 text-right font-mono">{S(tot.total)}</td><td className="p-2 text-right">100%</td>
              </tr>
            </tbody>
          </table>
        )}
        {vista === 'dia' && (
          <table className="w-full min-w-[700px] text-xs" data-tabla="dia">
            <thead className="border-b bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>{['Fecha', 'Documentos', 'Con factura', 'Doc. internos', 'Regulariza', 'Total del día'].map((h, i) => <th key={h} className={`p-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {comprasPorDia(visibles).map((d) => (
                <tr key={d.fecha}>
                  <td className="p-2">{formatDate(d.fecha)}</td><td className="p-2 text-right">{d.documentos}</td>
                  <td className="p-2 text-right font-mono">{S(d.factura)}</td><td className="p-2 text-right font-mono">{S(d.interno)}</td>
                  <td className="p-2 text-right font-mono">{S(d.regulariza)}</td><td className="p-2 text-right font-mono font-bold">{S(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-gray-500">
        Lo anulado no suma. Crédito fiscal = IGV de facturas (incluidas las que regularizan documentos internos). Los documentos internos
        no tienen comprobante: sin IGV y fuera del Registro de Compras de SUNAT.
      </p>
    </div>
  )
}
