/**
 * ¿La firma que generamos se verifica contra el XML que mandamos?
 *
 * SUNAT respondió 2335 "Incorrect reference digest value". Eso puede ser culpa
 * de la firma o de que el XML cambie entre el momento en que se calcula el
 * digest y el momento en que se serializa. Verificarlo acá, con la misma
 * librería, separa las dos cosas: si acá tampoco verifica, el problema es
 * nuestro y no hay que adivinar del lado de SUNAT.
 */

import fs from 'node:fs'
import path from 'node:path'
import { SignedXml } from 'xml-crypto'
import { DOMParser } from '@xmldom/xmldom'

const archivo = process.argv[2] ?? path.join(process.cwd(), '.sunat', '20519883296-01-F002-00000044.xml')
const xml = fs.readFileSync(archivo, 'utf8')

const doc = new DOMParser().parseFromString(xml, 'text/xml')
const nodos = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')
if (nodos.length === 0) { console.error('No hay firma en el XML'); process.exit(1) }
const firma = nodos[0]

// El certificado con el que verificar sale del propio XML: la firma lo lleva
// adentro, en KeyInfo, que es de donde también lo saca SUNAT.
const der = xml.match(/<ds:X509Certificate>([\s\S]*?)<\/ds:X509Certificate>/)?.[1]?.replace(/\s+/g, '')
if (!der) { console.error('La firma no trae el certificado'); process.exit(1) }
const pem = `-----BEGIN CERTIFICATE-----\n${der.replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`

const sig = new SignedXml({ publicCert: pem })
sig.loadSignature(firma as unknown as Node)

let ok = false
try {
  ok = sig.checkSignature(xml)
} catch (e) {
  console.log('\nNo validó:', e instanceof Error ? e.message : String(e))
}

console.log(`\nArchivo: ${path.basename(archivo)}`)
console.log(`Verifica: ${ok ? 'SÍ' : 'NO'}`)
if (!ok) {
  console.log('Motivo:', (sig as unknown as { validationErrors?: string[] }).validationErrors ?? '(sin detalle)')
}

// Los dos valores que SUNAT compara.
console.log('\nDigest declarado en la firma:',
  xml.match(/<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/)?.[1] ?? '—')
console.log('Referencia URI:',
  xml.match(/<ds:Reference URI="([^"]*)"/)?.[1] ?? '(sin URI)')
console.log('Transformadas:',
  Array.from(xml.matchAll(/<ds:Transform Algorithm="([^"]+)"/g)).map((m) => m[1].split('#')[1] || m[1]).join(', '))
console.log()
