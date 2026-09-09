/**
 * ¿Qué fechas de emisión acepta SUNAT, y cuáles no?
 *
 * De esto depende el flujo que necesita AGROCAR. Los pedidos se toman el
 * sábado, el camión sale el lunes a las 3:30 de la madrugada y no hay nadie en
 * la oficina a esa hora: el papel que el cliente recibe el lunes tiene que
 * imprimirse el sábado. Daniel pide que la fecha de emisión sea la del
 * reparto, no la del sábado.
 *
 * Eso obliga a emitir el sábado un comprobante fechado el lunes. La pregunta
 * es si SUNAT lo acepta cuando se envía el lunes —y si lo rechaza cuando se
 * envía antes—, porque de ahí sale todo el diseño.
 *
 * Manda la MISMA factura, con la misma estructura, cambiando solo la fecha de
 * emisión, y anota el veredicto de SUNAT en cada caso. Cada envío usa un
 * número distinto para que ninguno choque con otro (código 4000).
 *
 * Beta. No declara nada.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-probar-ventana-fechas.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { construirInvoice, type ItemUbl } from '../src/lib/sunat/ubl'
import { abrirCertificado, firmarXml, comprimir, enviarASunat } from '../src/lib/sunat/firma'

const EMISOR = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
  direccion: 'CAL. EMILIO FORERO NRO 553A - TACNA',
}
const BETA = { usuario: `${EMISOR.ruc}MODDATOS`, clave: 'MODDATOS' }

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

/** Hoy en Lima (UTC-5). */
const LIMA = 5 * 60 * 60 * 1000
const hoyLima = () => new Date(Date.now() - LIMA).toISOString().slice(0, 10)
function correr(dias: number): string {
  const d = new Date(`${hoyLima()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const ITEMS: ItemUbl[] = [{
  cantidad: 10,
  precio_unitario: 11.8,
  igv_porcentaje: 18,
  descripcion: 'PRUEBA VENTANA DE FECHAS',
  codigo: 'TEST',
  unidad: 'NIU',
}]

const CLIENTE = {
  razon_social: 'CLIENTE DE PRUEBA SUNAT',
  ruc: '20000000001',
  dni: null,
  direccion: 'TACNA',
}

interface Caso { etiqueta: string; dias: number; espera: 'aceptado' | 'rechazado' }

const CASOS: Caso[] = [
  { etiqueta: 'Fechada HOY (el caso normal)', dias: 0, espera: 'aceptado' },
  { etiqueta: 'Fechada MAÑANA (el sábado emitiendo para el domingo)', dias: 1, espera: 'rechazado' },
  { etiqueta: 'Fechada en 2 DÍAS (el sábado emitiendo para el lunes)', dias: 2, espera: 'rechazado' },
  { etiqueta: 'Fechada AYER (dentro del plazo de envío)', dias: -1, espera: 'aceptado' },
  { etiqueta: 'Fechada hace 3 DÍAS (borde del plazo)', dias: -3, espera: 'aceptado' },
  { etiqueta: 'Fechada hace 10 DÍAS (fuera de plazo)', dias: -10, espera: 'aceptado' },
]

async function main() {
  cargarEnvLocal()
  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))

  console.log('\nQUÉ FECHAS DE EMISIÓN ACEPTA SUNAT')
  console.log(`Enviando hoy ${hoyLima()}, contra el servicio de pruebas.\n`)

  // Base alta y variable para que ningún número choque con envíos anteriores.
  const base = 90000000 + (Date.now() % 9000000)
  const resultados: { caso: Caso; codigo: string | null; mensaje: string | null }[] = []

  for (let i = 0; i < CASOS.length; i++) {
    const caso = CASOS[i]
    const fecha = correr(caso.dias)
    const numero = String(base + i)

    process.stdout.write(`  ${caso.etiqueta}\n      fecha ${fecha} … `)

    try {
      const { xml, nombreArchivo } = construirInvoice({
        comprobante: {
          serie: 'F001', numero, tipo: 'factura',
          fecha_emision: fecha, moneda: 'PEN', forma_pago: 'contado',
          cliente: CLIENTE,
        },
        emisor: EMISOR,
        items: ITEMS,
      })
      const zip = await comprimir(nombreArchivo, firmarXml(xml, cert))
      const r = await enviarASunat({ modo: 'beta', ...BETA, nombreArchivo, zip })
      const veredicto = r.codigo === '0' ? 'ACEPTADO' : `RECHAZADO ${r.codigo}`
      console.log(`${veredicto}`)
      if (r.codigo !== '0') console.log(`      SUNAT dice: ${r.mensaje}`)
      if (r.observaciones?.length) {
        r.observaciones.forEach((o) => console.log(`      observación: ${o}`))
      }
      resultados.push({ caso, codigo: r.codigo, mensaje: r.mensaje })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`ERROR DE ENVÍO`)
      console.log(`      ${msg}`)
      resultados.push({ caso, codigo: 'error', mensaje: msg })
    }

    // Beta limita el ritmo; sin pausa devuelve 401 que no es de credenciales.
    await new Promise((r) => setTimeout(r, 1500))
  }

  console.log('\n  ── Lo que esto significa ──────────────────────────────────\n')
  for (const { caso, codigo } of resultados) {
    const aceptado = codigo === '0'
    const comoEsperado = (aceptado ? 'aceptado' : 'rechazado') === caso.espera
    console.log(`  ${comoEsperado ? '  ' : '! '}${aceptado ? 'acepta  ' : 'rechaza '} ${caso.etiqueta}`)
  }
  console.log()
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
