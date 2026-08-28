/**
 * La firma digital y el envío a SUNAT.
 *
 * El certificado viene en un `.pfx` (PKCS#12) protegido por contraseña. Node
 * no sabe abrirlo por su cuenta —su `crypto` no lee PKCS#12— así que lo
 * desarma node-forge y de ahí salen la llave privada y el certificado en PEM.
 */

import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import JSZip from 'jszip'

export interface Certificado {
  privateKeyPem: string
  certificatePem: string
  /** El DER en base64, que es lo que va dentro de `<ds:X509Certificate>`. */
  certificateBase64: string
  titular: string
  vence: Date
}

/** Abre el `.pfx` y devuelve la llave y el certificado del titular. */
export function abrirCertificado(pfx: Buffer, password: string): Certificado {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')))
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password)

  let llave: forge.pki.PrivateKey | null = null
  let cert: forge.pki.Certificate | null = null

  for (const contenido of p12.safeContents) {
    for (const bag of contenido.safeBags) {
      if (!llave && bag.key
        && (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag)) {
        llave = bag.key
      }
      /*
       * El .pfx trae la cadena completa: el del titular, la CA intermedia y la
       * raíz. El que firma es el del titular, y se lo reconoce porque NO es
       * una autoridad certificadora — el resto son los que tienen basicConstraints
       * con cA=true.
       */
      if (bag.type === forge.pki.oids.certBag && bag.cert) {
        const bc = bag.cert.getExtension('basicConstraints') as { cA?: boolean } | undefined
        if (!bc?.cA) cert = bag.cert
      }
    }
  }

  if (!llave) throw new Error('El certificado no trae llave privada')
  if (!cert) throw new Error('El certificado no trae el certificado del titular')

  return {
    privateKeyPem: forge.pki.privateKeyToPem(llave as forge.pki.rsa.PrivateKey),
    certificatePem: forge.pki.certificateToPem(cert),
    certificateBase64: forge.util.encode64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    ),
    titular: cert.subject.attributes.map((a: { shortName?: string; value?: unknown }) => `${a.shortName}=${a.value}`).join(', '),
    vence: cert.validity.notAfter,
  }
}

/**
 * Firma el XML y mete la firma dentro de `ext:ExtensionContent`.
 *
 * SUNAT solo la acepta ahí. Es una firma envolvente sobre el documento entero
 * (URI vacía), con SHA-256, que es lo que exige desde UBL 2.1.
 */
export function firmarXml(xml: string, cert: Pick<Certificado, 'privateKeyPem' | 'certificatePem'>): string {
  const sig = new SignedXml({
    privateKey: cert.privateKeyPem,
    publicCert: cert.certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  })

  /*
   * `uri: ''` con `isEmptyUri` es lo que hace que la referencia quede como
   * URI="" — el documento entero.
   *
   * Sin eso, xml-crypto le inventa un Id al elemento raíz y firma URI="#_0".
   * SUNAT lo rechaza con el código 2335, "El documento electrónico ingresado
   * ha sido alterado", porque el Id agregado cambia el documento respecto del
   * que se digirió.
   */
  sig.addReference({
    xpath: '/*',
    /*
     * Las dos transformadas importan, y la segunda es la que más cuesta
     * descubrir que falta.
     *
     * xml-crypto aplica únicamente las que estén en esta lista: si solo se
     * pone `enveloped-signature`, el digest termina calculado sobre el
     * `toString()` crudo del DOM, sin canonicalizar. Quien verifica —SUNAT
     * usa Apache Santuario— canonicaliza igual, porque para una referencia
     * sobre un conjunto de nodos la norma dice que ese es el comportamiento
     * por omisión. Los dos digests salen distintos y SUNAT responde 2335,
     * "El documento electrónico ingresado ha sido alterado".
     *
     * Declararla explícitamente deja a las dos partes haciendo lo mismo.
     */
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    uri: '',
    isEmptyUri: true,
  })

  sig.computeSignature(xml, {
    prefix: 'ds',
    attrs: { Id: 'SignatureSP' },
    location: { reference: "//*[local-name(.)='ExtensionContent']", action: 'append' },
  })

  return sig.getSignedXml()
}

/** El ZIP que viaja: un solo XML adentro, con el mismo nombre. */
export async function comprimir(nombreArchivo: string, xml: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(`${nombreArchivo}.xml`, xml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export type ModoSunat = 'beta' | 'produccion'

const ENDPOINTS: Record<ModoSunat, string> = {
  beta: 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
  produccion: 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
}

export interface RespuestaSunat {
  ok: boolean
  tipo: 'cdr' | 'fault' | 'sin_respuesta'
  codigo: string | null
  mensaje: string | null
  observaciones?: string[]
  cdrXml?: string
  cdrZipBase64?: string
  crudo?: string
}

/**
 * Envía el comprobante y devuelve el CDR.
 *
 * El servicio es SOAP con seguridad WS-Security: usuario y clave viajan en el
 * encabezado. En beta el usuario es `RUC + MODDATOS` con clave `MODDATOS`; en
 * producción es el usuario secundario SOL creado en el portal, con el permiso
 * de facturación electrónica.
 */
/**
 * Códigos HTTP que valen la pena reintentar.
 *
 * El 401 no es una credencial mal puesta: el servicio de SUNAT lo devuelve
 * cuando lo apuran, y beta avisa en su propia documentación que no admite
 * envíos masivos ni simultáneos. Un 401 aislado en medio de una tanda que
 * funciona es eso, no una clave equivocada. Los 5xx y los tiempos agotados
 * son de la misma familia: el comprobante está bien, el servicio no contestó.
 */
const REINTENTABLES = [401, 429, 500, 502, 503, 504]

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function enviarASunat(
  { modo = 'beta', usuario, clave, nombreArchivo, zip, intentos = 3 }:
  { modo?: ModoSunat; usuario: string; clave: string; nombreArchivo: string; zip: Buffer; intentos?: number },
): Promise<RespuestaSunat> {
  const url = ENDPOINTS[modo]
  if (!url) throw new Error(`Modo desconocido: ${modo}`)

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
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
    <ser:sendBill>
      <fileName>${nombreArchivo}.zip</fileName>
      <contentFile>${zip.toString('base64')}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>`

  let res: Response | null = null
  let texto = ''
  let ultimoFallo = ''

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
        body: sobre,
      })
      texto = await res.text()
      if (!REINTENTABLES.includes(res.status)) break
      ultimoFallo = `HTTP ${res.status}`
    } catch (e) {
      ultimoFallo = e instanceof Error ? e.message : String(e)
    }
    // Espera creciente: 1s, 2s, 4s. Sin apurar a un servicio que ya avisó
    // que no quiere ser apurado.
    if (intento < intentos) await esperar(1000 * 2 ** (intento - 1))
  }

  if (!res) {
    return { ok: false, tipo: 'sin_respuesta', codigo: null, mensaje: ultimoFallo || 'No hubo respuesta' }
  }

  // SUNAT contesta con un Fault cuando algo falla antes de procesar el
  // comprobante: mal usuario, ZIP corrupto, nombre de archivo que no coincide
  // con lo que hay adentro.
  const fault = texto.match(/<faultstring>([\s\S]*?)<\/faultstring>/)
  if (fault) {
    const cod = texto.match(/<faultcode>([\s\S]*?)<\/faultcode>/)
    return {
      ok: false, tipo: 'fault',
      codigo: cod?.[1]?.trim() ?? null,
      mensaje: fault[1].trim(),
      crudo: texto,
    }
  }

  const b64 = texto.match(/<applicationResponse>([\s\S]*?)<\/applicationResponse>/)
  if (!b64) {
    return {
      ok: false, tipo: 'sin_respuesta',
      codigo: null,
      mensaje: `HTTP ${res.status}${REINTENTABLES.includes(res.status) ? ` tras ${intentos} intentos` : ''}`,
      crudo: texto.slice(0, 4000),
    }
  }

  // El CDR viene como un ZIP en base64 con un XML adentro llamado R-<nombre>.
  const cdrZip = await JSZip.loadAsync(Buffer.from(b64[1], 'base64'))
  const nombre = Object.keys(cdrZip.files).find((f) => f.endsWith('.xml'))
  if (!nombre) return { ok: false, tipo: 'sin_respuesta', codigo: null, mensaje: 'El CDR llegó sin XML adentro' }
  const cdrXml = await cdrZip.file(nombre)!.async('string')

  const codigo = cdrXml.match(/<cbc:ResponseCode>([\s\S]*?)<\/cbc:ResponseCode>/)?.[1]?.trim() ?? null
  const desc = cdrXml.match(/<cbc:Description>([\s\S]*?)<\/cbc:Description>/)?.[1]?.trim() ?? null
  const notas = Array.from(cdrXml.matchAll(/<cbc:Note>([\s\S]*?)<\/cbc:Note>/g)).map((m) => m[1].trim())

  // 0 aceptado · 2000-3999 rechazado · 4000+ aceptado con observaciones.
  return {
    ok: codigo === '0',
    tipo: 'cdr',
    codigo,
    mensaje: desc,
    observaciones: notas,
    cdrXml,
    cdrZipBase64: b64[1],
  }
}
