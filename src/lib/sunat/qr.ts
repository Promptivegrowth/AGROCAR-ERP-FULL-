/**
 * El código QR del comprobante impreso.
 *
 * SUNAT fija exactamente qué va adentro y en qué orden, separado por barras
 * verticales. No es un dato decorativo: es lo que permite que cualquiera
 * —el cliente, un fiscalizador— verifique el comprobante sin depender de
 * nosotros.
 *
 *   RUC | tipo | serie | número | IGV | total | fecha | tipo doc. cliente |
 *   documento del cliente | valor resumen
 *
 * El último campo es el que ordena todo el flujo: el **valor resumen** es el
 * digest de la firma digital, así que no existe hasta que el comprobante está
 * firmado. Firmar es local —no hace falta hablar con SUNAT— pero sí hay que
 * hacerlo antes de imprimir, o el ticket sale con el QR incompleto.
 *
 * La norma permite consignar el valor resumen fuera del QR, así que un
 * comprobante todavía sin firmar se imprime igual: el campo va vacío y lo
 * demás sirve para identificarlo.
 */

/** Catálogo 01. */
const TIPO_DOC: Record<string, string> = {
  factura: '01', boleta: '03', nota_credito: '07', nota_debito: '08',
}

/** Catálogo 06: 6 RUC, 1 DNI, 0 sin documento. */
function docCliente(cli?: { ruc?: string | null; dni?: string | null } | null) {
  if (cli?.ruc) return { tipo: '6', numero: cli.ruc }
  if (cli?.dni) return { tipo: '1', numero: cli.dni }
  return { tipo: '0', numero: '-' }
}

/**
 * El valor resumen: el DigestValue de la firma del XML.
 *
 * Se saca del XML firmado que quedó guardado, y no se recalcula: tiene que ser
 * el mismo que viajó a SUNAT, o el QR no verifica contra lo declarado.
 */
export function valorResumen(xmlFirmado?: string | null): string {
  if (!xmlFirmado) return ''
  return xmlFirmado.match(/<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/)?.[1]?.trim() ?? ''
}

export interface DatosQr {
  rucEmisor: string
  tipo: string
  serie: string
  numero: string
  igv: number
  total: number
  fechaEmision: string
  cliente?: { ruc?: string | null; dni?: string | null } | null
  /** El XML firmado, si ya existe. De ahí sale el valor resumen. */
  xmlFirmado?: string | null
}

export function contenidoQr(d: DatosQr): string {
  const tipoDoc = TIPO_DOC[d.tipo] ?? d.tipo
  const doc = docCliente(d.cliente)

  return [
    d.rucEmisor,
    tipoDoc,
    d.serie,
    d.numero,
    Number(d.igv ?? 0).toFixed(2),
    Number(d.total ?? 0).toFixed(2),
    d.fechaEmision,
    doc.tipo,
    doc.numero,
    valorResumen(d.xmlFirmado),
  ].join('|')
}
