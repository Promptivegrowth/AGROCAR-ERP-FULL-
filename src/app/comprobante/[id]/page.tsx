import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { numeroALetras } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import PrintButton from './print-button'

export const dynamic = 'force-dynamic'

const TIPO_TITULO: Record<string, string> = {
  boleta: 'BOLETA DE VENTA ELECTRONICA',
  factura: 'FACTURA ELECTRONICA',
  nota_pedido_interna: 'DOCUMENTO INTERNO',
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

  const { data: comp } = await (supabase as any)
    .from('comprobantes')
    .select(`
      id, tipo, serie, numero, fecha_emision, fecha_despacho, subtotal, igv, total, moneda, estado, pedido_id, created_at,
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

  const fechaEmision = new Date(comp.fecha_emision + 'T12:00:00-05:00').toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
  })
  // Fecha de despacho: cuándo se entrega la mercadería al cliente. Por requerimiento
  // del cliente, este es el dato que más le importa ver en el comprobante.
  const fechaDespacho = (comp as any).fecha_despacho
    ? new Date((comp as any).fecha_despacho + 'T12:00:00-05:00').toLocaleDateString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
      })
    : null
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
          {/* Encabezado A4 — 3 columnas: logo+slogan | razón social + RUC + dirección | recuadro */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
            <tbody>
              <tr>
                {/* IZQUIERDA: Logo + slogan centrado bajo el logo */}
                <td style={{ width: '25%', verticalAlign: 'top', textAlign: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-agrocar.png" alt="AGROCAR" style={{ maxWidth: 150, margin: '0 auto', display: 'block' }} />
                  <div style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 16, color: '#1f2937', marginTop: 4, textAlign: 'center' }}>
                    {EMPRESA.slogan}
                  </div>
                </td>
                {/* CENTRO: Razón social · RUC + dirección + teléfono/correo */}
                <td style={{ width: '45%', verticalAlign: 'top', paddingLeft: 12, paddingRight: 12 }}>
                  <div style={{ fontWeight: 'bold', fontSize: 14, lineHeight: 1.3 }}>
                    {EMPRESA.razon_social} · RUC {EMPRESA.ruc}
                  </div>
                  <div style={{ fontSize: 10.5, lineHeight: 1.45, marginTop: 4 }}>
                    <div>
                      <span style={{ color: '#6b7280', fontSize: 9 }}>Domicilio fiscal: </span>
                      {EMPRESA.direccion_comercial}
                    </div>
                    <div style={{ color: '#374151' }}>
                      <span style={{ color: '#6b7280', fontSize: 9 }}>Establecimiento anexo: </span>
                      {EMPRESA.direccion_fundo}
                    </div>
                    <div>Tel. {EMPRESA.telefono}</div>
                    <div>{EMPRESA.correo}</div>
                  </div>
                </td>
                {/* DERECHA: Recuadro título + correlativo (RUC ya está al centro, lo quitamos del recuadro) */}
                <td style={{ width: '30%', verticalAlign: 'top', textAlign: 'right' }}>
                  <div style={{ border: '2px solid #000', borderRadius: 4, padding: 10, display: 'inline-block', minWidth: 220, textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6, lineHeight: 1.2 }}>{titulo}</div>
                    <div style={{ fontSize: 11, color: '#444', marginBottom: 4 }}>R.U.C. {EMPRESA.ruc}</div>
                    <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace' }}>{correlativo}</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Datos del cliente — diseño original con fecha de despacho añadida */}
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

          {/* Tabla de items — diseño original */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 10 }}>
            <thead>
              <tr style={{ background: '#000', color: '#fff' }}>
                <th style={{ padding: 6, textAlign: 'center', border: '1px solid #000', width: 50 }}>CANT.</th>
                <th style={{ padding: 6, textAlign: 'center', border: '1px solid #000', width: 60 }}>UND.</th>
                <th style={{ padding: 6, textAlign: 'center', border: '1px solid #000', width: 80 }}>CÓDIGO</th>
                <th style={{ padding: 6, textAlign: 'left', border: '1px solid #000' }}>DESCRIPCIÓN</th>
                <th style={{ padding: 6, textAlign: 'right', border: '1px solid #000', width: 90 }}>P. UNIT.</th>
                <th style={{ padding: 6, textAlign: 'right', border: '1px solid #000', width: 100 }}>IMPORTE</th>
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
                    <td style={{ padding: 5, textAlign: 'center', border: '1px solid #ccc' }}>{cant.toFixed(2)}</td>
                    <td style={{ padding: 5, textAlign: 'center', border: '1px solid #ccc' }}>UND</td>
                    <td style={{ padding: 5, textAlign: 'center', border: '1px solid #ccc', fontFamily: 'monospace', fontSize: 9 }}>{prod?.codigo ?? '—'}</td>
                    <td style={{ padding: 5, textAlign: 'left', border: '1px solid #ccc' }}>{nombreProd}</td>
                    <td style={{ padding: 5, textAlign: 'right', border: '1px solid #ccc', fontFamily: 'monospace' }}>{fmtNum(pu)}</td>
                    <td style={{ padding: 5, textAlign: 'right', border: '1px solid #ccc', fontFamily: 'monospace' }}>{fmtNum(sub)}</td>
                  </tr>
                )
              })}
              {/* Filas vacías para rellenar visualmente */}
              {Array.from({ length: Math.max(0, 5 - (items?.length ?? 0)) }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td style={{ padding: 5, border: '1px solid #eee', height: 22 }}>&nbsp;</td>
                  <td style={{ padding: 5, border: '1px solid #eee' }}></td>
                  <td style={{ padding: 5, border: '1px solid #eee' }}></td>
                  <td style={{ padding: 5, border: '1px solid #eee' }}></td>
                  <td style={{ padding: 5, border: '1px solid #eee' }}></td>
                  <td style={{ padding: 5, border: '1px solid #eee' }}></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Total en letras + cuadro de totales — diseño original */}
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

          {/* QR + leyenda SUNAT — diseño original */}
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

          {/* Footer — diseño original */}
          <div style={{ marginTop: 24, textAlign: 'center', fontSize: 9, color: '#777', borderTop: '1px solid #ddd', paddingTop: 8 }}>
            Impreso el {impreso} · {EMPRESA.razon_social}
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

      <div className="ticket mx-auto bg-white shadow-lg print:shadow-none" style={{ maxWidth: 350, width: '100%', padding: 10, fontFamily: 'ui-monospace, "Courier New", monospace', fontSize: 10.5, lineHeight: 1.25, color: '#000' }}>
        {/* Logo + encabezado compactado */}
        <div style={{ textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-agrocar.png" alt="AGROCAR" style={{ maxWidth: 130, margin: '0 auto 1px', display: 'block' }} />
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

        {/* Info cabecera (sin separadores) */}
        <div style={{ marginTop: 4, fontSize: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>F. Emisión: {fechaEmision}</span>
            <span>Cond: {condicion}</span>
          </div>
          <div>{docCliente.label}: {docCliente.valor}{clienteTelefono && clienteTelefono !== '—' ? ` · Tel: ${clienteTelefono}` : ''}</div>
          <div>Cliente: {clienteNombre}</div>
          {clienteDireccion && clienteDireccion !== '—' && (
            <div>Dirección: {clienteDireccion}</div>
          )}
        </div>

        {/* Tabla items */}
        <table style={{ width: '100%', fontSize: 9.5, borderCollapse: 'collapse', marginTop: 4 }}>
          <thead>
            <tr style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
              <th style={{ textAlign: 'left', padding: '1px 0' }}>COD</th>
              <th style={{ textAlign: 'left', padding: '1px 0' }}>PRODUCTO</th>
              <th style={{ textAlign: 'right', padding: '1px 0' }}>CANT</th>
              <th style={{ textAlign: 'right', padding: '1px 0' }}>P.U</th>
              <th style={{ textAlign: 'right', padding: '1px 0' }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it: any) => (
              <tr key={it.id} style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '1px 2px 1px 0' }}>{it.productos?.codigo ?? '—'}</td>
                <td style={{ padding: '1px 2px' }}>{truncar(it.descripcion ?? it.productos?.descripcion ?? it.productos?.nombre ?? '', 18)}</td>
                <td style={{ textAlign: 'right', padding: '1px 2px' }}>{Number(it.cantidad).toFixed(0)}</td>
                <td style={{ textAlign: 'right', padding: '1px 2px' }}>{fmtNum(Number(it.precio_unitario))}</td>
                <td style={{ textAlign: 'right', padding: '1px 0 1px 2px' }}>{fmtNum(Number(it.subtotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* QR + totales lado a lado, totales en negrita */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6, borderTop: '1px solid #000', paddingTop: 4 }}>
          {/* QR pequeño a la izquierda */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="QR" style={{ width: 65, height: 65, flexShrink: 0 }} />
          {/* Totales a la derecha en negrita */}
          <div style={{ flex: 1, fontSize: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
              <span>OP. GRAVADA:</span><span>S/ {fmtNum(subtotalNum)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
              <span>IGV 18%:</span><span>S/ {fmtNum(igvNum)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 12, borderTop: '1px solid #000', paddingTop: 1, marginTop: 1 }}>
              <span>IMPORTE TOTAL:</span><span>S/ {fmtNum(totalNum)}</span>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 9.5, marginTop: 3 }}>
          <strong>SON:</strong> {totalLetras} {monedaLabel}
        </div>

        {/* Usuario + Vendedor en una línea */}
        <div style={{ fontSize: 9, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
          <span>Usuario: {facturador?.full_name ?? '—'}</span>
          <span>VDR: {vendedorNombre}</span>
        </div>
        <div style={{ fontSize: 9 }}>Impreso: {impreso}</div>

        {/* "GRACIAS POR SU COMPRA" + leyenda SUNAT compactada */}
        <div style={{ textAlign: 'center', fontWeight: 'bold', marginTop: 4 }}>
          ** GRACIAS POR SU COMPRA **
        </div>
        <div style={{ textAlign: 'center', fontSize: 8, color: '#555' }}>
          Representación impresa · Consulta www.sunat.gob.pe
        </div>
      </div>

      <div className="mx-auto mt-4 text-center print:hidden" style={{ maxWidth: 350 }}>
        <PrintButton />
      </div>
    </div>
  )
}
