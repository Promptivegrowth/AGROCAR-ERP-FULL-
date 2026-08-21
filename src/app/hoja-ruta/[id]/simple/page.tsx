import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import HojaRutaSimpleActions from './hoja-ruta-simple-actions'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

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
        id, numero, total, tipo_pago,
        clientes(razon_social, ruc, dni, tipo_comprobante_preferido),
        profiles!pedidos_vendedor_id_fkey(id, full_name, codigo),
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
      // Si el vendedor tiene código asignado, usarlo. Si no, fallback al ID corto.
      const vendedorCodigo = ped.profiles?.codigo
        ? ped.profiles.codigo
        : ped.profiles?.id ? ped.profiles.id.slice(-3).toUpperCase() : '—'
      // tipo_pago del pedido determina la condición.
      // Si no está definido (legacy), inferir por el cliente: si tiene RUC con
      // credito_dias > 0 → crédito, sino → contado.
      const condicion = ped.tipo_pago === 'contado' ? 'Contado'
        : ped.tipo_pago === 'credito' ? 'Crédito'
        : 'Contado'
      return {
        pedido_numero: ped.numero ?? '—',
        vendedor_codigo: vendedorCodigo,
        vendedor: ped.profiles?.full_name ?? '—',
        tipo_doc: tipoDoc,
        comprobante: cpe ? `${cpe.serie} ${cpe.numero}` : '—',
        cliente: ped.clientes?.razon_social ?? '—',
        ruc_dni: ped.clientes?.ruc ?? ped.clientes?.dni ?? '—',
        total: Number(ped.total ?? 0),
        condicion,
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

  // Las fechas se interpretan en timezone de Lima (UTC-5) — el servidor está en UTC.
  // Para fecha_despacho que viene como YYYY-MM-DD, agregamos T12:00:00 para evitar
  // que se desplace al día anterior al convertir a Date.
  const fechaDoc = new Date(despacho.fecha_despacho + 'T12:00:00').toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Lima',
  })
  const horaDoc = new Date(despacho.hoja_ruta_emitida_at ?? Date.now()).toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'America/Lima',
  })

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          /* IMPRESIÓN IDÉNTICA A LA PANTALLA — usar todo el ancho A4 sin
             reducir fuentes ni reflujo de columnas. La pantalla ya está
             optimizada con table-layout fixed y anchos proporcionales por
             colgroup, así que la impresión solo debe respetar ese diseño. */
          @page { size: A4 portrait; margin: 8mm; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          /* Mantener table-layout y proporciones tal cual están en pantalla */
          .simple-table { table-layout: fixed !important; width: 100% !important; }
          .simple-table td, .simple-table th { overflow: hidden; }
          /* El nombre del cliente NO se trunca: antes salía cortado con "..."
             y en una hoja de reparto el repartidor necesita leerlo completo.
             Si no entra en una línea, envuelve. */
          .simple-table .col-cliente { white-space: normal; word-break: break-word; }
          /* Estos NO deben partirse nunca en dos líneas: al hacerlo duplicaban
             el alto de cada fila y se desperdiciaba media hoja. */
          .simple-table .nowrap { white-space: nowrap !important; }
          tr { break-inside: avoid; }
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

      {/* Hoja imprimible — usa todo el ancho del A4 (igual que se ve en pantalla).
          La columna "Observación" al final tiene espacio para anotar a mano. */}
      <div className="max-w-5xl mx-auto print:mx-0 print:max-w-full bg-white p-6 print:p-0 shadow-sm my-3 print:my-0 print:shadow-none">
        {/* Encabezado mínimo. Daniel: "que me lo quite, AGROCAR a un costadito
            nada más… necesito lo más espacio posible para la mayor cantidad de
            clientes que entre en cada A4". Se van el slogan, la dirección y el
            teléfono: en una hoja de reparto interna no aportan. */}
        <div className="flex items-baseline justify-between pb-1 border-b-2 border-black">
          <span className="font-bold text-[10pt] whitespace-nowrap">{EMPRESA.razon_social}</span>
          <h1 className="text-[12pt] font-bold text-gray-900 underline">REPARTO/ENTREGA DE PEDIDOS</h1>
          <span className="text-[8pt] text-gray-600 whitespace-nowrap">
            {new Date(despacho.fecha_despacho).toLocaleDateString('es-PE')} · {horaDoc}
          </span>
        </div>

        {/* Metadatos */}
        <div className="flex items-center gap-4 py-1.5 text-[11px] text-gray-700 border-b border-gray-200">
          <span><strong>Vehículo:</strong> {v?.placa ?? '—'} {v?.descripcion ? `· ${v.descripcion}` : ''}</span>
          <span><strong>Despacho:</strong> <span className="font-mono">{despacho.numero}</span></span>
          <span><strong>Paradas:</strong> {despacho.total_pedidos}</span>
          <span className="ml-auto font-bold">Total: S/ {Number(despacho.total_monto ?? 0).toFixed(2)}</span>
        </div>

        {/* Tabla lista */}
        <table className="simple-table w-full mt-1 text-[9.5pt]" style={{ borderCollapse: 'collapse', lineHeight: 1.15, tableLayout: 'fixed' }}>
          {/* Anchos explícitos para que el navegador NO redistribuya según
              contenido. Total: 100% — distribuido para que "Cliente" tenga
              espacio suficiente para nombres peruanos largos (3-4 palabras). */}
          <colgroup>
            <col style={{ width: '9%' }} />{/* Pedido */}
            <col style={{ width: '5%' }} />{/* Cod.Vend */}
            <col style={{ width: '4%' }} />{/* T.D. */}
            {/* Comprob subió de 11% a 14%: con 11% "B001 00000358" se partía
                en dos líneas y duplicaba el alto de todas las filas */}
            <col style={{ width: '14%' }} />{/* Comprob */}
            {/* Cliente pasa de 30% a 41%. Daniel pidió "más espacio para los
                clientes": nombres como WALDIR JORDY SANTOS PALACIOS ESPINOZA o
                VICENTA HUARACHI LIMACHI DE CHURA se partían en dos líneas y
                cada corte duplica el alto de esa fila. El espacio sale de
                Observación, que estaba en 18% para anotar a mano y con 10%
                sigue alcanzando. */}
            <col style={{ width: '41%' }} />{/* Cliente */}
            {/* Total subió de 9% a 11%: el TOTAL GENERAL se partía en dos */}
            <col style={{ width: '11%' }} />{/* Total */}
            <col style={{ width: '6%' }} />{/* Condic */}
            <col style={{ width: '10%' }} />{/* Observación */}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-400">
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Pedido</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Vend.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">T.D.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Comprob.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Cliente</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Total</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Condic.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Observación</th>
            </tr>
          </thead>
          <tbody>
            {paradas.map((p: any, i: number) => (
              <tr key={i} className="border-b border-dotted border-gray-200" style={{ lineHeight: 1.1 }}>
                <td className="px-1 py-0 font-mono text-[8.5pt] text-gray-700">{p.pedido_numero}</td>
                <td className="px-1 py-0 font-mono text-[8.5pt] text-gray-700">{String(p.secuencia).padStart(3, '0')}</td>
                <td className="px-1 py-0 font-mono text-[8.5pt] text-gray-700">{p.tipo_doc}</td>
                <td className="nowrap px-1 py-0 font-mono text-[8.5pt] text-gray-700">{p.comprobante}</td>
                <td className="col-cliente px-1 py-0 text-[8.5pt] text-gray-900 uppercase">{p.cliente}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right font-semibold">{p.total.toFixed(2)}</td>
                <td className="px-1 py-0 text-[8.5pt] text-gray-700">{p.condicion}</td>
                <td className="px-1 py-0 text-[8.5pt] text-gray-600 border-b border-dotted border-gray-400"></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={5} className="px-1 py-1.5 text-[9pt] font-bold text-right">TOTAL GENERAL:</td>
              <td className="nowrap px-1 py-1.5 text-[10pt] font-bold text-right">S/ {totalGeneral.toFixed(2)}</td>
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
