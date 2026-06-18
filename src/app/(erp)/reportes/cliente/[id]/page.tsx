import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import ClienteReporteActions from './cliente-reporte-actions'

export const dynamic = 'force-dynamic'

async function getData(clienteId: string, desde: string, hasta: string) {
  const supabase = await createClient()

  const { data: cliente } = await (supabase as any)
    .from('clientes')
    .select('id, razon_social, ruc, dni, direccion, telefono, email, lista_precio_id')
    .eq('id', clienteId)
    .maybeSingle()

  if (!cliente) return null

  const [compRes, cobRes] = await Promise.all([
    (supabase as any).from('comprobantes')
      .select(`
        id, serie, numero, tipo, fecha_emision, subtotal, igv, total, estado, created_at,
        comprobantes_items(
          id, descripcion, cantidad, precio_unitario, subtotal,
          productos(id, codigo, nombre, familias(nombre))
        )
      `)
      .eq('cliente_id', clienteId)
      .gte('fecha_emision', desde)
      .lte('fecha_emision', hasta)
      .neq('estado', 'anulado')
      .order('fecha_emision', { ascending: false }),
    (supabase as any).from('cobros')
      .select('total, fecha')
      .eq('cliente_id', clienteId)
      .gte('fecha', desde)
      .lte('fecha', hasta),
  ])

  const comprobantes: any[] = compRes.data ?? []
  const cobros: any[] = cobRes.data ?? []

  const totalFacturado = comprobantes.reduce((a, c) => a + Number(c.total ?? 0), 0)
  const totalCobrado = cobros.reduce((a, c) => a + Number(c.total ?? 0), 0)

  // Top productos comprados (sumando todas las líneas)
  const productosMap = new Map<string, {
    codigo: string; nombre: string; familia: string;
    cantidad: number; monto: number; veces: number
  }>()
  comprobantes.forEach((c) => {
    ;(c.comprobantes_items ?? []).forEach((it: any) => {
      const key = it.productos?.id ?? it.descripcion ?? 'desconocido'
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
  const topProductos = Array.from(productosMap.values())
    .sort((a, b) => b.monto - a.monto)

  return { cliente, comprobantes, totalFacturado, totalCobrado, topProductos }
}

export default async function ClienteReportePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const hasta = sp.hasta ?? hoyLima()
  // Default: año completo (clientes con historial largo). Si quieren todo, ponen 2020-01-01.
  const desde = sp.desde ?? '2025-01-01'

  const data = await getData(id, desde, hasta)
  if (!data) return notFound()
  const { cliente, comprobantes, totalFacturado, totalCobrado, topProductos } = data
  const saldo = Math.max(0, totalFacturado - totalCobrado)

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
          .cliente-doc { font-size: 11pt !important; line-height: 1.4 !important; }
          .cliente-doc table { font-size: 10pt !important; }
          .cliente-doc th, .cliente-doc td { padding: 4px 6px !important; }
          .cliente-doc tr { page-break-inside: avoid; }
          .cliente-doc thead { display: table-header-group; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="max-w-6xl mx-auto p-4 print:p-0 print:max-w-full">
        {/* Acciones (no se imprimen) */}
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP · Reporte de cliente</p>
            <h1 className="text-xl font-bold">{cliente.razon_social}</h1>
            <p className="text-xs text-gray-300">
              {cliente.ruc ? `RUC ${cliente.ruc}` : cliente.dni ? `DNI ${cliente.dni}` : 'Sin documento'}
              {cliente.telefono ? ` · Tel ${cliente.telefono}` : ''}
            </p>
          </div>
          <ClienteReporteActions
            clienteId={id}
            clienteNombre={cliente.razon_social}
            clienteTelefono={cliente.telefono ?? null}
            desde={desde}
            hasta={hasta}
          />
        </div>

        {/* Cabecera para impresión */}
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
              <p className="text-sm font-bold">Estado de cuenta</p>
              <p className="text-xs">{cliente.razon_social}</p>
              <p className="text-[10px] text-gray-600">
                {cliente.ruc ? `RUC ${cliente.ruc}` : cliente.dni ? `DNI ${cliente.dni}` : ''}
              </p>
              <p className="text-[10px] text-gray-600">Del {formatDate(desde)} al {formatDate(hasta)}</p>
            </div>
          </div>
        </div>

        <div className="cliente-doc bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-4">
          {/* Resumen */}
          <div>
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Resumen</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500">Comprobantes</p>
                <p className="text-lg font-bold">{comprobantes.length}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500">Facturado</p>
                <p className="text-lg font-bold">{formatCurrency(totalFacturado)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500">Cobrado</p>
                <p className="text-lg font-bold text-green-700">{formatCurrency(totalCobrado)}</p>
              </div>
              <div className={`border rounded-lg p-3 ${saldo > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <p className="text-xs">{saldo > 0 ? 'Saldo pendiente' : 'Sin saldo'}</p>
                <p className={`text-lg font-bold ${saldo > 0 ? 'text-red-700' : 'text-green-700'}`}>
                  {formatCurrency(saldo)}
                </p>
              </div>
            </div>
          </div>

          {/* Comprobantes detallados */}
          <div>
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">
              Comprobantes ({comprobantes.length})
            </h2>
            {comprobantes.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Sin compras en el período.</p>
            ) : (
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-2">Fecha</th>
                    <th className="text-left p-2">Tipo</th>
                    <th className="text-left p-2">N°</th>
                    <th className="text-right p-2">Subtotal</th>
                    <th className="text-right p-2">IGV</th>
                    <th className="text-right p-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {comprobantes.map((c: any) => (
                    <tr key={c.id} className="border-b border-gray-100">
                      <td className="p-2 font-mono">{formatDate(c.fecha_emision)}</td>
                      <td className="p-2 capitalize text-gray-700">{c.tipo}</td>
                      <td className="p-2 font-mono">{c.serie}-{String(c.numero).padStart(8, '0')}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(Number(c.subtotal ?? 0))}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(Number(c.igv ?? 0))}</td>
                      <td className="p-2 text-right font-mono font-bold">{formatCurrency(Number(c.total ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                    <td colSpan={5} className="p-2 text-right">TOTAL FACTURADO</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(totalFacturado)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Top productos */}
          {topProductos.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">
                Productos comprados ({topProductos.length})
              </h2>
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-2">Código</th>
                    <th className="text-left p-2">Producto</th>
                    <th className="text-left p-2">Familia</th>
                    <th className="text-right p-2">Veces</th>
                    <th className="text-right p-2">Cantidad</th>
                    <th className="text-right p-2">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {topProductos.map((p, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="p-2 font-mono text-[10px]">{p.codigo}</td>
                      <td className="p-2 truncate max-w-[260px]">{p.nombre}</td>
                      <td className="p-2 text-gray-600 truncate max-w-[140px]">{p.familia}</td>
                      <td className="p-2 text-right">{p.veces}</td>
                      <td className="p-2 text-right font-mono">{p.cantidad.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono font-semibold">{formatCurrency(p.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
