import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte,
} from '@/lib/excel-export'
import { hoyLima } from '@/lib/fechas-pe'
import { calcularUtilidad } from '@/lib/reporte-utilidad'

/**
 * Excel del reporte gerencial de utilidad. Lo protege el middleware: /api/gerencia
 * solo lo abren gerente y administrador. Usa la sesión del que lo pide, no la
 * llave de servicio.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const hasta = req.nextUrl.searchParams.get('hasta') ?? hoyLima()
  const desde = req.nextUrl.searchParams.get('desde') ?? `${hasta.slice(0, 8)}01`
  const supabase = await createClient()
  const reporte = await calcularUtilidad(supabase, desde, hasta)
  const pedida = req.nextUrl.searchParams.get('familia') ?? ''
  const familia = reporte.familias.some((g) => g.familia === pedida) ? pedida : ''
  const familias = familia ? reporte.familias.filter((g) => g.familia === familia) : reporte.familias
  const total = familia ? familias[0] : reporte.total
  const n2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Utilidad por producto y familia',
    subtitulo: `Reporte gerencial${familia ? ` · Familia ${familia}` : ''} · montos sin IGV`,
    periodo: { desde, hasta },
    sheetName: 'Utilidad',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, `Resumen por familia (${familias.length})`, 8)
  row = seccionTabla(sheet, row,
    ['Familia', 'Productos', 'Cantidad', 'Venta', 'Costo', 'Utilidad', '% s/venta', '% s/costo'],
    familias.map((g) => [
      g.familia, g.productos.length, n2(g.cantidad), g.venta, g.costo_total, g.utilidad,
      n2(g.margen_venta), n2(g.margen_costo),
    ]),
    {
      columnasMoneda: [3, 4, 5],
      columnasPorcentaje: [6, 7],
      totalsRow: ['TOTAL', familias.reduce((a, g) => a + g.productos.length, 0), n2(total.cantidad),
        total.venta, total.costo_total, total.utilidad, n2(total.margen_venta), n2(total.margen_costo)],
    },
  )

  row = seccionTitulo(sheet, row, 'Detalle por producto', 11)
  row = seccionTabla(sheet, row,
    ['Familia', 'Código', 'Producto', 'Cantidad', 'Costo unit.', 'P. prom. venta', 'Venta', 'Costo', 'Utilidad', '% s/venta', '% s/costo'],
    familias.flatMap((g) => g.productos.map((p) => [
      g.familia, p.codigo, p.producto, n2(p.cantidad), n2(p.costo_unitario), n2(p.precio_promedio),
      p.venta, p.costo_total, p.utilidad, n2(p.margen_venta), n2(p.margen_costo),
    ])),
    {
      columnasMoneda: [4, 5, 6, 7, 8],
      columnasPorcentaje: [9, 10],
      totalsRow: ['TOTAL', '', '', n2(total.cantidad), null, null,
        total.venta, total.costo_total, total.utilidad, n2(total.margen_venta), n2(total.margen_costo)],
    },
  )

  if (total.sin_costo > 0) {
    row = seccionTitulo(sheet, row,
      `${total.sin_costo} producto(s) sin costo de compra: su venta cuenta, pero no entra en la utilidad.`, 11)
  }
  footerReporte(sheet, row)
  const sufijo = familia ? `-${familia.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''
  return excelResponse(workbook, `utilidad-${desde}-a-${hasta}${sufijo}.xlsx`)
}
