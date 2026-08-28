import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { configuracionSunat, EMISOR_SUNAT } from '@/lib/sunat/config'
import { construirInvoice, type ItemUbl } from '@/lib/sunat/ubl'
import { firmarXml, comprimir, enviarASunat } from '@/lib/sunat/firma'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Enviar un comprobante a SUNAT.
 *
 * Un envío a producción no se deshace: el comprobante queda declarado y para
 * dejarlo sin efecto hay que emitir una nota de crédito o una comunicación de
 * baja, cada una con su plazo. Por eso acá hay tres barreras antes de tocar el
 * servicio real, y hay que pasarlas todas:
 *
 *   1. Quien llama tiene que estar autenticado y ser administrador o facturador
 *   2. El sistema tiene que estar en modo producción CON credenciales cargadas
 *      (lo resuelve `configuracionSunat`, no esta ruta)
 *   3. Quien manda tiene que declarar contra qué modo cree que está enviando
 *
 * La tercera es la que evita el accidente de verdad. Si la pantalla cree que
 * está en pruebas y el servidor está en producción, el envío se rechaza en vez
 * de emitir algo real que nadie esperaba.
 */
export async function POST(req: Request) {
  // ── 1. Quién llama ────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: perfil } = await (supabase as any)
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!perfil || !['administrador', 'facturador'].includes(perfil.role)) {
    return NextResponse.json({ error: 'Sin permisos para enviar comprobantes a SUNAT' }, { status: 403 })
  }

  const cuerpo = await req.json().catch(() => ({})) as {
    comprobante_id?: string
    modo_esperado?: string
  }
  if (!cuerpo.comprobante_id) {
    return NextResponse.json({ error: 'Falta comprobante_id' }, { status: 400 })
  }

  let conf
  try {
    conf = await configuracionSunat()
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo leer la configuración de SUNAT' },
      { status: 500 },
    )
  }

  // ── 3. Que las dos partes estén de acuerdo sobre a dónde se envía ────────
  if (cuerpo.modo_esperado && cuerpo.modo_esperado !== conf.modo) {
    return NextResponse.json({
      error: `No se envió nada. La pantalla cree que el sistema está en "${cuerpo.modo_esperado}" `
        + `y en realidad está en "${conf.modo}". Recargá la página y volvé a intentar.`,
    }, { status: 409 })
  }

  // ── El comprobante ───────────────────────────────────────────────────────
  const admin = createAdminClient()
  const { data, error } = await (admin as any).from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, total, estado, enviado_sunat, sunat_modo, sunat_intentos,
    clientes(razon_social, ruc, dni, direccion, credito_dias),
    pedidos(tipo_pago),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).eq('id', cuerpo.comprobante_id).maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'El comprobante no existe' }, { status: 404 })

  const c = data as any
  if (c.estado === 'anulado') {
    return NextResponse.json({ error: 'El comprobante está anulado' }, { status: 400 })
  }
  if (!['factura', 'boleta'].includes(c.tipo)) {
    return NextResponse.json({ error: `Los documentos de tipo "${c.tipo}" no se declaran a SUNAT` }, { status: 400 })
  }
  /*
   * La fecha de corte. Los 409 comprobantes que el ERP emitió antes de
   * conectarse a SUNAT no se declaran: la sincronización arranca el día que el
   * sistema entra en línea.
   *
   * El corte lo hace el servidor y no la pantalla, porque el accidente que hay
   * que evitar es justamente el de la pantalla: un filtro mal puesto, un
   * "seleccionar todo", y salen cuatrocientos comprobantes fuera de plazo que
   * después hay que anular de a uno.
   *
   * En beta no aplica: ahí nada queda declarado y conviene poder probar con
   * cualquier comprobante.
   */
  if (conf.modo === 'produccion') {
    if (!conf.sincronizarDesde) {
      return NextResponse.json({
        error: 'No hay fecha de inicio de sincronización configurada. Hasta fijarla, no se declara ningún comprobante.',
      }, { status: 409 })
    }
    if (c.fecha_emision < conf.sincronizarDesde) {
      return NextResponse.json({
        error: `${c.serie}-${c.numero} es del ${c.fecha_emision}, anterior al inicio de la sincronización `
          + `(${conf.sincronizarDesde}). Los comprobantes históricos no se declaran.`,
      }, { status: 409 })
    }
  }

  // Reenviar algo ya aceptado en producción devolvería 4000 y no aporta nada.
  if (c.enviado_sunat && c.sunat_modo === 'produccion' && conf.modo === 'produccion') {
    return NextResponse.json({
      error: `${c.serie}-${c.numero} ya fue aceptado por SUNAT. Para dejarlo sin efecto hay que emitir una nota de crédito.`,
    }, { status: 409 })
  }

  // ── Armar, firmar y enviar ───────────────────────────────────────────────
  const items: ItemUbl[] = (c.comprobantes_items ?? []).map((it: any) => ({
    cantidad: Number(it.cantidad),
    precio_unitario: Number(it.precio_unitario),
    igv_porcentaje: it.igv_porcentaje ?? 18,
    descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
    codigo: it.productos?.codigo ?? null,
    unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
  }))

  /*
   * El vencimiento sale de los dias de credito del cliente, no de un valor por
   * omision. Si el cliente no tiene dias pactados no hay plazo que declarar y
   * la venta va como contado: es lo que realmente se acordo.
   *
   * Hoy los 83 comprobantes marcados a credito son de clientes con cero dias,
   * asi que todos caen en este caso. Cuando Daniel cargue los plazos reales de
   * cada cliente, empezaran a declararse como credito solos.
   */
  const diasCredito = Number(c.clientes?.credito_dias ?? 0)
  const esCredito = c.pedidos?.tipo_pago === 'credito' && diasCredito > 0
  let vencimiento: string | null = null
  if (esCredito) {
    const d = new Date(`${c.fecha_emision}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + diasCredito)
    vencimiento = d.toISOString().slice(0, 10)
  }

  try {
    const { xml, nombreArchivo, totales } = construirInvoice({
      comprobante: {
        serie: c.serie, numero: c.numero, tipo: c.tipo,
        fecha_emision: c.fecha_emision,
        moneda: 'PEN',
        forma_pago: esCredito ? 'credito' : 'contado',
        fecha_vencimiento: vencimiento,
        cliente: c.clientes,
      },
      emisor: EMISOR_SUNAT,
      items,
    })

    // El total declarado tiene que ser el mismo que el cliente tiene impreso.
    // Si no coincide, se corta antes de declarar nada.
    if (Math.abs(totales.total - Number(c.total)) > 0.005) {
      return NextResponse.json({
        error: `No se envió: el total calculado (S/ ${totales.total.toFixed(2)}) no coincide con el del `
          + `comprobante (S/ ${Number(c.total).toFixed(2)}).`,
      }, { status: 422 })
    }

    const firmado = firmarXml(xml, conf.certificado)
    const zip = await comprimir(nombreArchivo, firmado)
    const r = await enviarASunat({
      modo: conf.modo, usuario: conf.usuario, clave: conf.clave, nombreArchivo, zip,
    })

    // 4000 es "ya fue presentado": el comprobante está en SUNAT igual.
    const aceptado = r.codigo === '0' || r.codigo === '4000'

    await (admin as any).from('comprobantes').update({
      enviado_sunat: aceptado,
      sunat_estado: aceptado ? 'aceptado' : 'rechazado',
      sunat_codigo: r.codigo,
      sunat_mensaje: r.mensaje,
      sunat_observaciones: r.observaciones ?? null,
      sunat_cdr: r.cdrZipBase64 ?? null,
      sunat_xml: firmado,
      sunat_modo: conf.modo,
      sunat_enviado_at: new Date().toISOString(),
      sunat_intentos: (c.sunat_intentos ?? 0) + 1,
    }).eq('id', c.id)

    return NextResponse.json({
      ok: aceptado,
      modo: conf.modo,
      razon: conf.razon,
      comprobante: `${c.serie}-${c.numero}`,
      codigo: r.codigo,
      mensaje: r.mensaje,
      observaciones: r.observaciones ?? [],
      declarado: aceptado && conf.modo === 'produccion',
    })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error inesperado al enviar'
    await (admin as any).from('comprobantes').update({
      sunat_estado: 'error',
      sunat_mensaje: mensaje,
      sunat_enviado_at: new Date().toISOString(),
      sunat_intentos: (c.sunat_intentos ?? 0) + 1,
    }).eq('id', c.id)
    return NextResponse.json({ error: mensaje }, { status: 500 })
  }
}

/** Con qué servicio está hablando el sistema. Lo consulta la pantalla. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  try {
    const conf = await configuracionSunat()
    return NextResponse.json({
      modo: conf.modo,
      razon: conf.razon,
      envio_automatico: conf.envioAutomatico,
      sincronizar_desde: conf.sincronizarDesde,
      certificado: {
        titular: conf.certificado.titular,
        vence: conf.certificado.vence.toISOString().slice(0, 10),
      },
    })
  } catch (e) {
    return NextResponse.json({
      modo: null,
      error: e instanceof Error ? e.message : 'No se pudo leer la configuración',
    }, { status: 500 })
  }
}
