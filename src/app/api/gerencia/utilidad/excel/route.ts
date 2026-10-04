import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte,
} from '@/lib/excel-export'
import { hoyLima } from '@/lib/fechas-pe'
import { calcularUtilidad, type Agrupacion } from '@/lib/reporte-utilidad'

/**
 * Excel del reporte gerencial de utilidad. Lo protege el middleware: /api/gerencia
 * solo lo abren gerente y administrador. Usa la sesión del que lo pide, no la
 * llave de servicio.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const hasta = q.get('hasta') ?? hoyLima()
  const desde = q.get('desde') ?? `${hasta.slice(0, 8)}01`
  const por: Agrupacion = q.get('por') === 'tipo' ? 'tipo' : 'marca'
  const et = por === 'marca' ? 'Marca' : 'Tipo de producto'
  const supabase = await createClient()
  const reporte = await calcularUtilidad(supabase, desde, hasta, por)
  const pedido = q.get('grupo') ?? ''
  const grupo = reporte.grupos.some((g) => g.grupo === pedido) ? pedido : ''
  const grupos = grupo ? reporte.grupos.filter((g) => g.grupo === grupo) : reporte.grupos
  const total = grupo ? grupos[0] : reporte.total
  const n2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: `Utilidad por ${et.toLowerCase()}`,
    subtitulo: `Reporte gerencial${grupo ? ` · ${et} ${grupo}` : ''} · montos sin IGV`,
    periodo: { desde, hasta },
    sheetName: 'Utilidad',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, `Utilidad por ${et.toLowerCase()} (${grupos.length})`, 10)
  row = seccionTabla(sheet, row,
    [et, 'Productos', 'Cantidad', 'Venta', 'Costo', 'Utilidad', '% s/venta', '% s/costo', '% de la venta', '% de la utilidad'],
    grupos.map((g) => [
      g.grupo, g.productos.length, n2(g.cantidad), g.venta, g.costo_total, g.utilidad,
      n2(g.margen_venta), n2(g.margen_costo), n2(g.part_venta), n2(g.part_utilidad),
    ]),
    {
      columnasMoneda: [3, 4, 5],
      columnasPorcentaje: [6, 7, 8, 9],
      totalsRow: ['TOTAL', grupos.reduce((a, g) => a + g.productos.length, 0), n2(total.cantidad),
        total.venta, total.costo_total, total.utilidad, n2(total.margen_venta), n2(total.margen_costo),
        grupo ? n2(grupos[0].part_venta) : 100, grupo ? n2(grupos[0].part_utilidad) : 100],
    },
  )

  row = seccionTitulo(sheet, row, 'Detalle por producto', 11)
  row = seccionTabla(sheet, row,
    [et, 'Código', 'Producto', 'Cantidad', 'Costo unit.', 'P. prom. venta', 'Venta', 'Costo', 'Utilidad', '% s/venta', '% s/costo'],
    grupos.flatMap((g) => g.productos.map((p) => [
      g.grupo, p.codigo, p.producto, n2(p.cantidad), n2(p.costo_unitario), n2(p.precio_promedio),
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
  const sufijo = grupo ? `-${grupo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''
  return excelResponse(workbook, `utilidad-por-${por}-${desde}-a-${hasta}${sufijo}.xlsx`)
}
