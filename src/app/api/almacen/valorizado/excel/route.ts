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
    const d = new Date(hasta + 'T00:00:00-05:00'); d.setDate(d.getDate() - 89)
    return d.toISOString().slice(0, 10)
  })()
  const desde = req.nextUrl.searchParams.get('desde') ?? desdeDefault
  const familiaFiltro = req.nextUrl.searchParams.get('familia') ?? 'todas'
  const soloStock = req.nextUrl.searchParams.get('solo_stock') !== '0'

  const { data: prods } = await (supabase as any)
    .from('productos')
    .select(`
      id, codigo, nombre, descripcion, activo,
      familias(id, nombre),
      stock(cantidad)
    `)
    .order('codigo')

  const [{ data: comprasItems }, { data: ventasItems }] = await Promise.all([
    (supabase as any).from('compras_items')
      .select('producto_id, cantidad, precio_unitario, compras!inner(fecha, estado)')
      .gte('compras.fecha', desde).lte('compras.fecha', hasta)
      .neq('compras.estado', 'anulado'),
    (supabase as any).from('comprobantes_items')
      .select('producto_id, cantidad, precio_unitario, comprobantes!inner(fecha_emision, estado)')
      .gte('comprobantes.fecha_emision', desde).lte('comprobantes.fecha_emision', hasta)
      .neq('comprobantes.estado', 'anulado'),
  ])

  type Prom = { cant: number; monto: number }
  const compraMap = new Map<string, Prom>()
  ;(comprasItems ?? []).forEach((it: any) => {
    if (!it.producto_id) return
    const acc = compraMap.get(it.producto_id) ?? { cant: 0, monto: 0 }
    const c = Number(it.cantidad ?? 0)
    acc.cant += c; acc.monto += c * Number(it.precio_unitario ?? 0)
    compraMap.set(it.producto_id, acc)
  })
  const ventaMap = new Map<string, Prom>()
  ;(ventasItems ?? []).forEach((it: any) => {
    if (!it.producto_id) return
    const acc = ventaMap.get(it.producto_id) ?? { cant: 0, monto: 0 }
    const c = Number(it.cantidad ?? 0)
    acc.cant += c; acc.monto += c * Number(it.precio_unitario ?? 0)
    ventaMap.set(it.producto_id, acc)
  })

  let productos = (prods ?? []).map((p: any) => {
    const compra = compraMap.get(p.id)
    const venta = ventaMap.get(p.id)
    const costo = compra && compra.cant > 0 ? compra.monto / compra.cant : null
    const precioVenta = venta && venta.cant > 0 ? venta.monto / venta.cant : null
    const margen = (costo !== null && precioVenta !== null) ? precioVenta - costo : null
    const utilPct = (costo !== null && costo > 0 && margen !== null) ? (margen / costo) * 100 : null
    const stock = Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0)
    return {
      codigo: p.codigo ?? '—',
      descripcion: p.descripcion?.trim() || p.nombre || '—',
      familia_id: p.familias?.id ?? null,
      familia_nombre: p.familias?.nombre ?? 'Sin familia',
      stock,
      costo,
      precio_venta: precioVenta,
      margen,
      utilidad_pct: utilPct,
      valor_inventario: costo !== null ? stock * costo : 0,
      utilidad_potencial: margen !== null ? stock * margen : 0,
    }
  }) as any[]

  if (soloStock) productos = productos.filter((p) => p.stock > 0)
  if (familiaFiltro !== 'todas') productos = productos.filter((p) => p.familia_id === familiaFiltro)

  // Resumen por familia
  const famMap = new Map<string, any>()
  productos.forEach((p) => {
    const key = p.familia_id ?? '_'
    const acc = famMap.get(key) ?? {
      nombre: p.familia_nombre, productos: 0, valor: 0, utilidad: 0, suma_pct: 0, con_util: 0,
    }
    acc.productos++; acc.valor += p.valor_inventario; acc.utilidad += p.utilidad_potencial
    if (p.utilidad_pct !== null) { acc.suma_pct += p.utilidad_pct; acc.con_util++ }
    famMap.set(key, acc)
  })
  const familiasArr = Array.from(famMap.values())
    .map((f) => ({ ...f, pct_prom: f.con_util > 0 ? f.suma_pct / f.con_util : null }))
    .sort((a, b) => b.valor - a.valor)

  const totalValor = productos.reduce((a, p) => a + p.valor_inventario, 0)
  const totalUtil = productos.reduce((a, p) => a + p.utilidad_potencial, 0)

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Inventario Valorizado',
    subtitulo: `Stock × costo promedio · utilidad real por producto y familia`,
    periodo: { desde, hasta },
    sheetName: 'Valorizado',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, 'Totales')
  row = seccionTabla(sheet, row, ['Concepto', 'Valor'], [
    ['Productos analizados', productos.length],
    ['Sin costo de compra', productos.filter((p) => p.costo === null).length],
    ['Valor del inventario (a costo)', totalValor],
    ['Utilidad potencial (si todo se vende)', totalUtil],
    ['Margen promedio %', totalValor > 0 ? `${((totalUtil / totalValor) * 100).toFixed(2)}%` : '—'],
  ], { columnasMoneda: [1] })

  row = seccionTitulo(sheet, row, `Resumen por familia (${familiasArr.length})`)
  row = seccionTabla(sheet, row,
    ['Familia', 'Productos', 'Valor Inventario', 'Utilidad Potencial', '% Margen'],
    familiasArr.map((f) => [
      f.nombre, f.productos, f.valor, f.utilidad,
      f.pct_prom !== null ? `${f.pct_prom.toFixed(2)}%` : '—',
    ]),
    { columnasMoneda: [2, 3] },
  )

  row = seccionTitulo(sheet, row, `Detalle por producto (${productos.length})`)
  row = seccionTabla(sheet, row,
    ['Código', 'Producto', 'Familia', 'Stock', 'Costo prom.', 'Venta prom.', 'Margen', '% Util.', 'Valor Inv.', 'Util. Pot.'],
    productos.map((p) => [
      p.codigo, p.descripcion, p.familia_nombre, p.stock,
      p.costo ?? '', p.precio_venta ?? '', p.margen ?? '',
      p.utilidad_pct !== null ? `${p.utilidad_pct.toFixed(2)}%` : '—',
      p.valor_inventario, p.utilidad_potencial,
    ]),
    {
      columnasMoneda: [4, 5, 6, 8, 9],
      totalsRow: ['', '', 'TOTAL', '', '', '', '', '', totalValor, totalUtil],
    },
  )

  footerReporte(sheet, row)
  return excelResponse(workbook, `inventario-valorizado-${desde}-a-${hasta}.xlsx`)
}
