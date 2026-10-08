import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte } from '@/lib/excel-export'
import { hoyLima } from '@/lib/fechas-pe'
import {
  TIPO_VENTA, normalizarVentas, filtrarVentas, totalesVentas, ventasPorDia, ventasPor, anuladaVenta,
} from '@/lib/registros'

/** Excel del registro de ventas (gerencia). Mismos filtros y totales que la pantalla (lib/registros). */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const hasta = q.get('hasta') ?? hoyLima()
  const desde = q.get('desde') ?? `${hasta.slice(0, 8)}01`
  const supabase = await createClient()
  const { data, error } = await (supabase.rpc as any)('registro_ventas', { p_desde: desde, p_hasta: hasta })
  if (error) return new Response(error.message, { status: 403 })
  const filas = filtrarVentas(normalizarVentas(data), {
    tipo: q.get('tipo') ?? 'todos', condicion: q.get('condicion') ?? 'todas', vendedor: q.get('vendedor') ?? 'todos',
    anulados: q.get('anulados') === '1', buscar: q.get('buscar') ?? '',
  })
  const t = totalesVentas(filas)

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Registro de ventas', subtitulo: 'Reporte gerencial', periodo: { desde, hasta }, sheetName: 'Ventas',
  })
  let row = startRow
  row = seccionTitulo(sheet, row, 'Resumen', 13)
  row = seccionTabla(sheet, row, ['Concepto', 'Documentos', 'Valor venta', 'IGV', 'Total'], [
    ['Facturas', t.porTipo.factura.cantidad, t.porTipo.factura.base, t.porTipo.factura.igv, t.porTipo.factura.total],
    ['Boletas', t.porTipo.boleta.cantidad, t.porTipo.boleta.base, t.porTipo.boleta.igv, t.porTipo.boleta.total],
    ['Documentos internos', t.porTipo.nota_pedido_interna.cantidad, null, null, t.porTipo.nota_pedido_interna.total],
    ['Notas de crédito (restan)', t.porTipo.nota_credito.cantidad, -t.porTipo.nota_credito.base, -t.porTipo.nota_credito.igv, -t.porTipo.nota_credito.total],
    ['Contado', null, null, null, t.contado],
    ['Crédito', null, null, null, t.credito],
    ['Cobrado', null, null, null, t.cobrado],
    ['Por cobrar', null, null, null, t.porCobrar],
  ], { columnasMoneda: [2, 3, 4], totalsRow: ['TOTAL VENTAS', t.vigentes, t.valorVentaDeclarable, t.igvDeclarable, t.total] })

  row = seccionTitulo(sheet, row, 'Resumen por día', 13)
  const dias = ventasPorDia(filas)
  row = seccionTabla(sheet, row, ['Fecha', 'Documentos', 'Facturas', 'Boletas', 'Doc. internos', 'Notas de crédito', 'Total'],
    dias.map((d) => [d.fecha.split('-').reverse().join('/'), d.documentos, d.factura, d.boleta, d.interno, d.nc ? -d.nc : 0, d.total]),
    { columnasMoneda: [2, 3, 4, 5, 6], totalsRow: ['TOTAL', t.vigentes, t.porTipo.factura.total, t.porTipo.boleta.total, t.porTipo.nota_pedido_interna.total, -t.porTipo.nota_credito.total, t.total] })

  row = seccionTitulo(sheet, row, 'Por vendedor', 13)
  row = seccionTabla(sheet, row, ['Vendedor', 'Documentos', 'Facturas', 'Boletas', 'Doc. internos', 'Total', 'Por cobrar'],
    ventasPor(filas, (f) => f.vendedor || 'Sin vendedor').map((g) => [g.nombre, g.documentos, g.factura, g.boleta, g.interno, g.total, g.porCobrar]),
    { columnasMoneda: [2, 3, 4, 5, 6] })

  row = seccionTitulo(sheet, row, `Detalle (${filas.length} documentos)`, 13)
  row = seccionTabla(sheet, row,
    ['Fecha', 'Tipo', 'Documento', 'Cliente', 'RUC / DNI', 'Vendedor', 'Condición', 'Valor venta', 'IGV', 'Total', 'Cobrado', 'Saldo', 'Estado'],
    filas.map((f) => {
      const interno = f.tipo === 'nota_pedido_interna'
      const s = f.tipo === 'nota_credito' ? -1 : 1
      return [f.fecha.split('-').reverse().join('/'), TIPO_VENTA[f.tipo] ?? f.tipo, `${f.serie}-${f.numero}`, f.cliente, f.doc, f.vendedor || '',
        f.condicion === 'credito' ? 'Crédito' : 'Contado', interno ? null : s * f.base, interno ? null : s * f.igv, s * f.total,
        f.tipo === 'nota_credito' ? null : f.cobrado, f.tipo === 'nota_credito' ? null : Math.max(0, f.total - f.cobrado),
        anuladaVenta(f) ? 'ANULADO' : interno ? 'No va a SUNAT' : (f.sunat_estado ?? 'Pendiente')]
    }),
    { columnasMoneda: [7, 8, 9, 10, 11] })

  footerReporte(sheet, row)
  return excelResponse(workbook, `registro-ventas-${desde}-a-${hasta}.xlsx`)
}
