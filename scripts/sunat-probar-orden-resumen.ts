/**
 * ¿Dónde va `sac:Status` dentro de la línea del resumen diario?
 *
 * SUNAT rechazó el resumen diciendo que después de `AccountingCustomerParty`
 * esperaba `TotalAmount`, no `Status`. En vez de adivinar, se prueban las tres
 * posiciones posibles contra beta y se queda la que acepta. El validador de
 * SUNAT es la única documentación que no miente.
 */

import fs from 'node:fs'
import path from 'node:path'
import { abrirCertificado, firmarXml, comprimir, enviarResumen } from '../src/lib/sunat/firma'

const RUC = '20519883296'
const RAZON = 'AGROCAR S.R.L.'

function cargarEnvLocal() {
  const f = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(f)) return
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const env = (n: string) => {
  const v = process.env[n]
  if (!v) throw new Error(`Falta ${n}`)
  return v
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const STATUS = `
    <sac:Status>
      <cbc:ConditionCode>3</cbc:ConditionCode>
    </sac:Status>`

const CLIENTE = `
    <cac:AccountingCustomerParty>
      <cbc:CustomerAssignedAccountID>24990691</cbc:CustomerAssignedAccountID>
      <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    </cac:AccountingCustomerParty>`

const IMPORTES = `
    <sac:TotalAmount currencyID="PEN">2085.20</sac:TotalAmount>
    <sac:BillingPayment>
      <cbc:PaidAmount currencyID="PEN">1767.11</cbc:PaidAmount>
      <cbc:InstructionID>01</cbc:InstructionID>
    </sac:BillingPayment>`

const IMPUESTOS = `
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="PEN">318.09</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxAmount currencyID="PEN">318.09</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID>1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>`

const VARIANTES: { nombre: string; cuerpo: string }[] = [
  { nombre: 'Sin Status: solo informar la boleta', cuerpo: CLIENTE + IMPORTES + IMPUESTOS },
  { nombre: 'Status entre el cliente y los importes', cuerpo: CLIENTE + STATUS + IMPORTES + IMPUESTOS },
  { nombre: 'Status despues de los importes', cuerpo: CLIENTE + IMPORTES + STATUS + IMPUESTOS },
  { nombre: 'Status al final de la linea', cuerpo: CLIENTE + IMPORTES + IMPUESTOS + STATUS },
  { nombre: 'Status antes del cliente', cuerpo: STATUS + CLIENTE + IMPORTES + IMPUESTOS },
]

function armar(cuerpo: string, id: string, hoy: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1" xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.1</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:ReferenceDate>${hoy}</cbc:ReferenceDate>
  <cbc:IssueDate>${hoy}</cbc:IssueDate>
  <cac:Signature>
    <cbc:ID>${RUC}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${RUC}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${RAZON}]]></cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference><cbc:URI>#SignatureSP</cbc:URI></cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cbc:CustomerAssignedAccountID>${RUC}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity><cbc:RegistrationName><![CDATA[${RAZON}]]></cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <sac:SummaryDocumentsLine>
    <cbc:LineID>1</cbc:LineID>
    <cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>
    <cbc:ID>B002-288</cbc:ID>${cuerpo}
  </sac:SummaryDocumentsLine>
</SummaryDocuments>`
}

async function main() {
  cargarEnvLocal()
  fs.mkdirSync('.sunat', { recursive: true })
  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
  const cred = { modo: 'beta' as const, usuario: `${RUC}MODDATOS`, clave: 'MODDATOS' }

  console.log('\nProbando dónde acepta SUNAT el elemento Status:\n')

  for (let i = 0; i < VARIANTES.length; i++) {
    const v = VARIANTES[i]
    const id = `RC-${hoy.replace(/-/g, '')}-${20 + i}`
    const nombre = `${RUC}-${id}`
    const zip = await comprimir(nombre, firmarXml(armar(v.cuerpo, id, hoy), cert))
    const r = await enviarResumen({ ...cred, nombreArchivo: nombre, zip })

    if (r.ok) {
      console.log(`  ${v.nombre}\n     ACEPTADO — ticket ${r.ticket}\n`)
      console.log(`  El orden correcto es: ${v.nombre.toLowerCase()}.\n`)
      return
    }
    const detalle = (r.mensaje ?? '').replace(/\s+/g, ' ')
    const esperado = detalle.match(/next item should be \{[^}]*\}(\w+)/)?.[1]
    // Cuando el mensaje no nombra el elemento esperado, el detalle completo es
    // lo único que dice qué se rompió: se guarda entero.
    fs.writeFileSync(path.join('.sunat', `orden-${i + 1}.txt`), detalle, 'utf8')
    console.log(`  ${v.nombre}\n     rechazado${esperado ? ` — esperaba ${esperado} en ese lugar` : `: ${detalle.slice(0, 120)}`}`)
    await esperar(1500)
  }
  console.log('\n  Ninguna variante fue aceptada.\n')
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
