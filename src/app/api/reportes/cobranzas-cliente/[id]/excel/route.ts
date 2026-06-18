import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte,
} from '@/lib/excel-export'
import { diasVencidos, fechaVencimientoTexto } from '@/lib/cliente-saldo'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: cliente } = await (supabase as any)
    .from('clientes')
    .select('id, razon_social, ruc, dni, telefono, credito_dias')
    .eq('id', id).maybeSingle()
  if (!cliente) return new Response('Cliente no encontrado', { status: 404 })

  const [compRes, cobRes] = await Promise.all([
    (supabase as any).from('comprobantes')
      .select('id, serie, numero, tipo, fecha_emision, total, estado')
      .eq('cliente_id', id).neq('estado', 'anulado')
      .order('fecha_emision', { ascending: true }),
    (supabase as any).from('cobros_aplicaciones')
      .select('comprobante_id, monto_aplicado, cobros!inner(cliente_id)')
      .eq('cobros.cliente_id', id),
  ])

  const aplicadoMap = new Map<string, number>()
  ;(cobRes.data ?? []).forEach((a: any) => {
    if (!a.comprobante_id) return
    aplicadoMap.set(a.comprobante_id, (aplicadoMap.get(a.comprobante_id) ?? 0) + Number(a.monto_aplicado ?? 0))
  })

  const todos = (compRes.data ?? []).map((c: any) => {
    const abonado = aplicadoMap.get(c.id) ?? 0
    return {
      ...c, abonado,
      saldo: Math.max(0, Number(c.total) - abonado),
      dv: diasVencidos(c.fecha_emision, cliente.credito_dias),
      vencimiento: fechaVencimientoTexto(c.fecha_emision, cliente.credito_dias),
    }
  })
  const pendientes = todos.filter((d: any) => d.saldo > 0.01)
  const saldoTotal = pendientes.reduce((a: number, d: any) => a + d.saldo, 0)
  const vencido = pendientes.filter((d: any) => d.dv > 0).reduce((a: number, d: any) => a + d.saldo, 0)
  const porVencer = pendientes.filter((d: any) => d.dv <= 0).reduce((a: number, d: any) => a + d.saldo, 0)
  const facturadoTotal = todos.reduce((a: number, d: any) => a + Number(d.total), 0)
  const abonadoTotal = todos.reduce((a: number, d: any) => a + d.abonado, 0)

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Estado de Cuenta',
    subtitulo: `${cliente.razon_social} · ${cliente.ruc ? 'RUC ' + cliente.ruc : cliente.dni ? 'DNI ' + cliente.dni : ''} · Crédito ${cliente.credito_dias ?? 0} días`,
    sheetName: 'Estado de Cuenta',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, 'Resumen financiero')
  row = seccionTabla(sheet, row, ['Concepto', 'Monto'], [
    ['Facturado total', facturadoTotal],
    ['Abonado total', abonadoTotal],
    ['Por vencer', porVencer],
    ['Vencido', vencido],
    ['SALDO PENDIENTE', saldoTotal],
  ], { columnasMoneda: [1] })

  if (pendientes.length > 0) {
    row = seccionTitulo(sheet, row, `Comprobantes pendientes (${pendientes.length})`)
    row = seccionTabla(sheet, row,
      ['Fecha emis.', 'Tipo', 'Comprobante', 'Vence', 'Días', 'Total', 'Abonado', 'Saldo'],
      pendientes.map((d: any) => [
        d.fecha_emision, d.tipo,
        `${d.serie}-${String(d.numero).padStart(8, '0')}`,
        d.vencimiento ?? '—',
        d.dv === Number.NEGATIVE_INFINITY ? '—' : d.dv,
        Number(d.total), d.abonado, d.saldo,
      ]),
      {
        columnasMoneda: [5, 6, 7],
        columnasFecha: [0, 3],
        totalsRow: ['', '', '', '', 'TOTAL', facturadoTotal, abonadoTotal, saldoTotal],
      },
    )
  }

  footerReporte(sheet, row)
  return excelResponse(workbook, `estado-cuenta-${cliente.razon_social.replace(/\s+/g, '-').toLowerCase()}.xlsx`)
}
