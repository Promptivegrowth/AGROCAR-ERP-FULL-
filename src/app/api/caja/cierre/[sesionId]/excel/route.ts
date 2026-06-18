import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crearExcelBranded,
  seccionTitulo,
  seccionTabla,
  excelResponse,
  footerReporte,
} from '@/lib/excel-export'

export const dynamic = 'force-dynamic'

/**
 * Genera el Excel branded del cierre de caja para una sesión específica.
 * Replica la información de /caja/cierre/[sesionId] pero exportable.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sesionId: string }> },
) {
  const { sesionId } = await params
  const supabase = createAdminClient()

  const { data: sesion } = await (supabase as any)
    .from('caja_sesiones')
    .select(`
      id, fecha_apertura, fecha_cierre, saldo_inicial, saldo_final, estado, notas,
      profiles!caja_sesiones_cajero_id_fkey(full_name)
    `)
    .eq('id', sesionId)
    .maybeSingle()

  if (!sesion) {
    return new Response('Sesión no encontrada', { status: 404 })
  }

  const [cobrosRes, movsRes] = await Promise.all([
    (supabase as any)
      .from('cobros')
      .select(`
        id, numero, total, efectivo, yape, plin, transferencia, fecha, notas, created_at,
        cliente_externo_nombre,
        clientes(razon_social, ruc, dni),
        profiles!cobros_cobrador_id_fkey(full_name, role)
      `)
      .gte('created_at', sesion.fecha_apertura)
      .lte('created_at', sesion.fecha_cierre ?? new Date().toISOString())
      .order('created_at', { ascending: true }),
    (supabase as any)
      .from('caja_movimientos')
      .select(`
        id, tipo, categoria, descripcion, monto, created_at,
        profiles!caja_movimientos_cobrador_id_fkey(full_name)
      `)
      .eq('sesion_id', sesionId)
      .order('created_at', { ascending: true }),
  ])

  const cobros: any[] = cobrosRes.data ?? []
  const movs: any[] = movsRes.data ?? []
  const egresos = movs.filter((m: any) => m.tipo === 'egreso')

  const totalEfectivo = cobros.reduce((a, c) => a + Number(c.efectivo ?? 0), 0)
  const totalYape = cobros.reduce((a, c) => a + Number(c.yape ?? 0), 0)
  const totalPlin = cobros.reduce((a, c) => a + Number(c.plin ?? 0), 0)
  const totalTransfer = cobros.reduce((a, c) => a + Number(c.transferencia ?? 0), 0)
  const totalIngresos = cobros.reduce((a, c) => a + Number(c.total ?? 0), 0)
  const totalEgresos = egresos.reduce((a, m) => a + Number(m.monto ?? 0), 0)

  const saldoInicial = Number(sesion.saldo_inicial ?? 0)
  const saldoTeorico = saldoInicial + totalEfectivo - totalEgresos
  const saldoFinal = sesion.saldo_final !== null ? Number(sesion.saldo_final) : null
  const diferencia = saldoFinal !== null ? saldoFinal - saldoTeorico : null

  const fmtFecha = (d: string | null) =>
    d
      ? new Date(d).toLocaleString('es-PE', {
          timeZone: 'America/Lima',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—'

  // ── Crear workbook
  const cajero = (sesion as any).profiles?.full_name ?? '—'
  const fechaAp = fmtFecha(sesion.fecha_apertura)
  const fechaCi = fmtFecha(sesion.fecha_cierre)
  const filename = `cierre-caja-${sesionId.slice(0, 8)}-${(sesion.fecha_apertura ?? '').slice(0, 10)}.xlsx`

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Cierre de Caja',
    subtitulo: `Cajero: ${cajero} · Sesión ${sesionId.slice(0, 8).toUpperCase()}`,
    sheetName: 'Cierre',
  })

  let row = startRow

  // Datos generales
  row = seccionTitulo(sheet, row, 'Información general')
  sheet.getCell(`A${row}`).value = 'Apertura'
  sheet.getCell(`A${row}`).font = { bold: true }
  sheet.getCell(`B${row}`).value = fechaAp
  sheet.getCell(`D${row}`).value = 'Cierre'
  sheet.getCell(`D${row}`).font = { bold: true }
  sheet.getCell(`E${row}`).value = fechaCi
  row++
  sheet.getCell(`A${row}`).value = 'Estado'
  sheet.getCell(`A${row}`).font = { bold: true }
  sheet.getCell(`B${row}`).value = sesion.estado
  sheet.getCell(`D${row}`).value = 'Saldo inicial'
  sheet.getCell(`D${row}`).font = { bold: true }
  sheet.getCell(`E${row}`).value = saldoInicial
  sheet.getCell(`E${row}`).numFmt = '"S/ "#,##0.00'
  row += 2

  // Resumen financiero
  row = seccionTitulo(sheet, row, 'Resumen financiero')
  row = seccionTabla(
    sheet,
    row,
    ['Concepto', 'Monto'],
    [
      ['Efectivo', totalEfectivo],
      ['Yape', totalYape],
      ['Plin', totalPlin],
      ['Transferencia', totalTransfer],
      ['Total Ingresos', totalIngresos],
      ['Total Egresos', totalEgresos],
      ['Saldo Teórico (Inicial + Efectivo − Egresos)', saldoTeorico],
      ['Saldo Final declarado', saldoFinal ?? 0],
      ['Diferencia (Final − Teórico)', diferencia ?? 0],
    ],
    { columnasMoneda: [1] },
  )

  // Cobros del periodo
  if (cobros.length > 0) {
    row = seccionTitulo(sheet, row, `Cobros recibidos (${cobros.length})`)
    row = seccionTabla(
      sheet,
      row,
      ['Hora', 'Recibo', 'Cliente', 'Cobrador', 'Efectivo', 'Yape', 'Plin', 'Transfer.', 'Total'],
      cobros.map((c) => [
        new Date(c.created_at).toLocaleTimeString('es-PE', {
          hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
        }),
        c.numero ?? '—',
        (c.clientes as any)?.razon_social ?? c.cliente_externo_nombre ?? 'Consumidor final',
        (c.profiles as any)?.full_name ?? '—',
        Number(c.efectivo ?? 0),
        Number(c.yape ?? 0),
        Number(c.plin ?? 0),
        Number(c.transferencia ?? 0),
        Number(c.total ?? 0),
      ]),
      {
        columnasMoneda: [4, 5, 6, 7, 8],
        totalsRow: ['', '', '', 'TOTALES', totalEfectivo, totalYape, totalPlin, totalTransfer, totalIngresos],
      },
    )
  }

  // Egresos
  if (egresos.length > 0) {
    row = seccionTitulo(sheet, row, `Egresos / Gastos (${egresos.length})`)
    row = seccionTabla(
      sheet,
      row,
      ['Hora', 'Categoría', 'Descripción', 'Registrado por', 'Monto'],
      egresos.map((m) => [
        new Date(m.created_at).toLocaleTimeString('es-PE', {
          hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
        }),
        m.categoria ?? '—',
        m.descripcion ?? '—',
        (m.profiles as any)?.full_name ?? '—',
        Number(m.monto ?? 0),
      ]),
      {
        columnasMoneda: [4],
        totalsRow: ['', '', '', 'TOTAL', totalEgresos],
      },
    )
  }

  if (sesion.notas) {
    row = seccionTitulo(sheet, row, 'Observaciones')
    sheet.mergeCells(`A${row}:G${row}`)
    sheet.getCell(`A${row}`).value = sesion.notas
    sheet.getCell(`A${row}`).alignment = { wrapText: true, vertical: 'top' }
    sheet.getRow(row).height = 50
    row += 2
  }

  footerReporte(sheet, row, cajero)

  return excelResponse(workbook, filename)
}
