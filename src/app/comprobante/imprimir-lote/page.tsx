import { Fragment } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { numeroALetras } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import AutoPrint from './auto-print'

export const dynamic = 'force-dynamic'

const TIPO_TITULO: Record<string, string> = {
  boleta: 'BOLETA DE VENTA ELECTRONICA',
  factura: 'FACTURA ELECTRONICA',
  nota_pedido_interna: 'DOCUMENTO INTERNO',
  nota_credito: 'NOTA DE CREDITO ELECTRONICA',
}

function pad(n: string | number, len: number) {
  return String(n).padStart(len, '0')
}

function fmtNum(n: number) {
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function ImprimirLotePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; formato?: string }>
}) {
  const { ids, formato } = await searchParams
  const idsArr = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const esA4 = formato !== 'ticket' // por defecto A4 para impresión por rangos

  if (idsArr.length === 0) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-gray-500">
        <p>No se especificaron comprobantes para imprimir.</p>
      </div>
    )
  }

  const supabase = createAdminClient()

  // Batch query de comprobantes con cliente y facturador
  const { data: comprobantes } = await supabase
    .from('comprobantes')
    .select(`
      id, tipo, serie, numero, fecha_emision, fecha_despacho, subtotal, igv, total, moneda, estado, pedido_id, created_at,
      cliente_externo_nombre, cliente_externo_doc, editado, editado_at,
      clientes(id, razon_social, ruc, dni, direccion, telefono),
      profiles!comprobantes_facturador_id_fkey(full_name)
    `)
    .in('id', idsArr)

  // Batch query de items (todos los items de todos los comprobantes)
  const { data: itemsAll } = await supabase
    .from('comprobantes_items')
    .select('id, comprobante_id, descripcion, cantidad, precio_unitario, subtotal, igv_porcentaje, productos(codigo, nombre, descripcion)')
    .in('comprobante_id', idsArr)

  const itemsPorComp = new Map<string, any[]>()
  ;(itemsAll ?? []).forEach((it: any) => {
    if (!itemsPorComp.has(it.comprobante_id)) itemsPorComp.set(it.comprobante_id, [])
    itemsPorComp.get(it.comprobante_id)!.push(it)
  })

  // Vendedor y condición (contado/crédito) — mismos datos que el comprobante individual
  const pedidoIds = (comprobantes ?? [])
    .map((c: any) => c.pedido_id)
    .filter(Boolean) as string[]

  const vendedorPorPedido = new Map<string, string>()
  const cobradoPorPedido = new Map<string, number>()

  if (pedidoIds.length > 0) {
    const [{ data: pedidos }, { data: cobros }] = await Promise.all([
      supabase
        .from('pedidos')
        .select('id, profiles!pedidos_vendedor_id_fkey(full_name)')
        .in('id', pedidoIds),
      supabase.from('cobros').select('referencia_id, total').in('referencia_id', pedidoIds),
    ])
    ;(pedidos ?? []).forEach((p: any) => {
      if (p.profiles?.full_name) vendedorPorPedido.set(p.id, p.profiles.full_name)
    })
    ;(cobros ?? []).forEach((c: any) => {
      cobradoPorPedido.set(c.referencia_id, (cobradoPorPedido.get(c.referencia_id) ?? 0) + Number(c.total ?? 0))
    })
  }

  // Ordenar comprobantes por correlativo: primero por serie, luego por número
  // (pedido de Daniel: que salgan en orden correlativo, boletas y facturas)
  const lista = (comprobantes ?? []).sort((a: any, b: any) => {
    const s = String(a.serie).localeCompare(String(b.serie))
    if (s !== 0) return s
    return Number(a.numero) - Number(b.numero)
  })

  return (
    <div className="bg-gray-200 print:bg-white">
      <AutoPrint count={lista.length} esTicket={!esA4} />
      <style>{`
        @media print {
          /* En ticket, AutoPrint reemplaza este tamaño por 80mm × alto real:
             "80mm auto" no es CSS válido y hace que el navegador caiga a A4. */
          @page { size: ${esA4 ? 'A4' : '80mm 200mm'}; margin: ${esA4 ? '8mm' : '0'}; }
          body { margin: 0; }
          .no-print { display: none !important; }
          ${esA4 ? `
          /* A4: un comprobante por hoja */
          .pagebreak { page-break-after: always; break-after: page; }
          .pagebreak:last-child { page-break-after: auto; break-after: auto; }
          ` : `
          /* TICKET: cada comprobante es su PROPIA página.
             Con @page size: 80mm auto el rollo solo avanza lo que mide el
             ticket (no gasta papel), y el salto de página es justo lo que
             dispara la guillotina automática de la ticketera — así CADA
             ticket sale cortado, incluido el último del lote. */
          .pagebreak { page-break-after: always; break-after: page; }
          /* Sin esto el último ticket arrastra una hoja en blanco: con un solo
             comprobante el diálogo mostraba "2 páginas". */
          .pagebreak:last-child { page-break-after: auto; break-after: auto; }
          /* OJO: aquí NO va page-break-inside: avoid. Como cada ticket ya
             ocupa su propia página, esa regla es redundante y además dañina:
             si el contenido se pasa un milímetro del alto calculado, empuja el
             ticket completo a la hoja siguiente y deja la anterior en blanco.
             Medido con Chrome, eso duplicaba las páginas del lote. */
          /* FIDELIDAD pantalla = papel: ancho útil de 72mm, sin reescalado */
          .pagebreak {
            width: 72mm !important;
            max-width: 72mm !important;
            margin: 0 auto !important;
            padding: 2mm !important;
            box-shadow: none !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .pagebreak img { max-width: 100% !important; }
          `}
        }
      `}</style>

      {/* Barra superior solo visible en pantalla */}
      <div className="no-print sticky top-0 bg-white border-b border-gray-200 shadow-sm py-3 px-4 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">
              Impresión por lote — {lista.length} comprobante{lista.length === 1 ? '' : 's'}
            </h1>
            <p className="text-xs text-gray-500">
              Formato: {esA4 ? 'A4 SUNAT' : 'Ticket 80mm'} · El diálogo de impresión se abre automáticamente.
            </p>
          </div>
          <button
            type="button"
            onClick={undefined /* AutoPrint maneja esto */}
            className="px-4 py-2 text-sm font-semibold bg-[#FBE600] text-black rounded-md hover:bg-[#E5D100]"
            id="reprintBtn"
          >
            🖨️ Imprimir otra vez
          </button>
        </div>
      </div>

      {/* print:py-0 es imprescindible: ese relleno de 24 px (6.4 mm) también
          se aplica al imprimir, empuja el ticket hacia abajo y hace que no
          quepa en su propia página, partiéndolo en dos hojas. */}
      <div className="py-6 print:py-0">
        {lista.map((comp: any) => {
          const cliente: any = comp.clientes
          const facturador: any = comp.profiles
          const items = itemsPorComp.get(comp.id) ?? []
          const totalNum = Number(comp.total ?? 0)
          const subtotalNum = Number(comp.subtotal ?? 0)
          const igvNum = Number(comp.igv ?? 0)
          const titulo = TIPO_TITULO[comp.tipo as string] ?? 'COMPROBANTE'
          const correlativo = `${comp.serie}-${pad(comp.numero, 6)}`
          const externoNombre = comp.cliente_externo_nombre as string | null
          const externoDoc = comp.cliente_externo_doc as string | null
          const clienteNombre = cliente?.razon_social ?? externoNombre ?? '—'
          const clienteDireccion = cliente?.direccion ?? '—'
          const externoEsRuc = externoDoc && externoDoc.length === 11
          const externoEsDni = externoDoc && externoDoc.length === 8
          const docCliente = cliente?.ruc
            ? { label: 'RUC', valor: cliente.ruc }
            : cliente?.dni
              ? { label: 'DNI', valor: cliente.dni }
              : externoEsRuc
                ? { label: 'RUC', valor: externoDoc as string }
                : externoEsDni
                  ? { label: 'DNI', valor: externoDoc as string }
                  : { label: 'DOC', valor: externoDoc ?? '—' }
          const totalLetras = numeroALetras(totalNum)
          const monedaLabel = comp.moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES'
          const clienteTelefono = cliente?.telefono ?? null
          const vendedorNombre = comp.pedido_id ? (vendedorPorPedido.get(comp.pedido_id) ?? '—') : '—'
          const cobrado = comp.pedido_id ? (cobradoPorPedido.get(comp.pedido_id) ?? 0) : 0
          const condicion = cobrado >= totalNum && totalNum > 0 ? 'CONTADO' : 'CREDITO'
          const impreso = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })
          const fechaDespacho = (comp as any).fecha_despacho
            ? new Date((comp as any).fecha_despacho + 'T12:00:00-05:00').toLocaleDateString('es-PE', {
                day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
              })
            : null
          const fechaEmision = new Date(comp.fecha_emision + 'T12:00:00-05:00').toLocaleDateString('es-PE', {
            day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
          })
          const qrData = `AGROCAR|20519883296|${comp.tipo}|${correlativo}|${totalNum.toFixed(2)}|${comp.fecha_emision}|${docCliente.valor}`
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrData)}`

          return (
            <div
              key={comp.id}
              className="pagebreak mx-auto bg-white shadow-lg print:shadow-none mb-6 print:mb-0"
              style={{
                // El ticket se muestra en pantalla al MISMO ancho con el que
                // se imprime (72 mm, el área útil del rollo de 80 mm). Así lo
                // que se ve es exactamente lo que sale, y la medición del alto
                // para el tamaño de página es exacta: si midiéramos a otro
                // ancho el texto envolvería distinto y sobraría o faltaría papel.
                maxWidth: esA4 ? 800 : '72mm',
                width: esA4 ? undefined : '72mm',
                padding: esA4 ? 32 : '2mm',
                fontFamily: esA4 ? '"Helvetica Neue", Arial, sans-serif' : 'ui-monospace, "Courier New", monospace',
                fontSize: esA4 ? 11 : 10.5,
                lineHeight: esA4 ? undefined : 1.25,
                // Ticket: TODO en negrita — la térmica imprimía muy claro (pedido de Daniel)
                fontWeight: esA4 ? 'normal' : 'bold',
                color: '#000',
              }}
            >
              {esA4 ? (
                <>
                  {/* Encabezado A4 */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
                    <tbody>
                      <tr>
                        <td style={{ width: '40%', verticalAlign: 'top' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/logo-agrocar.png" alt="AGROCAR" style={{ maxWidth: 160 }} />
                          <div style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 16, color: '#1f2937', marginTop: 2, marginLeft: 4 }}>
                            {EMPRESA.slogan}
                          </div>
                          <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5 }}>
                            <div style={{ fontWeight: 'bold', fontSize: 14 }}>{EMPRESA.razon_social}</div>
                            <div>{EMPRESA.rubro}</div>
                            <div>{EMPRESA.direccion_comercial}</div>
                            <div style={{ fontSize: 10, color: '#6b7280' }}>{EMPRESA.direccion_fundo}</div>
                            <div>Tel. {EMPRESA.telefono} · {EMPRESA.correo}</div>
                          </div>
                        </td>
                        <td style={{ width: '60%', verticalAlign: 'top', textAlign: 'right' }}>
                          <div style={{ border: '2px solid #000', borderRadius: 4, padding: 12, display: 'inline-block', minWidth: 280, textAlign: 'center' }}>
                            <div style={{ fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>R.U.C. 20519883296</div>
                            <div style={{ fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6, lineHeight: 1.2 }}>{titulo}</div>
                            <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace' }}>{correlativo}</div>
                          </div>
                          {comp.editado && (
                            <div style={{ marginTop: 6, fontSize: 9, color: '#92400e', fontWeight: 'bold' }}>
                              ⚠ COMPROBANTE EDITADO
                            </div>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Cliente */}
                  <div style={{ border: '1px solid #999', borderRadius: 4, padding: 10, marginBottom: 12, background: '#fafafa' }}>
                    <table style={{ width: '100%', fontSize: 11 }}>
                      <tbody>
                        <tr>
                          <td style={{ padding: '2px 4px', fontWeight: 'bold', width: 120 }}>Señor(es):</td>
                          <td style={{ padding: '2px 4px' }}>{clienteNombre}</td>
                          <td style={{ padding: '2px 4px', fontWeight: 'bold', width: 100 }}>Fecha emisión:</td>
                          <td style={{ padding: '2px 4px' }}>{fechaEmision}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '2px 4px', fontWeight: 'bold' }}>{docCliente.label}:</td>
                          <td style={{ padding: '2px 4px' }}>{docCliente.valor}</td>
                          <td style={{ padding: '2px 4px', fontWeight: 'bold' }}>Moneda:</td>
                          <td style={{ padding: '2px 4px' }}>{monedaLabel}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '2px 4px', fontWeight: 'bold' }}>Dirección:</td>
                          <td style={{ padding: '2px 4px' }} colSpan={3}>{clienteDireccion}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Items */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, fontSize: 9.5, lineHeight: 1.2 }}>
                    <thead>
                      {/* Encabezado en NEGRO sobre blanco. Antes era blanco
                          sobre fondo negro y, como el navegador no imprime
                          fondos por defecto, el texto quedaba casi invisible. */}
                      <tr style={{ color: '#000', fontWeight: 'bold' }}>
                        <th style={{ padding: '3px 4px', textAlign: 'center', border: '1.5px solid #000', width: 45 }}>CANT.</th>
                        <th style={{ padding: '3px 4px', textAlign: 'center', border: '1.5px solid #000', width: 70 }}>CÓDIGO</th>
                        <th style={{ padding: '3px 4px', textAlign: 'left', border: '1.5px solid #000' }}>DESCRIPCIÓN</th>
                        <th style={{ padding: '3px 4px', textAlign: 'right', border: '1.5px solid #000', width: 80 }}>P. UNIT.</th>
                        <th style={{ padding: '3px 4px', textAlign: 'right', border: '1.5px solid #000', width: 90 }}>IMPORTE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#b91c1c', fontStyle: 'italic' }}>
                          ⚠ Sin detalle de items
                        </td></tr>
                      ) : items.map((it: any) => {
                        const prod = it.productos
                        const cant = Number(it.cantidad ?? 0)
                        const pu = Number(it.precio_unitario ?? 0)
                        const sub = Number(it.subtotal ?? cant * pu)
                        return (
                          <tr key={it.id} style={{ color: '#000' }}>
                            <td style={{ padding: '2px 4px', textAlign: 'center', border: '1px solid #666' }}>{cant.toFixed(2)}</td>
                            <td style={{ padding: '2px 4px', textAlign: 'center', border: '1px solid #666', fontFamily: 'monospace', fontSize: 8.5 }}>{prod?.codigo ?? '—'}</td>
                            <td style={{ padding: '2px 4px', textAlign: 'left', border: '1px solid #666' }}>{it.descripcion || prod?.descripcion?.trim() || prod?.nombre || '—'}</td>
                            <td style={{ padding: '2px 4px', textAlign: 'right', border: '1px solid #666', fontFamily: 'monospace' }}>{fmtNum(pu)}</td>
                            <td style={{ padding: '2px 4px', textAlign: 'right', border: '1px solid #666', fontFamily: 'monospace' }}>{fmtNum(sub)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Totales */}
                  <table style={{ width: '100%', marginBottom: 12, fontSize: 10 }}>
                    <tbody>
                      <tr>
                        <td style={{ verticalAlign: 'top', padding: 8, border: '1px solid #999', background: '#fafafa', width: '60%' }}>
                          <div style={{ fontWeight: 'bold', fontSize: 10, marginBottom: 4 }}>SON:</div>
                          <div style={{ fontSize: 11, textTransform: 'uppercase' }}>{totalLetras} {monedaLabel}</div>
                        </td>
                        <td style={{ verticalAlign: 'top', width: '40%', paddingLeft: 8 }}>
                          <table style={{ width: '100%', fontSize: 11 }}>
                            <tbody>
                              {/* Totales en NEGRITA sobre fondo blanco: el relleno
                                  negro salía lavado en la impresora (pedido de Daniel) */}
                              <tr>
                                <td style={{ padding: '4px 8px', border: '1px solid #666', fontWeight: 'bold', color: '#000' }}>OP. GRAVADA</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #666', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#000' }}>S/ {fmtNum(subtotalNum)}</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '4px 8px', border: '1px solid #666', fontWeight: 'bold', color: '#000' }}>IGV (18%)</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #666', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#000' }}>S/ {fmtNum(igvNum)}</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '6px 8px', border: '2px solid #000', fontWeight: 'bold', fontSize: 13, color: '#000' }}>TOTAL</td>
                                <td style={{ padding: '6px 8px', border: '2px solid #000', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 14, color: '#000' }}>S/ {fmtNum(totalNum)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* QR + footer */}
                  <table style={{ width: '100%', marginTop: 12 }}>
                    <tbody>
                      <tr>
                        <td style={{ verticalAlign: 'top', width: 130 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={qrUrl} alt="QR" style={{ width: 100, height: 100 }} />
                        </td>
                        <td style={{ verticalAlign: 'top', fontSize: 10, paddingLeft: 12, color: '#555' }}>
                          <p style={{ marginBottom: 6 }}>Representación impresa del comprobante electrónico.</p>
                          <p style={{ marginBottom: 6 }}>Consulte en <strong>www.sunat.gob.pe</strong></p>
                          {facturador?.full_name && (
                            <p style={{ marginTop: 6, fontSize: 9 }}>Emitido por: {facturador.full_name}</p>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              ) : (
                /* Ticket 80mm — MISMO formato aprobado del comprobante individual.
                   Todo en negrita por pedido de Daniel: la térmica imprimía muy
                   claro y no se leía bien. */
                <>
                  {/* Logo + encabezado */}
                  <div style={{ textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {/* Alto explícito (130 × 221/390 = 74): sin él la imagen
                        no ocupa espacio hasta cargar y la medición del alto
                        del ticket sale ~20 mm corta, con lo que el ticket no
                        cabe en su página y se parte en dos hojas. */}
                    <img src="/logo-agrocar.png" alt="AGROCAR" width={130} height={74}
                      style={{ width: 130, height: 74, margin: '0 auto 1px', display: 'block' }} />
                    <div style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14, color: '#000', marginBottom: 2 }}>
                      {EMPRESA.slogan}
                    </div>
                    <div style={{ fontWeight: 'bold', fontSize: 12 }}>{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</div>
                    <div style={{ fontSize: 9.5 }}>{EMPRESA.direccion_comercial}</div>
                    <div style={{ fontSize: 9.5 }}>{EMPRESA.direccion_fundo}</div>
                    <div style={{ fontSize: 9.5 }}>Tel. {EMPRESA.telefono} · {EMPRESA.correo}</div>
                  </div>

                  {/* Título y correlativo */}
                  <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 11, marginTop: 5 }}>{titulo}</div>
                  <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 13 }}>{correlativo}</div>
                  {comp.editado && (
                    <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 'bold' }}>⚠ COMPROBANTE EDITADO</div>
                  )}

                  {/* Cabecera */}
                  <div style={{ marginTop: 4, fontSize: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>F. Emisión: {fechaEmision}</span>
                      <span>Cond: {condicion}</span>
                    </div>
                    {fechaDespacho && <div>F. Despacho: {fechaDespacho}</div>}
                    <div>
                      {docCliente.label}: {docCliente.valor}
                      {clienteTelefono && clienteTelefono !== '—' ? ` · Tel: ${clienteTelefono}` : ''}
                    </div>
                    <div>Cliente: {clienteNombre}</div>
                    {clienteDireccion && clienteDireccion !== '—' && (
                      <div>Dirección: {clienteDireccion}</div>
                    )}
                  </div>

                  {/* Ítems en 2 líneas: descripción completa arriba, cifras abajo */}
                  <table style={{ width: '100%', fontSize: 9.5, borderCollapse: 'collapse', marginTop: 4 }}>
                    <thead>
                      <tr style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
                        <th style={{ textAlign: 'left', padding: '1px 0', width: 60 }}>CODIGO</th>
                        <th style={{ textAlign: 'left', padding: '1px 0' }}>PRODUCTO</th>
                        <th style={{ textAlign: 'right', padding: '1px 0', width: 38 }}>CANT.</th>
                        <th style={{ textAlign: 'right', padding: '1px 0', width: 48 }}>P.UNIT.</th>
                        <th style={{ textAlign: 'right', padding: '1px 0', width: 52 }}>TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr><td colSpan={5} style={{ padding: 6, textAlign: 'center', fontStyle: 'italic' }}>
                          ⚠ Sin detalle de items
                        </td></tr>
                      ) : items.map((it: any) => (
                        <Fragment key={it.id}>
                          <tr style={{ verticalAlign: 'top' }}>
                            <td style={{ padding: '2px 2px 0 0', fontSize: 9 }}>{it.productos?.codigo ?? '—'}</td>
                            <td colSpan={4} style={{ padding: '2px 0 0 2px' }}>
                              {(it.descripcion ?? it.productos?.descripcion ?? it.productos?.nombre ?? '—').trim()}
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={2}></td>
                            <td style={{ textAlign: 'right', padding: '0 2px 2px' }}>{Number(it.cantidad).toFixed(0)}</td>
                            <td style={{ textAlign: 'right', padding: '0 2px 2px' }}>{fmtNum(Number(it.precio_unitario))}</td>
                            <td style={{ textAlign: 'right', padding: '0 0 2px 2px' }}>{fmtNum(Number(it.subtotal))}</td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>

                  {/* QR + totales lado a lado */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6, borderTop: '1px solid #000', paddingTop: 4 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrUrl} alt="QR" style={{ width: 65, height: 65, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>OP. GRAVADA:</span><span>S/ {fmtNum(subtotalNum)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>IGV 18%:</span><span>S/ {fmtNum(igvNum)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid #000', paddingTop: 1, marginTop: 1 }}>
                        <span>IMPORTE TOTAL:</span><span>S/ {fmtNum(totalNum)}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: 9.5, marginTop: 3 }}>
                    SON: {totalLetras} {monedaLabel}
                  </div>

                  <div style={{ fontSize: 9, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Usuario: {facturador?.full_name ?? '—'}</span>
                    <span>VDR: {vendedorNombre}</span>
                  </div>
                  <div style={{ fontSize: 9 }}>Impreso: {impreso}</div>

                  <div style={{ textAlign: 'center', marginTop: 4 }}>
                    ** GRACIAS POR SU COMPRA **
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 8 }}>
                    Representación impresa · Consulta www.sunat.gob.pe
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
