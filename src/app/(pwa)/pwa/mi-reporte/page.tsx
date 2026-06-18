'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileSpreadsheet, Printer, Loader2, Calendar } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

interface DiaRow {
  fecha: string
  pedidos_count: number
  pedidos_monto: number
  comprobantes_count: number
  comprobantes_monto: number
  cobros_count: number
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  cobros_total: number
}

/**
 * "Mi Reporte" — vista personal del vendedor/cobrador/repartidor con
 * historial diario y opciones de descargar Excel / imprimir.
 *
 * Reutiliza las queries directas a Supabase (filtradas por usuario actual)
 * en vez de un endpoint para que no requiera permisos extras.
 */
export default function MiReportePage() {
  const router = useRouter()
  const supabase = createClient()

  const hoy = hoyLima()
  const defaultDesde = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00')
    d.setDate(d.getDate() - 13)
    return d.toISOString().slice(0, 10)
  })()

  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string>('—')
  const [userRol, setUserRol] = useState<string>('')
  const [desde, setDesde] = useState(defaultDesde)
  const [hasta, setHasta] = useState(hoy)
  const [dias, setDias] = useState<DiaRow[]>([])
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async (uid: string, d: string, h: string) => {
    setLoading(true)
    const [pedRes, compRes, cobRes] = await Promise.all([
      (supabase as any).from('pedidos')
        .select('total, fecha_pedido')
        .gte('fecha_pedido', d).lte('fecha_pedido', h)
        .eq('vendedor_id', uid),
      (supabase as any).from('comprobantes')
        .select('total, fecha_emision, pedidos(vendedor_id)')
        .gte('fecha_emision', d).lte('fecha_emision', h)
        .neq('estado', 'anulado'),
      (supabase as any).from('cobros')
        .select('efectivo, yape, plin, transferencia, total, fecha')
        .gte('fecha', d).lte('fecha', h)
        .eq('cobrador_id', uid),
    ])

    const dias = new Map<string, DiaRow>()
    const init = (f: string): DiaRow => ({
      fecha: f,
      pedidos_count: 0, pedidos_monto: 0,
      comprobantes_count: 0, comprobantes_monto: 0,
      cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0,
    })

    ;(pedRes.data ?? []).forEach((p: any) => {
      const f = p.fecha_pedido
      if (!dias.has(f)) dias.set(f, init(f))
      const d = dias.get(f)!
      d.pedidos_count++; d.pedidos_monto += Number(p.total ?? 0)
    })
    ;(compRes.data ?? []).forEach((c: any) => {
      if (c.pedidos?.vendedor_id !== uid) return
      const f = c.fecha_emision
      if (!dias.has(f)) dias.set(f, init(f))
      const d = dias.get(f)!
      d.comprobantes_count++; d.comprobantes_monto += Number(c.total ?? 0)
    })
    ;(cobRes.data ?? []).forEach((c: any) => {
      const f = c.fecha
      if (!dias.has(f)) dias.set(f, init(f))
      const d = dias.get(f)!
      d.cobros_count++
      d.efectivo += Number(c.efectivo ?? 0)
      d.yape += Number(c.yape ?? 0)
      d.plin += Number(c.plin ?? 0)
      d.transferencia += Number(c.transferencia ?? 0)
      d.cobros_total += Number(c.total ?? 0)
    })

    setDias(Array.from(dias.values()).sort((a, b) => b.fecha.localeCompare(a.fecha)))
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .single()
      setUserId(user.id)
      setUserName((profile as any)?.full_name ?? '—')
      setUserRol((profile as any)?.role ?? '')
      await cargar(user.id, desde, hasta)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (userId) cargar(userId, desde, hasta)
  }, [userId, desde, hasta, cargar])

  const tot = dias.reduce((acc, d) => ({
    pedidos_count: acc.pedidos_count + d.pedidos_count,
    pedidos_monto: acc.pedidos_monto + d.pedidos_monto,
    comprobantes_count: acc.comprobantes_count + d.comprobantes_count,
    comprobantes_monto: acc.comprobantes_monto + d.comprobantes_monto,
    cobros_count: acc.cobros_count + d.cobros_count,
    efectivo: acc.efectivo + d.efectivo,
    yape: acc.yape + d.yape,
    plin: acc.plin + d.plin,
    transferencia: acc.transferencia + d.transferencia,
    cobros_total: acc.cobros_total + d.cobros_total,
  }), { pedidos_count: 0, pedidos_monto: 0, comprobantes_count: 0, comprobantes_monto: 0,
       cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0 })

  const ayer = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00')
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const semana = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00')
    d.setDate(d.getDate() - 6)
    return d.toISOString().slice(0, 10)
  })()
  const setSoloHoy = () => { setDesde(hoy); setHasta(hoy) }
  const setSoloAyer = () => { setDesde(ayer); setHasta(ayer) }
  const setUltimos7 = () => { setDesde(semana); setHasta(hoy) }

  return (
    <div className="min-h-full bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; color: #111 !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .mi-reporte-doc { font-size: 11pt !important; line-height: 1.4 !important; }
          .mi-reporte-doc table { font-size: 10pt !important; }
          .mi-reporte-doc th, .mi-reporte-doc td { padding: 4px 6px !important; }
          .mi-reporte-doc tr { page-break-inside: avoid; }
          .mi-reporte-doc thead { display: table-header-group; }
        }
        .print-only { display: none; }
      `}</style>

      {/* Header — solo pantalla */}
      <div className="bg-black text-white px-4 pt-6 pb-4 border-b-4 border-[#FBE600] no-print">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold">Mi Reporte</h1>
            <p className="text-xs text-gray-300">{userName} · {userRol}</p>
          </div>
        </div>

        {/* Atajos rápidos */}
        <div className="flex gap-1.5 mb-2">
          <button
            type="button"
            onClick={setSoloHoy}
            className={`flex-1 inline-flex items-center justify-center gap-1 h-8 text-[11px] font-semibold rounded border ${
              desde === hoy && hasta === hoy
                ? 'bg-[#FBE600] text-black border-[#FBE600]'
                : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
            }`}
          >
            <Calendar className="w-3 h-3" />
            Hoy
          </button>
          <button
            type="button"
            onClick={setSoloAyer}
            className={`flex-1 inline-flex items-center justify-center gap-1 h-8 text-[11px] font-semibold rounded border ${
              desde === ayer && hasta === ayer
                ? 'bg-[#FBE600] text-black border-[#FBE600]'
                : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
            }`}
          >
            Ayer
          </button>
          <button
            type="button"
            onClick={setUltimos7}
            className={`flex-1 inline-flex items-center justify-center gap-1 h-8 text-[11px] font-semibold rounded border ${
              desde === semana && hasta === hoy
                ? 'bg-[#FBE600] text-black border-[#FBE600]'
                : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
            }`}
          >
            7 días
          </button>
        </div>

        <div className="flex gap-2 items-center text-xs">
          <input
            type="date"
            value={desde}
            max={hasta}
            onChange={(e) => setDesde(e.target.value)}
            className="flex-1 h-9 px-2 rounded-md bg-white/10 border border-white/20 text-white"
          />
          <span className="text-gray-400">→</span>
          <input
            type="date"
            value={hasta}
            min={desde}
            max={hoy}
            onChange={(e) => setHasta(e.target.value)}
            className="flex-1 h-9 px-2 rounded-md bg-white/10 border border-white/20 text-white"
          />
        </div>

        <div className="flex gap-2 mt-2">
          {userId && (
            <a
              href={`/api/reportes/persona/${userId}/excel?desde=${desde}&hasta=${hasta}`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 text-xs font-bold bg-green-600 hover:bg-green-700 rounded-md"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Excel
            </a>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 text-xs font-bold bg-[#FBE600] hover:bg-[#E5D100] text-black rounded-md"
          >
            <Printer className="w-3.5 h-3.5" />
            PDF / Imprimir
          </button>
        </div>
      </div>

      {/* Cabecera brandeada — solo se ve al imprimir */}
      <div className="print-only mb-4 px-2">
        <div className="flex items-center justify-between border-b-2 border-black pb-3">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-agrocar.png" alt="AGROCAR" style={{ height: 50 }} />
            <div>
              <p className="font-bold text-base">{EMPRESA.razon_social}</p>
              <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 15, lineHeight: 1 }}>{EMPRESA.slogan}</p>
              <p className="text-[10px] text-gray-700">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
              <p className="text-[10px] text-gray-700">Tel. {EMPRESA.telefono} · {EMPRESA.correo}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold">Mi Reporte</p>
            <p className="text-xs">{userName}</p>
            <p className="text-[10px] text-gray-600">{userRol}</p>
            <p className="text-[10px] text-gray-600">Del {formatDate(desde)} al {formatDate(hasta)}</p>
          </div>
        </div>
      </div>

      <div className="mi-reporte-doc p-3 space-y-3 print:p-0">
        {/* Totales del período */}
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Totales del período · Del {formatDate(desde)} al {formatDate(hasta)}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
              <p className="text-[10px] text-blue-700 font-semibold">PEDIDOS</p>
              <p className="text-lg font-bold text-blue-900">{tot.pedidos_count}</p>
              <p className="text-[10px] text-blue-700">{formatCurrency(tot.pedidos_monto)}</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-lg p-2">
              <p className="text-[10px] text-green-700 font-semibold">COBROS</p>
              <p className="text-lg font-bold text-green-900">{tot.cobros_count}</p>
              <p className="text-[10px] text-green-700">{formatCurrency(tot.cobros_total)}</p>
            </div>
          </div>
          {tot.cobros_total > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-1 text-center">
              <div className="bg-gray-50 rounded p-1.5">
                <p className="text-[9px] text-gray-500">Efectivo</p>
                <p className="text-[10px] font-mono font-semibold">{formatCurrency(tot.efectivo)}</p>
              </div>
              <div className="bg-gray-50 rounded p-1.5">
                <p className="text-[9px] text-gray-500">Yape</p>
                <p className="text-[10px] font-mono font-semibold">{formatCurrency(tot.yape)}</p>
              </div>
              <div className="bg-gray-50 rounded p-1.5">
                <p className="text-[9px] text-gray-500">Plin</p>
                <p className="text-[10px] font-mono font-semibold">{formatCurrency(tot.plin)}</p>
              </div>
              <div className="bg-gray-50 rounded p-1.5">
                <p className="text-[9px] text-gray-500">Transfer.</p>
                <p className="text-[10px] font-mono font-semibold">{formatCurrency(tot.transferencia)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Detalle día por día */}
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Detalle diario
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : dias.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">Sin actividad en el período</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {dias.map((d) => (
                <div key={d.fecha} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-800">{formatDate(d.fecha)}</p>
                    <p className="text-sm font-mono font-bold text-green-700">{formatCurrency(d.cobros_total)}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-gray-600">
                    {d.pedidos_count > 0 && (
                      <span>📋 {d.pedidos_count} pedidos · {formatCurrency(d.pedidos_monto)}</span>
                    )}
                    {d.comprobantes_count > 0 && (
                      <span>🧾 {d.comprobantes_count} facturas · {formatCurrency(d.comprobantes_monto)}</span>
                    )}
                    {d.cobros_count > 0 && (
                      <span>💰 {d.cobros_count} cobros</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
