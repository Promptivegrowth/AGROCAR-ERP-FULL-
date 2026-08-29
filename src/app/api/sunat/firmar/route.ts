import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { configuracionSunat, EMISOR_SUNAT } from '@/lib/sunat/config'
import { construirInvoice, type ItemUbl } from '@/lib/sunat/ubl'
import { firmarXml } from '@/lib/sunat/firma'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Firmar un comprobante, sin enviarlo.
 *
 * Firmar y declarar son dos cosas distintas, y conviene separarlas:
 *
 *   Firmar    es local, instantáneo y no sale de acá. Produce el XML con
 *             valor legal y, sobre todo, el digest que necesita el QR del
 *             ticket impreso.
 *   Declarar  habla con SUNAT y no se deshace.
 *
 * El ticket se imprime en el momento de la venta, mucho antes de que el
 * comprobante se declare —puede pasar un día entero—. Si el QR esperara al
 * envío, saldría incompleto en cada ticket. Firmando al emitir, el papel sale
 * completo desde el primer segundo aunque SUNAT esté caído o el sistema
 * todavía en pruebas.
 *
 * Es idempotente: firmar dos veces produce el mismo XML y no cambia nada.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const cuerpo = await req.json().catch(() => ({})) as { comprobante_id?: string }
  if (!cuerpo.comprobante_id) {
    return NextResponse.json({ error: 'Falta comprobante_id' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await (admin as any).from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, total, estado, enviado_sunat,
    clientes(razon_social, ruc, dni, direccion, credito_dias),
    pedidos(tipo_pago),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).eq('id', cuerpo.comprobante_id).maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'El comprobante no existe' }, { status: 404 })

  const c = data as any
  if (!['factura', 'boleta'].includes(c.tipo)) {
    // Los documentos internos no llevan firma ni QR de SUNAT: no se declaran.
    return NextResponse.json({ firmado: false, motivo: 'Documento interno' })
  }
  // Un comprobante ya declarado conserva el XML que se envió; volver a firmarlo
  // produciría otro digest y el QR dejaría de coincidir con lo declarado.
  if (c.enviado_sunat) {
    return NextResponse.json({ firmado: false, motivo: 'Ya declarado: conserva su firma original' })
  }

  try {
    const conf = await configuracionSunat()

    const items: ItemUbl[] = (c.comprobantes_items ?? []).map((it: any) => ({
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      igv_porcentaje: it.igv_porcentaje ?? 18,
      descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
      codigo: it.productos?.codigo ?? null,
      unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
    }))

    const diasCredito = Number(c.clientes?.credito_dias ?? 0)
    const esCredito = c.pedidos?.tipo_pago === 'credito' && diasCredito > 0
    let vencimiento: string | null = null
    if (esCredito) {
      const d = new Date(`${c.fecha_emision}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + diasCredito)
      vencimiento = d.toISOString().slice(0, 10)
    }

    const { xml } = construirInvoice({
      comprobante: {
        serie: c.serie, numero: c.numero, tipo: c.tipo,
        fecha_emision: c.fecha_emision, moneda: 'PEN',
        forma_pago: esCredito ? 'credito' : 'contado',
        fecha_vencimiento: vencimiento,
        cliente: c.clientes,
      },
      emisor: EMISOR_SUNAT,
      items,
    })

    const firmado = firmarXml(xml, conf.certificado)
    await (admin as any).from('comprobantes').update({ sunat_xml: firmado }).eq('id', c.id)

    return NextResponse.json({
      firmado: true,
      comprobante: `${c.serie}-${c.numero}`,
      resumen: firmado.match(/<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/)?.[1]?.trim() ?? null,
    })
  } catch (e) {
    /*
     * Que falle la firma no puede romper la emisión: el comprobante ya existe
     * y el pedido ya está facturado. Se informa y se sigue; el QR sale sin el
     * valor resumen, que la norma permite, y se vuelve a firmar más tarde.
     */
    return NextResponse.json({
      firmado: false,
      motivo: e instanceof Error ? e.message : 'No se pudo firmar',
    }, { status: 200 })
  }
}
