import { createClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/utils'
import RendicionActions from './rendicion-actions'
import { hoyLima } from '@/lib/fechas-pe'

export const dynamic = 'force-dynamic'

/**
 * Reporte de rendición diaria por vendedor y repartidor.
 *
 * Lo pidió el cliente: "los reportes de ventas y cobranzas deben generarse
 * por vendedor y repartidor para que cada uno rinda su cuenta diaria. Va
 * en el módulo de reportes, no en caja, para separar las operaciones del
 * cierre."
 */
async function getData(fecha: string) {
  const supabase = await createClient()

  const inicioDia = `${fecha}T00:00:00`
  const finDia = `${fecha}T23:59:59`

  // Personal: vendedores y repartidores activos
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['vendedor', 'repartidor'])
    .eq('activo', true)
    .order('full_name')

  // Pedidos creados en el día (con vendedor_id y total)
  const { data: pedidos } = await (supabase as any)
    .from('pedidos')
    .select('id, vendedor_id, total, fecha_pedido')
    .eq('fecha_pedido', fecha)

  // Comprobantes emitidos en el día — usamos el vendedor del pedido
  const { data: comprobantes } = await (supabase as any)
    .from('comprobantes')
    .select(`
      id, total, fecha_emision, pedido_id,
      pedidos(vendedor_id)
    `)
    .eq('fecha_emision', fecha)
    .neq('estado', 'anulado')

  // Cobros del día por cobrador
  const { data: cobros } = await (supabase as any)
    .from('cobros')
    .select(`
      id, cobrador_id, efectivo, yape, plin, transferencia, total, fecha,
      cobros_aplicaciones(comprobante_id, monto_aplicado, es_a_cuenta)
    `)
    .eq('fecha', fecha)

  // Agregaciones por persona
  type Resumen = {
    id: string
    nombre: string
    rol: string
    pedidos_count: number
    pedidos_monto: number
    comprobantes_count: number
    comprobantes_monto: number
    cobros_count: number
    efectivo: number
    yape: number
    plin: number
    transferencia: number
    cobros_total: number
  }
  const resumen = new Map<string, Resumen>()
  ;(profiles ?? []).forEach((p: any) => {
    resumen.set(p.id, {
      id: p.id, nombre: p.full_name ?? '—', rol: p.role,
      pedidos_count: 0, pedidos_monto: 0,
      comprobantes_count: 0, comprobantes_monto: 0,
      cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0,
    })
  })

  // Pedidos por vendedor
  ;(pedidos ?? []).forEach((p: any) => {
    if (!p.vendedor_id) return
    const r = resumen.get(p.vendedor_id)
    if (!r) return
    r.pedidos_count += 1
    r.pedidos_monto += Number(p.total ?? 0)
  })

  // Comprobantes por vendedor (via pedido)
  ;(comprobantes ?? []).forEach((c: any) => {
    const vId = c.pedidos?.vendedor_id
    if (!vId) return
    const r = resumen.get(vId)
    if (!r) return
    r.comprobantes_count += 1
    r.comprobantes_monto += Number(c.total ?? 0)
  })

  // Cobros por cobrador
  ;(cobros ?? []).forEach((c: any) => {
    if (!c.cobrador_id) return
    const r = resumen.get(c.cobrador_id)
    if (!r) return
    r.cobros_count += 1
    r.efectivo += Number(c.efectivo ?? 0)
    r.yape += Number(c.yape ?? 0)
    r.plin += Number(c.plin ?? 0)
    r.transferencia += Number(c.transferencia ?? 0)
    r.cobros_total += Number(c.total ?? 0)
  })

  // Separar vendedores y repartidores con actividad
  const filas = Array.from(resumen.values()).filter(
    (r) => r.pedidos_count > 0 || r.comprobantes_count > 0 || r.cobros_count > 0,
  )
  const vendedores = filas.filter((r) => r.rol === 'vendedor')
  const repartidores = filas.filter((r) => r.rol === 'repartidor')

  // Totales generales
  const totales = filas.reduce(
    (acc, r) => ({
      pedidos: acc.pedidos + r.pedidos_count,
      pedidos_monto: acc.pedidos_monto + r.pedidos_monto,
      comprobantes_monto: acc.comprobantes_monto + r.comprobantes_monto,
      cobros_count: acc.cobros_count + r.cobros_count,
      efectivo: acc.efectivo + r.efectivo,
      yape: acc.yape + r.yape,
      plin: acc.plin + r.plin,
      transferencia: acc.transferencia + r.transferencia,
      cobros_total: acc.cobros_total + r.cobros_total,
    }),
    { pedidos: 0, pedidos_monto: 0, comprobantes_monto: 0, cobros_count: 0,
      efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0 },
  )

  return { vendedores, repartidores, totales }
}

export default async function RendicionDiariaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>
}) {
  const { fecha } = await searchParams
  const fechaSel = fecha || hoyLima()
  const data = await getData(fechaSel)

  const fechaFmt = new Date(fechaSel + 'T12:00:00').toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Lima',
  })

  const renderTabla = (filas: typeof data.vendedores, titulo: string, colorRol: string) => (
    <div className="mb-6">
      <h3 className={`text-[11pt] font-bold mb-1 ${colorRol}`}>{titulo} ({filas.length})</h3>
      {filas.length === 0 ? (
        <p className="text-[9pt] italic text-gray-400 py-2 px-2 border border-gray-200 rounded">
          Sin actividad en el día.
        </p>
      ) : (
        <table className="w-full rendicion-table border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-100 text-[9pt]">
              <th className="text-left py-1 px-2 border border-gray-300">Persona</th>
              <th className="text-center py-1 px-2 border border-gray-300 w-12">Ped.</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-24">Ventas día</th>
              <th className="text-center py-1 px-2 border border-gray-300 w-12">Cobros</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-20">Efectivo</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-20">Yape</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-20">Plin</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-20">Transfer.</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-24">Total cobrado</th>
            </tr>
          </thead>
          <tbody className="text-[9pt]">
            {filas.map((r) => (
              <tr key={r.id}>
                <td className="py-1 px-2 border border-gray-200 font-medium">{r.nombre}</td>
                <td className="py-1 px-2 border border-gray-200 text-center font-mono">{r.comprobantes_count > 0 ? r.comprobantes_count : r.pedidos_count}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono">{formatCurrency(r.comprobantes_monto || r.pedidos_monto)}</td>
                <td className="py-1 px-2 border border-gray-200 text-center font-mono">{r.cobros_count}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono">{formatCurrency(r.efectivo)}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono">{formatCurrency(r.yape)}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono">{formatCurrency(r.plin)}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono">{formatCurrency(r.transferencia)}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono font-bold text-green-700">{formatCurrency(r.cobros_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .rendicion-table { font-size: 8pt !important; }
          .rendicion-table td, .rendicion-table th { padding: 2px 4px !important; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-bold text-gray-900 text-sm">Rendición diaria por persona</h1>
            <p className="text-[11px] text-gray-500">
              Ventas y cobranzas del día, separadas por vendedor y repartidor.
            </p>
          </div>
          <RendicionActions fechaActual={fechaSel} />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 print:px-0 print:py-0">
        <div className="text-center mb-3">
          <h2 className="text-[14pt] font-bold">AGROCAR S.R.L.</h2>
          <h3 className="text-[11pt] font-semibold">RENDICIÓN DIARIA DE VENDEDORES Y REPARTIDORES</h3>
          <p className="text-[10pt] capitalize mt-1">{fechaFmt}</p>
        </div>

        {renderTabla(data.vendedores, 'Vendedores', 'text-blue-700')}
        {renderTabla(data.repartidores, 'Repartidores', 'text-amber-700')}

        {/* Totales globales */}
        <div className="mt-6 border-2 border-black bg-yellow-50/40 p-4">
          <h3 className="text-[11pt] font-bold mb-2 text-center">TOTALES GENERALES DEL DÍA</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10pt]">
            <div className="text-center"><div className="text-gray-600">Pedidos/Comprob.</div><div className="font-bold font-mono">{data.totales.pedidos}</div></div>
            <div className="text-center"><div className="text-gray-600">Ventas día</div><div className="font-bold font-mono">{formatCurrency(data.totales.comprobantes_monto || data.totales.pedidos_monto)}</div></div>
            <div className="text-center"><div className="text-gray-600">Total cobros</div><div className="font-bold font-mono text-green-700">{formatCurrency(data.totales.cobros_total)}</div></div>
            <div className="text-center"><div className="text-gray-600"># Cobros</div><div className="font-bold font-mono">{data.totales.cobros_count}</div></div>
          </div>
          <div className="grid grid-cols-4 gap-3 text-[9pt] mt-3 border-t border-gray-300 pt-2">
            <div className="text-center"><div className="text-gray-600">Efectivo</div><div className="font-mono">{formatCurrency(data.totales.efectivo)}</div></div>
            <div className="text-center"><div className="text-gray-600">Yape</div><div className="font-mono">{formatCurrency(data.totales.yape)}</div></div>
            <div className="text-center"><div className="text-gray-600">Plin</div><div className="font-mono">{formatCurrency(data.totales.plin)}</div></div>
            <div className="text-center"><div className="text-gray-600">Transferencia</div><div className="font-mono">{formatCurrency(data.totales.transferencia)}</div></div>
          </div>
        </div>

        <div className="text-center text-[8pt] text-gray-500 mt-6 print:mt-3">
          Documento generado {new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })} · AGROCAR ERP
        </div>
      </div>
    </div>
  )
}
