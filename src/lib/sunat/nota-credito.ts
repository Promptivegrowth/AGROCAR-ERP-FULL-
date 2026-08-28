/**
 * La nota de crédito en UBL 2.1.
 *
 * Es el único modo de corregir un comprobante que SUNAT ya aceptó. Una vez
 * enviado, el comprobante no se edita ni se borra: se emite una nota de
 * crédito que lo anula o lo corrige, citándolo.
 *
 * El documento se parece a una factura pero no es el mismo esquema: la raíz es
 * `CreditNote`, las líneas son `CreditNoteLine` con `CreditedQuantity`, no
 * lleva forma de pago, y suma dos bloques que la factura no tiene —el motivo
 * (`DiscrepancyResponse`) y la cita al documento original
 * (`BillingReference`)—. Sin cualquiera de los dos, SUNAT la rechaza.
 */

import { montoEnLetras } from './letras'
import type { ItemUbl, EmisorUbl, ClienteUbl, ResultadoUbl } from './ubl'

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const n2 = (x: number): string => Number(x ?? 0).toFixed(2)
const n6 = (x: number): string => Number(x ?? 0).toFixed(6)

/**
 * Catálogo 09: por qué se emite la nota de crédito.
 *
 * El código viaja en el XML y el texto se imprime en el comprobante; los dos
 * tienen que decir lo mismo, así que salen de la misma tabla.
 */
export const MOTIVOS_NOTA_CREDITO: Record<string, string> = {
  '01': 'Anulación de la operación',
  '02': 'Anulación por error en el RUC',
  '03': 'Corrección por error en la descripción',
  '04': 'Descuento global',
  '05': 'Descuento por ítem',
  '06': 'Devolución total',
  '07': 'Devolución por ítem',
  '08': 'Bonificación',
  '09': 'Disminución en el valor',
  '10': 'Otros conceptos',
  '11': 'Ajustes de operaciones de exportación',
  '13': 'Ajustes - montos y/o fechas de pago',
}

/** Catálogo 06: 6 RUC, 1 DNI, 0 sin documento. */
function docCliente(cli?: ClienteUbl | null): { tipo: string; numero: string } {
  if (cli?.ruc) return { tipo: '6', numero: cli.ruc }
  if (cli?.dni) return { tipo: '1', numero: cli.dni }
  return { tipo: '0', numero: '00000000' }
}

export interface NotaCreditoUbl {
  serie: string
  numero: string
  fecha_emision: string
  hora_emision?: string
  moneda?: string
  /** Código del catálogo 09. */
  motivo: string
  /** Texto libre; si no viene, se usa el del catálogo. */
  motivo_texto?: string
  /** El comprobante que se corrige: "F002-00000044". */
  documento_afectado: string
  /** Catálogo 01 del afectado: 01 factura, 03 boleta. */
  tipo_afectado: string
  cliente?: ClienteUbl | null
}

export function construirNotaCredito(
  { nota, emisor, items }: { nota: NotaCreditoUbl; emisor: EmisorUbl; items: ItemUbl[] },
): ResultadoUbl {
  if (items.length === 0) throw new Error('La nota de crédito no tiene líneas')
  if (!MOTIVOS_NOTA_CREDITO[nota.motivo]) {
    throw new Error(`Motivo ${nota.motivo} no existe en el catálogo 09`)
  }
  if (!/^[A-Z0-9]+-\d+$/.test(nota.documento_afectado)) {
    throw new Error(`El documento afectado "${nota.documento_afectado}" no tiene la forma SERIE-NUMERO`)
  }

  const id = `${nota.serie}-${nota.numero}`
  const moneda = nota.moneda || 'PEN'
  const doc = docCliente(nota.cliente)

  let gravado = 0
  let igvTotal = 0

  const lineas = items.map((it, i) => {
    const cantidad = Number(it.cantidad)
    const precioConIgv = Number(it.precio_unitario)
    const pctIgv = Number(it.igv_porcentaje ?? 18)
    const factor = 1 + pctIgv / 100

    // Mismo redondeo que la factura: se parte del monto con IGV, que es el que
    // el cliente pagó y el que hay que devolverle.
    const valorUnitario = precioConIgv / factor
    const montoConIgv = Math.round(cantidad * precioConIgv * 100) / 100
    const valorVenta = Math.round((montoConIgv / factor) * 100) / 100
    const igvLinea = Math.round((montoConIgv - valorVenta) * 100) / 100

    gravado += valorVenta
    igvTotal += igvLinea

    return `
  <cac:CreditNoteLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:CreditedQuantity unitCode="${esc(it.unidad || 'NIU')}">${n6(cantidad)}</cbc:CreditedQuantity>
    <cbc:LineExtensionAmount currencyID="${moneda}">${n2(valorVenta)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${moneda}">${n6(precioConIgv)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${n2(igvLinea)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${moneda}">${n2(valorVenta)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${moneda}">${n2(igvLinea)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${n2(pctIgv)}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>10</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID>1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${it.descripcion}]]></cbc:Description>${it.codigo ? `
      <cac:SellersItemIdentification><cbc:ID>${esc(it.codigo)}</cbc:ID></cac:SellersItemIdentification>` : ''}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${moneda}">${n6(valorUnitario)}</cbc:PriceAmount>
    </cac:Price>
  </cac:CreditNoteLine>`
  }).join('')

  gravado = Math.round(gravado * 100) / 100
  igvTotal = Math.round(igvTotal * 100) / 100
  const total = Math.round((gravado + igvTotal) * 100) / 100
  const motivoTexto = nota.motivo_texto || MOTIVOS_NOTA_CREDITO[nota.motivo]

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${esc(id)}</cbc:ID>
  <cbc:IssueDate>${esc(nota.fecha_emision)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(nota.hora_emision || '00:00:00')}</cbc:IssueTime>
  <cbc:Note languageLocaleID="1000"><![CDATA[${montoEnLetras(total, moneda)}]]></cbc:Note>
  <cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>
  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>${esc(nota.documento_afectado)}</cbc:ReferenceID>
    <cbc:ResponseCode>${esc(nota.motivo)}</cbc:ResponseCode>
    <cbc:Description><![CDATA[${motivoTexto}]]></cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(nota.documento_afectado)}</cbc:ID>
      <cbc:DocumentTypeCode>${esc(nota.tipo_afectado)}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  <cac:Signature>
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
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${esc(emisor.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${emisor.nombre_comercial || emisor.razon_social}]]></cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${emisor.razon_social}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>
          <cac:AddressLine><cbc:Line><![CDATA[${emisor.direccion || '-'}]]></cbc:Line></cac:AddressLine>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${doc.tipo}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${esc(doc.numero)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${nota.cliente?.razon_social || 'CLIENTE VARIOS'}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${moneda}">${n2(igvTotal)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${n2(gravado)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">${n2(igvTotal)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>1000</cbc:ID>
          <cbc:Name>IGV</cbc:Name>
          <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="${moneda}">${n2(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineas}
</CreditNote>`

  return {
    xml,
    id,
    tipoDoc: '07',
    nombreArchivo: `${emisor.ruc}-07-${id}`,
    totales: { gravado, igv: igvTotal, total },
  }
}
