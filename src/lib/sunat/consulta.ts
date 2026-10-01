/**
 * Preguntarle a SUNAT si tiene un comprobante, sin mandarle nada.
 *
 * Es el servicio de consulta (billConsultService), separado del de envío: solo
 * lee. No declara, no reenvía, no cambia nada del lado de SUNAT. Sirve para
 * confirmar con SUNAT misma —y no con lo que el ERP anotó— que un comprobante
 * llegó y quedó aceptado, y para recuperar la constancia (CDR) si el envío se
 * cortó después de que SUNAT ya lo había recibido.
 *
 * Existe solo en producción y se autentica con el usuario SOL. Lo que se mandó
 * al servicio de pruebas no aparece acá, porque no está declarado.
 */

import JSZip from 'jszip'
import { EMISOR_SUNAT } from './config'

const URL_CONSULTA = 'https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService'

const TIPO_SUNAT: Record<string, string> = {
  factura: '01',
  boleta: '03',
  nota_credito: '07',
  nota_debito: '08',
}

export type EstadoConsulta =
  | 'aceptado'      // SUNAT lo tiene y está aceptado
  | 'rechazado'     // SUNAT lo tiene pero lo rechazó
  | 'baja'          // SUNAT lo tiene, dado de baja
  | 'no_existe'     // SUNAT no lo tiene
  | 'no_consultable'// el servicio no responde por este tipo de comprobante
  | 'error'         // no se pudo preguntar (credenciales, red, SUNAT caído)

export interface ResultadoConsulta {
  estado: EstadoConsulta
  codigo: string | null
  mensaje: string
  /** La constancia, si SUNAT la devolvió. */
  cdrZipBase64?: string
  cdrCodigo?: string | null
  cdrMensaje?: string | null
}

function sobre(usuario: string, clave: string, operacion: string, cuerpo: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${usuario}</wsse:Username>
        <wsse:Password>${clave}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:${operacion}>${cuerpo}</ser:${operacion}>
  </soapenv:Body>
</soapenv:Envelope>`
}

async function llamar(usuario: string, clave: string, operacion: string, cuerpo: string) {
  const res = await fetch(URL_CONSULTA, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: sobre(usuario, clave, operacion, cuerpo),
  })
  const texto = await res.text()
  const fault = texto.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1]?.trim()
  const codigo = texto.match(/<statusCode>([\s\S]*?)<\/statusCode>/)?.[1]?.trim() ?? null
  const mensaje = texto.match(/<statusMessage>([\s\S]*?)<\/statusMessage>/)?.[1]?.trim() ?? null
  const contenido = texto.match(/<content>([\s\S]*?)<\/content>/)?.[1]?.trim() ?? null
  return { http: res.status, fault, codigo, mensaje, contenido, crudo: texto }
}

/** Lo que contesta `getStatus`, traducido. */
function estadoDeCodigo(codigo: string | null): EstadoConsulta {
  switch (codigo) {
    case '0001': return 'aceptado'
    case '0002': return 'rechazado'
    case '0003': return 'baja'
    case '0011': return 'no_existe'
    // 0009/0010: el servicio solo consulta facturas y notas (serie F).
    case '0009': case '0010': return 'no_consultable'
    default: return 'error'
  }
}

export async function consultarEnSunat(
  c: { tipo: string; serie: string; numero: string | number },
): Promise<ResultadoConsulta> {
  const usuarioSol = process.env.SUNAT_USUARIO_SOL
  const claveSol = process.env.SUNAT_CLAVE_SOL
  if (!usuarioSol || !claveSol) {
    return { estado: 'error', codigo: null, mensaje: 'Faltan las credenciales SOL en el servidor' }
  }
  const tipo = TIPO_SUNAT[c.tipo]
  if (!tipo) {
    return { estado: 'no_consultable', codigo: null, mensaje: `Los documentos de tipo "${c.tipo}" no se consultan` }
  }

  const usuario = `${EMISOR_SUNAT.ruc}${usuarioSol}`
  const cuerpo = `<rucComprobante>${EMISOR_SUNAT.ruc}</rucComprobante>`
    + `<tipoComprobante>${tipo}</tipoComprobante>`
    + `<serieComprobante>${c.serie}</serieComprobante>`
    + `<numeroComprobante>${Number(c.numero)}</numeroComprobante>`

  try {
    // 1. ¿Lo tiene, y en qué estado?
    const est = await llamar(usuario, claveSol, 'getStatus', cuerpo)
    if (est.fault) {
      return { estado: 'error', codigo: null, mensaje: `SUNAT respondió: ${est.fault}` }
    }
    const estado = estadoDeCodigo(est.codigo)
    const base: ResultadoConsulta = {
      estado, codigo: est.codigo,
      mensaje: est.mensaje ?? (est.codigo ? `Código ${est.codigo}` : `HTTP ${est.http} sin respuesta`),
    }
    if (estado !== 'aceptado' && estado !== 'rechazado') return base

    // 2. Si lo tiene, traer la constancia: es la prueba firmada por SUNAT.
    const cdr = await llamar(usuario, claveSol, 'getStatusCdr', cuerpo)
    if (!cdr.contenido) return base
    const zip = await JSZip.loadAsync(Buffer.from(cdr.contenido, 'base64'))
    const nombre = Object.keys(zip.files).find((f) => f.endsWith('.xml'))
    const xml = nombre ? await zip.file(nombre)!.async('string') : ''
    return {
      ...base,
      cdrZipBase64: cdr.contenido,
      cdrCodigo: xml.match(/<cbc:ResponseCode>([\s\S]*?)<\/cbc:ResponseCode>/)?.[1]?.trim() ?? null,
      cdrMensaje: xml.match(/<cbc:Description>([\s\S]*?)<\/cbc:Description>/)?.[1]?.trim() ?? null,
    }
  } catch (e) {
    return { estado: 'error', codigo: null, mensaje: e instanceof Error ? e.message : 'No se pudo consultar' }
  }
}

/**
 * Lo que dice la constancia que el ERP guardó cuando envió.
 *
 * El CDR es el documento que SUNAT firma al recibir el comprobante: si dice
 * código 0 y se refiere a este comprobante, SUNAT lo aceptó. Es la prueba que
 * queda en el ERP aunque el servicio de consulta no esté disponible.
 *
 * (La documentación del servicio de consulta habla solo de facturas y notas,
 * pero el 30/09/2026 respondió también por boletas: B002-00000001 dio 0011 "no
 * existe", no el 0009 de "tipo no consultable". Si algún día deja de
 * atenderlas, la constancia sigue alcanzando.)
 */
export async function leerCdr(cdrZipBase64: string, esperado: string) {
  const zip = await JSZip.loadAsync(Buffer.from(cdrZipBase64, 'base64'))
  const nombre = Object.keys(zip.files).find((f) => f.endsWith('.xml'))
  if (!nombre) return { valido: false, motivo: 'La constancia no trae XML adentro' } as const
  const xml = await zip.file(nombre)!.async('string')
  const codigo = xml.match(/<cbc:ResponseCode>([\s\S]*?)<\/cbc:ResponseCode>/)?.[1]?.trim() ?? null
  const descripcion = xml.match(/<cbc:Description>([\s\S]*?)<\/cbc:Description>/)?.[1]?.trim() ?? null
  const referencia = xml.match(/<cbc:ReferenceID>([\s\S]*?)<\/cbc:ReferenceID>/)?.[1]?.trim() ?? null
  const fecha = xml.match(/<cbc:ResponseDate>([\s\S]*?)<\/cbc:ResponseDate>/)?.[1]?.trim() ?? null
  const hora = xml.match(/<cbc:ResponseTime>([\s\S]*?)<\/cbc:ResponseTime>/)?.[1]?.trim() ?? null
  const firmadoPorSunat = /<ds:Signature|<Signature/.test(xml) && xml.includes('20131312955')
  const notas = Array.from(xml.matchAll(/<cbc:Note>([\s\S]*?)<\/cbc:Note>/g)).map((m) => m[1].trim())
  const corresponde = referencia === esperado
  return {
    valido: codigo === '0' && corresponde,
    codigo, descripcion, referencia, corresponde, firmadoPorSunat,
    recibido: fecha ? `${fecha}${hora ? ` ${hora}` : ''}` : null,
    observaciones: notas,
  } as const
}
