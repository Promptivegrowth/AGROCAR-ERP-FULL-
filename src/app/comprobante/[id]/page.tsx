import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { numeroALetras } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import PrintButton from './print-button'

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

function truncar(s: string, max: number) {
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export default async function ComprobantePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ formato?: string }>
}) {
  const { id } = await params
  const { formato } = await searchParams
  const esA4 = formato === 'a4'
  const supabase = createAdminClient()

  const { data: comp } = await supabase
    .from('comprobantes')
    .select(`
      id, tipo, serie, numero, fecha_emision, subtotal, igv, total, moneda, estado, pedido_id, created_at,
      cliente_externo_nombre, cliente_externo_doc,
      clientes(id, razon_social, ruc, dni, direccion, telefono),
      profiles!comprobantes_facturador_id_fkey(full_name)
    `)
    .eq('id', id)
    .single()

  if (!comp) notFound()

  const cliente: any = (comp as any).clientes
  const facturador: any = (comp as any).profiles

  // Items del comprobante. Snapshot en comprobantes_items; si no hay, fallback al pedido
  const { data: itemsCompr } = await supabase
    .from('comprobantes_items')
    .select(`
      id, descripcion, cantidad, precio_unitario, subtotal, igv_porcentaje,
      productos(codigo, nombre, descripcion)
    `)
    .eq('comprobante_id', id)

  let items = itemsCompr ?? []
  if (items.length === 0 && comp.pedido_id) {
    const { data: itemsPed } = await supabase
      .from('pedidos_items')
      .select(`
        id, cantidad, precio_unitario, subtotal,
        productos(codigo, nombre, descripcion)
      `)
      .eq('pedido_id', comp.pedido_id)
    items = (itemsPed ?? []).map((it: any) => ({
      id: it.id,
      descripcion: it.productos?.descripcion?.trim() || it.productos?.nombre || '—',
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      subtotal: it.subtotal,
      igv_porcentaje: 18,
      productos: it.productos,
    }))
  }

  // Vendedor desde el pedido asociado
  let vendedorNombre = '—'
  let totalCobrado = 0
  if (comp.pedido_id) {
    const { data: pedido } = await supabase
      .from('pedidos')
      .select('vendedor_id, profiles!pedidos_vendedor_id_fkey(full_name)')
      .eq('id', comp.pedido_id)
      .maybeSingle()
    vendedorNombre = (pedido as any)?.profiles?.full_name ?? '—'

    // Cobros para determinar condición (contado/crédito)
    const { data: cobros } = await supabase
      .from('cobros')
      .select('total')
      .eq('referencia_id', comp.pedido_id)
    totalCobrado = (cobros ?? []).reduce((acc, c: any) => acc + Number(c.total ?? 0), 0)
  }

  const totalNum = Number(comp.total ?? 0)
  const subtotalNum = Number(comp.subtotal ?? 0)
  const igvNum = Number(comp.igv ?? 0)
  const condicion = totalCobrado >= totalNum && totalNum > 0 ? 'CONTADO' : 'CREDITO'

  const fechaEmision = new Date(comp.fecha_emision).toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
  })
  const horaEmision = new Date(comp.created_at).toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Lima',
  })
  const impreso = new Date().toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Lima',
  })

  const titulo = TIPO_TITULO[comp.tipo as string] ?? 'COMPROBANTE'
  const correlativo = `${comp.serie}-${pad(comp.numero, 6)}`
  // Datos del cliente: si no hay registrado, usar el snapshot del consumidor final
  const externoNombre = (comp as any).cliente_externo_nombre as string | null
  const externoDoc = (comp as any).cliente_externo_doc as string | null
  const clienteNombre = cliente?.razon_social ?? externoNombre ?? '—'
  const clienteDireccion = cliente?.direccion ?? '—'
  const clienteTelefono = cliente?.telefono ?? '—'
  // Documento: primero del cliente registrado, sino del externo (RUC si tiene 11 dígitos, DNI si tiene 8)
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
          : externoDoc
            ? { label: 'DOC', valor: externoDoc }
            : { label: 'DNI', valor: '—' }

  const totalLetras = numeroALetras(totalNum)
  const monedaLabel = comp.moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES'

  const qrData = `AGROCAR|20519883296|${comp.tipo}|${correlativo}|${totalNum.toFixed(2)}|${comp.fecha_emision}|${docCliente.valor}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`

  // Toggle de formato (oculto al imprimir)
  const ToggleFormato = () => (
    <div className="max-w-4xl mx-auto mb-3 px-4 print:hidden">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-2 shadow-sm flex-wrap">
        <span className="text-xs text-gray-600 px-2">Formato:</span>
        <a
          href={`/comprobante/${id}`}
          className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${!esA4 ? 'bg-[#FBE600] text-black' : 'text-gray-600 hover:bg-gray-50'}`}
          title="Para ticketera térmica de 80mm"
        >
          🧾 Ticket (80mm)
        </a>
        <a
          href={`/comprobante/${id}?formato=a4`}
          className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${esA4 ? 'bg-[#FBE600] text-black' : 'text-gray-600 hover:bg-gray-50'}`}
          title="Para impresora normal o PDF"
        >
          📄 A4 SUNAT
        </a>
        <div className="ml-auto"><PrintButton /></div>
      </div>
      {!esA4 && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
          <span className="text-amber-600 shrink-0">⚠</span>
          <div>
            <p className="font-semibold">Este formato es para ticketera térmica de 80mm.</p>
            <p className="mt-0.5">
              Si va a imprimir en impresora normal (A4 / Carta), use el formato{' '}
              <a href={`/comprobante/${id}?formato=a4`} className="underline font-semibold">📄 A4 SUNAT</a>
              {' '}para que no salga la hoja casi vacía.
            </p>
          </div>
        </div>
      )}
    </div>
  )

  if (esA4) {
    return (
      <div className="min-h-dvh bg-gray-200 py-6 print:bg-white print:py-0">
        <style>{`
          @media print {
            @page { size: A4; margin: 8mm; }
            body { margin: 0; }
            .no-print { display: none !important; }
          }
        `}</style>
        <ToggleFormato />
        <div className="a4-doc mx-auto bg-white shadow-lg print:shadow-none p-8" style={{ maxWidth: 800, fontFamily: '"Helvetica Neue", Arial, sans-serif', fontSize: 11, color: '#111' }}>
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
                </td>
              </tr>
            </tbody>
          </table>

          {/* Datos del cliente */}
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
                  <td style={{ padding: '2px 4px', fontWeight: 'bold' }}>Condición:</td>
                  <td style={{ padding: '2px 4px' }}>{condicion}</td>
                </tr>
                <tr>
                  <td style={{ padding: '2px 4px', fontWeight: 'bold' }}>Dirección:</td>
                  <td style={{ padding: '2px 4px' }} colSpan={3}>{clienteDireccion}</td>
                </tr>
                {vendedorNombre !== '—' && (
                  <tr>
                    <td style={{ padding: '2px 4px', fontWeight: 'bold' }}>Vendedor:</td>
                    <td style={{ padding: '2px 4px' }} colSpan={3}>{vendedorNombre}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tabla de items */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, fontSize: 9.5, lineHeight: 1.2 }}>
            <thead>
              <tr style={{ background: '#000', color: '#fff' }}>
                <th style={{ padding: '3px 4px', textAlign: 'center', border: '1px solid #000', width: 45 }}>CANT.</th>
                <th style={{ padding: '3px 4px', textAlign: 'center', border: '1px solid #000', width: 40 }}>UND.</th>
                <th style={{ padding: '3px 4px', textAlign: 'center', border: '1px solid #000', width: 70 }}>CÓDIGO</th>
                <th style={{ padding: '3px 4px', textAlign: 'left', border: '1px solid #000' }}>DESCRIPCIÓN</th>
                <th style={{ padding: '3px 4px', textAlign: 'right', border: '1px solid #000', width: 80 }}>P. UNIT.</th>
                <th style={{ padding: '3px 4px', textAlign: 'right', border: '1px solid #000', width: 90 }}>IMPORTE</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it: any) => {
                const prod = it.productos
                const nombreProd = it.descripcion || prod?.descripcion?.trim() || prod?.nombre || '—'
                const cant = Number(it.cantidad ?? 0)
                const pu = Number(it.precio_unitario ?? 0)
                const sub = Number(it.subtotal ?? cant * pu)
                return (
                  <tr key={it.id}>
                    <td style={{ padding: '2px 4px', textAlign: 'center', border: '1px solid #ccc' }}>{cant.toFixed(2)}</td>
                    <td style={{ padding: '2px 4px', textAlign: 'center', border: '1px solid #ccc' }}>UND</td>
                    <td style={{ padding: '2px 4px', textAlign: 'center', border: '1px solid #ccc', fontFamily: 'monospace', fontSize: 8.5 }}>{prod?.codigo ?? '—'}</td>
                    <td style={{ padding: '2px 4px', textAlign: 'left', border: '1px solid #ccc' }}>{nombreProd}</td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', border: '1px solid #ccc', fontFamily: 'monospace' }}>{fmtNum(pu)}</td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', border: '1px solid #ccc', fontFamily: 'monospace' }}>{fmtNum(sub)}</td>
                  </tr>
                )
              })}
              {/* Solo agregar 1 fila vacía si hay pocos items (≤2), no rellenar tanto */}
              {Array.from({ length: Math.max(0, 2 - (items?.length ?? 0)) }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td style={{ padding: '2px 4px', border: '1px solid #eee', height: 16 }}>&nbsp;</td>
                  <td style={{ padding: '2px 4px', border: '1px solid #eee' }}></td>
                  <td style={{ padding: '2px 4px', border: '1px solid #eee' }}></td>
                  <td style={{ padding: '2px 4px', border: '1px solid #eee' }}></td>
                  <td style={{ padding: '2px 4px', border: '1px solid #eee' }}></td>
                  <td style={{ padding: '2px 4px', border: '1px solid #eee' }}></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Total en letras + cuadro de totales */}
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

          {/* QR + leyenda SUNAT */}
          <table style={{ width: '100%', marginTop: 12 }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: 'top', width: 150 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrUrl} alt="QR" style={{ width: 110, height: 110 }} />
                </td>
                <td style={{ verticalAlign: 'top', fontSize: 10, paddingLeft: 12, color: '#555' }}>
                  <p style={{ marginBottom: 6 }}>Representación impresa del comprobante electrónico.</p>
                  <p style={{ marginBottom: 6 }}>Consulte la validez del comprobante en:<br/><strong>www.sunat.gob.pe</strong></p>
                  <p style={{ marginTop: 8, fontSize: 9 }}>
                    Autorizado mediante Resolución de Intendencia Nº 034-005-0007698/SUNAT.<br/>
                    Bienes y servicios afectos al IGV.
                  </p>
                  {facturador?.full_name && (
                    <p style={{ marginTop: 6, fontSize: 9 }}>Emitido por: {facturador.full_name}</p>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Footer */}
          <div style={{ marginTop: 24, textAlign: 'center', fontSize: 9, color: '#777', borderTop: '1px solid #ddd', paddingTop: 8 }}>
            Impreso el {impreso} · AGROCAR S.R.L.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-gray-200 py-6 print:bg-white print:py-0">
      <style>{`
        @media print {
          /* Pide al navegador papel de 80mm para ticketera térmica.
             Si la impresora es A4 normal y no soporta 80mm, el ticket
             quedará en la esquina superior izquierda — para esos casos
             el usuario debe usar el formato A4 SUNAT (avisado en pantalla). */
          @page { size: 80mm auto; margin: 0; }
          body { margin: 0; }
          .no-print { display: none !important; }
          .ticket {
            margin: 0 auto !important;
            box-shadow: none !important;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <ToggleFormato />

      <div className="ticket mx-auto bg-white shadow-lg print:shadow-none" style={{ maxWidth: 350, width: '100%', padding: 12, fontFamily: 'ui-monospace, "Courier New", monospace', fontSize: 11, lineHeight: 1.35, color: '#000' }}>
        {/* Logo + encabezado */}
        <div style={{ textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-agrocar.png" alt="AGROCAR" style={{ maxWidth: 140, margin: '0 auto 2px', display: 'block' }} />
          <div style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 15, color: '#000', marginBottom: 4 }}>
            {EMPRESA.slogan}
          </div>
          <div style={{ fontWeight: 'bold', fontSize: 13 }}>{EMPRESA.razon_social}</div>
          <div>RUC: {EMPRESA.ruc}</div>
          <div>CALLE EMILIO FORERO 553-A</div>
          <div>PARA GRANDE - TACNA</div>
          <div>FUNDO PARA GRANDE PARCELA 31</div>
          <div>SUB LT 1 - TACNA</div>
          <div>TELEFONO: {EMPRESA.telefono}</div>
          <div style={{ fontSize: 10 }}>{EMPRESA.correo}</div>
        </div>

        <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 12 }}>{titulo}</div>
        <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 14, marginTop: 2 }}>{correlativo}</div>

        <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        {/* Info cabecera */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>FECHA:</span><span>{fechaEmision}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>CONDICION:</span><span>{condicion}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{docCliente.label}:</span><span>{docCliente.valor}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>TELEFONO:</span><span>{clienteTelefono}</span>
          </div>
          <div>
            <span>NOMBRE: </span><span>{clienteNombre}</span>
          </div>
          <div>
            <span>DIRECCION: </span><span>{clienteDireccion}</span>
          </div>
        </div>

        <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        {/* Tabla items */}
        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px dashed #000' }}>
              <th style={{ textAlign: 'left', padding: '2px 0' }}>COD</th>
              <th style={{ textAlign: 'left', padding: '2px 0' }}>PRODUCTO</th>
              <th style={{ textAlign: 'right', padding: '2px 0' }}>CANT</th>
              <th style={{ textAlign: 'right', padding: '2px 0' }}>P.U</th>
              <th style={{ textAlign: 'right', padding: '2px 0' }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it: any) => (
              <tr key={it.id} style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '2px 2px 2px 0' }}>{it.productos?.codigo ?? '—'}</td>
                <td style={{ padding: '2px 2px' }}>{truncar(it.descripcion ?? it.productos?.descripcion ?? it.productos?.nombre ?? '', 18)}</td>
                <td style={{ textAlign: 'right', padding: '2px 2px' }}>{Number(it.cantidad).toFixed(0)}</td>
                <td style={{ textAlign: 'right', padding: '2px 2px' }}>{fmtNum(Number(it.precio_unitario))}</td>
                <td style={{ textAlign: 'right', padding: '2px 0 2px 2px' }}>{fmtNum(Number(it.subtotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        {/* Totales */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>OP. GRAVADAS:</span><span>S/ {fmtNum(subtotalNum)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>IGV (18%):</span><span>S/ {fmtNum(igvNum)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 13, marginTop: 4 }}>
            <span>IMPORTE TOTAL:</span><span>S/ {fmtNum(totalNum)}</span>
          </div>
        </div>

        <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        <div style={{ fontSize: 10 }}>
          <strong>SON:</strong> {totalLetras} {monedaLabel}
        </div>

        <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        <div style={{ fontSize: 10 }}>
          <div>USUARIO: {facturador?.full_name ?? '—'}</div>
          <div>IMPRESO: {impreso}</div>
          <div>VDR: {vendedorNombre}</div>
        </div>

        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="QR" style={{ width: 120, height: 120, margin: '0 auto', display: 'block' }} />
        </div>

        <div style={{ textAlign: 'center', fontWeight: 'bold', marginTop: 8 }}>
          ** GRACIAS POR SU COMPRA **
        </div>

        <div style={{ textAlign: 'center', fontSize: 9, marginTop: 8, color: '#555' }}>
          Representación impresa del comprobante electrónico.
          <br />
          Consulta: www.sunat.gob.pe
        </div>
      </div>

      <div className="mx-auto mt-4 text-center print:hidden" style={{ maxWidth: 350 }}>
        <PrintButton />
      </div>
    </div>
  )
}
