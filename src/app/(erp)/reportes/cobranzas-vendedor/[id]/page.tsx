import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import { diasVencidos, fechaVencimientoTexto } from '@/lib/cliente-saldo'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import CobranzasVendedorActions from './cobranzas-vendedor-actions'

export const dynamic = 'force-dynamic'

interface DocPendiente {
  comp_id: string; serie: string; numero: number; tipo: string;
  fecha_emision: string; total: number; abonado: number; saldo: number;
  dv: number; vencimiento: string | null; pedido_numero: string;
}
interface ClienteRow {
  id: string; razon_social: string; ruc: string | null; dni: string | null;
  direccion: string | null; telefono: string | null; credito_dias: number;
  facturado: number; abonado: number; saldo: number; vencido: number;
  docs: DocPendiente[];
  max_dias_vencido: number;
}

async function getData(vendedorId: string) {
  const supabase = await createClient()

  const { data: vendedor } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', vendedorId).maybeSingle()
  if (!vendedor) return null

  const { data: clientes } = await (supabase as any)
    .from('clientes')
    .select('id, razon_social, ruc, dni, direccion, telefono, credito_dias')
    .eq('vendedor_id', vendedorId)
    .eq('estado', 'activo')
  const clienteIds = (clientes ?? []).map((c: any) => c.id)
  if (clienteIds.length === 0) return { vendedor, clientes: [] as ClienteRow[], totales: { facturado: 0, abonado: 0, saldo: 0, vencido: 0 } }

  const [compRes, aplRes] = await Promise.all([
    (supabase as any).from('comprobantes')
      .select('id, serie, numero, tipo, fecha_emision, total, estado, cliente_id, pedidos(numero)')
      .in('cliente_id', clienteIds)
      .neq('estado', 'anulado'),
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

  const clienteRows: ClienteRow[] = (clientes ?? []).map((cl: any) => {
    const comps = compPorCliente.get(cl.id) ?? []
    const docs: DocPendiente[] = comps.map((c: any) => {
      const abonado = aplicadoMap.get(c.id) ?? 0
      const total = Number(c.total ?? 0)
      return {
        comp_id: c.id, serie: c.serie, numero: c.numero, tipo: c.tipo,
        fecha_emision: c.fecha_emision, total, abonado,
        saldo: Math.max(0, total - abonado),
        dv: diasVencidos(c.fecha_emision, cl.credito_dias),
        vencimiento: fechaVencimientoTexto(c.fecha_emision, cl.credito_dias),
        pedido_numero: c.pedidos?.numero ?? '—',
      }
    }).filter((d) => d.saldo > 0.01)
    const facturado = comps.reduce((a: number, c: any) => a + Number(c.total ?? 0), 0)
    const abonado = docs.reduce((a, d) => a + d.abonado, 0) +
      comps.filter((c: any) => (aplicadoMap.get(c.id) ?? 0) >= Number(c.total))
           .reduce((a: number, c: any) => a + (aplicadoMap.get(c.id) ?? 0), 0)
    const saldo = docs.reduce((a, d) => a + d.saldo, 0)
    const vencido = docs.filter((d) => d.dv > 0).reduce((a, d) => a + d.saldo, 0)
    const max_dias_vencido = docs.length ? Math.max(...docs.map((d) => d.dv === Number.NEGATIVE_INFINITY ? -9999 : d.dv)) : 0
    return {
      id: cl.id, razon_social: cl.razon_social, ruc: cl.ruc, dni: cl.dni,
      direccion: cl.direccion, telefono: cl.telefono, credito_dias: cl.credito_dias ?? 0,
      facturado,
      abonado: Math.min(abonado, facturado),
      saldo, vencido, docs, max_dias_vencido,
    }
  }).filter((c: ClienteRow) => c.saldo > 0.01)
    .sort((a: ClienteRow, b: ClienteRow) => b.saldo - a.saldo)

  const totales = clienteRows.reduce((acc, c) => ({
    facturado: acc.facturado + c.facturado,
    abonado: acc.abonado + c.abonado,
    saldo: acc.saldo + c.saldo,
    vencido: acc.vencido + c.vencido,
  }), { facturado: 0, abonado: 0, saldo: 0, vencido: 0 })

  return { vendedor, clientes: clienteRows, totales }
}

export default async function CobranzasVendedorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getData(id)
  if (!data) return notFound()
  const { vendedor, clientes, totales } = data

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
          .cv-doc { font-size: 10.5pt !important; line-height: 1.35 !important; }
          .cv-doc table { font-size: 9.5pt !important; }
          .cv-doc th, .cv-doc td { padding: 3px 5px !important; }
          .cv-doc tr { page-break-inside: avoid; }
          .cv-doc thead { display: table-header-group; }
          .cliente-block { page-break-inside: avoid; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="max-w-6xl mx-auto p-4 print:p-0 print:max-w-full">
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP · Cobranzas a cargo</p>
            <h1 className="text-xl font-bold">{vendedor.full_name}</h1>
            <p className="text-sm text-gray-300 capitalize">{vendedor.role}</p>
          </div>
          <CobranzasVendedorActions vendedorId={id} />
        </div>

        <div className="print-only mb-3">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-agrocar.png" alt="AGROCAR" style={{ height: 55 }} />
              <div>
                <p className="font-bold text-base">{EMPRESA.razon_social}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 15, lineHeight: 1 }}>{EMPRESA.slogan}</p>
                <p className="text-[10px] text-gray-700">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
                <p className="text-[10px] text-gray-700">Tel. {EMPRESA.telefono}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">Reporte de Cuentas por Cobrar</p>
              <p className="text-xs">Vendedor: {vendedor.full_name}</p>
              <p className="text-[10px] text-gray-600">{new Date().toLocaleDateString('es-PE')}</p>
            </div>
          </div>
        </div>

        <div className="cv-doc bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 font-semibold">CLIENTES CON DEUDA</p>
              <p className="text-lg font-bold">{clientes.length}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700 font-semibold">FACTURADO</p>
              <p className="text-lg font-bold text-blue-900">{formatCurrency(totales.facturado)}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700 font-semibold">VENCIDO</p>
              <p className="text-lg font-bold text-amber-900">{formatCurrency(totales.vencido)}</p>
            </div>
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
              <p className="text-xs text-red-700 font-bold">SALDO PENDIENTE</p>
              <p className="text-xl font-bold text-red-900">{formatCurrency(totales.saldo)}</p>
            </div>
          </div>

          {clientes.length === 0 ? (
            <p className="text-center py-8 text-green-700 font-semibold">
              ✓ Sin clientes con deuda. ¡Todo cobrado!
            </p>
          ) : (
            <>
              {/* Detalle por cliente */}
              {clientes.map((c) => (
                <div key={c.id} className="cliente-block border border-gray-300 rounded-lg overflow-hidden">
                  {/* Cabecera cliente */}
                  <div className="bg-gray-100 border-b border-gray-300 p-2 flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="text-sm">{c.razon_social}</strong>
                        <span className="text-[10px] font-mono text-gray-600">
                          {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : ''}
                        </span>
                        {c.max_dias_vencido > 30 && (
                          <span className="text-[10px] bg-red-200 text-red-900 px-1.5 py-0.5 rounded font-bold">
                            🚨 +{c.max_dias_vencido}d vencido
                          </span>
                        )}
                        {c.max_dias_vencido > 0 && c.max_dias_vencido <= 30 && (
                          <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold">
                            ⚠ {c.max_dias_vencido}d vencido
                          </span>
                        )}
                      </div>
                      {c.direccion && <p className="text-[11px] text-gray-600 truncate">{c.direccion}</p>}
                      {c.telefono && <p className="text-[11px] text-gray-600 font-mono">📞 {c.telefono}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-gray-500 uppercase">Saldo</p>
                      <p className="text-lg font-bold text-red-700">{formatCurrency(c.saldo)}</p>
                      {c.vencido > 0 && (
                        <p className="text-[10px] text-red-600">Vencido: {formatCurrency(c.vencido)}</p>
                      )}
                    </div>
                  </div>

                  {/* Tabla de documentos */}
                  <table className="w-full text-xs">
                    <thead className="bg-white border-b border-gray-300">
                      <tr>
                        <th className="text-left p-2">Fecha</th>
                        <th className="text-left p-2">Pedido</th>
                        <th className="text-left p-2">Comp.</th>
                        <th className="text-left p-2">Vence</th>
                        <th className="text-right p-2">Días</th>
                        <th className="text-right p-2">Total</th>
                        <th className="text-right p-2">Abonado</th>
                        <th className="text-right p-2 bg-red-50/60">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.docs.map((d) => (
                        <tr key={d.comp_id} className={`border-b border-gray-100 last:border-0 ${d.dv > 0 ? 'bg-red-50/30' : ''}`}>
                          <td className="p-2 font-mono">{formatDate(d.fecha_emision)}</td>
                          <td className="p-2 font-mono text-[10px]">{d.pedido_numero}</td>
                          <td className="p-2 font-mono text-[10px]">
                            <span className="capitalize text-[9px] text-gray-500">{d.tipo} </span>
                            {d.serie}-{String(d.numero).padStart(8, '0')}
                          </td>
                          <td className="p-2 font-mono text-[11px]">{d.vencimiento ?? '—'}</td>
                          <td className={`p-2 text-right font-mono font-semibold ${
                            d.dv > 30 ? 'text-red-800' : d.dv > 0 ? 'text-red-600' : d.dv > -7 ? 'text-amber-600' : 'text-gray-500'
                          }`}>
                            {d.dv > 0 ? `+${d.dv}` :
                              d.dv === Number.NEGATIVE_INFINITY ? '—' : d.dv}
                          </td>
                          <td className="p-2 text-right font-mono">{formatCurrency(d.total)}</td>
                          <td className="p-2 text-right font-mono text-green-700">
                            {d.abonado > 0 ? `−${formatCurrency(d.abonado)}` : '—'}
                          </td>
                          <td className="p-2 text-right font-mono font-bold bg-red-50/40">
                            {formatCurrency(d.saldo)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                        <td colSpan={5} className="p-2 text-right">Total del cliente:</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(c.docs.reduce((a, d) => a + d.total, 0))}</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(c.docs.reduce((a, d) => a + d.abonado, 0))}</td>
                        <td className="p-2 text-right font-mono bg-[#FBE600]">{formatCurrency(c.saldo)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}

              {/* Total general */}
              <div className="bg-black text-white rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-400">Total general de cobranzas</p>
                  <p className="text-[11px] text-gray-300">{clientes.length} clientes · {clientes.reduce((a, c) => a + c.docs.length, 0)} documentos</p>
                </div>
                <p className="text-2xl font-bold text-[#FBE600]">{formatCurrency(totales.saldo)}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
