import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte,
} from '@/lib/excel-export'
import { hoyLima } from '@/lib/fechas-pe'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const hasta = req.nextUrl.searchParams.get('hasta') ?? hoyLima()
  const desdeDefault = (() => {
    const d = new Date(hasta + 'T00:00:00-05:00'); d.setDate(d.getDate() - 29)
    return d.toISOString().slice(0, 10)
  })()
  const desde = req.nextUrl.searchParams.get('desde') ?? desdeDefault

  const { data: items } = await (supabase as any)
    .from('comprobantes_items')
    .select(`
      cantidad, precio_unitario, subtotal, descripcion, producto_id,
      productos(id, codigo, nombre, familias(nombre)),
      comprobantes!inner(fecha_emision, estado)
    `)
    .gte('comprobantes.fecha_emision', desde)
    .lte('comprobantes.fecha_emision', hasta)
    .neq('comprobantes.estado', 'anulado')

  const map = new Map<string, any>()
  ;(items ?? []).forEach((it: any) => {
    const key = it.producto_id ?? `__${it.descripcion}`
    const acc = map.get(key) ?? {
      codigo: it.productos?.codigo ?? '—',
      nombre: it.productos?.nombre ?? it.descripcion ?? '—',
      familia: it.productos?.familias?.nombre ?? '—',
      cantidad: 0, monto: 0, veces: 0,
    }
    acc.cantidad += Number(it.cantidad ?? 0)
    acc.monto += Number(it.subtotal ?? 0)
    acc.veces += 1
    map.set(key, acc)
  })
  const productos = Array.from(map.values()).sort((a, b) => b.monto - a.monto)

  const fam = new Map<string, any>()
  productos.forEach((p) => {
    const acc = fam.get(p.familia) ?? { familia: p.familia, cantidad: 0, monto: 0, productos: 0 }
    acc.cantidad += p.cantidad; acc.monto += p.monto; acc.productos += 1
    fam.set(p.familia, acc)
  })
  const familias = Array.from(fam.values()).sort((a, b) => b.monto - a.monto)
  const totalMonto = productos.reduce((a, p) => a + p.monto, 0)

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Productos más vendidos',
    subtitulo: 'Ranking de productos y familias',
    periodo: { desde, hasta },
    sheetName: 'Ventas',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, `Ranking por familia (${familias.length})`)
  row = seccionTabla(sheet, row,
    ['#', 'Familia', 'Productos', 'Cantidad', 'Monto', '% del total'],
    familias.map((f, i) => [
      i + 1, f.familia, f.productos, f.cantidad, f.monto,
      totalMonto > 0 ? `${((f.monto / totalMonto) * 100).toFixed(1)}%` : '0%',
    ]),
    { columnasMoneda: [4] },
  )

  row = seccionTitulo(sheet, row, `Ranking de productos (${productos.length})`)
  row = seccionTabla(sheet, row,
    ['#', 'Código', 'Producto', 'Familia', 'Veces', 'Cantidad', 'Monto'],
    productos.map((p, i) => [
      i + 1, p.codigo, p.nombre, p.familia, p.veces, p.cantidad, p.monto,
    ]),
    {
      columnasMoneda: [6],
      totalsRow: ['', '', 'TOTAL', '', '', '', totalMonto],
    },
  )

  footerReporte(sheet, row)
  return excelResponse(workbook, `productos-mas-vendidos-${desde}-a-${hasta}.xlsx`)
}
