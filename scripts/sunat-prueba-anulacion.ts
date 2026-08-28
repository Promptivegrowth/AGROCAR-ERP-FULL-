/**
 * Prueba de anulación contra el servicio BETA.
 *
 * Es la parte que nadie prueba hasta que la necesita, y para entonces ya hay
 * un comprobante mal emitido esperando. Acá se ejercitan los dos caminos:
 *
 *   Comunicación de Baja (RA)  ->  para dar de baja una factura
 *   Resumen Diario (RC)        ->  para anular una boleta
 *
 * Los dos son asíncronos: SUNAT devuelve un ticket y hay que volver a
 * preguntar por el resultado.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-prueba-anulacion.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { construirComunicacionBaja, construirResumenDiario } from '../src/lib/sunat/resumen'
import {
  abrirCertificado, firmarXml, comprimir, enviarResumen, consultarTicket,
} from '../src/lib/sunat/firma'

const EMISOR = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
  direccion: 'CAL. EMILIO FORERO NRO 553A - TACNA',
}

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

const cred = { modo: 'beta' as const, usuario: `${EMISOR.ruc}MODDATOS`, clave: 'MODDATOS' }

async function mandar(nombre: string, xml: string, cert: any, etiqueta: string) {
  const firmado = firmarXml(xml, cert)
  fs.writeFileSync(path.join('.sunat', `${nombre}.xml`), firmado, 'utf8')
  const zip = await comprimir(nombre, firmado)

  const envio = await enviarResumen({ ...cred, nombreArchivo: nombre, zip })
  if (!envio.ok) {
    console.log(`  ${etiqueta}: rechazado al enviar — ${envio.mensaje}`)
    return false
  }
  console.log(`  ${etiqueta}: ticket ${envio.ticket}`)

  // SUNAT lo procesa aparte; se pregunta hasta cinco veces antes de rendirse.
  for (let i = 1; i <= 5; i++) {
    await esperar(3000)
    const r = await consultarTicket({ ...cred, ticket: envio.ticket! })
    if (r.enProceso) { console.log(`     (en proceso, intento ${i})`); continue }
    if (r.cdrXml) fs.writeFileSync(path.join('.sunat', `R-${nombre}.xml`), r.cdrXml, 'utf8')
    console.log(`     [${r.codigo}] ${r.mensaje}`)
    if (r.observaciones?.length) r.observaciones.forEach((o) => console.log(`       · ${o}`))
    return r.ok
  }
  console.log('     SUNAT no terminó de procesarlo dentro del tiempo de espera')
  return false
}

async function main() {
  cargarEnvLocal()
  fs.mkdirSync('.sunat', { recursive: true })
  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })

  console.log('\nANULACIÓN — servicio de pruebas de SUNAT\n')

  // ── 1. Dar de baja una factura ───────────────────────────────────────────
  const baja = construirComunicacionBaja({
    emisor: EMISOR,
    correlativo: 1,
    fechaDocumentos: hoy,
    fechaComunicacion: hoy,
    documentos: [{ tipo: '01', serie: 'F002', numero: 44, motivo: 'ERROR EN LOS DATOS DEL COMPROBANTE' }],
  })
  const ok1 = await mandar(baja.nombreArchivo, baja.xml, cert, `Baja de factura  ${baja.id}`)

  await esperar(2000)

  // ── 2. Anular una boleta por resumen diario ──────────────────────────────
  const resumen = construirResumenDiario({
    emisor: EMISOR,
    correlativo: 1,
    fechaBoletas: hoy,
    fechaResumen: hoy,
    boletas: [{
      serie: 'B002', numero: 288, estado: 3,
      clienteTipoDoc: '1', clienteDoc: '24990691',
      gravado: 1767.11, igv: 318.09, total: 2085.20,
    }],
  })
  const ok2 = await mandar(resumen.nombreArchivo, resumen.xml, cert, `Anular boleta    ${resumen.id}`)

  console.log(`\n  Baja de factura:  ${ok1 ? 'aceptada' : 'falta corregir'}`)
  console.log(`  Anular boleta:    ${ok2 ? 'aceptada' : 'falta corregir'}\n`)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
