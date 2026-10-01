/**
 * La guía de remisión electrónica del remitente, en UBL 2.1.
 *
 * Es un documento distinto de la factura: un `DespatchAdvice`, no un `Invoice`.
 * No lleva precios ni impuestos —no es un comprobante de pago—; lleva qué se
 * traslada, desde dónde, hasta dónde, quién lo lleva y en qué vehículo.
 *
 * AGROCAR emite la guía del REMITENTE (tipo 09): la mercadería es suya y la
 * traslada en sus propios camiones. La del transportista (31) es otra cosa y
 * la emite quien presta el servicio de transporte.
 *
 * Lo que SUNAT mira con más rigor y suele rechazar:
 *
 *   - la serie: cuatro caracteres empezando con T (T001), no vale otra letra
 *   - los ubigeos de partida y llegada: seis dígitos, obligatorios
 *   - el peso bruto total y el de cada línea
 *   - en traslado privado, los datos del vehículo y del conductor
 *
 * El XML se firma después, en el hueco `ext:ExtensionContent`, igual que las
 * facturas y con el mismo certificado.
 */

/** Cómo se traslada: por cuenta propia o contratando a un transportista. */
export type ModalidadTraslado = 'privado' | 'publico'

export interface ItemGuia {
  /** Código interno del producto. */
  codigo: string | null
  descripcion: string
  cantidad: number
  /** Unidad del catálogo 03 de SUNAT: KGM, NIU, ZZ… */
  unidad: string
}

export interface DireccionGuia {
  /** Ubigeo de seis dígitos. SUNAT lo exige en los dos extremos. */
  ubigeo: string
  direccion: string
}

export interface DestinatarioGuia {
  razon_social: string
  ruc?: string | null
  dni?: string | null
}

export interface TransporteGuia {
  modalidad: ModalidadTraslado
  /** Traslado privado: la placa del vehículo propio. */
  placa?: string | null
  /** Traslado privado: quién maneja. */
  conductor_nombres?: string | null
  conductor_apellidos?: string | null
  conductor_doc?: string | null
  conductor_tipo_doc?: string | null
  conductor_licencia?: string | null
  /** Traslado público: el transportista contratado. */
  transportista_ruc?: string | null
  transportista_razon_social?: string | null
}

export interface GuiaUbl {
  serie: string
  numero: string | number
  /** El día en que se emite, no el del traslado. */
  fecha_emision: string
  /** La hora de emisión (HH:MM:SS, hora de Lima). Sin ella va 00:00:00. */
  hora_emision?: string | null
  /** El día en que sale la mercadería. */
  fecha_inicio_traslado: string
  /** Catálogo 20. */
  motivo_traslado: string
  motivo_descripcion?: string | null
  peso_bruto_total: number
  /** Catálogo 03: normalmente KGM. */
  unidad_peso: string
  /** Cuántos bultos van. Opcional. */
  numero_bultos?: number | null
  partida: DireccionGuia
  llegada: DireccionGuia
  destinatario: DestinatarioGuia
  transporte: TransporteGuia
  /** El comprobante que origina el traslado, si lo hay. */
  comprobante_relacionado?: { tipo: string; serie: string; numero: string | number } | null
}

export interface EmisorGuia {
  ruc: string
  razon_social: string
  nombre_comercial?: string
}

export interface ResultadoGuiaUbl {
  xml: string
  /** Sin extensión: `20519883296-09-T001-00000001`. */
  nombreArchivo: string
}

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Guía de remisión remitente. Catálogo 01. */
export const TIPO_GUIA_REMITENTE = '09'

/**
 * Catálogo 20: por qué se traslada la mercadería.
 *
 * Los nombres de la izquierda son los del ERP; los códigos, los de SUNAT.
 */
export const MOTIVO_TRASLADO: Record<string, string> = {
  venta: '01',
  compra: '02',
  traslado_entre_establecimientos: '04',
  traslado_emisor_itinerante: '18',
  importacion: '08',
  exportacion: '09',
  devolucion: '06',
  recojo_bienes: '19',
  otros: '13',
}

/** Catálogo 06: qué documento identifica a una persona o empresa. */
function tipoDocumento(d: { ruc?: string | null; dni?: string | null }): { tipo: string; numero: string } {
  const ruc = (d.ruc ?? '').trim()
  if (/^\d{11}$/.test(ruc)) return { tipo: '6', numero: ruc }
  const dni = (d.dni ?? '').trim()
  if (/^\d{8}$/.test(dni)) return { tipo: '1', numero: dni }
  // Sin documento utilizable: SUNAT exige algo, y el '-' es lo que acepta.
  return { tipo: '0', numero: '-' }
}

/** El correlativo como lo quiere SUNAT: ocho dígitos. */
function correlativo(numero: string | number): string {
  const s = String(numero).trim()
  return s.length >= 8 ? s : s.padStart(8, '0')
}

/**
 * Comprueba lo que SUNAT rechaza antes de que SUNAT lo rechace.
 *
 * Es preferible un error claro acá que un código de tres dígitos media hora
 * después: el envío es asíncrono y el motivo llega en una consulta aparte.
 */
function validar(guia: GuiaUbl, items: ItemGuia[]): void {
  if (!/^T\w{3}$/i.test(guia.serie)) {
    throw new Error(
      `La serie de la guía debe tener cuatro caracteres y empezar con T (por ejemplo T001). `
      + `Llegó "${guia.serie}".`,
    )
  }
  if (items.length === 0) {
    throw new Error('La guía no tiene productos que trasladar')
  }
  for (const [nombre, dir] of [['partida', guia.partida], ['llegada', guia.llegada]] as const) {
    if (!/^\d{6}$/.test((dir?.ubigeo ?? '').trim())) {
      throw new Error(
        `Falta el ubigeo de ${nombre}, o no tiene seis dígitos. SUNAT lo exige en los dos extremos `
        + `del traslado.`,
      )
    }
    if (!(dir?.direccion ?? '').trim()) {
      throw new Error(`Falta la dirección de ${nombre}`)
    }
  }
  if (!(guia.peso_bruto_total > 0)) {
    throw new Error('El peso bruto total tiene que ser mayor que cero')
  }
  if (guia.transporte.modalidad === 'privado') {
    if (!(guia.transporte.placa ?? '').trim()) {
      throw new Error('Traslado por cuenta propia: falta la placa del vehículo')
    }
    const doc = (guia.transporte.conductor_doc ?? '').trim()
    if (!doc) {
      throw new Error('Traslado por cuenta propia: falta el documento del conductor')
    }
  } else if (!/^\d{11}$/.test((guia.transporte.transportista_ruc ?? '').trim())) {
    throw new Error('Traslado con transportista: falta el RUC de la empresa de transporte')
  }
  // La guía se emite ANTES de que salga la mercadería: el traslado no puede
  // empezar antes del día de emisión.
  if (guia.fecha_inicio_traslado < guia.fecha_emision) {
    throw new Error(
      `El traslado (${guia.fecha_inicio_traslado}) no puede empezar antes de la emisión de la guía `
      + `(${guia.fecha_emision}).`,
    )
  }
  if (!MOTIVO_TRASLADO[guia.motivo_traslado]) {
    throw new Error(`Motivo de traslado desconocido: "${guia.motivo_traslado}"`)
  }
}

export function construirGuiaRemision(
  { guia, emisor, items }: { guia: GuiaUbl; emisor: EmisorGuia; items: ItemGuia[] },
): ResultadoGuiaUbl {
  validar(guia, items)

  const numero = correlativo(guia.numero)
  const id = `${guia.serie.toUpperCase()}-${numero}`
  const dest = tipoDocumento(guia.destinatario)
  const codigoMotivo = MOTIVO_TRASLADO[guia.motivo_traslado]

  /*
   * El transporte. Son dos bloques distintos y excluyentes: con transportista
   * va su RUC; por cuenta propia van el vehículo y el conductor. Mandar los dos
   * —o ninguno— es motivo de rechazo.
   */
  const bloqueTransporte = guia.transporte.modalidad === 'publico'
    ? `
      <cac:CarrierParty>
        <cac:PartyIdentification>
          <cbc:ID schemeID="6">${esc(guia.transporte.transportista_ruc)}</cbc:ID>
        </cac:PartyIdentification>
        <cac:PartyLegalEntity>
          <cbc:RegistrationName><![CDATA[${guia.transporte.transportista_razon_social ?? ''}]]></cbc:RegistrationName>
        </cac:PartyLegalEntity>
      </cac:CarrierParty>`
    : `
      <cac:OwnerParty>
        <cac:PartyIdentification>
          <cbc:ID schemeID="6">${esc(emisor.ruc)}</cbc:ID>
        </cac:PartyIdentification>
      </cac:OwnerParty>
      <cac:DriverPerson>
        <cbc:ID schemeID="${esc(guia.transporte.conductor_tipo_doc || '1')}">${esc(guia.transporte.conductor_doc)}</cbc:ID>
        <cbc:FirstName><![CDATA[${guia.transporte.conductor_nombres ?? ''}]]></cbc:FirstName>
        <cbc:FamilyName><![CDATA[${guia.transporte.conductor_apellidos ?? ''}]]></cbc:FamilyName>
        <cbc:JobTitle>Principal</cbc:JobTitle>
        <cac:IdentityDocumentReference>
          <cbc:ID>${esc((guia.transporte.conductor_licencia ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase())}</cbc:ID>
        </cac:IdentityDocumentReference>
      </cac:DriverPerson>`

  const bloqueVehiculo = guia.transporte.modalidad === 'privado'
    ? `
    <cac:TransportHandlingUnit>
      <cac:TransportEquipment>
        <cbc:ID>${esc((guia.transporte.placa ?? '').replace(/[^A-Za-z0-9]/g, ''))}</cbc:ID>
      </cac:TransportEquipment>
    </cac:TransportHandlingUnit>`
    : ''

  // El comprobante que origina el traslado, cuando lo hay.
  const bloqueRelacionado = guia.comprobante_relacionado
    ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>${esc(guia.comprobante_relacionado.serie)}-${esc(correlativo(guia.comprobante_relacionado.numero))}</cbc:ID>
    <cbc:DocumentTypeCode>${esc(guia.comprobante_relacionado.tipo)}</cbc:DocumentTypeCode>
  </cac:AdditionalDocumentReference>`
    : ''

  const lineas = items.map((it, i) => `
  <cac:DespatchLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:DeliveredQuantity unitCode="${esc(it.unidad || 'NIU')}">${Number(it.cantidad).toFixed(2)}</cbc:DeliveredQuantity>
    <cac:OrderLineReference>
      <cbc:LineID>${i + 1}</cbc:LineID>
    </cac:OrderLineReference>
    <cac:Item>
      <cbc:Description><![CDATA[${it.descripcion}]]></cbc:Description>
      ${it.codigo ? `<cac:SellersItemIdentification><cbc:ID>${esc(it.codigo)}</cbc:ID></cac:SellersItemIdentification>` : ''}
    </cac:Item>
  </cac:DespatchLine>`).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${esc(id)}</cbc:ID>
  <cbc:IssueDate>${esc(guia.fecha_emision)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(guia.hora_emision || '00:00:00')}</cbc:IssueTime>
  <cbc:DespatchAdviceTypeCode>${TIPO_GUIA_REMITENTE}</cbc:DespatchAdviceTypeCode>
  ${guia.motivo_descripcion ? `<cbc:Note><![CDATA[${guia.motivo_descripcion}]]></cbc:Note>` : ''}
${bloqueRelacionado}
  <cac:DespatchSupplierParty>
    <cbc:CustomerAssignedAccountID schemeID="6">${esc(emisor.ruc)}</cbc:CustomerAssignedAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${emisor.razon_social}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:DespatchSupplierParty>
  <cac:DeliveryCustomerParty>
    <cbc:CustomerAssignedAccountID schemeID="${dest.tipo}">${esc(dest.numero)}</cbc:CustomerAssignedAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${guia.destinatario.razon_social}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:DeliveryCustomerParty>
  <cac:Shipment>
    <cbc:ID>SUNAT_Envio</cbc:ID>
    <cbc:HandlingCode>${esc(codigoMotivo)}</cbc:HandlingCode>
    ${guia.motivo_descripcion ? `<cbc:Information><![CDATA[${guia.motivo_descripcion}]]></cbc:Information>` : ''}
    <cbc:GrossWeightMeasure unitCode="${esc(guia.unidad_peso || 'KGM')}">${Number(guia.peso_bruto_total).toFixed(3)}</cbc:GrossWeightMeasure>
    ${guia.numero_bultos ? `<cbc:TotalTransportHandlingUnitQuantity>${Number(guia.numero_bultos)}</cbc:TotalTransportHandlingUnitQuantity>` : ''}
    <cac:ShipmentStage>
      <cbc:TransportModeCode>${guia.transporte.modalidad === 'publico' ? '01' : '02'}</cbc:TransportModeCode>
      <cac:TransitPeriod>
        <cbc:StartDate>${esc(guia.fecha_inicio_traslado)}</cbc:StartDate>
      </cac:TransitPeriod>${bloqueTransporte}
    </cac:ShipmentStage>
    <cac:Delivery>
      <cac:DeliveryAddress>
        <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${esc(guia.llegada.ubigeo)}</cbc:ID>
        <cac:AddressLine>
          <cbc:Line><![CDATA[${guia.llegada.direccion}]]></cbc:Line>
        </cac:AddressLine>
      </cac:DeliveryAddress>
      <cac:Despatch>
        <cac:DespatchAddress>
          <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${esc(guia.partida.ubigeo)}</cbc:ID>
          <cac:AddressLine>
            <cbc:Line><![CDATA[${guia.partida.direccion}]]></cbc:Line>
          </cac:AddressLine>
        </cac:DespatchAddress>
      </cac:Despatch>
    </cac:Delivery>${bloqueVehiculo}
  </cac:Shipment>${lineas}
</DespatchAdvice>`

  return {
    xml,
    nombreArchivo: `${emisor.ruc}-${TIPO_GUIA_REMITENTE}-${id}`,
  }
}
