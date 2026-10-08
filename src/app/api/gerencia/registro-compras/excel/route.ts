import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte } from '@/lib/excel-export'
import { hoyLima } from '@/lib/fechas-pe'
import {
  TIPO_COMPRA, normalizarCompras, filtrarCompras, totalesCompras, comprasPorProveedor, comprasPorDia, anuladaCompra,
} from '@/lib/registros'

/** Excel del registro de compras (gerencia). Mismos filtros y totales que la pantalla (lib/registros). */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const hasta = q.get('hasta') ?? hoyLima()
  const desde = q.get('desde') ?? `${hasta.slice(0, 8)}01`
  const supabase = await createClient()
  const { data, error } = await (supabase.rpc as any)('registro_compras', { p_desde: desde, p_hasta: hasta })
  if (error) return new Response(error.message, { status: 403 })
  const filas = filtrarCompras(normalizarCompras(data), {
    tipo: q.get('tipo') ?? 'todos', proveedor: q.get('proveedor') ?? 'todos',
    anuladas: q.get('anuladas') === '1', buscar: q.get('buscar') ?? '',
  })
  const t = totalesCompras(filas)
  const n = t.porTipo.factura.cantidad + t.porTipo.interno.cantidad + t.porTipo.regulariza.cantidad

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Registro de compras', subtitulo: 'Reporte gerencial', periodo: { desde, hasta }, sheetName: 'Compras',
  })
  let row = startRow
  row = seccionTitulo(sheet, row, 'Resumen', 9)
  row = seccionTabla(sheet, row, ['Concepto', 'Documentos', 'Valor compra', 'IGV', 'Total'], [
    ['Facturas', t.porTipo.factura.cantidad, t.porTipo.factura.base, t.porTipo.factura.igv, t.porTipo.factura.total],
    ['Facturas que regularizan internos', t.porTipo.regulariza.cantidad, t.porTipo.regulariza.base, t.porTipo.regulariza.igv, t.porTipo.regulariza.total],
    ['Documentos internos (sin comprobante)', t.porTipo.interno.cantidad, t.porTipo.interno.base, null, t.porTipo.interno.total],
  ], { columnasMoneda: [2, 3, 4], totalsRow: ['TOTAL COMPRAS', n, null, t.creditoFiscal, t.total] })

  row = seccionTitulo(sheet, row, 'Por proveedor', 9)
  row = seccionTabla(sheet, row, ['Proveedor', 'RUC', 'Documentos', 'Con factura', 'Doc. internos', 'IGV', 'Total'],
    comprasPorProveedor(filas).map((g) => [g.nombre, g.ruc, g.documentos, g.factura + g.regulariza, g.interno, g.igv, g.total]),
    { columnasMoneda: [3, 4, 5, 6], totalsRow: ['TOTAL', '', n, t.conComprobante, t.sinComprobante, t.creditoFiscal, t.total] })

  row = seccionTitulo(sheet, row, 'Resumen por día', 9)
  row = seccionTabla(sheet, row, ['Fecha', 'Documentos', 'Con factura', 'Doc. internos', 'Regulariza', 'Total'],
    comprasPorDia(filas).map((d) => [d.fecha.split('-').reverse().join('/'), d.documentos, d.factura, d.interno, d.regulariza, d.total]),
    { columnasMoneda: [2, 3, 4, 5] })

  row = seccionTitulo(sheet, row, `Detalle (${filas.length} documentos)`, 9)
  row = seccionTabla(sheet, row, ['Fecha', 'Tipo', 'Documento', 'Proveedor', 'RUC', 'Valor compra', 'IGV', 'Total', 'Estado'],
    filas.map((f) => [f.fecha.split('-').reverse().join('/'), TIPO_COMPRA[f.tipo], f.documento, f.proveedor, f.ruc,
      f.base, f.tipo === 'interno' ? null : f.igv, f.total, anuladaCompra(f) ? 'ANULADA' : f.estado]),
    { columnasMoneda: [5, 6, 7] })

  footerReporte(sheet, row)
  return excelResponse(workbook, `registro-compras-${desde}-a-${hasta}.xlsx`)
}
