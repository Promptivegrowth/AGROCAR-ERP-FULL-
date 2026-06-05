import { createAdminClient } from '@/lib/supabase/admin'
import { numeroALetras } from '@/lib/utils'
import AutoPrint from './auto-print'

export const dynamic = 'force-dynamic'

const TIPO_TITULO: Record<string, string> = {
  boleta: 'BOLETA DE VENTA ELECTRONICA',
  factura: 'FACTURA ELECTRONICA',
  nota_pedido_interna: 'NOTA DE PEDIDO',
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
      id, tipo, serie, numero, fecha_emision, subtotal, igv, total, moneda, estado, pedido_id, created_at,
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

  // Ordenar comprobantes por correlativo (serie + numero)
  const lista = (comprobantes ?? []).sort((a: any, b: any) => {
    const ka = `${a.serie}-${a.numero}`
    const kb = `${b.serie}-${b.numero}`
    return ka.localeCompare(kb)
  })

  return (
    <div className="bg-gray-200 print:bg-white">
      <AutoPrint count={lista.length} />
      <style>{`
        @media print {
          @page { size: ${esA4 ? 'A4' : '80mm auto'}; margin: ${esA4 ? '12mm' : '0'}; }
          body { margin: 0; }
          .no-print { display: none !important; }
          .pagebreak { page-break-after: always; break-after: page; }
          .pagebreak:last-child { page-break-after: auto; break-after: auto; }
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

      <div className="py-6">
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
          const fechaEmision = new Date(comp.fecha_emision).toLocaleDateString('es-PE', {
            day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
          })
          const qrData = `AGROCAR|20519883296|${comp.tipo}|${correlativo}|${totalNum.toFixed(2)}|${comp.fecha_emision}|${docCliente.valor}`
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrData)}`

          return (
            <div
              key={comp.id}
              className="pagebreak mx-auto bg-white shadow-lg print:shadow-none mb-6 print:mb-0"
              style={{
                maxWidth: esA4 ? 800 : 350,
                padding: esA4 ? 32 : 12,
                fontFamily: esA4 ? '"Helvetica Neue", Arial, sans-serif' : 'ui-monospace, "Courier New", monospace',
                fontSize: esA4 ? 11 : 11,
                color: '#111',
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
                          <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
                            <div style={{ fontWeight: 'bold', fontSize: 14 }}>AGROCAR S.R.L.</div>
                            <div>Distribuidor de Línea de Frío</div>
                            <div>Tacna, Perú</div>
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
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 10 }}>
                    <thead>
                      <tr style={{ background: '#000', color: '#fff' }}>
                        <th style={{ padding: 6, textAlign: 'center', border: '1px solid #000', width: 50 }}>CANT.</th>
                        <th style={{ padding: 6, textAlign: 'center', border: '1px solid #000', width: 80 }}>CÓDIGO</th>
                        <th style={{ padding: 6, textAlign: 'left', border: '1px solid #000' }}>DESCRIPCIÓN</th>
                        <th style={{ padding: 6, textAlign: 'right', border: '1px solid #000', width: 90 }}>P. UNIT.</th>
                        <th style={{ padding: 6, textAlign: 'right', border: '1px solid #000', width: 100 }}>IMPORTE</th>
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
                          <tr key={it.id}>
                            <td style={{ padding: 5, textAlign: 'center', border: '1px solid #ccc' }}>{cant.toFixed(2)}</td>
                            <td style={{ padding: 5, textAlign: 'center', border: '1px solid #ccc', fontFamily: 'monospace', fontSize: 9 }}>{prod?.codigo ?? '—'}</td>
                            <td style={{ padding: 5, textAlign: 'left', border: '1px solid #ccc' }}>{it.descripcion || prod?.descripcion?.trim() || prod?.nombre || '—'}</td>
                            <td style={{ padding: 5, textAlign: 'right', border: '1px solid #ccc', fontFamily: 'monospace' }}>{fmtNum(pu)}</td>
                            <td style={{ padding: 5, textAlign: 'right', border: '1px solid #ccc', fontFamily: 'monospace' }}>{fmtNum(sub)}</td>
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
                              <tr>
                                <td style={{ padding: '4px 8px', border: '1px solid #ccc', background: '#fafafa' }}>OP. GRAVADA</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #ccc', textAlign: 'right', fontFamily: 'monospace' }}>S/ {fmtNum(subtotalNum)}</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '4px 8px', border: '1px solid #ccc', background: '#fafafa' }}>IGV (18%)</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #ccc', textAlign: 'right', fontFamily: 'monospace' }}>S/ {fmtNum(igvNum)}</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '6px 8px', border: '2px solid #000', background: '#000', color: '#fff', fontWeight: 'bold' }}>TOTAL</td>
                                <td style={{ padding: '6px 8px', border: '2px solid #000', background: '#000', color: '#fff', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 13 }}>S/ {fmtNum(totalNum)}</td>
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
                /* Ticket 80mm — versión compacta */
                <>
                  <div style={{ textAlign: 'center', fontWeight: 'bold' }}>AGROCAR S.R.L.</div>
                  <div style={{ textAlign: 'center' }}>RUC: 20519883296</div>
                  <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
                  <div style={{ textAlign: 'center', fontWeight: 'bold' }}>{titulo}</div>
                  <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 13 }}>{correlativo}</div>
                  {comp.editado && (
                    <div style={{ textAlign: 'center', fontSize: 9, color: '#92400e', fontWeight: 'bold' }}>⚠ EDITADO</div>
                  )}
                  <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
                  <div>Fecha: {fechaEmision}</div>
                  <div>{docCliente.label}: {docCliente.valor}</div>
                  <div>Cliente: {clienteNombre}</div>
                  <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
                  {items.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#b91c1c', fontStyle: 'italic', fontSize: 10 }}>⚠ Sin detalle</div>
                  ) : items.map((it: any) => (
                    <div key={it.id} style={{ marginBottom: 4 }}>
                      <div style={{ fontWeight: 'bold', fontSize: 10 }}>{it.descripcion ?? it.productos?.nombre ?? '—'}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span>{Number(it.cantidad).toFixed(0)} x {fmtNum(Number(it.precio_unitario))}</span>
                        <span>{fmtNum(Number(it.subtotal))}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span>TOTAL:</span><span>S/ {fmtNum(totalNum)}</span>
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
