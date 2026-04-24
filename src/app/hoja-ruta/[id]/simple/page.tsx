import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import HojaRutaSimpleActions from './hoja-ruta-simple-actions'

export const dynamic = 'force-dynamic'

async function getData(id: string) {
  const supabase = await createClient()

  const { data: despacho } = await (supabase as any)
    .from('despachos')
    .select(`
      id, numero, fecha_despacho, estado, total_pedidos, total_monto, peso_total_kg,
      orden_entrega, hoja_ruta_emitida_at,
      vehiculos(placa, descripcion)
    `)
    .eq('id', id)
    .maybeSingle()
  if (!despacho) return null

  const { data: items } = await (supabase as any)
    .from('despachos_items')
    .select(`
      id, pedido_id, estado,
      pedidos(
        id, numero, total,
        clientes(razon_social, ruc, dni, tipo_comprobante_preferido),
        profiles!pedidos_vendedor_id_fkey(id, full_name),
        comprobantes(serie, numero, tipo)
      )
    `)
    .eq('despacho_id', id)

  const ordenMap = new Map<string, number>()
  ;(despacho.orden_entrega ?? []).forEach((o: any) => ordenMap.set(o.pedido_id, o.secuencia))

  const paradas = (items ?? [])
    .map((it: any) => {
      const ped = it.pedidos ?? {}
      const cpe = (ped.comprobantes ?? [])[0]
      const tipoDoc = cpe?.tipo === 'factura' ? '01' : cpe?.tipo === 'boleta' ? '03' : cpe?.tipo === 'nota_pedido_interna' ? '00' : '—'
      const vendedorCodigo = ped.profiles?.id ? ped.profiles.id.slice(-3).toUpperCase() : '—'
      return {
        pedido_numero: ped.numero ?? '—',
        vendedor_codigo: vendedorCodigo,
        vendedor: ped.profiles?.full_name ?? '—',
        tipo_doc: tipoDoc,
        comprobante: cpe ? `${cpe.serie} ${cpe.numero}` : '—',
        cliente: ped.clientes?.razon_social ?? '—',
        ruc_dni: ped.clientes?.ruc ?? ped.clientes?.dni ?? '—',
        total: Number(ped.total ?? 0),
        condicion: 'Crédito',
        observacion: '',
        secuencia: ordenMap.get(it.pedido_id) ?? 999,
      }
    })
    .sort((a: any, b: any) => a.secuencia - b.secuencia)

  return { despacho, paradas }
}

export default async function HojaRutaSimplePage({ params }: { params: { id: string } }) {
  const data = await getData(params.id)
  if (!data) return notFound()

  const { despacho, paradas } = data
  const v = despacho.vehiculos as any
  const totalGeneral = paradas.reduce((a: number, p: any) => a + p.total, 0)

  const fechaDoc = new Date(despacho.fecha_despacho).toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const horaDoc = new Date(despacho.hoja_ruta_emitida_at ?? Date.now()).toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .simple-table { font-size: 9pt !important; }
          .simple-table td, .simple-table th { padding: 1px 4px !important; }
        }
      `}</style>

      {/* Acciones (no se imprimen) */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-gray-900 text-sm">Hoja de Ruta Simple · {despacho.numero}</h1>
            <p className="text-[11px] text-gray-500">Vista compacta para impresión económica</p>
          </div>
          <HojaRutaSimpleActions despachoId={params.id} />
        </div>
      </div>

      {/* Hoja imprimible */}
      <div className="max-w-5xl mx-auto bg-white p-6 print:p-0 shadow-sm my-3 print:my-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between pb-2 border-b-2 border-black">
          <div>
            <p className="text-[10px] text-gray-500">Desde: {new Date(despacho.fecha_despacho).toLocaleDateString('es-PE')} hasta: {new Date(despacho.fecha_despacho).toLocaleDateString('es-PE')}</p>
            <p className="text-[10px] text-gray-500">Todos</p>
          </div>
          <div className="text-center flex-1">
            <h1 className="text-base font-bold text-gray-900 underline">REPARTO/ENTREGA DE PEDIDOS</h1>
          </div>
          <div className="text-right text-[10px] text-gray-600">
            <p>{fechaDoc}</p>
            <p className="font-mono">{horaDoc}</p>
          </div>
        </div>

        {/* Metadatos */}
        <div className="flex items-center gap-4 py-1.5 text-[11px] text-gray-700 border-b border-gray-200">
          <span><strong>Vehículo:</strong> {v?.placa ?? '—'} {v?.descripcion ? `· ${v.descripcion}` : ''}</span>
          <span><strong>Despacho:</strong> <span className="font-mono">{despacho.numero}</span></span>
          <span><strong>Paradas:</strong> {despacho.total_pedidos}</span>
          <span className="ml-auto font-bold">Total: S/ {Number(despacho.total_monto ?? 0).toFixed(2)}</span>
        </div>

        {/* Tabla lista */}
        <table className="simple-table w-full mt-2 text-[10.5pt]">
          <thead>
            <tr className="border-b border-gray-400">
              <th className="text-left px-1 py-1 text-[8pt] font-bold text-gray-700">Pedido</th>
              <th className="text-left px-1 py-1 text-[8pt] font-bold text-gray-700">Cod.Vend.</th>
              <th className="text-left px-1 py-1 text-[8pt] font-bold text-gray-700">T.D.</th>
              <th className="text-left px-1 py-1 text-[8pt] font-bold text-gray-700">Comprob.</th>
              <th className="text-left px-1 py-1 text-[8pt] font-bold text-gray-700">Cliente</th>
              <th className="text-right px-1 py-1 text-[8pt] font-bold text-gray-700">Total</th>
              <th className="text-left px-1 py-1 text-[8pt] font-bold text-gray-700">Condic.</th>
              <th className="text-left px-1 py-1 text-[8pt] font-bold text-gray-700">Observación</th>
            </tr>
          </thead>
          <tbody>
            {paradas.map((p: any, i: number) => (
              <tr key={i} className="border-b border-dotted border-gray-200">
                <td className="px-1 py-0.5 font-mono text-[9pt] text-gray-700">{p.pedido_numero}</td>
                <td className="px-1 py-0.5 font-mono text-[9pt] text-gray-700">{String(p.secuencia).padStart(3, '0')}</td>
                <td className="px-1 py-0.5 font-mono text-[9pt] text-gray-700">{p.tipo_doc}</td>
                <td className="px-1 py-0.5 font-mono text-[9pt] text-gray-700">{p.comprobante}</td>
                <td className="px-1 py-0.5 text-[9pt] text-gray-900 uppercase">{p.cliente}</td>
                <td className="px-1 py-0.5 text-[9pt] text-right font-semibold">{p.total.toFixed(2)}</td>
                <td className="px-1 py-0.5 text-[9pt] text-gray-700">{p.condicion}</td>
                <td className="px-1 py-0.5 text-[9pt] text-gray-600 border-b border-dotted border-gray-400 min-w-[120px]"></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={5} className="px-1 py-1.5 text-[9pt] font-bold text-right">TOTAL GENERAL:</td>
              <td className="px-1 py-1.5 text-[10pt] font-bold text-right">S/ {totalGeneral.toFixed(2)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>

        <div className="flex justify-between mt-6 pt-4 border-t border-gray-300">
          <div className="text-center">
            <div className="border-t border-black pt-1 px-10">
              <p className="text-[9pt]">Firma del Chofer</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-1 px-10">
              <p className="text-[9pt]">Firma del Repartidor</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-1 px-10">
              <p className="text-[9pt]">Recibí conforme</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
