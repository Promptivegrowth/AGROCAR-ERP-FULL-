import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { numeroALetras } from '@/lib/utils'
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

export default async function ComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: comp } = await supabase
    .from('comprobantes')
    .select(`
      id, tipo, serie, numero, fecha_emision, subtotal, igv, total, moneda, estado, pedido_id, created_at,
      clientes(id, razon_social, ruc, dni, direccion, telefono),
      profiles!comprobantes_facturador_id_fkey(full_name)
    `)
    .eq('id', id)
    .single()

  if (!comp) notFound()

  const cliente: any = (comp as any).clientes
  const facturador: any = (comp as any).profiles

  // Items del comprobante
  const { data: items } = await supabase
    .from('comprobantes_items')
    .select(`
      id, descripcion, cantidad, precio_unitario, subtotal, igv_porcentaje,
      productos(codigo, nombre)
    `)
    .eq('comprobante_id', id)

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
  const docCliente = cliente?.ruc
    ? { label: 'RUC', valor: cliente.ruc }
    : cliente?.dni
      ? { label: 'DNI', valor: cliente.dni }
      : { label: 'DNI', valor: '—' }

  const totalLetras = numeroALetras(totalNum)
  const monedaLabel = comp.moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES'

  const qrData = `AGROCAR|20519883296|${comp.tipo}|${correlativo}|${totalNum.toFixed(2)}|${comp.fecha_emision}|${docCliente.valor}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`

  return (
    <div className="min-h-dvh bg-gray-200 py-6 print:bg-white print:py-0">
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 0; }
          body { margin: 0; }
        }
      `}</style>

      <div className="ticket mx-auto bg-white shadow-lg print:shadow-none" style={{ maxWidth: 350, width: '100%', padding: 12, fontFamily: 'ui-monospace, "Courier New", monospace', fontSize: 11, lineHeight: 1.35, color: '#000' }}>
        {/* Logo + encabezado */}
        <div style={{ textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-agrocar.png" alt="AGROCAR" style={{ maxWidth: 140, margin: '0 auto 4px', display: 'block' }} />
          <div style={{ fontWeight: 'bold', fontSize: 13 }}>AGROCAR S.R.L.</div>
          <div>RUC: 20519883296</div>
          <div>CALLE EMILIO FORERO 553-A</div>
          <div>PARA GRANDE - TACNA</div>
          <div>FUNDO PARA GRANDE PARCELA 31</div>
          <div>SUB LT 1 - TACNA</div>
          <div>TELEFONO: 952901119</div>
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
            <span>TELEFONO:</span><span>{cliente?.telefono ?? '—'}</span>
          </div>
          <div>
            <span>NOMBRE: </span><span>{cliente?.razon_social ?? '—'}</span>
          </div>
          <div>
            <span>DIRECCION: </span><span>{cliente?.direccion ?? '—'}</span>
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
                <td style={{ padding: '2px 2px' }}>{truncar(it.descripcion ?? it.productos?.nombre ?? '', 18)}</td>
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
