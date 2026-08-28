/**
 * Los dos documentos con los que se deshace algo ya declarado.
 *
 * Un comprobante que SUNAT aceptó no se borra ni se edita. Para dejarlo sin
 * efecto hay dos caminos, y cuál corresponde depende del tipo:
 *
 *   Factura  ->  Comunicación de Baja (RA)
 *   Boleta   ->  Resumen Diario con la boleta marcada como anulada (RC)
 *
 * No es una preferencia: la nota de crédito emitida contra una boleta rebota
 * con el error 2116, "el tipo de documento modificado debe ser factura
 * electrónica o ticket". Se comprobó contra beta. Como AGROCAR emite sobre
 * todo boletas, el resumen es el camino que más va a usar.
 *
 * Los dos viajan por `sendSummary`, que no contesta en el momento: devuelve un
 * ticket y hay que volver a preguntar por él con `consultarTicket`.
 *
 * Estado de las pruebas contra beta
 * ---------------------------------
 * La comunicación de baja quedó aceptada (RA-20260828-1, código 0).
 *
 * El resumen diario NO se pudo validar entero. El esquema que usa beta no
 * reconoce `sac:Status` dentro de la línea: probadas las cuatro posiciones
 * posibles, en dos responde que ahí espera `TotalAmount` y en las otras dos
 * que la línea ya debería haber terminado. Sin ese elemento el documento sí
 * pasa la validación de esquema —falla recién en una regla de negocio— así que
 * lo que está bien armado es todo lo demás.
 *
 * Beta valida contra un esquema más viejo que el de producción en este
 * documento puntual. Queda por confirmar contra el servicio real, y hasta
 * entonces anular una boleta ya enviada es la única operación sin probar.
 */

import type { EmisorUbl } from './ubl'

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const n2 = (x: number): string => Number(x ?? 0).toFixed(2)

const NS_SAC = 'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1'
const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
const NS_EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'

/** El bloque de firma y emisor, idéntico en los dos documentos. */
function cabeceraEmisor(emisor: EmisorUbl): string {
  return `  <cac:Signature>
    <cbc:ID>${esc(emisor.ruc)}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${esc(emisor.ruc)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${emisor.razon_social}]]></cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference><cbc:URI>#SignatureSP</cbc:URI></cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cbc:CustomerAssignedAccountID>${esc(emisor.ruc)}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${emisor.razon_social}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`
}

export interface DocumentoABajar {
  /** Catálogo 01: 01 factura, 07 nota de crédito, 08 nota de débito. */
  tipo: string
  serie: string
  /** Sin ceros a la izquierda: SUNAT lo quiere como número. */
  numero: string | number
  motivo: string
}

export interface ResultadoResumen {
  xml: string
  id: string
  nombreArchivo: string
}

/**
 * Comunicación de Baja — para dar de baja facturas y sus notas.
 *
 * `ReferenceDate` es el día en que se emitieron los documentos que se dan de
 * baja, y `IssueDate` el día en que se comunica. No son lo mismo y SUNAT los
 * compara: el plazo para comunicar una baja es de siete días calendario.
 */
export function construirComunicacionBaja(
  { emisor, correlativo, fechaDocumentos, fechaComunicacion, documentos }:
  {
    emisor: EmisorUbl
    /** El número del día: RA-20260827-1, RA-20260827-2… */
    correlativo: number
    fechaDocumentos: string
    fechaComunicacion: string
    documentos: DocumentoABajar[]
  },
): ResultadoResumen {
  if (documentos.length === 0) throw new Error('No hay documentos que dar de baja')

  const id = `RA-${fechaComunicacion.replace(/-/g, '')}-${correlativo}`

  const lineas = documentos.map((d, i) => `
  <sac:VoidedDocumentsLine>
    <cbc:LineID>${i + 1}</cbc:LineID>
    <cbc:DocumentTypeCode>${esc(d.tipo)}</cbc:DocumentTypeCode>
    <sac:DocumentSerialID>${esc(d.serie)}</sac:DocumentSerialID>
    <sac:DocumentNumberID>${Number(d.numero)}</sac:DocumentNumberID>
    <sac:VoidReasonDescription><![CDATA[${d.motivo}]]></sac:VoidReasonDescription>
  </sac:VoidedDocumentsLine>`).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<VoidedDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1" xmlns:sac="${NS_SAC}" xmlns:cac="${NS_CAC}" xmlns:cbc="${NS_CBC}" xmlns:ext="${NS_EXT}" xmlns:ds="${NS_DS}">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.0</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:ReferenceDate>${esc(fechaDocumentos)}</cbc:ReferenceDate>
  <cbc:IssueDate>${esc(fechaComunicacion)}</cbc:IssueDate>
${cabeceraEmisor(emisor)}${lineas}
</VoidedDocuments>`

  return { xml, id, nombreArchivo: `${emisor.ruc}-${id}` }
}

export interface BoletaDelResumen {
  serie: string
  numero: string | number
  /** 1 adicionar, 2 modificar, 3 anular. */
  estado: 1 | 2 | 3
  clienteTipoDoc: string
  clienteDoc: string
  gravado: number
  igv: number
  total: number
}

/**
 * Resumen Diario de boletas — el camino para anular una boleta.
 *
 * Cada línea es una boleta con su estado: 1 la informa, 2 la corrige, 3 la
 * anula. Todas las boletas de un resumen tienen que ser del mismo día de
 * emisión, que es lo que dice `ReferenceDate`.
 */
export function construirResumenDiario(
  { emisor, correlativo, fechaBoletas, fechaResumen, boletas, moneda = 'PEN' }:
  {
    emisor: EmisorUbl
    correlativo: number
    fechaBoletas: string
    fechaResumen: string
    boletas: BoletaDelResumen[]
    moneda?: string
  },
): ResultadoResumen {
  if (boletas.length === 0) throw new Error('El resumen no tiene boletas')

  const id = `RC-${fechaResumen.replace(/-/g, '')}-${correlativo}`

  const lineas = boletas.map((b, i) => `
  <sac:SummaryDocumentsLine>
    <cbc:LineID>${i + 1}</cbc:LineID>
    <cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>
    <cbc:ID>${esc(b.serie)}-${Number(b.numero)}</cbc:ID>
    <cac:AccountingCustomerParty>
      <cbc:CustomerAssignedAccountID>${esc(b.clienteDoc)}</cbc:CustomerAssignedAccountID>
      <cbc:AdditionalAccountID>${esc(b.clienteTipoDoc)}</cbc:AdditionalAccountID>
    </cac:AccountingCustomerParty>
    <sac:Status>
      <cbc:ConditionCode>${b.estado}</cbc:ConditionCode>
    </sac:Status>
    <sac:TotalAmount currencyID="${moneda}">${n2(b.total)}</sac:TotalAmount>
    <sac:BillingPayment>
      <cbc:PaidAmount currencyID="${moneda}">${n2(b.gravado)}</cbc:PaidAmount>
      <cbc:InstructionID>01</cbc:InstructionID>
    </sac:BillingPayment>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${n2(b.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxAmount currencyID="${moneda}">${n2(b.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID>1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
  </sac:SummaryDocumentsLine>`).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1" xmlns:sac="${NS_SAC}" xmlns:cac="${NS_CAC}" xmlns:cbc="${NS_CBC}" xmlns:ext="${NS_EXT}" xmlns:ds="${NS_DS}">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.1</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:ReferenceDate>${esc(fechaBoletas)}</cbc:ReferenceDate>
  <cbc:IssueDate>${esc(fechaResumen)}</cbc:IssueDate>
${cabeceraEmisor(emisor)}${lineas}
</SummaryDocuments>`

  return { xml, id, nombreArchivo: `${emisor.ruc}-${id}` }
}
