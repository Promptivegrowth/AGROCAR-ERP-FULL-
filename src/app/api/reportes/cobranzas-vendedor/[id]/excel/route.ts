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

  const { data: vendedor } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, role').eq('id', id).maybeSingle()
  if (!vendedor) return new Response('Vendedor no encontrado', { status: 404 })

  const { data: clientes } = await (supabase as any)
    .from('clientes')
    .select('id, razon_social, ruc, dni, telefono, credito_dias')
    .eq('vendedor_id', id).eq('estado', 'activo')
  const clienteIds = (clientes ?? []).map((c: any) => c.id)

  const [compRes, aplRes] = clienteIds.length === 0
    ? [{ data: [] }, { data: [] }]
    : await Promise.all([
        (supabase as any).from('comprobantes')
          .select('id, serie, numero, tipo, fecha_emision, total, estado, cliente_id')
          .in('cliente_id', clienteIds).neq('estado', 'anulado'),
        (supabase as any).from('cobros_aplicaciones')
          .select('comprobante_id, monto_aplicado, cobros!inner(cliente_id)')
          .in('cobros.cliente_id', clienteIds),
      ])

  const aplicadoMap = new Map<string, number>()
  ;(aplRes.data ?? []).forEach((a: any) => {
    if (!a.comprobante_id) return
    aplicadoMap.set(a.comprobante_id, (aplicadoMap.get(a.comprobante_id) ?? 0) + Number(a.monto_aplicado ?? 0))
  })

  const compPorCliente = new Map<string, any[]>()
  ;(compRes.data ?? []).forEach((c: any) => {
    const arr = compPorCliente.get(c.cliente_id) ?? []
    arr.push(c)
    compPorCliente.set(c.cliente_id, arr)
  })

  const filas: any[] = []
  let totalSaldo = 0
  let totalVencido = 0
  let clientesConDeuda = 0

  ;(clientes ?? []).forEach((cl: any) => {
    const comps = compPorCliente.get(cl.id) ?? []
    const docs = comps.map((c: any) => {
      const abonado = aplicadoMap.get(c.id) ?? 0
      return {
        ...c, abonado,
        saldo: Math.max(0, Number(c.total) - abonado),
        dv: diasVencidos(c.fecha_emision, cl.credito_dias),
        vencimiento: fechaVencimientoTexto(c.fecha_emision, cl.credito_dias),
      }
    }).filter((d: any) => d.saldo > 0.01)
    const saldoCli = docs.reduce((a: number, d: any) => a + d.saldo, 0)
    if (saldoCli <= 0.01) return
    clientesConDeuda++
    totalSaldo += saldoCli
    totalVencido += docs.filter((d: any) => d.dv > 0).reduce((a: number, d: any) => a + d.saldo, 0)
    // Fila cabecera cliente
    filas.push([cl.razon_social, cl.ruc ?? cl.dni ?? '—', cl.telefono ?? '', '', '', '', '', saldoCli])
    docs.forEach((d: any) => {
      filas.push([
        d.fecha_emision,
        '',
        `${d.serie}-${String(d.numero).padStart(8, '0')}`,
        d.vencimiento ?? '—',
        d.dv === Number.NEGATIVE_INFINITY ? '—' : d.dv,
        Number(d.total),
        d.abonado,
        d.saldo,
      ])
    })
    // Fila vacía separadora
    filas.push(['', '', '', '', '', '', '', ''])
  })

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Cuentas por Cobrar',
    subtitulo: `Vendedor: ${vendedor.full_name} · ${clientesConDeuda} clientes con saldo`,
    sheetName: 'Cobranzas',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, 'Resumen')
  row = seccionTabla(sheet, row, ['Concepto', 'Monto'], [
    ['Clientes con deuda', clientesConDeuda],
    ['Saldo pendiente total', totalSaldo],
    ['De los cuales vencido', totalVencido],
  ], { columnasMoneda: [1] })

  row = seccionTitulo(sheet, row, `Detalle por cliente (${clientesConDeuda})`)
  row = seccionTabla(sheet, row,
    ['Cliente / Fecha', 'Doc / Tel', 'Comprobante', 'Vence', 'Días', 'Total', 'Abonado', 'Saldo'],
    filas,
    { columnasMoneda: [5, 6, 7] },
  )

  footerReporte(sheet, row, vendedor.full_name)
  return excelResponse(workbook, `cobranzas-${vendedor.full_name?.replace(/\s+/g, '-').toLowerCase()}.xlsx`)
}
