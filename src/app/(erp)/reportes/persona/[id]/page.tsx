import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import PersonaReporteActions from './persona-reporte-actions'

export const dynamic = 'force-dynamic'

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

async function getData(personaId: string, desde: string, hasta: string) {
  const supabase = await createClient()

  const { data: persona } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', personaId)
    .maybeSingle()

  if (!persona) return null

  const [pedRes, compRes, cobRes] = await Promise.all([
    (supabase as any).from('pedidos')
      .select('id, vendedor_id, total, fecha_pedido')
      .gte('fecha_pedido', desde)
      .lte('fecha_pedido', hasta)
      .eq('vendedor_id', personaId),
    (supabase as any).from('comprobantes')
      .select('id, total, fecha_emision, pedidos(vendedor_id)')
      .gte('fecha_emision', desde)
      .lte('fecha_emision', hasta)
      .neq('estado', 'anulado'),
    (supabase as any).from('cobros')
      .select('id, cobrador_id, efectivo, yape, plin, transferencia, total, fecha')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .eq('cobrador_id', personaId),
  ])

  // Agrupar por día
  const dias = new Map<string, DiaRow>()
  const inicializarDia = (f: string): DiaRow => ({
    fecha: f,
    pedidos_count: 0, pedidos_monto: 0,
    comprobantes_count: 0, comprobantes_monto: 0,
    cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0,
  })

  ;(pedRes.data ?? []).forEach((p: any) => {
    const f = p.fecha_pedido
    if (!dias.has(f)) dias.set(f, inicializarDia(f))
    const d = dias.get(f)!
    d.pedidos_count++
    d.pedidos_monto += Number(p.total ?? 0)
  })
  ;(compRes.data ?? []).forEach((c: any) => {
    if (c.pedidos?.vendedor_id !== personaId) return
    const f = c.fecha_emision
    if (!dias.has(f)) dias.set(f, inicializarDia(f))
    const d = dias.get(f)!
    d.comprobantes_count++
    d.comprobantes_monto += Number(c.total ?? 0)
  })
  ;(cobRes.data ?? []).forEach((c: any) => {
    const f = c.fecha
    if (!dias.has(f)) dias.set(f, inicializarDia(f))
    const d = dias.get(f)!
    d.cobros_count++
    d.efectivo += Number(c.efectivo ?? 0)
    d.yape += Number(c.yape ?? 0)
    d.plin += Number(c.plin ?? 0)
    d.transferencia += Number(c.transferencia ?? 0)
    d.cobros_total += Number(c.total ?? 0)
  })

  const dias_arr = Array.from(dias.values()).sort((a, b) => b.fecha.localeCompare(a.fecha))

  return { persona, dias: dias_arr }
}

export default async function PersonaReportePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const hoy = hoyLima()
  const hasta = sp.hasta ?? hoy
  // Default: últimos 14 días
  const desdeDefault = new Date(hoy + 'T00:00:00-05:00')
  desdeDefault.setDate(desdeDefault.getDate() - 13)
  const desde = sp.desde ?? desdeDefault.toISOString().slice(0, 10)

  const data = await getData(id, desde, hasta)
  if (!data) return notFound()

  const { persona, dias } = data

  // Totales del período
  const tot = dias.reduce(
    (acc, d) => ({
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
    }),
    { pedidos_count: 0, pedidos_monto: 0, comprobantes_count: 0, comprobantes_monto: 0,
      cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0 },
  )

  const rolLabel = persona.role === 'vendedor' ? 'Vendedor'
    : persona.role === 'repartidor' ? 'Repartidor'
    : persona.role

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="max-w-6xl mx-auto p-4 print:p-0">
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between print:bg-white print:text-black print:border print:border-gray-300 no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP</p>
            <h1 className="text-xl font-bold">Reporte por persona</h1>
            <p className="text-sm text-gray-300">{persona.full_name} · {rolLabel}</p>
          </div>
          <PersonaReporteActions personaId={id} desde={desde} hasta={hasta} />
        </div>

        {/* Encabezado para impresión */}
        <div className="hidden print:block mb-4">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div>
              <p className="font-bold text-lg">{EMPRESA.razon_social}</p>
              <p style={{ fontFamily: SLOGAN_FONT_STACK }} className="text-base">{EMPRESA.slogan}</p>
              <p className="text-[10px] text-gray-600">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
              <p className="text-[10px] text-gray-600">Tel. {EMPRESA.telefono} · {EMPRESA.correo}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">Reporte por persona</p>
              <p className="text-xs">{persona.full_name}</p>
              <p className="text-[10px] text-gray-600">{rolLabel}</p>
              <p className="text-[10px] text-gray-600">Del {formatDate(desde)} al {formatDate(hasta)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-4">
          {/* Totales del período */}
          <div>
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Totales del período</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500">Pedidos creados</p>
                <p className="text-lg font-bold">{tot.pedidos_count}</p>
                <p className="text-xs text-gray-600">{formatCurrency(tot.pedidos_monto)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500">Facturas/Boletas</p>
                <p className="text-lg font-bold">{tot.comprobantes_count}</p>
                <p className="text-xs text-gray-600">{formatCurrency(tot.comprobantes_monto)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500">Cobros</p>
                <p className="text-lg font-bold">{tot.cobros_count}</p>
                <p className="text-xs text-gray-600">{formatCurrency(tot.cobros_total)}</p>
              </div>
              <div className="bg-[#FBE600] border border-yellow-400 rounded-lg p-3">
                <p className="text-xs text-black/70">Efectivo + Yape + Plin + Transfer</p>
                <p className="text-lg font-bold text-black">{formatCurrency(tot.cobros_total)}</p>
                <p className="text-[10px] text-black/60">
                  E {formatCurrency(tot.efectivo)} · Y {formatCurrency(tot.yape)} · P {formatCurrency(tot.plin)} · T {formatCurrency(tot.transferencia)}
                </p>
              </div>
            </div>
          </div>

          {/* Detalle por día */}
          <div>
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Detalle día por día</h2>
            {dias.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">
                Sin actividad registrada en el período.
              </p>
            ) : (
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-2">Fecha</th>
                    <th className="text-right p-2">Pedidos</th>
                    <th className="text-right p-2">Monto ped.</th>
                    <th className="text-right p-2">Fact./Bol.</th>
                    <th className="text-right p-2">Monto fact.</th>
                    <th className="text-right p-2">Cobros</th>
                    <th className="text-right p-2">Efectivo</th>
                    <th className="text-right p-2">Yape</th>
                    <th className="text-right p-2">Plin</th>
                    <th className="text-right p-2">Transfer.</th>
                    <th className="text-right p-2 bg-yellow-50">Total cobrado</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map((d) => (
                    <tr key={d.fecha} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="p-2 font-mono">{formatDate(d.fecha)}</td>
                      <td className="p-2 text-right">{d.pedidos_count}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(d.pedidos_monto)}</td>
                      <td className="p-2 text-right">{d.comprobantes_count}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(d.comprobantes_monto)}</td>
                      <td className="p-2 text-right">{d.cobros_count}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(d.efectivo)}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(d.yape)}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(d.plin)}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(d.transferencia)}</td>
                      <td className="p-2 text-right font-mono font-bold bg-yellow-50/40">{formatCurrency(d.cobros_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                    <td className="p-2">TOTAL</td>
                    <td className="p-2 text-right">{tot.pedidos_count}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(tot.pedidos_monto)}</td>
                    <td className="p-2 text-right">{tot.comprobantes_count}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(tot.comprobantes_monto)}</td>
                    <td className="p-2 text-right">{tot.cobros_count}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(tot.efectivo)}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(tot.yape)}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(tot.plin)}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(tot.transferencia)}</td>
                    <td className="p-2 text-right font-mono bg-[#FBE600]">{formatCurrency(tot.cobros_total)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
