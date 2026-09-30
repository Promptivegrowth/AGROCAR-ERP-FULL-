/**
 * Enviar la guía de remisión a SUNAT.
 *
 * La guía NO viaja por donde viajan las facturas. Son dos mundos distintos y
 * conviene tenerlo presente al leer esto:
 *
 *                      facturas y boletas          guía de remisión
 *   canal              SOAP (billService)          API REST
 *   credenciales       usuario y clave SOL         client_id + client_secret
 *   autenticación      en la cabecera del envío    OAuth2, token aparte
 *   respuesta          el CDR, al momento          un ticket; el resultado se
 *                                                  consulta después
 *
 * Lo único que comparten es el certificado: la firma del XML es la misma.
 *
 * Todo esto está verificado contra SUNAT el 2026-09-30, incluido que la ruta
 * del token es `clientessol` —`clientesextranet` responde "cliente no
 * autorizado" aunque las credenciales sean correctas— y que el único
 * `grant_type` que funciona es `password`: con `client_credentials` devuelve un
 * 204 vacío, que no es un error pero tampoco un token.
 */

import { createHash } from 'node:crypto'
import JSZip from 'jszip'

const TOKEN_URL = (clientId: string) =>
  `https://api-seguridad.sunat.gob.pe/v1/clientessol/${clientId}/oauth2/token/`

const API = 'https://api-cpe.sunat.gob.pe/v1/contribuyente/gem'

export interface CredencialesGre {
  clientId: string
  clientSecret: string
  /** El usuario SOL, sin el RUC: el RUC se le pega acá. */
  usuarioSol: string
  claveSol: string
  ruc: string
}

export interface RespuestaEnvioGre {
  ok: boolean
  /** Con esto se consulta el resultado más tarde. */
  ticket?: string | null
  codigo?: string | null
  mensaje?: string | null
  /** La respuesta cruda, por si hay que entender algo raro. */
  crudo?: string
}

export interface RespuestaTicketGre {
  /** 'procesando' | 'aceptado' | 'rechazado' | 'desconocido' */
  estado: 'procesando' | 'aceptado' | 'rechazado' | 'desconocido'
  codigo?: string | null
  mensaje?: string | null
  /** El CDR que devuelve SUNAT, comprimido y en base64. */
  cdrZipBase64?: string | null
  crudo?: string
}

/**
 * El token.
 *
 * Dura una hora. No se guarda en ningún lado a propósito: pedirlo de nuevo
 * cuesta una llamada, y un token guardado en disco es un token que alguien
 * puede leer.
 */
export async function obtenerToken(cred: CredencialesGre): Promise<string> {
  const cuerpo = new URLSearchParams({
    grant_type: 'password',
    scope: 'https://api-cpe.sunat.gob.pe',
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    username: `${cred.ruc}${cred.usuarioSol}`,
    password: cred.claveSol,
  })

  const r = await fetch(TOKEN_URL(cred.clientId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo.toString(),
  })

  const texto = await r.text()
  if (!r.ok) {
    /*
     * Los dos errores que se ven en la práctica, traducidos a algo accionable:
     * uno es de las credenciales de la aplicación y el otro del usuario SOL.
     */
    let detalle = texto.slice(0, 200)
    try {
      const j = JSON.parse(texto)
      if (j.error === 'unauthorized_client') {
        detalle = 'las credenciales de la aplicación (ID y CLAVE de la API) no son válidas'
      } else if (String(j.error_description ?? '').toLowerCase().includes('usuario')) {
        detalle = 'el usuario o la clave SOL no son correctos'
      } else {
        detalle = j.error_description ?? detalle
      }
    } catch { /* se queda el texto crudo */ }
    throw new Error(`SUNAT no entregó el token: ${detalle}`)
  }

  const j = JSON.parse(texto)
  if (!j.access_token) throw new Error('SUNAT respondió sin token')
  return j.access_token as string
}

/** El ZIP que espera SUNAT, con el XML adentro. */
export async function comprimirGuia(nombreArchivo: string, xml: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(`${nombreArchivo}.xml`, xml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Enviar la guía.
 *
 * Devuelve un ticket, no un veredicto: SUNAT procesa aparte y el resultado se
 * pregunta después con `consultarTicket`. Que esto responda bien no significa
 * que la guía haya sido aceptada.
 */
export async function enviarGuia(
  { token, nombreArchivo, zip }: { token: string; nombreArchivo: string; zip: Buffer },
): Promise<RespuestaEnvioGre> {
  // El hash va en hexadecimal sobre el ZIP, no sobre el XML.
  const hash = createHash('sha256').update(zip).digest('hex')

  const r = await fetch(`${API}/comprobantes/${nombreArchivo}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      archivo: {
        nomArchivo: `${nombreArchivo}.zip`,
        arcGreZip: zip.toString('base64'),
        hashZip: hash,
      },
    }),
  })

  const texto = await r.text()
  let j: any = null
  try { j = JSON.parse(texto) } catch { /* puede venir vacío o en html */ }

  if (!r.ok) {
    return {
      ok: false,
      codigo: j?.cod ?? j?.codigo ?? String(r.status),
      mensaje: j?.msg ?? j?.mensaje ?? texto.slice(0, 220),
      crudo: texto.slice(0, 600),
    }
  }

  const ticket = j?.numTicket ?? j?.numticket ?? null
  return {
    ok: !!ticket,
    ticket,
    codigo: j?.cod ?? null,
    mensaje: ticket ? null : (j?.msg ?? 'SUNAT no devolvió número de ticket'),
    crudo: texto.slice(0, 600),
  }
}

/**
 * Preguntar cómo salió.
 *
 * Mientras SUNAT procesa devuelve un estado de "en proceso"; recién cuando
 * termina dice si la aceptó y entrega el CDR.
 */
export async function consultarTicket(
  { token, ticket }: { token: string; ticket: string },
): Promise<RespuestaTicketGre> {
  const r = await fetch(`${API}/comprobantes/envios/${ticket}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })

  const texto = await r.text()
  let j: any = null
  try { j = JSON.parse(texto) } catch { /* nada */ }

  if (!r.ok) {
    return {
      estado: 'desconocido',
      codigo: String(r.status),
      mensaje: texto.slice(0, 220),
      crudo: texto.slice(0, 600),
    }
  }

  /*
   * `codRespuesta` es el veredicto:
   *   '0'  aceptada
   *   '98' todavía procesando
   *   otro rechazada, y `error` dice por qué
   */
  const cod = String(j?.codRespuesta ?? '')
  const estado: RespuestaTicketGre['estado'] =
    cod === '0' ? 'aceptado'
      : cod === '98' ? 'procesando'
        : cod ? 'rechazado' : 'desconocido'

  return {
    estado,
    codigo: j?.error?.numError ?? (cod || null),
    mensaje: j?.error?.desError ?? j?.mensaje ?? null,
    cdrZipBase64: j?.arcCdr ?? null,
    crudo: texto.slice(0, 600),
  }
}
