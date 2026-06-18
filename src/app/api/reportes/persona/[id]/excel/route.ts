import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crearExcelBranded,
  seccionTitulo,
  seccionTabla,
  excelResponse,
  footerReporte,
} from '@/lib/excel-export'
import { hoyLima } from '@/lib/fechas-pe'

export const dynamic = 'force-dynamic'

/**
 * Excel branded del reporte por persona con historial.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()
  const hoy = hoyLima()
  const hasta = req.nextUrl.searchParams.get('hasta') ?? hoy

  const desdeDefault = new Date(hoy + 'T00:00:00-05:00')
  desdeDefault.setDate(desdeDefault.getDate() - 13)
  const desde = req.nextUrl.searchParams.get('desde') ?? desdeDefault.toISOString().slice(0, 10)

  const { data: persona } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', id)
    .maybeSingle()

  if (!persona) return new Response('Usuario no encontrado', { status: 404 })

  const [pedRes, compRes, cobRes] = await Promise.all([
    (supabase as any).from('pedidos')
      .select('id, vendedor_id, total, fecha_pedido')
      .gte('fecha_pedido', desde).lte('fecha_pedido', hasta)
      .eq('vendedor_id', id),
    (supabase as any).from('comprobantes')
      .select('id, total, fecha_emision, pedidos(vendedor_id)')
      .gte('fecha_emision', desde).lte('fecha_emision', hasta)
      .neq('estado', 'anulado'),
    (supabase as any).from('cobros')
      .select('id, cobrador_id, efectivo, yape, plin, transferencia, total, fecha')
      .gte('fecha', desde).lte('fecha', hasta)
      .eq('cobrador_id', id),
  ])

  type DiaRow = {
    fecha: string
    pedidos_count: number; pedidos_monto: number
    comprobantes_count: number; comprobantes_monto: number
    cobros_count: number; efectivo: number; yape: number
    plin: number; transferencia: number; cobros_total: number
  }
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
    if (c.pedidos?.vendedor_id !== id) return
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

  const dias_arr = Array.from(dias.values()).sort((a, b) => b.fecha.localeCompare(a.fecha))

  const tot = dias_arr.reduce((acc, d) => ({
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

  const rolLabel = persona.role === 'vendedor' ? 'Vendedor'
    : persona.role === 'repartidor' ? 'Repartidor'
    : persona.role

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Reporte por persona',
    subtitulo: `${persona.full_name} · ${rolLabel}`,
    periodo: { desde, hasta },
    sheetName: 'Reporte',
  })

  let row = startRow

  row = seccionTitulo(sheet, row, 'Totales del período')
  row = seccionTabla(sheet, row,
    ['Concepto', 'Cantidad', 'Monto'],
    [
      ['Pedidos creados', tot.pedidos_count, tot.pedidos_monto],
      ['Facturas/Boletas emitidas', tot.comprobantes_count, tot.comprobantes_monto],
      ['Cobros recibidos', tot.cobros_count, tot.cobros_total],
      ['  Efectivo', '', tot.efectivo],
      ['  Yape', '', tot.yape],
      ['  Plin', '', tot.plin],
      ['  Transferencia', '', tot.transferencia],
    ],
    { columnasMoneda: [2] },
  )

  row = seccionTitulo(sheet, row, 'Detalle día por día')
  row = seccionTabla(sheet, row,
    ['Fecha', 'Pedidos', 'Monto ped.', 'Fact./Bol.', 'Monto fact.', 'Cobros', 'Efectivo', 'Yape', 'Plin', 'Transfer.', 'Total cobrado'],
    dias_arr.map((d) => [
      d.fecha,
      d.pedidos_count, d.pedidos_monto,
      d.comprobantes_count, d.comprobantes_monto,
      d.cobros_count, d.efectivo, d.yape, d.plin, d.transferencia, d.cobros_total,
    ]),
    {
      columnasMoneda: [2, 4, 6, 7, 8, 9, 10],
      columnasFecha: [0],
      totalsRow: ['TOTAL', tot.pedidos_count, tot.pedidos_monto,
        tot.comprobantes_count, tot.comprobantes_monto,
        tot.cobros_count, tot.efectivo, tot.yape, tot.plin, tot.transferencia, tot.cobros_total],
    },
  )

  footerReporte(sheet, row, persona.full_name)
  return excelResponse(workbook, `reporte-${persona.full_name?.replace(/\s+/g, '-').toLowerCase()}-${desde}-a-${hasta}.xlsx`)
}
