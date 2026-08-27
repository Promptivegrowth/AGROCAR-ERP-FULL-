/**
 * El comprobante en el idioma de SUNAT: UBL 2.1.
 *
 * Un detalle que ordena todo lo demás: en la base los precios están CON IGV
 * —13.50 el kilo es lo que paga el cliente— pero UBL pide el valor de venta
 * SIN IGV en `cbc:PriceAmount`, y el precio con IGV va aparte, como
 * `AlternativeConditionPrice` con código 01. Confundirlos es de los errores
 * que más rebotan en homologación.
 *
 * Los totales se recalculan desde las líneas y no se copian de la cabecera:
 * si algún redondeo viejo quedó torcido, SUNAT rechaza por inconsistencia y
 * el mensaje no dice cuál de los dos números está mal.
 */

import { montoEnLetras } from './letras'

export interface ItemUbl {
  cantidad: number
  /** Precio unitario CON IGV, tal como está en la base. */
  precio_unitario: number
  igv_porcentaje?: number
  descripcion: string
  codigo?: string | null
  /** Catálogo 03. Si no se sabe, NIU (unidad). */
  unidad?: string
}

export interface EmisorUbl {
  ruc: string
  razon_social: string
  nombre_comercial?: string
  direccion?: string
  ubigeo?: string
  distrito?: string
  provincia?: string
  departamento?: string
}

export interface ClienteUbl {
  razon_social?: string | null
  ruc?: string | null
  dni?: string | null
  direccion?: string | null
}

export interface ComprobanteUbl {
  serie: string
  numero: string
  tipo: 'factura' | 'boleta' | 'nota_credito' | 'nota_debito'
  fecha_emision: string
  hora_emision?: string
  moneda?: string
  /** Catálogo 51. Por omisión 0101, venta interna. */
  tipo_operacion?: string
  /** Obligatoria desde 2021. Por omisión contado. */
  forma_pago?: 'contado' | 'credito'
  /** Solo si es a crédito: cuándo vence la única cuota. */
  fecha_vencimiento?: string | null
  cliente?: ClienteUbl | null
}

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const n2 = (x: number): string => Number(x ?? 0).toFixed(2)
const n6 = (x: number): string => Number(x ?? 0).toFixed(6)

/** Catálogo 01. */
const TIPO_DOC: Record<string, string> = {
  factura: '01', boleta: '03', nota_credito: '07', nota_debito: '08',
}

/** Catálogo 06: 6 RUC, 1 DNI, 0 sin documento. */
function docCliente(cli?: ClienteUbl | null): { tipo: string; numero: string } {
  if (cli?.ruc) return { tipo: '6', numero: cli.ruc }
  if (cli?.dni) return { tipo: '1', numero: cli.dni }
  return { tipo: '0', numero: '00000000' }
}

export interface ResultadoUbl {
  xml: string
  id: string
  tipoDoc: string
  nombreArchivo: string
  totales: { gravado: number; igv: number; total: number }
}

export function construirInvoice(
  { comprobante, emisor, items }: { comprobante: ComprobanteUbl; emisor: EmisorUbl; items: ItemUbl[] },
): ResultadoUbl {
  const tipoDoc = TIPO_DOC[comprobante.tipo]
  if (!tipoDoc) throw new Error(`Tipo de comprobante no soportado: ${comprobante.tipo}`)
  if (items.length === 0) throw new Error('El comprobante no tiene líneas')

  /*
   * Tipo de operación, catálogo 51. Va en `cbc:ProfileID`, que es un campo
   * distinto del `InvoiceTypeCode` (ese lleva el catálogo 01, el tipo de
   * documento). Sin ProfileID, SUNAT responde 3244: "Debe consignar la
   * información del tipo de transacción del comprobante".
   *
   * 0101 es venta interna, que es todo lo que hace AGROCAR: distribución en
   * el mercado local. Exportación, anticipos o detracciones tienen sus
   * propios códigos y ninguno aplica todavía.
   */
  const tipoOperacion = comprobante.tipo_operacion || '0101'

  const id = `${comprobante.serie}-${comprobante.numero}`
  const moneda = comprobante.moneda || 'PEN'
  const doc = docCliente(comprobante.cliente)

  let gravado = 0
  let igvTotal = 0

  const lineas = items.map((it, i) => {
    const cantidad = Number(it.cantidad)
    const precioConIgv = Number(it.precio_unitario)
    const pctIgv = Number(it.igv_porcentaje ?? 18)
    const factor = 1 + pctIgv / 100

    const valorUnitario = precioConIgv / factor
    const valorVenta = Math.round(cantidad * valorUnitario * 100) / 100
    const igvLinea = Math.round(valorVenta * (pctIgv / 100) * 100) / 100

    gravado += valorVenta
    igvTotal += igvLinea

    return `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(it.unidad || 'NIU')}">${n6(cantidad)}</cbc:InvoicedQuantity>
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
  </cac:InvoiceLine>`
  }).join('')

  gravado = Math.round(gravado * 100) / 100
  igvTotal = Math.round(igvTotal * 100) / 100
  const total = Math.round((gravado + igvTotal) * 100) / 100

  /*
   * Forma de pago. Obligatoria desde la RS 193-2020: sin ella SUNAT rechaza
   * con 3244, "Debe consignar la informacion del tipo de transaccion del
   * comprobante", y el mensaje no dice que se trata de esto.
   *
   * Al contado alcanza con decirlo. A credito hay que declarar ademas el
   * saldo pendiente y cada cuota; AGROCAR vende a credito simple, sin
   * fraccionar, asi que va una sola cuota por el total.
   */
  const formaPago = comprobante.forma_pago || 'contado'
  const bloquePago = formaPago === 'credito'
    ? `
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>
    <cbc:Amount currencyID="${moneda}">${n2(total)}</cbc:Amount>
  </cac:PaymentTerms>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Cuota001</cbc:PaymentMeansID>
    <cbc:Amount currencyID="${moneda}">${n2(total)}</cbc:Amount>
    <cbc:PaymentDueDate>${esc(comprobante.fecha_vencimiento || comprobante.fecha_emision)}</cbc:PaymentDueDate>
  </cac:PaymentTerms>`
    : `
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
  </cac:PaymentTerms>`

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ProfileID schemeName="Tipo de Operacion" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo51">${esc(tipoOperacion)}</cbc:ProfileID>
  <cbc:ID>${esc(id)}</cbc:ID>
  <cbc:IssueDate>${esc(comprobante.fecha_emision)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(comprobante.hora_emision || '00:00:00')}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="${esc(tipoOperacion)}" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">${tipoDoc}</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000"><![CDATA[${montoEnLetras(total, moneda)}]]></cbc:Note>
  <cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>
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
        <cbc:RegistrationName><![CDATA[${comprobante.cliente?.razon_social || 'CLIENTE VARIOS'}]]></cbc:RegistrationName>${comprobante.cliente?.direccion ? `
        <cac:RegistrationAddress><cac:AddressLine><cbc:Line><![CDATA[${comprobante.cliente.direccion}]]></cbc:Line></cac:AddressLine></cac:RegistrationAddress>` : ''}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>${bloquePago}
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
    <cbc:LineExtensionAmount currencyID="${moneda}">${n2(gravado)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${moneda}">${n2(total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${moneda}">${n2(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineas}
</Invoice>`

  return {
    xml,
    id,
    tipoDoc,
    nombreArchivo: `${emisor.ruc}-${tipoDoc}-${id}`,
    totales: { gravado, igv: igvTotal, total },
  }
}
