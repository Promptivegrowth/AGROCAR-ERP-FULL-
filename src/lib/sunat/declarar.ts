/**
 * Declarar un comprobante ante SUNAT.
 *
 * Todo lo que decide si un comprobante se declara o no vive acá, en una sola
 * función, y no repartido entre la pantalla y el proceso automático. Esa es la
 * razón de que este archivo exista: el envío automático corre de madrugada, sin
 * nadie mirando, y no puede tener barreras más flojas que el botón que aprieta
 * una persona. Si están en dos lugares, tarde o temprano se separan.
 *
 * Lo que se comprueba antes de tocar el servicio de SUNAT:
 *
 *   - el comprobante existe, no está anulado y es de un tipo que se declara
 *   - no está fechado adelante (código 2329)
 *   - en producción: es posterior a la fecha de inicio de sincronización
 *   - no fue ya aceptado en producción
 *   - el total que se va a declarar es el mismo que el cliente tiene impreso
 *
 * Quién puede pedirlo y contra qué modo se envía se resuelve afuera: acá ya
 * llega la configuración decidida.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { EMISOR_SUNAT, type ConfiguracionSunat } from './config'
import { construirInvoice, type ItemUbl } from './ubl'
import { firmarXml, comprimir, enviarASunat } from './firma'
import { hoyLima } from '@/lib/fechas-pe'
import { sumarDias } from './plazo'
import { condicionDePago } from '@/lib/condicion-pago'
import { consultarEnSunat } from './consulta'

/**
 * SUNAT dice que ese número ya lo tiene. Pasa cuando un envío anterior llegó
 * pero la respuesta se perdió (se cortó la conexión, se venció el tiempo).
 */
const YA_REGISTRADO = /registrado previamente|ya (fue|ha sido) (registrad|informad|presentad)/i

/**
 * Si SUNAT ya tiene el comprobante aceptado, se anota como declarado con la
 * constancia que devuelve la consulta, sin volver a enviarlo. Devuelve null si
 * SUNAT no lo tiene aceptado.
 */
async function recuperarDeSunat(
  admin: any,
  c: { id: string; tipo: string; serie: string; numero: string },
  nombre: string,
): Promise<ResultadoDeclaracion | null> {
  const consulta = await consultarEnSunat(c)
  if (consulta.estado !== 'aceptado') return null
  const ahora = new Date().toISOString()
  await admin.from('comprobantes').update({
    enviado_sunat: true,
    sunat_estado: 'aceptado',
    sunat_modo: 'produccion',
    sunat_codigo: consulta.cdrCodigo ?? '0',
    sunat_mensaje: consulta.cdrMensaje ?? consulta.mensaje,
    ...(consulta.cdrZipBase64 ? { sunat_cdr: consulta.cdrZipBase64 } : {}),
    sunat_enviado_at: ahora,
    sunat_verificado_at: ahora,
    sunat_verificacion: 'aceptado',
  }).eq('id', c.id)
  return {
    ok: true,
    comprobante: nombre,
    codigo: consulta.cdrCodigo ?? '0',
    mensaje: 'SUNAT ya lo tenía aceptado de un envío anterior: se recuperó la constancia sin reenviarlo.',
    declarado: true,
  }
}

export interface ResultadoDeclaracion {
  ok: boolean
  /** Por qué no se envió, cuando no se envió. Vacío si se llegó a SUNAT. */
  motivo?: string
  /** Qué código HTTP le corresponde al motivo, para quien responda una ruta. */
  estadoHttp?: number
  comprobante: string
  codigo?: string | null
  mensaje?: string | null
  observaciones?: string[]
  /** Quedó declarado de verdad ante SUNAT (producción, no pruebas). */
  declarado: boolean
  /** Cuando se rechaza por fecha futura: el día en que sí se puede enviar. */
  programadoPara?: string
}

const SELECT = `
  id, serie, numero, tipo, fecha_emision, total, estado, enviado_sunat, sunat_modo, sunat_intentos,
  clientes(razon_social, ruc, dni, direccion, credito_dias),
  pedidos(tipo_pago),
  comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
    productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
`

export async function declararComprobante(
  comprobanteId: string,
  conf: ConfiguracionSunat,
): Promise<ResultadoDeclaracion> {
  const admin = createAdminClient()
  const { data, error } = await (admin as any)
    .from('comprobantes').select(SELECT).eq('id', comprobanteId).maybeSingle()

  if (error) {
    return { ok: false, motivo: error.message, estadoHttp: 500, comprobante: '', declarado: false }
  }
  if (!data) {
    return { ok: false, motivo: 'El comprobante no existe', estadoHttp: 404, comprobante: '', declarado: false }
  }

  const c = data as any
  const nombre = `${c.serie}-${c.numero}`

  /*
   * Negarse a enviar, con o sin constancia.
   *
   * Hay dos clases de negativa y no se anotan igual. "Todavía no es su fecha" o
   * "es anterior al inicio de la sincronización" son respuestas normales: el
   * comprobante está bien y no hay nada que arreglar, así que no se le escribe
   * nada encima.
   *
   * Pero cuando algo está realmente mal -el total no cuadra con el impreso- hay
   * que dejarlo anotado. Si no, el envío automático de la madrugada lo saltea
   * todos los días sin que nadie se entere: el comprobante se queda para
   * siempre "sin declarar" y en pantalla no se distingue de uno que todavía no
   * llegó a su día.
   */
  const no = async (
    motivo: string,
    estadoHttp: number,
    extra: Partial<ResultadoDeclaracion> & { anotar?: boolean } = {},
  ): Promise<ResultadoDeclaracion> => {
    const { anotar, ...resto } = extra
    if (anotar) {
      await (admin as any).from('comprobantes').update({
        sunat_estado: 'error',
        sunat_mensaje: motivo,
        sunat_enviado_at: new Date().toISOString(),
      }).eq('id', c.id)
    }
    return { ok: false, motivo, estadoHttp, comprobante: nombre, declarado: false, ...resto }
  }

  if (c.estado === 'anulado') return await no('El comprobante está anulado', 400)
  if (!['factura', 'boleta'].includes(c.tipo)) {
    return await no(`Los documentos de tipo "${c.tipo}" no se declaran a SUNAT`, 400)
  }

  /*
   * Nada se declara antes de su fecha de emisión.
   *
   * Los comprobantes se imprimen la noche anterior al reparto porque el camión
   * sale a las 3:30 de la mañana y a esa hora no hay nadie en la oficina. Salen
   * fechados el día en que se entrega la mercadería, que es el que corresponde
   * según el art. 5 del Reglamento de Comprobantes de Pago.
   *
   * Ese papel ya está impreso y su QR ya está calculado sobre esa fecha, así
   * que la fecha no se toca: lo que se hace es esperar. Enviarlo antes lo haría
   * rechazar con el código 2329 —"la fecha de emisión se encuentra fuera del
   * límite permitido"— y dejaría marcado como rechazado un comprobante que no
   * tiene nada malo.
   */
  const hoy = hoyLima()
  if (c.fecha_emision > hoy) {
    return await no(
      `${nombre} está fechado el ${c.fecha_emision} y hoy es ${hoy}. SUNAT no recibe comprobantes antes de su fecha de emisión.`,
      409, { programadoPara: c.fecha_emision },
    )
  }

  /*
   * La fecha de corte. Los comprobantes que el ERP emitió antes de conectarse a
   * SUNAT no se declaran: la sincronización arranca el día que el sistema entra
   * en línea. El corte lo hace el servidor y no la pantalla, porque el
   * accidente que hay que evitar es el de un filtro mal puesto que declare
   * cientos de comprobantes fuera de plazo.
   *
   * En beta no aplica: ahí nada queda declarado.
   */
  if (conf.modo === 'produccion') {
    if (!conf.sincronizarDesde) {
      return await no('No hay fecha de inicio de sincronización configurada. Hasta fijarla, no se declara ningún comprobante.', 409)
    }
    if (c.fecha_emision < conf.sincronizarDesde) {
      return await no(
        `${nombre} es del ${c.fecha_emision}, anterior al inicio de la sincronización `
        + `(${conf.sincronizarDesde}). Los comprobantes históricos no se declaran.`, 409,
      )
    }
  }

  // Reenviar algo ya aceptado en producción devolvería 4000 y no aporta nada.
  if (c.enviado_sunat && c.sunat_modo === 'produccion' && conf.modo === 'produccion') {
    return await no(`${nombre} ya fue aceptado por SUNAT. Para dejarlo sin efecto hay que emitir una nota de crédito.`, 409)
  }

  const items: ItemUbl[] = (c.comprobantes_items ?? []).map((it: any) => ({
    cantidad: Number(it.cantidad),
    precio_unitario: Number(it.precio_unitario),
    igv_porcentaje: it.igv_porcentaje ?? 18,
    descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
    codigo: it.productos?.codigo ?? null,
    unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
  }))

  /*
   * Contado o crédito según cómo se vendió (el pedido); el plazo, el del
   * cliente o 7 días. La misma regla que el papel impreso: lib/condicion-pago.
   */
  const cond = condicionDePago(c.pedidos?.tipo_pago, c.clientes?.credito_dias, c.fecha_emision)
  const esCredito = cond.credito
  const vencimiento = cond.vencimiento

  let tengoLaReserva = false
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

    /*
     * El total declarado tiene que ser el mismo que el cliente tiene impreso.
     *
     * Cuando no coinciden suele ser por un céntimo, en productos que se venden
     * por peso: 3.150 kg x 23.50 da 74.025, justo en la mitad, y el ERP y el
     * XML pueden redondear para lados distintos. Es poco -5 de 810 al momento
     * de escribir esto- pero no se puede declarar un importe distinto del que
     * está en el papel, así que se corta.
     *
     * Se anota en el comprobante para que aparezca en pantalla: si no, el envío
     * automático lo saltearía cada madrugada sin dejar rastro.
     */
    if (Math.abs(totales.total - Number(c.total)) > 0.005) {
      return await no(
        `No se envió: el total calculado (S/ ${totales.total.toFixed(2)}) no coincide con el del `
        + `comprobante (S/ ${Number(c.total).toFixed(2)}). Diferencia de `
        + `S/ ${Math.abs(totales.total - Number(c.total)).toFixed(2)} por redondeo.`,
        422, { anotar: true },
      )
    }

    /*
     * Reservar el comprobante para este proceso. Pueden coincidir el envío de
     * la mañana, el de respaldo y alguien apretando "Declarar": el primero se
     * lo queda y los demás lo saltan. Mientras dura, la base no deja editarlo
     * (migración 116), así que SUNAT recibe exactamente lo que queda guardado.
     */
    const { data: reservado, error: errReserva } = await (admin as any)
      .rpc('reservar_envio_sunat', { p_comprobante_id: c.id })
    if (errReserva) throw new Error(`No se pudo reservar el envío: ${errReserva.message}`)
    if (!reservado) {
      return { ok: false, motivo: `${nombre} ya se está enviando o ya fue declarado.`, estadoHttp: 409, comprobante: nombre, declarado: false }
    }
    tengoLaReserva = true

    /*
     * Si ya hubo un intento, antes de reenviar se pregunta. Un envío que llegó
     * a SUNAT pero cuya respuesta se perdió figura acá como error; reenviarlo
     * rebotaría por duplicado. Si SUNAT lo tiene aceptado, se recupera.
     */
    if (conf.modo === 'produccion' && (c.sunat_intentos ?? 0) > 0) {
      const recuperado = await recuperarDeSunat(admin, c, nombre)
      if (recuperado) return recuperado
    }

    const firmado = firmarXml(xml, conf.certificado)
    const zip = await comprimir(nombreArchivo, firmado)
    const r = await enviarASunat({
      modo: conf.modo, usuario: conf.usuario, clave: conf.clave, nombreArchivo, zip,
    })

    // SUNAT dice que ya lo tiene: se consulta y, si está aceptado, se recupera
    // en lugar de marcarlo rechazado.
    if (conf.modo === 'produccion' && r.codigo !== '0' && YA_REGISTRADO.test(r.mensaje ?? '')) {
      const recuperado = await recuperarDeSunat(admin, c, nombre)
      if (recuperado) return recuperado
    }

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

    return {
      ok: aceptado,
      comprobante: nombre,
      codigo: r.codigo,
      mensaje: r.mensaje,
      observaciones: r.observaciones ?? [],
      declarado: aceptado && conf.modo === 'produccion',
    }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error inesperado al enviar'
    let falla = (admin as any).from('comprobantes').update({
      sunat_estado: 'error',
      sunat_mensaje: mensaje,
      sunat_enviado_at: new Date().toISOString(),
      sunat_intentos: (c.sunat_intentos ?? 0) + 1,
    }).eq('id', c.id)
    // Sin la reserva, no se pisa el "enviando" de otro proceso.
    if (!tengoLaReserva) falla = falla.or('sunat_estado.is.null,sunat_estado.neq.enviando')
    await falla
    return { ok: false, motivo: mensaje, estadoHttp: 500, comprobante: nombre, declarado: false }
  }
}

/**
 * Qué comprobantes toca declarar hoy.
 *
 * Los que ya cumplieron sus días de espera —el margen para editar o anular,
 * ver `plazo.ts`— y todavía no fueron aceptados, ordenados por fecha para que
 * si el plazo de alguno está por vencerse salga primero. Los que se pasaron de
 * su día de envío sin salir (un envío que falló) siguen entrando: el día de
 * reserva es para eso.
 *
 * La fecha de corte se respeta acá SIEMPRE, también en pruebas, y esa es la
 * diferencia con el envío manual. Enviar de a uno lo elige una persona que sabe
 * lo que está haciendo; un barrido automático sin corte agarraría los cientos de
 * comprobantes que el ERP emitió antes de conectarse a SUNAT y los marcaría como
 * enviados. En pruebas no se declararía nada, pero quedarían con
 * `enviado_sunat` en verdadero, y el día que el sistema pase a producción el
 * propio barrido los saltearía por estar "ya enviados". Un estado falso que se
 * arregla a mano.
 *
 * Sin fecha de corte configurada no devuelve nada: el barrido no arranca a
 * ciegas.
 */
export async function comprobantesPendientes(conf: ConfiguracionSunat, limite = 200) {
  if (!conf.sincronizarDesde) return []

  const admin = createAdminClient()
  const { data, error } = await (admin as any).from('comprobantes')
    .select('id, serie, numero, fecha_emision')
    .in('tipo', ['factura', 'boleta'])
    .neq('estado', 'anulado')
    .eq('enviado_sunat', false)
    .gte('fecha_emision', conf.sincronizarDesde)
    // Emitido hace al menos `diasEspera` días: con 2, el 03/10 sale lo del 01/10.
    .lte('fecha_emision', sumarDias(hoyLima(), -conf.diasEspera))
    .order('fecha_emision', { ascending: true })
    // Dentro del mismo día, en orden de correlativo.
    .order('serie', { ascending: true })
    .order('numero', { ascending: true })
    .limit(limite)

  if (error) throw new Error(error.message)
  return (data ?? []) as { id: string; serie: string; numero: string; fecha_emision: string }[]
}
