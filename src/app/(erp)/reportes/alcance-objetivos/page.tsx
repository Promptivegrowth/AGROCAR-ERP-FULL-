'use client'

import { useEffect, useState, useCallback, Suspense, Fragment } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Target, Printer, Download } from 'lucide-react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

interface ProductoFila {
  codigo: string
  descripcion: string
  cant_real: number
  cant_cuota: number
  alc_cant: number | null
  valor_real: number
  valor_cuota: number
  alc_valor: number | null
}

interface Linea {
  codigo: string
  nombre: string
  productos: ProductoFila[]
  tot_cant_real: number
  tot_cant_cuota: number
  tot_valor_real: number
  tot_valor_cuota: number
  alc_valor: number | null
}

interface Reporte {
  anio: number
  mes: number
  periodo: string
  vendedor_nombre: string
  lineas: Linea[]
  total_valor_real: number
  total_valor_cuota: number
  alc_total: number | null
}

interface Vendedor { id: string; nombre: string }

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

const num = (v: number | string | null | undefined, dec = 2) =>
  Number(v ?? 0).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const pct = (v: number | null) => (v === null || v === undefined ? '0.00%' : `${num(v)}%`)

function AlcanceInner() {
  const params = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()

  const [anio, setAnio] = useState(parseInt(params.get('anio') ?? '') || ahora.getFullYear())
  const [mes, setMes] = useState(parseInt(params.get('mes') ?? '') || ahora.getMonth() + 1)
  const [vendedorId, setVendedorId] = useState(params.get('vendedor') ?? '')
  const [soloConDatos, setSoloConDatos] = useState(true)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [rep, setRep] = useState<Reporte | null>(null)
  const [loading, setLoading] = useState(false)

  // Cargar lista de vendedores
  useEffect(() => {
    ;(async () => {
      const { data } = await (supabase as any)
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'vendedor')
        .eq('activo', true)
        .order('full_name')
      const vs = (data ?? []).map((v: any) => ({ id: v.id, nombre: v.full_name || v.email }))
      setVendedores(vs)
      if (!vendedorId && vs.length > 0) setVendedorId(vs[0].id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cargar = useCallback(async () => {
    if (!vendedorId) return
    setLoading(true)
    const { data, error } = await (supabase.rpc as any)('alcance_objetivos', {
      p_anio: anio,
      p_mes: mes,
      p_vendedor_id: vendedorId,
      p_solo_con_datos: soloConDatos,
    })
    setLoading(false)
    if (error) { setRep(null); return }
    setRep(data as Reporte)
  }, [supabase, anio, mes, vendedorId, soloConDatos])

  useEffect(() => { cargar() }, [cargar])

  const colorPct = (v: number | null) => {
    if (v === null) return 'text-gray-400'
    if (v >= 100) return 'text-green-700 font-bold'
    if (v >= 80) return 'text-emerald-600'
    if (v >= 50) return 'text-amber-600'
    return 'text-red-600'
  }

  const exportarCSV = () => {
    if (!rep) return
    const filas: string[] = []
    filas.push(`ALCANCE DE OBJETIVOS;PERIODO ${rep.periodo};${rep.vendedor_nombre}`)
    filas.push('CODIGO;DESCRIPCION;CANT. REAL;CANT. CUOTA;ALC. CANT.;VALOR REAL;VALOR CUOTA;ALC. VALOR')
    rep.lineas.forEach((l) => {
      filas.push(`LINEA: ${l.codigo} - ${l.nombre};;;;;;;`)
      l.productos.forEach((p) => {
        filas.push([
          p.codigo, `"${p.descripcion.replace(/"/g, "'")}"`,
          num(p.cant_real), num(p.cant_cuota), pct(p.alc_cant),
          num(p.valor_real), num(p.valor_cuota), pct(p.alc_valor),
        ].join(';'))
      })
      filas.push([
        '', `TOTAL LINEA ${l.codigo} - ${l.nombre}`,
        num(l.tot_cant_real), num(l.tot_cant_cuota), '',
        num(l.tot_valor_real), num(l.tot_valor_cuota), pct(l.alc_valor),
      ].join(';'))
    })
    filas.push(['', 'TOTAL GENERAL', '', '', '', num(rep.total_valor_real), num(rep.total_valor_cuota), pct(rep.alc_total)].join(';'))

    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `alcance_objetivos_${rep.periodo}_${rep.vendedor_nombre.replace(/\s+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4 print:space-y-1">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 8mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
        table { font-size: 6.5pt !important; }
        tr { break-inside: avoid; }
        .linea-header { break-after: avoid; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-blue-600" />
            Alcance de Objetivos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cuota vs venta real por producto y línea · cantidad y valor
          </p>
        </div>
        <Link href="/vendedores/cuotas/productos"
          className="text-xs px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-md">
          ⚙ Asignar cuotas por producto
        </Link>
        <button onClick={exportarCSV} disabled={!rep}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> Excel
        </button>
        <button onClick={() => window.print()} disabled={!rep}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-40">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3 no-print">
        <div className="min-w-[220px]">
          <Label className="text-[10px] text-gray-500">Vendedor</Label>
          <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}
            className="block mt-1 h-9 px-2 w-full text-sm border border-gray-300 rounded-md bg-white">
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Mes</Label>
          <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
            {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Año</Label>
          <Input type="number" value={anio} onChange={(e) => setAnio(parseInt(e.target.value) || ahora.getFullYear())}
            className="w-24 h-9 text-sm" min={2024} max={2100} />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-700 h-9 cursor-pointer">
          <input type="checkbox" checked={!soloConDatos} onChange={(e) => setSoloConDatos(!e.target.checked)}
            className="w-4 h-4" />
          Mostrar todo el catálogo (incluye productos en cero)
        </label>
      </div>

      {/* Cabecera del reporte (pantalla + impresión) */}
      {rep && (
        <div className="bg-white border border-gray-300 rounded-lg print:border-0 print:rounded-none">
          <div className="p-3 border-b-2 border-black print:p-1">
            <div className="flex items-start justify-between text-xs">
              <div>
                <p className="font-bold text-sm">{EMPRESA.razon_social}</p>
                <p className="text-gray-600">RUC {EMPRESA.ruc}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 13 }}>{EMPRESA.slogan}</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-sm tracking-wide">ALCANCE DE OBJETIVOS</p>
                <p className="font-semibold">PERIODO: {rep.periodo}</p>
              </div>
              <div className="text-right text-[10px] text-gray-600">
                <p>Impreso: {new Date().toLocaleString('es-PE')}</p>
              </div>
            </div>
            <p className="mt-2 text-xs font-bold uppercase">
              VENDEDOR: {rep.vendedor_nombre}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : rep.lineas.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-amber-700 font-semibold text-sm">
                ⚠ Este vendedor no tiene cuotas ni ventas registradas en {MESES[mes-1]} {anio}
              </p>
              <Link href="/vendedores/cuotas/productos" className="text-blue-700 underline text-xs mt-2 inline-block">
                → Asignar cuotas por producto
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-y border-black bg-gray-100 print:bg-white">
                    <th className="text-left px-1 py-1 font-bold w-[70px]">CÓDIGO</th>
                    <th className="text-left px-1 py-1 font-bold">DESCRIPCIÓN</th>
                    <th className="text-right px-1 py-1 font-bold w-[70px]">CANT. REAL</th>
                    <th className="text-right px-1 py-1 font-bold w-[70px]">CANT. CUOTA</th>
                    <th className="text-right px-1 py-1 font-bold w-[65px]">ALC. CANT.</th>
                    <th className="text-right px-1 py-1 font-bold w-[85px]">VALOR REAL</th>
                    <th className="text-right px-1 py-1 font-bold w-[85px]">VALOR CUOTA</th>
                    <th className="text-right px-1 py-1 font-bold w-[70px]">ALC. VALOR</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.lineas.map((l) => (
                    <Fragment key={`${l.codigo}-${l.nombre}`}>
                      <tr className="linea-header">
                        <td colSpan={8} className="px-1 pt-2 pb-0.5 font-bold uppercase text-gray-900">
                          LÍNEA: {l.codigo} - {l.nombre}
                        </td>
                      </tr>
                      {l.productos.map((p, i) => (
                        <tr key={`${l.codigo}-${p.codigo}-${i}`} className="hover:bg-yellow-50 print:hover:bg-transparent">
                          <td className="px-1 py-0.5 font-mono text-gray-700">{p.codigo}</td>
                          <td className="px-1 py-0.5">{p.descripcion}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{num(p.cant_real)}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{num(p.cant_cuota)}</td>
                          <td className={`px-1 py-0.5 text-right font-mono ${colorPct(p.alc_cant)}`}>{pct(p.alc_cant)}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{num(p.valor_real)}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{num(p.valor_cuota)}</td>
                          <td className={`px-1 py-0.5 text-right font-mono ${colorPct(p.alc_valor)}`}>{pct(p.alc_valor)}</td>
                        </tr>
                      ))}
                      <tr className="border-y border-gray-400 font-bold bg-gray-50 print:bg-white">
                        <td className="px-1 py-0.5" />
                        <td className="px-1 py-0.5 text-right uppercase">
                          TOTAL LÍNEA {l.codigo} - {l.nombre}
                        </td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(l.tot_cant_real)}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(l.tot_cant_cuota)}</td>
                        <td className="px-1 py-0.5" />
                        <td className="px-1 py-0.5 text-right font-mono">{num(l.tot_valor_real)}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(l.tot_valor_cuota)}</td>
                        <td className={`px-1 py-0.5 text-right font-mono ${colorPct(l.alc_valor)}`}>{pct(l.alc_valor)}</td>
                      </tr>
                    </Fragment>
                  ))}
                  <tr className="border-t-2 border-black font-bold text-[12px]">
                    <td className="px-1 py-2" />
                    <td className="px-1 py-2 text-right">TOTAL GENERAL</td>
                    <td className="px-1 py-2" />
                    <td className="px-1 py-2" />
                    <td className="px-1 py-2" />
                    <td className="px-1 py-2 text-right font-mono">{num(rep.total_valor_real)}</td>
                    <td className="px-1 py-2 text-right font-mono">{num(rep.total_valor_cuota)}</td>
                    <td className={`px-1 py-2 text-right font-mono ${colorPct(rep.alc_total)}`}>{pct(rep.alc_total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="text-[11px] text-gray-500 no-print">
        💡 <b>CANT. REAL</b> = unidades/kg vendidos en el mes (las notas de crédito restan).
        <b> VALOR REAL</b> = venta sin IGV. Los % en verde superan el 100% del objetivo.
      </div>
    </div>
  )
}

export default function AlcanceObjetivosPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <AlcanceInner />
    </Suspense>
  )
}
