/**
 * Declarar una guía de remisión ante SUNAT, y saber cómo salió.
 *
 * Vive acá y no en la ruta para que la usen igual la pantalla de guías, la
 * emisión desde Facturación y cualquier regularización: las mismas barreras,
 * los mismos datos.
 *
 * Lo que la diferencia de una factura (ver `declarar.ts`):
 *
 *   - Se declara AL EMITIRLA, antes de que salga el camión. En transporte
 *     privado la guía electrónica se emite antes del inicio del traslado: no
 *     hay días de margen como con los comprobantes. Por eso la fecha de emisión
 *     es el momento del envío, y el traslado puede ser hoy o un día posterior.
 *   - No hay ambiente de pruebas: todo envío es real.
 *   - SUNAT responde con un ticket y el veredicto llega en una consulta aparte;
 *     se pregunta varias veces seguidas para tenerlo en el momento.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { EMISOR_GRE, type ConfiguracionGre } from './gre-config'
import { construirGuiaRemision, type ItemGuia } from './gre-ubl'
import { firmarXml } from './firma'
import { obtenerToken, comprimirGuia, enviarGuia, consultarTicket } from './gre-envio'
import { hoyLima } from '@/lib/fechas-pe'

export interface ResultadoGuia {
  ok: boolean
  guia: string
  estado?: 'aceptado' | 'rechazado' | 'procesando' | 'error' | 'desconocido'
  ticket?: string | null
  codigo?: string | null
  mensaje?: string | null
  /** Por qué no se envió, si no se envió. */
  motivo?: string
  /** Solo en un ensayo: el XML firmado que se habría enviado. */
  xml?: string
  estadoHttp?: number
}

const SELECT = `
  id, serie, numero, estado, enviado_sunat, sunat_ticket, sunat_estado, sunat_intentos,
  fecha_emision, fecha_inicio_traslado, motivo_traslado, motivo_descripcion,
  modalidad_traslado, punto_partida, punto_llegada, ubigeo_partida, ubigeo_llegada,
  peso_bruto_total, unidad_peso, vehiculo_placa,
  conductor_nombre, conductor_doc, conductor_licencia,
  transportista_ruc, transportista_razon_social,
  cliente_externo_nombre, cliente_externo_doc,
  clientes(razon_social, ruc, dni, ubigeo),
  comprobantes(tipo, serie, numero),
  guias_remision_items(codigo, descripcion, cantidad, unidad_medida, orden)
`

const nombreDe = (g: { serie: string; numero: number | string }) =>
  `${g.serie}-${String(g.numero).padStart(8, '0')}`

/** Hora de Lima, HH:MM:SS. */
function horaLima(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date())
}

/**
 * Nombres y apellidos del conductor, del maestro de conductores.
 *
 * En la guía viene un solo texto, "AGUILAR JARRO VALERIO", y partirlo a ojo
 * daba nombres "AGUILAR JARRO" y apellido "VALERIO". El maestro los tiene por
 * separado; se busca por DNI. Si no está, se asume el orden peruano: dos
 * apellidos y después los nombres.
 */
async function conductor(admin: any, doc: string, texto: string) {
  const { data } = await admin.from('conductores')
    .select('nombres, apellido_paterno, apellido_materno, licencia_numero')
    .eq('dni', doc.trim()).maybeSingle()
  if (data?.nombres) {
    return {
      nombres: String(data.nombres).trim(),
      apellidos: `${String(data.apellido_paterno ?? '').trim()} ${String(data.apellido_materno ?? '').trim()}`.trim(),
      licencia: data.licencia_numero as string | null,
    }
  }
  const p = texto.trim().split(/\s+/)
  return {
    nombres: (p.length > 2 ? p.slice(2) : p.slice(-1)).join(' ') || '-',
    apellidos: (p.length > 2 ? p.slice(0, 2) : p.slice(0, 1)).join(' ') || '-',
    licencia: null,
  }
}

async function anotar(admin: any, id: string, campos: Record<string, unknown>) {
  await admin.from('guias_remision').update(campos).eq('id', id)
}

/** Consultar el ticket de un envío anterior y anotar el veredicto. */
export async function consultarGuia(guiaId: string, conf: ConfiguracionGre, intentos = 1): Promise<ResultadoGuia> {
  const admin = createAdminClient() as any
  const { data: g } = await admin.from('guias_remision')
    .select('id, serie, numero, sunat_ticket, sunat_estado').eq('id', guiaId).maybeSingle()
  if (!g) return { ok: false, guia: '', motivo: 'La guía no existe', estadoHttp: 404 }
  const nombre = nombreDe(g)
  if (!g.sunat_ticket) return { ok: false, guia: nombre, motivo: `${nombre} todavía no se envió a SUNAT`, estadoHttp: 409 }

  const token = await obtenerToken(conf.credenciales!)
  let r = await consultarTicket({ token, ticket: g.sunat_ticket })
  for (let i = 1; i < intentos && r.estado === 'procesando'; i++) {
    await new Promise((res) => setTimeout(res, 2500))
    r = await consultarTicket({ token, ticket: g.sunat_ticket })
  }
  if (r.estado === 'desconocido') {
    // No se pudo saber: se deja como estaba, para volver a consultar.
    return { ok: false, guia: nombre, estado: r.estado, ticket: g.sunat_ticket, codigo: r.codigo, mensaje: r.mensaje }
  }
  await anotar(admin, g.id, {
    sunat_estado: r.estado,
    sunat_codigo: r.codigo,
    sunat_mensaje: r.mensaje,
    ...(r.cdrZipBase64 ? { sunat_cdr: r.cdrZipBase64 } : {}),
    enviado_sunat: r.estado === 'aceptado',
  })
  return {
    ok: r.estado === 'aceptado', guia: nombre, estado: r.estado,
    ticket: g.sunat_ticket, codigo: r.codigo, mensaje: r.mensaje,
  }
}

/**
 * Declarar la guía. Si SUNAT la recibe, se consulta enseguida el ticket hasta
 * tener el veredicto (o quedar "procesando" para consultar después).
 */
export async function declararGuia(
  guiaId: string,
  conf: ConfiguracionGre,
  opciones: { soloArmar?: boolean } = {},
): Promise<ResultadoGuia> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('guias_remision').select(SELECT).eq('id', guiaId).maybeSingle()
  if (error) return { ok: false, guia: '', motivo: error.message, estadoHttp: 500 }
  if (!data) return { ok: false, guia: '', motivo: 'La guía no existe', estadoHttp: 404 }
  const g = data as any
  const nombre = nombreDe(g)
  const no = (motivo: string, estadoHttp = 409): ResultadoGuia => ({ ok: false, guia: nombre, motivo, estadoHttp })

  if (g.estado === 'anulada') return no(`${nombre} está anulada`, 400)
  if (g.enviado_sunat) return no(`${nombre} ya fue aceptada por SUNAT. Para dejarla sin efecto hay que darla de baja.`)
  if (g.sunat_estado === 'procesando' && g.sunat_ticket) {
    // Ya está en SUNAT: en vez de reenviar, se pregunta.
    return await consultarGuia(guiaId, conf, 4)
  }

  if (!conf.declararDesde) return no('No hay fecha de inicio configurada para las guías. Hasta fijarla no se declara ninguna.')
  const hoy = hoyLima()
  const traslado = String(g.fecha_inicio_traslado ?? '').slice(0, 10)
  if (traslado < conf.declararDesde) {
    return no(`${nombre} es del traslado del ${traslado}, anterior al inicio (${conf.declararDesde}).`)
  }
  if (traslado < hoy) {
    return no(`${nombre} es de un traslado que ya pasó (${traslado}). Una guía se declara antes de que salga el camión, no después.`)
  }

  const cli = g.clientes ?? {}
  const ubigeoPartida = String(g.ubigeo_partida ?? '').trim()
  const ubigeoLlegada = String(g.ubigeo_llegada ?? cli.ubigeo ?? '').trim()
  const cond = await conductor(admin, String(g.conductor_doc ?? ''), String(g.conductor_nombre ?? ''))

  const items: ItemGuia[] = ((g.guias_remision_items ?? []) as any[])
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map((it) => ({
      codigo: it.codigo ?? null,
      descripcion: (it.descripcion ?? '').trim() || 'PRODUCTO',
      cantidad: Number(it.cantidad ?? 0),
      unidad: it.unidad_medida || 'NIU',
    }))

  let firmado: string
  let nombreArchivo: string
  try {
    const armado = construirGuiaRemision({
      guia: {
        serie: g.serie,
        numero: g.numero,
        // La emisión electrónica es ahora, cuando se envía.
        fecha_emision: hoy,
        hora_emision: horaLima(),
        fecha_inicio_traslado: traslado,
        motivo_traslado: g.motivo_traslado,
        motivo_descripcion: g.motivo_descripcion,
        peso_bruto_total: Number(g.peso_bruto_total ?? 0),
        unidad_peso: g.unidad_peso || 'KGM',
        partida: { ubigeo: ubigeoPartida, direccion: g.punto_partida ?? '' },
        llegada: { ubigeo: ubigeoLlegada, direccion: g.punto_llegada ?? '' },
        destinatario: {
          razon_social: cli.razon_social ?? g.cliente_externo_nombre ?? '—',
          ruc: cli.ruc ?? null,
          dni: cli.dni ?? g.cliente_externo_doc ?? null,
        },
        transporte: {
          modalidad: g.modalidad_traslado,
          placa: g.vehiculo_placa,
          conductor_nombres: cond.nombres,
          conductor_apellidos: cond.apellidos,
          conductor_doc: g.conductor_doc,
          conductor_licencia: g.conductor_licencia || cond.licencia,
          transportista_ruc: g.transportista_ruc,
          transportista_razon_social: g.transportista_razon_social,
        },
        comprobante_relacionado: g.comprobantes
          ? { tipo: g.comprobantes.tipo === 'factura' ? '01' : '03', serie: g.comprobantes.serie, numero: g.comprobantes.numero }
          : null,
      },
      emisor: EMISOR_GRE,
      items,
    })
    firmado = firmarXml(armado.xml, conf.certificado!)
    nombreArchivo = armado.nombreArchivo
  } catch (e) {
    // Faltan datos: se dice cuál, sin tocar SUNAT ni sumar intentos.
    return no(e instanceof Error ? e.message : 'No se pudo armar la guía', 422)
  }

  // Ensayo: se arma y firma igual que de verdad, y no se manda.
  if (opciones.soloArmar) return { ok: true, guia: nombre, estado: 'desconocido', xml: firmado }

  try {
    const zip = await comprimirGuia(nombreArchivo, firmado)
    const token = await obtenerToken(conf.credenciales!)
    const r = await enviarGuia({ token, nombreArchivo, zip })

    await anotar(admin, g.id, {
      sunat_ticket: r.ticket ?? null,
      sunat_estado: r.ok ? 'procesando' : 'error',
      sunat_codigo: r.codigo ?? null,
      sunat_mensaje: r.mensaje ?? null,
      sunat_xml: firmado,
      sunat_enviado_at: new Date().toISOString(),
      sunat_intentos: (g.sunat_intentos ?? 0) + 1,
      // Lo que se declaró es la emisión de ahora: el impreso tiene que decir lo mismo.
      fecha_emision: new Date().toISOString(),
    })
    if (!r.ok) {
      return { ok: false, guia: nombre, estado: 'error', codigo: r.codigo ?? null, mensaje: r.mensaje ?? null }
    }
    // El veredicto llega aparte: se pregunta unas veces seguidas.
    await new Promise((res) => setTimeout(res, 2000))
    return await consultarGuia(guiaId, conf, 5)
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error inesperado al enviar la guía'
    await anotar(admin, g.id, {
      sunat_estado: 'error',
      sunat_mensaje: mensaje,
      sunat_enviado_at: new Date().toISOString(),
      sunat_intentos: (g.sunat_intentos ?? 0) + 1,
    })
    return { ok: false, guia: nombre, estado: 'error', motivo: mensaje, estadoHttp: 500 }
  }
}

/**
 * Lo que SUNAT deja leer de la constancia de una guía: el código, la
 * descripción y el enlace para el QR de la representación impresa.
 */
export async function leerCdrGuia(cdrZipBase64: string) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(Buffer.from(cdrZipBase64, 'base64'))
  const nombre = Object.keys(zip.files).find((f) => f.toLowerCase().endsWith('.xml'))
  const xml = nombre ? await zip.file(nombre)!.async('string') : ''
  return {
    codigo: xml.match(/<cbc:ResponseCode>([\s\S]*?)<\/cbc:ResponseCode>/)?.[1]?.trim() ?? null,
    descripcion: xml.match(/<cbc:Description>([\s\S]*?)<\/cbc:Description>/)?.[1]?.trim() ?? null,
    // SUNAT manda en la constancia de la guía la dirección para el QR.
    urlQr: xml.match(/<cbc:DocumentDescription>(https?:[^<]+)<\/cbc:DocumentDescription>/)?.[1]?.trim()
      ?? xml.match(/(https?:\/\/[^<\s"]*descargaqr[^<\s"]*)/i)?.[1]?.trim()
      ?? null,
  }
}
