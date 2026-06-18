import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import { diasVencidos, fechaVencimientoTexto } from '@/lib/cliente-saldo'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import CobranzasClienteActions from './cobranzas-cliente-actions'

export const dynamic = 'force-dynamic'

async function getData(clienteId: string) {
  const supabase = await createClient()

  const { data: cliente } = await (supabase as any)
    .from('clientes')
    .select(`
      id, razon_social, ruc, dni, direccion, telefono, email, credito_dias,
      profiles!clientes_vendedor_id_fkey(id, full_name)
    `)
    .eq('id', clienteId)
    .maybeSingle()
  if (!cliente) return null

  const [compRes, cobRes] = await Promise.all([
    (supabase as any).from('comprobantes')
      .select(`
        id, serie, numero, tipo, fecha_emision, total, estado, pedido_id,
        pedidos(numero)
      `)
      .eq('cliente_id', clienteId)
      .neq('estado', 'anulado')
      .order('fecha_emision', { ascending: true }),
    (supabase as any).from('cobros_aplicaciones')
      .select(`
        comprobante_id, monto_aplicado, es_a_cuenta,
        cobros!inner(id, numero, fecha, cliente_id)
      `)
      .eq('cobros.cliente_id', clienteId),
  ])

  const comprobantes: any[] = compRes.data ?? []
  const aplicaciones: any[] = cobRes.data ?? []

  // Calcular saldo por comprobante (total - aplicado)
  const aplicadoMap = new Map<string, number>()
  aplicaciones.forEach((a: any) => {
    if (!a.comprobante_id) return
    aplicadoMap.set(a.comprobante_id, (aplicadoMap.get(a.comprobante_id) ?? 0) + Number(a.monto_aplicado ?? 0))
  })

  type Detalle = {
    id: string; serie: string; numero: number; tipo: string;
    fecha_emision: string; total: number; abonado: number; saldo: number;
    dias_vencidos: number; vencimiento: string | null;
    pedido_numero: string;
  }
  const detalles: Detalle[] = comprobantes.map((c: any) => {
    const abonado = aplicadoMap.get(c.id) ?? 0
    const total = Number(c.total ?? 0)
    return {
      id: c.id, serie: c.serie, numero: c.numero, tipo: c.tipo,
      fecha_emision: c.fecha_emision,
      total, abonado,
      saldo: Math.max(0, total - abonado),
      dias_vencidos: diasVencidos(c.fecha_emision, cliente.credito_dias),
      vencimiento: fechaVencimientoTexto(c.fecha_emision, cliente.credito_dias),
      pedido_numero: c.pedidos?.numero ?? '—',
    }
  })

  const pendientes = detalles.filter((d) => d.saldo > 0.01)
  const totales = {
    facturado: detalles.reduce((a, d) => a + d.total, 0),
    abonado: detalles.reduce((a, d) => a + d.abonado, 0),
    saldo: detalles.reduce((a, d) => a + d.saldo, 0),
    vencido: pendientes.filter((d) => d.dias_vencidos > 0).reduce((a, d) => a + d.saldo, 0),
    por_vencer: pendientes.filter((d) => d.dias_vencidos <= 0).reduce((a, d) => a + d.saldo, 0),
  }

  return { cliente, detalles, pendientes, totales }
}

export default async function CobranzasClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getData(id)
  if (!data) return notFound()
  const { cliente, pendientes, totales } = data

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; color: #111 !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .ec-doc { font-size: 11pt !important; line-height: 1.4 !important; }
          .ec-doc table { font-size: 10pt !important; }
          .ec-doc th, .ec-doc td { padding: 4px 6px !important; }
          .ec-doc tr { page-break-inside: avoid; }
          .ec-doc thead { display: table-header-group; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="max-w-5xl mx-auto p-4 print:p-0 print:max-w-full">
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP · Estado de cuenta</p>
            <h1 className="text-xl font-bold">{cliente.razon_social}</h1>
            <p className="text-xs text-gray-300">
              {cliente.ruc ? `RUC ${cliente.ruc}` : cliente.dni ? `DNI ${cliente.dni}` : 'Sin documento'}
              {cliente.telefono ? ` · Tel ${cliente.telefono}` : ''}
              {cliente.profiles?.full_name ? ` · Vendedor: ${cliente.profiles.full_name}` : ''}
            </p>
          </div>
          <CobranzasClienteActions
            clienteId={id}
            clienteNombre={cliente.razon_social}
            clienteTelefono={cliente.telefono ?? null}
            saldo={totales.saldo}
          />
        </div>

        {/* Cabecera AGROCAR para impresión */}
        <div className="print-only mb-3">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-agrocar.png" alt="AGROCAR" style={{ height: 55 }} />
              <div>
                <p className="font-bold text-base">{EMPRESA.razon_social}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 15, lineHeight: 1 }}>{EMPRESA.slogan}</p>
                <p className="text-[10px] text-gray-700">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
                <p className="text-[10px] text-gray-700">Tel. {EMPRESA.telefono} · {EMPRESA.correo}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">Estado de Cuenta</p>
              <p className="text-xs">{cliente.razon_social}</p>
              <p className="text-[10px] text-gray-600">
                {cliente.ruc ? `RUC ${cliente.ruc}` : cliente.dni ? `DNI ${cliente.dni}` : ''}
              </p>
              <p className="text-[10px] text-gray-600">{new Date().toLocaleDateString('es-PE')}</p>
            </div>
          </div>
        </div>

        <div className="ec-doc bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-4">
          {/* Datos cliente */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-[10px] uppercase text-gray-500">Cliente</p>
              <p className="font-bold">{cliente.razon_social}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">Doc.</p>
              <p className="font-mono">{cliente.ruc ? `RUC ${cliente.ruc}` : cliente.dni ? `DNI ${cliente.dni}` : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">Crédito</p>
              <p className="font-semibold">{cliente.credito_dias ?? 0} días</p>
            </div>
            {cliente.direccion && (
              <div className="md:col-span-3">
                <p className="text-[10px] uppercase text-gray-500">Dirección</p>
                <p>{cliente.direccion}</p>
              </div>
            )}
          </div>

          {/* Resumen financiero */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700 font-semibold">FACTURADO</p>
              <p className="text-lg font-bold text-blue-900">{formatCurrency(totales.facturado)}</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-xs text-green-700 font-semibold">COBRADO</p>
              <p className="text-lg font-bold text-green-900">{formatCurrency(totales.abonado)}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700 font-semibold">POR VENCER</p>
              <p className="text-lg font-bold text-amber-900">{formatCurrency(totales.por_vencer)}</p>
            </div>
            <div className={`rounded-lg p-3 border ${totales.vencido > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-xs font-semibold ${totales.vencido > 0 ? 'text-red-700' : 'text-gray-700'}`}>VENCIDO</p>
              <p className={`text-lg font-bold ${totales.vencido > 0 ? 'text-red-900' : 'text-gray-900'}`}>
                {formatCurrency(totales.vencido)}
              </p>
            </div>
          </div>

          {/* Saldo total destacado */}
          <div className={`rounded-lg p-4 border-2 ${totales.saldo > 0 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'} flex items-center justify-between`}>
            <div>
              <p className={`text-xs font-bold uppercase ${totales.saldo > 0 ? 'text-red-700' : 'text-green-700'}`}>
                {totales.saldo > 0 ? 'Saldo pendiente' : '✓ Cuenta saldada'}
              </p>
              <p className={`text-[10px] mt-0.5 ${totales.saldo > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {pendientes.length > 0 ? `${pendientes.length} comprobante(s) sin saldar` : 'Sin pendientes'}
              </p>
            </div>
            <p className={`text-3xl font-bold ${totales.saldo > 0 ? 'text-red-700' : 'text-green-700'}`}>
              {formatCurrency(totales.saldo)}
            </p>
          </div>

          {/* Detalle de pendientes */}
          {pendientes.length > 0 ? (
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">
                Comprobantes pendientes ({pendientes.length})
              </h2>
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-2">Fecha emis.</th>
                    <th className="text-left p-2">Comprob.</th>
                    <th className="text-left p-2">Vence</th>
                    <th className="text-right p-2">Días</th>
                    <th className="text-right p-2">Total</th>
                    <th className="text-right p-2">Abonado</th>
                    <th className="text-right p-2 bg-red-50">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((d) => {
                    const esVencido = d.dias_vencidos > 0
                    return (
                      <tr key={d.id} className={`border-b border-gray-100 ${esVencido ? 'bg-red-50/40' : ''}`}>
                        <td className="p-2 font-mono">{formatDate(d.fecha_emision)}</td>
                        <td className="p-2 font-mono text-[10px]">
                          {d.serie}-{String(d.numero).padStart(8, '0')}
                          <div className="text-[9px] text-gray-500 capitalize">{d.tipo}</div>
                        </td>
                        <td className="p-2 font-mono text-[11px]">{d.vencimiento ?? '—'}</td>
                        <td className={`p-2 text-right font-mono font-semibold ${
                          esVencido ? 'text-red-700' : d.dias_vencidos > -7 ? 'text-amber-700' : 'text-gray-600'
                        }`}>
                          {d.dias_vencidos > 0 ? `+${d.dias_vencidos}` :
                            d.dias_vencidos === Number.NEGATIVE_INFINITY ? '—' :
                            d.dias_vencidos.toString()}
                        </td>
                        <td className="p-2 text-right font-mono">{formatCurrency(d.total)}</td>
                        <td className="p-2 text-right font-mono text-green-700">
                          {d.abonado > 0 ? `−${formatCurrency(d.abonado)}` : '—'}
                        </td>
                        <td className="p-2 text-right font-mono font-bold bg-red-50/60">
                          {formatCurrency(d.saldo)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                    <td colSpan={4} className="p-2 text-right">TOTALES PENDIENTES</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(pendientes.reduce((a, d) => a + d.total, 0))}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(pendientes.reduce((a, d) => a + d.abonado, 0))}</td>
                    <td className="p-2 text-right font-mono bg-[#FBE600]">{formatCurrency(totales.saldo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-green-700">
              <p className="text-2xl">✓</p>
              <p className="font-bold">¡Cuenta al día!</p>
              <p className="text-xs text-gray-500 mt-1">No tiene comprobantes pendientes de pago.</p>
            </div>
          )}

          {/* Leyenda */}
          {pendientes.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-[10px] text-gray-600">
              <strong>Leyenda Días:</strong> número positivo = días pasados desde el vencimiento (vencido) ·
              número negativo = días restantes hasta vencer ·
              fondo rosa = vencido.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
