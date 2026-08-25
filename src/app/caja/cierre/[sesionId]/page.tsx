import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import CierreActions from './cierre-actions'

export const dynamic = 'force-dynamic'

const CATEGORIA_LABELS: Record<string, string> = {
  cobro_cliente: 'Cobro cliente',
  pago_planilla: 'Pago planilla',
  prestamo_empleado: 'Préstamo empleado',
  otro: 'Otro',
}

export default async function CierreCajaReporte({
  params,
}: {
  params: Promise<{ sesionId: string }>
}) {
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

  if (!sesion) return notFound()

  /**
   * Los días a los que pertenece el dinero de esta sesión.
   *
   * No es lo mismo que la fecha de apertura. Si el sábado nadie abre caja, la
   * sesión del domingo liquida los cobros del sábado, y el reporte tiene que
   * decirlo: si no, queda un cierre fechado el domingo con plata que se
   * levantó el sábado y nadie puede cuadrar el día.
   */
  const apertura = new Date(sesion.fecha_apertura)
  const cierre = sesion.fecha_cierre ? new Date(sesion.fecha_cierre) : null

  // Fuente de verdad: caja_movimientos.sesion_id. Incluye los retroactivos
  // (cobros previos cargados al abrir caja) que un filtro por fecha excluiría.
  const { data: movsRaw } = await (supabase as any)
    .from('caja_movimientos')
    .select(`
      id, tipo, categoria, descripcion, monto, created_at, cobro_id,
      profiles!caja_movimientos_cobrador_id_fkey(full_name)
    `)
    .eq('sesion_id', sesionId)
    .order('created_at', { ascending: true })

  const movs = movsRaw ?? []
  const cobroIds = movs.filter((m: any) => m.cobro_id).map((m: any) => m.cobro_id)

  // Traer cobros asociados a los movimientos (en vez de filtrar por fecha).
  const { data: cobrosRaw } = cobroIds.length > 0
    ? await (supabase as any)
        .from('cobros')
        .select(`
          id, numero, total, efectivo, yape, plin, transferencia, fecha, notas, created_at, cliente_externo_nombre,
          clientes(razon_social, telefono),
          profiles!cobros_cobrador_id_fkey(full_name, role)
        `)
        .in('id', cobroIds)
        .order('created_at', { ascending: true })
    : { data: [] }

  const cobros = cobrosRaw ?? []

  // Los días a los que pertenece el dinero, tomados de la fecha de cada cobro
  const diasDelDinero = (() => {
    const dias = Array.from(new Set(
      (cobros as any[]).map((c) => c.fecha).filter(Boolean),
    )).sort()
    if (dias.length === 0) return null
    const legible = (d: string) => new Date(d + 'T12:00:00-05:00')
      .toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    if (dias.length === 1) return legible(dias[0])
    return `${legible(dias[0])} al ${legible(dias[dias.length - 1])}`
  })()
  const egresos = movs.filter((m: any) => m.tipo === 'egreso')

  // Totales
  const totalEfectivo = cobros.reduce((a: number, c: any) => a + Number(c.efectivo ?? 0), 0)
  const totalYape = cobros.reduce((a: number, c: any) => a + Number(c.yape ?? 0), 0)
  const totalPlin = cobros.reduce((a: number, c: any) => a + Number(c.plin ?? 0), 0)
  const totalTransfer = cobros.reduce((a: number, c: any) => a + Number(c.transferencia ?? 0), 0)
  const totalIngresos = cobros.reduce((a: number, c: any) => a + Number(c.total ?? 0), 0)
  const totalEgresos = egresos.reduce((a: number, m: any) => a + Number(m.monto ?? 0), 0)

  const saldoInicial = Number(sesion.saldo_inicial ?? 0)
  const saldoTeorico = saldoInicial + totalIngresos - totalEgresos
  const saldoFinal = sesion.saldo_final !== null ? Number(sesion.saldo_final) : null
  const diferencia = saldoFinal !== null ? saldoFinal - saldoTeorico : null

  // Fechas formateadas en hora Lima
  const fmtFecha = (d: Date | null) =>
    d ? d.toLocaleString('es-PE', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      timeZone: 'America/Lima',
    }) : '—'

  const fmtHora = (d: Date | string) =>
    new Date(d).toLocaleTimeString('es-PE', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'America/Lima', hour12: false,
    })

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; color: #111 !important; }
          .no-print { display: none !important; }
          /* Tipos legibles en impresión */
          .cierre-doc { font-size: 11pt !important; line-height: 1.4 !important; }
          .cierre-table { font-size: 10pt !important; }
          .cierre-table td, .cierre-table th { padding: 4px 6px !important; }
          .cierre-table thead th { background: #f3f4f6 !important; color: #000 !important;
            border: 1px solid #999 !important; font-weight: 700 !important; }
          .cierre-table tbody td { border: 1px solid #d1d5db !important; }
          .cierre-table tr { page-break-inside: avoid; }
          .cierre-table thead { display: table-header-group; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-gray-900 text-sm">Reporte de Cierre de Caja</h1>
            <p className="text-[11px] text-gray-500">
              Sesión {sesionId.slice(0, 8).toUpperCase()} · Cajero: {(sesion.profiles as any)?.full_name ?? '—'}
            </p>
          </div>
          <CierreActions sesionId={sesionId} />
        </div>
      </div>

      <div className="cierre-doc max-w-5xl mx-auto px-6 py-8 print:px-0 print:py-0 print:max-w-full">
        {/* Cabecera */}
        <div className="text-center mb-4">
          <h2 className="text-[16pt] font-bold tracking-wide">{EMPRESA.razon_social}</h2>
          <div style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 18, color: '#1f2937', lineHeight: 1, marginTop: 2 }}>
            {EMPRESA.slogan}
          </div>
          <div className="text-[9pt] text-gray-600 mt-1">
            RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}
          </div>
          <div className="text-[9pt] text-gray-600">
            Tel. {EMPRESA.telefono} · {EMPRESA.correo}
          </div>
          <h3 className="text-[12pt] font-semibold mt-3 border-t border-gray-300 pt-2">REPORTE DE CIERRE DE CAJA</h3>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-[10pt] border border-gray-300 rounded p-3">
          <div>
            <div><strong>Cajero:</strong> {(sesion.profiles as any)?.full_name ?? '—'}</div>
            <div><strong>Apertura:</strong> {fmtFecha(apertura)}</div>
            <div><strong>Cierre:</strong> {fmtFecha(cierre)}</div>
            {/* De qué día es la plata, que no siempre es el día en que se
                abrió la caja: si un día nadie la abre, la siguiente sesion
                liquida lo que quedó pendiente. Sin esto, el cierre del sabado
                hecho el domingo se leia como si fuera del domingo. */}
            {diasDelDinero && (
              <div className="col-span-2">
                <strong>Movimientos de:</strong> {diasDelDinero}
              </div>
            )}
          </div>
          <div className="text-right">
            <div><strong>Estado:</strong> <span className="uppercase">{sesion.estado}</span></div>
            <div><strong>Saldo inicial:</strong> <span className="font-mono">{formatCurrency(saldoInicial)}</span></div>
            {saldoFinal !== null && (
              <div><strong>Saldo declarado:</strong> <span className="font-mono">{formatCurrency(saldoFinal)}</span></div>
            )}
          </div>
        </div>

        {/* Resumen por método de pago */}
        <h3 className="text-[11pt] font-bold mb-1 mt-4">Resumen de ingresos por método</h3>
        <table className="w-full cierre-table border-collapse mb-3 border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="text-left py-1 px-2 border border-gray-300">Método</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-32">Monto</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            <tr><td className="py-1 px-2 border border-gray-200">Efectivo</td><td className="py-1 px-2 border border-gray-200 text-right">{formatCurrency(totalEfectivo)}</td></tr>
            <tr><td className="py-1 px-2 border border-gray-200">Yape</td><td className="py-1 px-2 border border-gray-200 text-right">{formatCurrency(totalYape)}</td></tr>
            <tr><td className="py-1 px-2 border border-gray-200">Plin</td><td className="py-1 px-2 border border-gray-200 text-right">{formatCurrency(totalPlin)}</td></tr>
            <tr><td className="py-1 px-2 border border-gray-200">Transferencia</td><td className="py-1 px-2 border border-gray-200 text-right">{formatCurrency(totalTransfer)}</td></tr>
            <tr className="font-bold bg-gray-50">
              <td className="py-1 px-2 border border-gray-300">TOTAL INGRESOS</td>
              <td className="py-1 px-2 border border-gray-300 text-right">{formatCurrency(totalIngresos)}</td>
            </tr>
          </tbody>
        </table>

        {/* Detalle cronológico de cobros */}
        <h3 className="text-[11pt] font-bold mb-1 mt-4">Cobros recibidos ({cobros.length})</h3>
        <table className="w-full cierre-table border-collapse mb-3 border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="text-left py-1 px-2 border border-gray-300 w-16">Hora</th>
              <th className="text-left py-1 px-2 border border-gray-300 w-28">Recibo</th>
              <th className="text-left py-1 px-2 border border-gray-300">Cliente</th>
              <th className="text-left py-1 px-2 border border-gray-300 w-32">Cobrador</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-24">Total</th>
            </tr>
          </thead>
          <tbody>
            {cobros.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center italic text-gray-400 border border-gray-200">Sin cobros</td></tr>
            ) : cobros.map((c: any) => (
              <tr key={c.id}>
                <td className="py-1 px-2 border border-gray-200 font-mono text-[8pt]">{fmtHora(c.created_at)}</td>
                <td className="py-1 px-2 border border-gray-200 font-mono text-[8pt]">{c.numero ?? '—'}</td>
                <td className="py-1 px-2 border border-gray-200">
                  {(c.clientes as any)?.razon_social ?? c.cliente_externo_nombre ?? '—'}
                </td>
                <td className="py-1 px-2 border border-gray-200 text-[8pt]">{(c.profiles as any)?.full_name ?? '—'}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono">{formatCurrency(Number(c.total ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Egresos */}
        <h3 className="text-[11pt] font-bold mb-1 mt-4">Egresos ({egresos.length})</h3>
        <table className="w-full cierre-table border-collapse mb-3 border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="text-left py-1 px-2 border border-gray-300 w-16">Hora</th>
              <th className="text-left py-1 px-2 border border-gray-300 w-32">Categoría</th>
              <th className="text-left py-1 px-2 border border-gray-300">Descripción</th>
              <th className="text-left py-1 px-2 border border-gray-300 w-32">Registró</th>
              <th className="text-right py-1 px-2 border border-gray-300 w-24">Monto</th>
            </tr>
          </thead>
          <tbody>
            {egresos.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center italic text-gray-400 border border-gray-200">Sin egresos</td></tr>
            ) : egresos.map((m: any) => (
              <tr key={m.id}>
                <td className="py-1 px-2 border border-gray-200 font-mono text-[8pt]">{fmtHora(m.created_at)}</td>
                <td className="py-1 px-2 border border-gray-200">{CATEGORIA_LABELS[m.categoria] ?? m.categoria}</td>
                <td className="py-1 px-2 border border-gray-200">{m.descripcion}</td>
                <td className="py-1 px-2 border border-gray-200 text-[8pt]">{(m.profiles as any)?.full_name ?? '—'}</td>
                <td className="py-1 px-2 border border-gray-200 text-right font-mono text-red-700">{formatCurrency(Number(m.monto ?? 0))}</td>
              </tr>
            ))}
            <tr className="font-bold bg-gray-50">
              <td colSpan={4} className="py-1 px-2 border border-gray-300 text-right">TOTAL EGRESOS</td>
              <td className="py-1 px-2 border border-gray-300 text-right text-red-700">{formatCurrency(totalEgresos)}</td>
            </tr>
          </tbody>
        </table>

        {/* Arqueo final */}
        <div className="mt-6 border-2 border-black p-4 bg-yellow-50/40">
          <h3 className="text-[12pt] font-bold mb-2 text-center">ARQUEO FINAL</h3>
          <table className="w-full text-[10pt]">
            <tbody>
              <tr><td className="py-1">Saldo de apertura</td><td className="py-1 text-right font-mono">{formatCurrency(saldoInicial)}</td></tr>
              <tr><td className="py-1">(+) Total ingresos</td><td className="py-1 text-right font-mono text-green-700">{formatCurrency(totalIngresos)}</td></tr>
              <tr><td className="py-1">(−) Total egresos</td><td className="py-1 text-right font-mono text-red-700">{formatCurrency(totalEgresos)}</td></tr>
              <tr className="border-t border-gray-400">
                <td className="py-1 font-bold">Saldo teórico</td>
                <td className="py-1 text-right font-mono font-bold">{formatCurrency(saldoTeorico)}</td>
              </tr>
              {saldoFinal !== null && (
                <>
                  <tr>
                    <td className="py-1 font-bold">Saldo declarado por cajero</td>
                    <td className="py-1 text-right font-mono font-bold">{formatCurrency(saldoFinal)}</td>
                  </tr>
                  <tr className="border-t-2 border-black bg-white">
                    <td className="py-2 font-bold text-[11pt]">DIFERENCIA</td>
                    <td className={`py-2 text-right font-mono font-bold text-[11pt] ${diferencia === 0 ? 'text-green-700' : diferencia! > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                      {diferencia === 0 ? 'CUADRADO' : (diferencia! > 0 ? 'Sobrante ' : 'Faltante ') + formatCurrency(Math.abs(diferencia!))}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {sesion.notas && (
          <div className="mt-4 text-[9pt] italic text-gray-700 border-t border-gray-200 pt-2">
            <strong>Notas:</strong> {sesion.notas}
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-12 text-[9pt] text-center">
          <div className="border-t border-black pt-1">
            Firma Cajero
          </div>
          <div className="border-t border-black pt-1">
            Firma Supervisor
          </div>
        </div>

        <div className="text-center text-[8pt] text-gray-500 mt-6">
          Documento generado {fmtFecha(new Date())} · AGROCAR ERP
        </div>
      </div>
    </div>
  )
}
