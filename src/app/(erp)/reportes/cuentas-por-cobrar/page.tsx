'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Printer, Download, Wallet } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EMPRESA } from '@/lib/empresa'

interface ClienteDeuda {
  cliente: string; documento: string; telefono: string | null
  documentos: number; facturado: number; abonado: number
  saldo: number; vencido: number; max_dias: number
}
interface VendedorDeuda {
  key: string; vendedor: string; clientes: number
  saldo: number; vencido: number; detalle: ClienteDeuda[]
}
interface Datos {
  desde: string | null; hasta: string | null; generado_at: string
  vendedores: VendedorDeuda[]
  totales: {
    clientes: number; documentos: number
    facturado: number; abonado: number; saldo: number; vencido: number
  }
}

const num = (v: number) =>
  Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CuentasPorCobrarPage() {
  const router = useRouter()
  const supabase = createClient()

  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [vendedorId, setVendedorId] = useState('')
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([])
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await (supabase as any)
        .from('profiles').select('id, full_name, email')
        .in('role', ['vendedor', 'repartidor']).eq('activo', true).order('full_name')
      setVendedores((data ?? []).map((v: any) => ({ id: v.id, nombre: v.full_name || v.email })))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const { data, error: e } = await (supabase.rpc as any)('cuentas_por_cobrar_consolidado', {
      p_desde: desde || null,
      p_hasta: hasta || null,
      p_vendedor_id: vendedorId || null,
    })
    setCargando(false)
    if (e) { setError(e.message); setDatos(null); return }
    setDatos(data as Datos)
  }, [supabase, desde, hasta, vendedorId])

  useEffect(() => { cargar() }, [cargar])

  const exportarExcel = () => {
    if (!datos) return
    const filas: string[] = []
    filas.push(`CUENTAS POR COBRAR;${desde || 'inicio'} a ${hasta || 'hoy'}`)
    filas.push('VENDEDOR;CLIENTE;DOCUMENTO;TELEFONO;DOCS;FACTURADO;ABONADO;SALDO;VENCIDO;DIAS')
    datos.vendedores.forEach((v) => {
      v.detalle.forEach((c) => {
        filas.push([
          `"${v.vendedor}"`, `"${c.cliente.replace(/"/g, "'")}"`, c.documento,
          c.telefono ?? '', c.documentos, num(c.facturado), num(c.abonado),
          num(c.saldo), num(c.vencido), c.max_dias,
        ].join(';'))
      })
      filas.push(`;"TOTAL ${v.vendedor}";;;;;;${num(v.saldo)};${num(v.vencido)};`)
    })
    filas.push(`;"TOTAL GENERAL";;;;;;${num(datos.totales.saldo)};${num(datos.totales.vencido)};`)
    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cuentas_por_cobrar_${hasta || 'hoy'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-3">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 8mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
        /* Hoja al máximo: Daniel pidió la mayor cantidad de clientes por A4 */
        .hoja { font-size: 8.5pt !important; }
        .hoja table { width: 100% !important; table-layout: fixed !important; }
        .hoja tr { break-inside: avoid; }
        .nowrap { white-space: nowrap !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg" title="Volver">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-blue-600" />
            Cuentas por Cobrar
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Consolidado de todos los vendedores · saldo pendiente por cliente
          </p>
        </div>
        <button onClick={exportarExcel} disabled={!datos}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> Excel
        </button>
        <button onClick={() => window.print()} disabled={!datos}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-40">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3 no-print">
        <div>
          <Label className="text-[10px] text-gray-500">Desde</Label>
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-9 text-sm w-[150px]" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Hasta</Label>
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-9 text-sm w-[150px]" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Vendedor</Label>
          <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white max-w-[200px]">
            <option value="">Todos</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </div>
        {(desde || hasta || vendedorId) && (
          <button onClick={() => { setDesde(''); setHasta(''); setVendedorId('') }}
            className="h-9 px-3 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md">
            Limpiar filtros
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 no-print">{error}</div>
      )}

      {cargando ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : !datos ? null : (
        <>
          {/* Resumen en pantalla */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 no-print">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-[10px] uppercase font-semibold text-blue-700">TOTAL POR COBRAR</p>
              <p className="text-xl font-bold text-blue-900">S/ {num(datos.totales.saldo)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-[10px] uppercase font-semibold text-red-700">VENCIDO</p>
              <p className="text-xl font-bold text-red-900">S/ {num(datos.totales.vencido)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] uppercase font-semibold text-gray-600">CLIENTES</p>
              <p className="text-xl font-bold text-gray-800">{datos.totales.clientes}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] uppercase font-semibold text-gray-600">DOCUMENTOS</p>
              <p className="text-xl font-bold text-gray-800">{datos.totales.documentos}</p>
            </div>
          </div>

          {/* Hoja: en pantalla dentro de una tarjeta, al imprimir a página completa */}
          <div className="hoja bg-white border border-gray-200 rounded-lg p-4 print:border-0 print:rounded-none print:p-0">
            {/* Encabezado mínimo, sin logo (pedido de Daniel) */}
            <div className="flex items-baseline justify-between border-b-2 border-black pb-1 mb-1">
              <span className="font-bold text-[10pt] nowrap">{EMPRESA.razon_social}</span>
              <span className="font-bold text-[11pt] underline">CUENTAS POR COBRAR</span>
              <span className="text-[8pt] text-gray-600 nowrap">
                {desde || hasta ? `${desde || '…'} a ${hasta || '…'}` : 'Al día de hoy'}
                {' · '}
                {new Date(datos.generado_at).toLocaleDateString('es-PE')}
              </span>
            </div>

            <table className="w-full border-collapse text-[9pt]" style={{ tableLayout: 'fixed', lineHeight: 1.15 }}>
              <colgroup>
                <col style={{ width: '34%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-black text-[7.5pt]">
                  <th className="text-left px-1 py-0.5">Cliente</th>
                  <th className="text-left px-1 py-0.5">RUC / DNI</th>
                  <th className="text-left px-1 py-0.5">Teléfono</th>
                  <th className="text-right px-1 py-0.5">Docs</th>
                  <th className="text-right px-1 py-0.5">Saldo</th>
                  <th className="text-right px-1 py-0.5">Vencido</th>
                  <th className="text-right px-1 py-0.5">Días venc.</th>
                </tr>
              </thead>
              <tbody>
                {datos.vendedores.map((v) => (
                  <Fragment key={v.key}>
                    <tr className="bg-gray-100">
                      <td colSpan={4} className="px-1 py-0.5 font-bold uppercase text-[8pt]">
                        {v.vendedor} <span className="font-normal">({v.clientes} clientes)</span>
                      </td>
                      <td className="px-1 py-0.5 text-right font-bold nowrap">{num(v.saldo)}</td>
                      <td className="px-1 py-0.5 text-right font-bold nowrap">{num(v.vencido)}</td>
                      <td />
                    </tr>
                    {v.detalle.map((c, i) => (
                      <tr key={`${v.key}-${i}`} className="border-b border-dotted border-gray-200">
                        <td className="px-1 py-0 uppercase">{c.cliente}</td>
                        <td className="px-1 py-0 font-mono text-[8pt]">{c.documento}</td>
                        <td className="px-1 py-0 font-mono text-[8pt]">{c.telefono ?? '—'}</td>
                        <td className="px-1 py-0 text-right">{c.documentos}</td>
                        <td className="px-1 py-0 text-right font-semibold nowrap">{num(c.saldo)}</td>
                        <td className={`px-1 py-0 text-right nowrap ${c.vencido > 0 ? 'font-semibold' : 'text-gray-400'}`}>
                          {c.vencido > 0 ? num(c.vencido) : '—'}
                        </td>
                        <td className={`px-1 py-0 text-right ${c.max_dias > 30 ? 'font-bold' : ''}`}>
                          {c.max_dias > 0 ? c.max_dias : '—'}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="border-t-2 border-black font-bold text-[10pt]">
                  <td colSpan={4} className="px-1 py-1.5 text-right">TOTAL GENERAL:</td>
                  <td className="px-1 py-1.5 text-right nowrap">S/ {num(datos.totales.saldo)}</td>
                  <td className="px-1 py-1.5 text-right nowrap">S/ {num(datos.totales.vencido)}</td>
                  <td />
                </tr>
              </tbody>
            </table>

            {datos.vendedores.length === 0 && (
              <p className="text-center py-10 text-gray-400 text-sm">
                No hay cuentas por cobrar en el periodo seleccionado
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
