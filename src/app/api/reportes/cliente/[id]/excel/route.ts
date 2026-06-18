import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte,
} from '@/lib/excel-export'
import { hoyLima } from '@/lib/fechas-pe'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()
  const hasta = req.nextUrl.searchParams.get('hasta') ?? hoyLima()
  const desde = req.nextUrl.searchParams.get('desde') ?? '2025-01-01'

  const { data: cliente } = await (supabase as any)
    .from('clientes')
    .select('razon_social, ruc, dni, direccion, telefono')
    .eq('id', id).maybeSingle()
  if (!cliente) return new Response('Cliente no encontrado', { status: 404 })

  const [compRes, cobRes] = await Promise.all([
    (supabase as any).from('comprobantes')
      .select(`
        id, serie, numero, tipo, fecha_emision, subtotal, igv, total,
        comprobantes_items(cantidad, precio_unitario, subtotal, descripcion,
          productos(codigo, nombre, familias(nombre)))
      `)
      .eq('cliente_id', id)
      .gte('fecha_emision', desde).lte('fecha_emision', hasta)
      .neq('estado', 'anulado')
      .order('fecha_emision', { ascending: false }),
    (supabase as any).from('cobros')
      .select('total').eq('cliente_id', id)
      .gte('fecha', desde).lte('fecha', hasta),
  ])

  const comprobantes: any[] = compRes.data ?? []
  const cobros: any[] = cobRes.data ?? []
  const totalFact = comprobantes.reduce((a, c) => a + Number(c.total ?? 0), 0)
  const totalCob = cobros.reduce((a, c) => a + Number(c.total ?? 0), 0)

  const productosMap = new Map<string, any>()
  comprobantes.forEach((c) => {
    ;(c.comprobantes_items ?? []).forEach((it: any) => {
      const key = it.productos?.codigo ?? it.descripcion
      const acc = productosMap.get(key) ?? {
        codigo: it.productos?.codigo ?? '—',
        nombre: it.productos?.nombre ?? it.descripcion ?? '—',
        familia: it.productos?.familias?.nombre ?? '—',
        cantidad: 0, monto: 0, veces: 0,
      }
      acc.cantidad += Number(it.cantidad ?? 0)
      acc.monto += Number(it.subtotal ?? 0)
      acc.veces += 1
      productosMap.set(key, acc)
    })
  })
  const topProductos = Array.from(productosMap.values()).sort((a, b) => b.monto - a.monto)

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Reporte de Cliente',
    subtitulo: `${cliente.razon_social} · ${cliente.ruc ? 'RUC ' + cliente.ruc : cliente.dni ? 'DNI ' + cliente.dni : ''}`,
    periodo: { desde, hasta },
    sheetName: 'Cliente',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, 'Resumen')
  row = seccionTabla(sheet, row,
    ['Concepto', 'Valor'],
    [
      ['Comprobantes', comprobantes.length],
      ['Total facturado', totalFact],
      ['Total cobrado', totalCob],
      ['Saldo pendiente', Math.max(0, totalFact - totalCob)],
    ],
    { columnasMoneda: [1] },
  )

  if (comprobantes.length > 0) {
    row = seccionTitulo(sheet, row, `Comprobantes (${comprobantes.length})`)
    row = seccionTabla(sheet, row,
      ['Fecha', 'Tipo', 'Serie-Número', 'Subtotal', 'IGV', 'Total'],
      comprobantes.map((c) => [
        c.fecha_emision,
        c.tipo,
        `${c.serie}-${String(c.numero).padStart(8, '0')}`,
        Number(c.subtotal ?? 0),
        Number(c.igv ?? 0),
        Number(c.total ?? 0),
      ]),
      {
        columnasMoneda: [3, 4, 5],
        columnasFecha: [0],
        totalsRow: ['', '', 'TOTAL', '', '', totalFact],
      },
    )
  }

  if (topProductos.length > 0) {
    row = seccionTitulo(sheet, row, `Productos comprados (${topProductos.length})`)
    row = seccionTabla(sheet, row,
      ['Código', 'Producto', 'Familia', 'Veces', 'Cantidad', 'Monto'],
      topProductos.map((p) => [p.codigo, p.nombre, p.familia, p.veces, p.cantidad, p.monto]),
      { columnasMoneda: [5] },
    )
  }

  footerReporte(sheet, row)
  return excelResponse(workbook, `cliente-${cliente.razon_social.replace(/\s+/g, '-').toLowerCase()}-${desde}-a-${hasta}.xlsx`)
}
