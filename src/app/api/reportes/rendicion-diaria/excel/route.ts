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
 * Excel branded del reporte de rendición diaria.
 * Replica la página /reportes/rendicion-diaria pero exportable.
 */
export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const fecha = req.nextUrl.searchParams.get('fecha') ?? hoyLima()

  const { data: profiles } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['vendedor', 'repartidor'])
    .eq('activo', true)
    .order('full_name')

  const [pedRes, compRes, cobRes] = await Promise.all([
    (supabase as any).from('pedidos')
      .select('id, vendedor_id, total, fecha_pedido')
      .eq('fecha_pedido', fecha),
    (supabase as any).from('comprobantes')
      .select('id, total, fecha_emision, pedido_id, pedidos(vendedor_id)')
      .eq('fecha_emision', fecha)
      .neq('estado', 'anulado'),
    (supabase as any).from('cobros')
      .select('id, cobrador_id, efectivo, yape, plin, transferencia, total, fecha')
      .eq('fecha', fecha),
  ])

  const pedidos: any[] = pedRes.data ?? []
  const comprobantes: any[] = compRes.data ?? []
  const cobros: any[] = cobRes.data ?? []

  type Resumen = {
    id: string; nombre: string; rol: string
    pedidos_count: number; pedidos_monto: number
    comprobantes_count: number; comprobantes_monto: number
    cobros_count: number; efectivo: number; yape: number; plin: number
    transferencia: number; cobros_total: number
  }
  const resumen = new Map<string, Resumen>()
  ;(profiles ?? []).forEach((p: any) => {
    resumen.set(p.id, {
      id: p.id, nombre: p.full_name ?? '—', rol: p.role,
      pedidos_count: 0, pedidos_monto: 0,
      comprobantes_count: 0, comprobantes_monto: 0,
      cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0,
    })
  })

  pedidos.forEach((p) => {
    const r = resumen.get(p.vendedor_id)
    if (r) { r.pedidos_count++; r.pedidos_monto += Number(p.total ?? 0) }
  })
  comprobantes.forEach((c) => {
    const vid = c.pedidos?.vendedor_id
    const r = vid ? resumen.get(vid) : null
    if (r) { r.comprobantes_count++; r.comprobantes_monto += Number(c.total ?? 0) }
  })
  cobros.forEach((c) => {
    const r = resumen.get(c.cobrador_id)
    if (r) {
      r.cobros_count++
      r.efectivo += Number(c.efectivo ?? 0)
      r.yape += Number(c.yape ?? 0)
      r.plin += Number(c.plin ?? 0)
      r.transferencia += Number(c.transferencia ?? 0)
      r.cobros_total += Number(c.total ?? 0)
    }
  })

  const vendedores = Array.from(resumen.values())
    .filter((r) => r.rol === 'vendedor' && (r.pedidos_count > 0 || r.cobros_count > 0))
  const repartidores = Array.from(resumen.values())
    .filter((r) => r.rol === 'repartidor' && (r.comprobantes_count > 0 || r.cobros_count > 0))

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Rendición Diaria',
    subtitulo: `Reporte por vendedor y repartidor — ${fecha}`,
    sheetName: 'Rendicion',
  })

  let row = startRow

  // Totales generales
  const totalPedidos = pedidos.reduce((a, p) => a + Number(p.total ?? 0), 0)
  const totalComprobantes = comprobantes.reduce((a, c) => a + Number(c.total ?? 0), 0)
  const totalCobros = cobros.reduce((a, c) => a + Number(c.total ?? 0), 0)

  row = seccionTitulo(sheet, row, 'Totales generales del día')
  row = seccionTabla(sheet, row,
    ['Concepto', 'Cantidad', 'Monto'],
    [
      ['Pedidos creados', pedidos.length, totalPedidos],
      ['Comprobantes emitidos', comprobantes.length, totalComprobantes],
      ['Cobros recibidos', cobros.length, totalCobros],
    ],
    { columnasMoneda: [2] },
  )

  // Vendedores
  if (vendedores.length > 0) {
    row = seccionTitulo(sheet, row, `Vendedores (${vendedores.length})`)
    row = seccionTabla(sheet, row,
      ['Vendedor', 'Pedidos', 'Monto pedidos', 'Facturas', 'Monto fact.', 'Cobros', 'Efectivo', 'Yape', 'Plin', 'Transfer.', 'Total cobrado'],
      vendedores.map((v) => [
        v.nombre, v.pedidos_count, v.pedidos_monto,
        v.comprobantes_count, v.comprobantes_monto,
        v.cobros_count, v.efectivo, v.yape, v.plin, v.transferencia, v.cobros_total,
      ]),
      { columnasMoneda: [2, 4, 6, 7, 8, 9, 10] },
    )
  }

  // Repartidores
  if (repartidores.length > 0) {
    row = seccionTitulo(sheet, row, `Repartidores (${repartidores.length})`)
    row = seccionTabla(sheet, row,
      ['Repartidor', 'Despachos', 'Monto despachado', 'Cobros', 'Efectivo', 'Yape', 'Plin', 'Transfer.', 'Total cobrado'],
      repartidores.map((r) => [
        r.nombre, r.comprobantes_count, r.comprobantes_monto,
        r.cobros_count, r.efectivo, r.yape, r.plin, r.transferencia, r.cobros_total,
      ]),
      { columnasMoneda: [2, 4, 5, 6, 7, 8] },
    )
  }

  footerReporte(sheet, row)
  return excelResponse(workbook, `rendicion-diaria-${fecha}.xlsx`)
}
