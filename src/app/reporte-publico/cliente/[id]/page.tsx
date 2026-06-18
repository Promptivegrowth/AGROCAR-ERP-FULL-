import { createAdminClient } from '@/lib/supabase/admin'
import { formatCurrency, formatDate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import PrintButton from '@/app/boleta/[id]/print-button'

export const dynamic = 'force-dynamic'

/**
 * Reporte público del cliente — accesible por link, sin login.
 *
 * Daniel quería poder enviar el reporte por WhatsApp. Esta ruta no requiere
 * autenticación (es el mismo patrón que /boleta/[id]). Usa el admin client
 * para leer datos del cliente y comprobantes filtrados por su ID.
 *
 * Seguridad: el ID es UUID — no se puede enumerar fácilmente. Cualquiera con
 * el link puede ver. Si en el futuro queremos restringir, agregar un token.
 */
export default async function ReportePublicoCliente({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const supabase = createAdminClient()
  const hasta = sp.hasta ?? hoyLima()
  const desde = sp.desde ?? '2025-01-01'

  const { data: cliente } = await (supabase as any)
    .from('clientes')
    .select('id, razon_social, ruc, dni, direccion, telefono')
    .eq('id', id).maybeSingle()
  if (!cliente) return notFound()

  const [compRes, cobRes] = await Promise.all([
    (supabase as any).from('comprobantes')
      .select(`
        id, serie, numero, tipo, fecha_emision, subtotal, igv, total,
        comprobantes_items(cantidad, precio_unitario, subtotal, descripcion,
          productos(codigo, nombre))
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
  const saldo = Math.max(0, totalFact - totalCob)

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
            <p className="text-sm font-bold">Reporte de compras</p>
            <p className="text-xs text-gray-600">Del {formatDate(desde)}</p>
            <p className="text-xs text-gray-600">al {formatDate(hasta)}</p>
          </div>
        </div>

        {/* Datos del cliente */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Cliente</p>
          <p className="font-bold text-base text-gray-900">{cliente.razon_social}</p>
          <p className="text-xs text-gray-600 font-mono">
            {cliente.ruc ? `RUC ${cliente.ruc}` : cliente.dni ? `DNI ${cliente.dni}` : 'Sin documento'}
            {cliente.telefono ? ` · Tel ${cliente.telefono}` : ''}
          </p>
          {cliente.direccion && <p className="text-xs text-gray-600">{cliente.direccion}</p>}
        </div>

        {/* Resumen */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
            <p className="text-[10px] text-blue-700 font-semibold">FACTURADO</p>
            <p className="text-lg font-bold text-blue-900">{formatCurrency(totalFact)}</p>
            <p className="text-[10px] text-blue-700">{comprobantes.length} comprobantes</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
            <p className="text-[10px] text-green-700 font-semibold">COBRADO</p>
            <p className="text-lg font-bold text-green-900">{formatCurrency(totalCob)}</p>
            <p className="text-[10px] text-green-700">{cobros.length} pagos</p>
          </div>
          <div className={`rounded-lg p-3 text-center border ${
            saldo > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
          }`}>
            <p className={`text-[10px] font-semibold ${saldo > 0 ? 'text-red-700' : 'text-gray-700'}`}>
              {saldo > 0 ? 'SALDO PENDIENTE' : 'SALDO'}
            </p>
            <p className={`text-lg font-bold ${saldo > 0 ? 'text-red-900' : 'text-gray-900'}`}>
              {formatCurrency(saldo)}
            </p>
            {saldo <= 0 && <p className="text-[10px] text-gray-700">✓ Al día</p>}
          </div>
        </div>

        {/* Tabla de comprobantes */}
        {comprobantes.length > 0 ? (
          <div>
            <p className="text-xs font-bold text-gray-700 uppercase mb-2">
              Compras del período
            </p>
            <table className="w-full text-xs border border-gray-200">
              <thead className="bg-gray-100">
                <tr className="border-b border-gray-300">
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-left p-2">Documento</th>
                  <th className="text-right p-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {comprobantes.map((c: any) => (
                  <tr key={c.id} className="border-b border-gray-100">
                    <td className="p-2 font-mono">{formatDate(c.fecha_emision)}</td>
                    <td className="p-2">
                      <span className="capitalize">{c.tipo}</span>{' '}
                      <span className="font-mono text-gray-600">
                        {c.serie}-{String(c.numero).padStart(8, '0')}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono font-semibold">
                      {formatCurrency(Number(c.total ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-yellow-50 font-bold border-t-2 border-black">
                  <td colSpan={2} className="p-2 text-right">TOTAL</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(totalFact)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-center text-gray-500 py-8 text-sm">
            No se encontraron compras en el período seleccionado.
          </p>
        )}

        {/* Footer */}
        <div className="mt-6 pt-3 border-t border-gray-200 text-center text-[10px] text-gray-500">
          <p>Gracias por su confianza · {EMPRESA.razon_social}</p>
          <p className="mt-1">Documento informativo — no tiene valor tributario.</p>
        </div>

        {/* Botón imprimir (no se ve al imprimir) */}
        <div className="no-print mt-4 text-center">
          <PrintButton />
        </div>
      </div>
    </div>
  )
}
