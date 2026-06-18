import { createAdminClient } from '@/lib/supabase/admin'
import { formatCurrency, formatDate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import { diasVencidos, fechaVencimientoTexto } from '@/lib/cliente-saldo'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import PrintButton from '@/app/boleta/[id]/print-button'

export const dynamic = 'force-dynamic'

/**
 * Estado de cuenta público — accesible por link, sin login.
 * Se envía al cliente por WhatsApp para que vea su saldo y pendientes.
 */
export default async function EstadoCuentaPublico({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: cliente } = await (supabase as any)
    .from('clientes')
    .select('id, razon_social, ruc, dni, direccion, telefono, credito_dias')
    .eq('id', id).maybeSingle()
  if (!cliente) return notFound()

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

  const pendientes = (compRes.data ?? []).map((c: any) => {
    const abonado = aplicadoMap.get(c.id) ?? 0
    return {
      ...c, abonado,
      saldo: Math.max(0, Number(c.total) - abonado),
      dv: diasVencidos(c.fecha_emision, cliente.credito_dias),
      vencimiento: fechaVencimientoTexto(c.fecha_emision, cliente.credito_dias),
    }
  }).filter((d: any) => d.saldo > 0.01)

  const saldoTotal = pendientes.reduce((a: number, d: any) => a + d.saldo, 0)
  const vencido = pendientes.filter((d: any) => d.dv > 0).reduce((a: number, d: any) => a + d.saldo, 0)

  return (
    <div className="min-h-dvh bg-gray-50 py-6 px-3 print:bg-white print:py-0 print:px-0">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto bg-white shadow-lg rounded-xl p-6 print:shadow-none print:rounded-none print:p-0">
        {/* Header AGROCAR */}
        <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-agrocar.png" alt="AGROCAR" style={{ height: 60 }} />
            <div>
              <p className="font-bold text-lg">{EMPRESA.razon_social}</p>
              <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 17, lineHeight: 1 }}>{EMPRESA.slogan}</p>
              <p className="text-xs text-gray-600 mt-1">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
              <p className="text-xs text-gray-600">Tel. {EMPRESA.telefono} · {EMPRESA.correo}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold">Estado de Cuenta</p>
            <p className="text-[10px] text-gray-600">{new Date().toLocaleDateString('es-PE')}</p>
          </div>
        </div>

        {/* Datos cliente */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Cliente</p>
          <p className="font-bold text-base text-gray-900">{cliente.razon_social}</p>
          <p className="text-xs text-gray-600 font-mono">
            {cliente.ruc ? `RUC ${cliente.ruc}` : cliente.dni ? `DNI ${cliente.dni}` : 'Sin documento'}
            {cliente.telefono ? ` · Tel ${cliente.telefono}` : ''}
          </p>
          {cliente.direccion && <p className="text-xs text-gray-600">{cliente.direccion}</p>}
          <p className="text-[11px] text-gray-700 mt-1">
            <strong>Crédito autorizado:</strong> {cliente.credito_dias ?? 0} días
          </p>
        </div>

        {/* Saldo total destacado */}
        <div className={`rounded-lg p-4 mb-4 border-2 ${saldoTotal > 0 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'} text-center`}>
          <p className={`text-xs font-bold uppercase ${saldoTotal > 0 ? 'text-red-700' : 'text-green-700'}`}>
            {saldoTotal > 0 ? 'Saldo Pendiente' : '✓ Cuenta al día'}
          </p>
          <p className={`text-3xl font-bold mt-1 ${saldoTotal > 0 ? 'text-red-700' : 'text-green-700'}`}>
            {formatCurrency(saldoTotal)}
          </p>
          {vencido > 0 && (
            <p className="text-xs text-red-700 mt-1">
              De los cuales <strong>{formatCurrency(vencido)}</strong> están vencidos
            </p>
          )}
        </div>

        {/* Tabla pendientes */}
        {pendientes.length > 0 ? (
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase mb-2">
              Comprobantes pendientes ({pendientes.length})
            </p>
            <table className="w-full text-xs border border-gray-200">
              <thead className="bg-gray-100">
                <tr className="border-b border-gray-300">
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-left p-2">Documento</th>
                  <th className="text-left p-2">Vence</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-right p-2">Abonado</th>
                  <th className="text-right p-2 bg-red-50">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((d: any) => (
                  <tr key={d.id} className={`border-b border-gray-100 ${d.dv > 0 ? 'bg-red-50/40' : ''}`}>
                    <td className="p-2 font-mono">{formatDate(d.fecha_emision)}</td>
                    <td className="p-2 font-mono text-[10px]">
                      <span className="capitalize">{d.tipo}</span> {d.serie}-{String(d.numero).padStart(8, '0')}
                    </td>
                    <td className="p-2 font-mono text-[11px]">
                      {d.vencimiento ?? '—'}
                      {d.dv > 0 && <span className="text-red-600 font-bold ml-1">(+{d.dv}d)</span>}
                    </td>
                    <td className="p-2 text-right font-mono">{formatCurrency(d.total)}</td>
                    <td className="p-2 text-right font-mono text-green-700">
                      {d.abonado > 0 ? `−${formatCurrency(d.abonado)}` : '—'}
                    </td>
                    <td className="p-2 text-right font-mono font-bold bg-red-50/60">
                      {formatCurrency(d.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-yellow-50 font-bold border-t-2 border-black">
                  <td colSpan={5} className="p-2 text-right">TOTAL POR PAGAR</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(saldoTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-center text-green-700 py-8 text-sm font-semibold">
            ¡Cuenta al día! No tienes comprobantes pendientes.
          </p>
        )}

        {/* Footer */}
        <div className="mt-6 pt-3 border-t border-gray-200 text-center text-[10px] text-gray-500">
          <p>Para coordinar el pago contáctanos al Tel. {EMPRESA.telefono} o {EMPRESA.correo}.</p>
          <p className="mt-1">Documento informativo — no tiene valor tributario.</p>
        </div>

        <div className="no-print mt-4 text-center">
          <PrintButton />
        </div>
      </div>
    </div>
  )
}
