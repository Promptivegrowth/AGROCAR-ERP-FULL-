'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Download, Upload, FileCheck2, ShoppingCart, Receipt } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'

type Tab = 'ventas' | 'compras' | 'match'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

interface FilaVenta {
  fecha_emision: string
  tipo_cpe: string
  serie: string
  numero: string
  tipo_doc_cliente: string
  num_doc_cliente: string
  razon_social: string
  base_imponible: number
  igv: number
  total: number
  estado: string
}

interface FilaCompra {
  fecha: string
  tipo_cpe: string
  serie: string
  numero: string
  ruc_proveedor: string
  razon_social: string
  base_imponible: number
  igv: number
  total: number
  estado: string
}

interface MatchResult {
  coincidencias: { key: string; montoSistema: number; montoSunat: number }[]
  soloSistema: { key: string; monto: number; razon: string }[]
  soloSunat: { key: string; monto: number }[]
  diferenciasMonto: { key: string; montoSistema: number; montoSunat: number }[]
}

export default function SirePage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [tab, setTab] = useState<Tab>('ventas')
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const [matchTipo, setMatchTipo] = useState<'ventas' | 'compras'>('ventas')
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [matching, setMatching] = useState(false)

  const cargar = useCallback(async () => {
    if (tab === 'match') return
    setLoading(true)
    const rpc = tab === 'ventas' ? 'sire_registro_ventas' : 'sire_registro_compras'
    const { data: d } = await (supabase.rpc as any)(rpc, { p_anio: anio, p_mes: mes })
    setData(d)
    setLoading(false)
  }, [supabase, tab, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  // ── Exportar TXT (formato pipe-delimited estilo SIRE)
  const exportarTxt = () => {
    if (!data?.filas?.length) { toast.error('Sin datos para exportar'); return }
    const periodo = data.periodo
    let lineas: string[]
    if (tab === 'ventas') {
      lineas = (data.filas as FilaVenta[]).map((f, i) => [
        periodo,                          // periodo
        String(i + 1).padStart(6, '0'),   // CAR correlativo
        f.fecha_emision?.replaceAll('-', '/'),
        f.tipo_cpe, f.serie, f.numero,
        f.tipo_doc_cliente, f.num_doc_cliente,
        f.razon_social,
        Number(f.base_imponible).toFixed(2),
        Number(f.igv).toFixed(2),
        Number(f.total).toFixed(2),
        f.estado === 'anulado' ? '2' : '1',
      ].join('|'))
    } else {
      lineas = (data.filas as FilaCompra[]).map((f, i) => [
        periodo,
        String(i + 1).padStart(6, '0'),
        f.fecha?.replaceAll('-', '/'),
        f.tipo_cpe, f.serie, f.numero,
        '6', f.ruc_proveedor,
        f.razon_social,
        Number(f.base_imponible).toFixed(2),
        Number(f.igv).toFixed(2),
        Number(f.total).toFixed(2),
        f.estado === 'anulada' ? '2' : '1',
      ].join('|'))
    }
    const blob = new Blob([lineas.join('\r\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `SIRE_${tab.toUpperCase()}_${periodo}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('TXT exportado')
  }

  // ── Match con archivo SUNAT
  const procesarArchivoSunat = async (file: File) => {
    setMatching(true)
    setMatchResult(null)
    try {
      const texto = await file.text()
      const lineasSunat = texto.split(/\r?\n/).filter((l) => l.trim().length > 0)

      // Extraer (serie, numero, total) de cada línea SUNAT de forma tolerante
      // El formato SIRE usa pipes; buscamos serie tipo letra+dígitos y montos
      const sunatDocs = new Map<string, number>()
      for (const linea of lineasSunat) {
        const campos = linea.split(/[|;\t]/).map((c) => c.trim())
        let serie = '', numero = '', total = 0
        for (const campo of campos) {
          if (!serie && /^[A-Z]{1,2}\d{2,3}$/i.test(campo)) serie = campo.toUpperCase()
          if (!numero && /^\d{1,8}$/.test(campo) && campo.length >= 4) numero = campo.replace(/^0+/, '')
        }
        // Total: el último número con decimales de la línea
        const montos = campos.filter((c) => /^-?\d+\.\d{2}$/.test(c)).map(Number)
        if (montos.length > 0) total = montos[montos.length - 1]
        if (serie && numero) {
          sunatDocs.set(`${serie}-${numero}`, total)
        }
      }

      if (sunatDocs.size === 0) {
        toast.error('No se pudieron leer comprobantes del archivo', {
          description: 'Verifica que sea el TXT/CSV descargado del portal SIRE (delimitado por | ; o tab)',
        })
        setMatching(false)
        return
      }

      // Traer datos del sistema para el período
      const rpc = matchTipo === 'ventas' ? 'sire_registro_ventas' : 'sire_registro_compras'
      const { data: sist } = await (supabase.rpc as any)(rpc, { p_anio: anio, p_mes: mes })
      const filasSist = (sist?.filas ?? []) as any[]

      const sistemaDocs = new Map<string, { monto: number; razon: string }>()
      filasSist.forEach((f) => {
        if (f.estado === 'anulado' || f.estado === 'anulada') return
        const key = `${f.serie}-${String(f.numero).replace(/^0+/, '')}`
        sistemaDocs.set(key, { monto: Number(f.total), razon: f.razon_social })
      })

      // Comparar
      const result: MatchResult = { coincidencias: [], soloSistema: [], soloSunat: [], diferenciasMonto: [] }
      sistemaDocs.forEach((v, key) => {
        if (sunatDocs.has(key)) {
          const montoSunat = sunatDocs.get(key)!
          if (Math.abs(Math.abs(v.monto) - Math.abs(montoSunat)) < 0.02) {
            result.coincidencias.push({ key, montoSistema: v.monto, montoSunat })
          } else {
            result.diferenciasMonto.push({ key, montoSistema: v.monto, montoSunat })
          }
        } else {
          result.soloSistema.push({ key, monto: v.monto, razon: v.razon })
        }
      })
      sunatDocs.forEach((monto, key) => {
        if (!sistemaDocs.has(key)) result.soloSunat.push({ key, monto })
      })

      setMatchResult(result)

      // Guardar historial
      await (supabase as any).from('sire_matches').insert({
        tipo: matchTipo, anio, mes,
        total_sistema: sistemaDocs.size,
        total_sunat: sunatDocs.size,
        coincidencias: result.coincidencias.length,
        solo_sistema: result.soloSistema.length,
        solo_sunat: result.soloSunat.length,
        detalle: {
          solo_sistema: result.soloSistema.slice(0, 100),
          solo_sunat: result.soloSunat.slice(0, 100),
          diferencias_monto: result.diferenciasMonto.slice(0, 100),
        },
      })

      toast.success(`Match completado: ${result.coincidencias.length} coincidencias`, {
        description: `${result.soloSistema.length} solo en sistema · ${result.soloSunat.length} solo en SUNAT`,
      })
    } catch (e: any) {
      toast.error('Error al procesar', { description: e?.message })
    }
    setMatching(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileCheck2 className="w-6 h-6 text-cyan-700" />
            SIRE — Registros Electrónicos
          </h1>
          <p className="text-sm text-gray-500">
            Registro de Ventas (RVIE) · Registro de Compras (RCE) · Match con SUNAT
          </p>
        </div>
        <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {[anio + 1, anio, anio - 1].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: 'ventas', label: 'Registro de Ventas', icon: Receipt },
          { key: 'compras', label: 'Registro de Compras', icon: ShoppingCart },
          { key: 'match', label: 'Match con SUNAT', icon: FileCheck2 },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-1.5 ${
              tab === t.key ? 'border-cyan-600 text-cyan-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab !== 'match' ? (
        <>
          {/* KPIs + export */}
          {data && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                <p className="text-[10px] text-gray-500 uppercase">Comprobantes</p>
                <p className="text-lg font-bold">{data.cantidad ?? 0}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                <p className="text-[10px] text-gray-500 uppercase">Base imponible</p>
                <p className="text-lg font-bold font-mono">{formatCurrency(data.total_base ?? 0)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                <p className="text-[10px] text-gray-500 uppercase">IGV</p>
                <p className="text-lg font-bold font-mono">{formatCurrency(data.total_igv ?? 0)}</p>
              </div>
              <div className="bg-[#FBE600] border-2 border-yellow-500 rounded-lg px-4 py-2">
                <p className="text-[10px] uppercase font-semibold">Total</p>
                <p className="text-lg font-bold font-mono">{formatCurrency(data.total_total ?? 0)}</p>
              </div>
              <div className="flex-1" />
              <Button onClick={exportarTxt} className="bg-cyan-700 hover:bg-cyan-800 gap-1">
                <Download className="w-4 h-4" /> Exportar TXT
              </Button>
            </div>
          )}

          {/* Tabla */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : !data?.filas?.length ? (
              <p className="text-center py-12 text-gray-400 text-sm">Sin comprobantes en {MESES[mes - 1]} {anio}</p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                    <tr>
                      <th className="text-left p-2 font-semibold text-gray-600 w-24">Fecha</th>
                      <th className="text-center p-2 font-semibold text-gray-600 w-12">Tipo</th>
                      <th className="text-left p-2 font-semibold text-gray-600 w-28">Serie-Número</th>
                      <th className="text-left p-2 font-semibold text-gray-600 w-28">{tab === 'ventas' ? 'Doc. Cliente' : 'RUC Prov.'}</th>
                      <th className="text-left p-2 font-semibold text-gray-600">Razón social</th>
                      <th className="text-right p-2 font-semibold text-gray-600 w-24">Base</th>
                      <th className="text-right p-2 font-semibold text-gray-600 w-24">IGV</th>
                      <th className="text-right p-2 font-semibold text-gray-600 w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.filas as any[]).map((f, i) => (
                      <tr key={i} className={`border-b border-gray-100 ${['anulado','anulada'].includes(f.estado) ? 'opacity-40 line-through' : ''}`}>
                        <td className="p-2 font-mono">{formatDate(f.fecha_emision ?? f.fecha)}</td>
                        <td className="p-2 text-center font-mono">{f.tipo_cpe}</td>
                        <td className="p-2 font-mono">{f.serie}-{f.numero}</td>
                        <td className="p-2 font-mono">{f.num_doc_cliente ?? f.ruc_proveedor}</td>
                        <td className="p-2 truncate max-w-[220px]">{f.razon_social}</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(f.base_imponible)}</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(f.igv)}</td>
                        <td className="p-2 text-right font-mono font-semibold">{formatCurrency(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* ══════ MATCH ══════ */
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Registro a comparar</p>
                <div className="flex gap-1">
                  <button onClick={() => setMatchTipo('ventas')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${matchTipo === 'ventas' ? 'bg-cyan-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    Ventas
                  </button>
                  <button onClick={() => setMatchTipo('compras')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${matchTipo === 'compras' ? 'bg-cyan-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    Compras
                  </button>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500 mb-1">
                  Sube el TXT/CSV descargado del portal SIRE de SUNAT ({MESES[mes - 1]} {anio}).
                  El sistema compara serie-número y monto contra tus registros.
                </p>
                <input ref={fileRef} type="file" accept=".txt,.csv,.tsv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) procesarArchivoSunat(f); e.target.value = '' }} />
                <Button onClick={() => fileRef.current?.click()} disabled={matching} className="bg-cyan-700 hover:bg-cyan-800 gap-1">
                  {matching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Subir archivo SUNAT
                </Button>
              </div>
            </div>
          </div>

          {matchResult && (
            <>
              {/* KPIs del match */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-[10px] text-green-700 uppercase font-semibold">✓ Coinciden</p>
                  <p className="text-2xl font-bold text-green-900">{matchResult.coincidencias.length}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-[10px] text-amber-700 uppercase font-semibold">Solo en sistema</p>
                  <p className="text-2xl font-bold text-amber-900">{matchResult.soloSistema.length}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-[10px] text-red-700 uppercase font-semibold">Solo en SUNAT</p>
                  <p className="text-2xl font-bold text-red-900">{matchResult.soloSunat.length}</p>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <p className="text-[10px] text-purple-700 uppercase font-semibold">Diferencia de monto</p>
                  <p className="text-2xl font-bold text-purple-900">{matchResult.diferenciasMonto.length}</p>
                </div>
              </div>

              {/* Solo en sistema */}
              {matchResult.soloSistema.length > 0 && (
                <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                    🟡 En tu sistema pero NO en SUNAT ({matchResult.soloSistema.length}) — probablemente falta enviar el CPE
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {matchResult.soloSistema.map((d) => (
                        <tr key={d.key} className="border-b border-gray-100">
                          <td className="p-2 font-mono w-32">{d.key}</td>
                          <td className="p-2">{d.razon}</td>
                          <td className="p-2 text-right font-mono w-28">{formatCurrency(d.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Solo en SUNAT */}
              {matchResult.soloSunat.length > 0 && (
                <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 text-sm font-bold text-red-900">
                    🔴 En SUNAT pero NO en tu sistema ({matchResult.soloSunat.length}) — {matchTipo === 'compras' ? 'facturas de proveedor sin registrar' : 'revisar emisiones externas'}
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {matchResult.soloSunat.map((d) => (
                        <tr key={d.key} className="border-b border-gray-100">
                          <td className="p-2 font-mono w-32">{d.key}</td>
                          <td className="p-2 text-right font-mono w-28">{formatCurrency(d.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Diferencias de monto */}
              {matchResult.diferenciasMonto.length > 0 && (
                <div className="bg-white border border-purple-200 rounded-lg overflow-hidden">
                  <div className="bg-purple-50 px-3 py-2 text-sm font-bold text-purple-900">
                    🟣 Mismo comprobante, monto distinto ({matchResult.diferenciasMonto.length})
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-2">Comprobante</th>
                        <th className="text-right p-2 w-32">Sistema</th>
                        <th className="text-right p-2 w-32">SUNAT</th>
                        <th className="text-right p-2 w-32">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchResult.diferenciasMonto.map((d) => (
                        <tr key={d.key} className="border-b border-gray-100">
                          <td className="p-2 font-mono">{d.key}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(d.montoSistema)}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(d.montoSunat)}</td>
                          <td className="p-2 text-right font-mono font-bold text-purple-700">
                            {formatCurrency(Math.abs(Math.abs(d.montoSistema) - Math.abs(d.montoSunat)))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {matchResult.soloSistema.length === 0 && matchResult.soloSunat.length === 0 && matchResult.diferenciasMonto.length === 0 && (
                <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6 text-center">
                  <p className="text-green-800 font-bold text-lg">✓ Todo cuadra perfectamente</p>
                  <p className="text-green-600 text-sm mt-1">Sistema y SUNAT tienen exactamente los mismos comprobantes.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
