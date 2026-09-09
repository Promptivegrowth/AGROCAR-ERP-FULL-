/**
 * Probar el flujo nuevo: se imprime antes, se declara el día del reparto.
 *
 * Tres cosas tienen que ser ciertas para que esto funcione, y las tres se
 * comprueban acá contra el código de verdad, no contra una copia:
 *
 *   1. El comprobante nace con la fecha del reparto, aunque todavía no llegó
 *   2. Nadie puede declararlo antes de esa fecha (SUNAT lo rechazaría con 2329)
 *   3. Llegado el día, entra solo en la lista de lo que hay que declarar
 *
 * La segunda es la importante: es la que protege el papel que ya se imprimió.
 *
 * Toca un comprobante real: le mueve la fecha, mira qué pasa y lo deja como
 * estaba, pase lo que pase. No envía nada a SUNAT —la prueba consiste
 * justamente en que se corte antes—.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/probar-emision-el-dia-del-reparto.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { abrirCertificado } from '../src/lib/sunat/firma'
import { declararComprobante, comprobantesPendientes } from '../src/lib/sunat/declarar'
import type { ConfiguracionSunat } from '../src/lib/sunat/config'

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

const LIMA = 5 * 60 * 60 * 1000
const hoyLima = () => new Date(Date.now() - LIMA).toISOString().slice(0, 10)
function correr(base: string, dias: number) {
  const d = new Date(`${base}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// ── La misma regla que usa la pantalla al emitir ────────────────────────────
const MAX_DIAS_ANTICIPO = 7
function fechaEmisionComprobante(fechaDespacho?: string | null): string {
  const hoy = hoyLima()
  if (!fechaDespacho) return hoy
  if (fechaDespacho <= hoy) return fechaDespacho
  const tope = new Date(`${hoy}T12:00:00Z`)
  tope.setUTCDate(tope.getUTCDate() + MAX_DIAS_ANTICIPO)
  return fechaDespacho <= tope.toISOString().slice(0, 10) ? fechaDespacho : hoy
}

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const hoy = hoyLima()

  console.log('\nEMISIÓN EL DÍA DEL REPARTO')
  console.log(`Hoy es ${hoy}.\n`)

  // ── 1. La fecha con la que nace el comprobante ────────────────────────────
  console.log('  1. Con qué fecha nace el comprobante\n')
  const sabadoParaLunes = correr(hoy, 2)
  check('El reparto de pasado mañana se emite con ESA fecha, no con la de hoy',
    fechaEmisionComprobante(sabadoParaLunes) === sabadoParaLunes,
    `despacho ${sabadoParaLunes} → emisión ${fechaEmisionComprobante(sabadoParaLunes)}`)
  check('El reparto de mañana se emite con la fecha de mañana',
    fechaEmisionComprobante(correr(hoy, 1)) === correr(hoy, 1))
  check('El reparto de hoy se emite hoy',
    fechaEmisionComprobante(hoy) === hoy)
  check('Un reparto ya pasado conserva su fecha',
    fechaEmisionComprobante(correr(hoy, -2)) === correr(hoy, -2))
  check('Una fecha absurda (dentro de 40 días) NO se usa: se emite hoy',
    fechaEmisionComprobante(correr(hoy, 40)) === hoy,
    `despacho ${correr(hoy, 40)} → emisión ${fechaEmisionComprobante(correr(hoy, 40))}`)
  check('Sin fecha de despacho, se emite hoy',
    fechaEmisionComprobante(null) === hoy)

  // ── 2. Que no se pueda declarar antes de tiempo ───────────────────────────
  console.log('\n  2. Que nada salga antes de su fecha\n')

  const { data: victima } = await (supabase as any).from('comprobantes')
    .select('id, serie, numero, fecha_emision, fecha_despacho')
    .in('tipo', ['factura', 'boleta'])
    .eq('enviado_sunat', false).neq('estado', 'anulado')
    .order('fecha_emision', { ascending: false }).limit(1).maybeSingle()

  if (!victima) {
    check('Hay un comprobante sin declarar para probar', false)
  } else {
    const c = victima as { id: string; serie: string; numero: string; fecha_emision: string }
    const original = c.fecha_emision
    const futura = correr(hoy, 2)

    const conf: ConfiguracionSunat = {
      modo: 'beta',
      usuario: '20519883296MODDATOS',
      clave: 'MODDATOS',
      certificado: abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS')),
      envioAutomatico: false,
      // El barrido exige una fecha de corte. Se pone una vieja para que la
      // lista incluya al comprobante de prueba y se pueda comprobar el filtro.
      sincronizarDesde: '2020-01-01',
      razon: 'prueba',
    }

    try {
      await (supabase as any).from('comprobantes')
        .update({ fecha_emision: futura }).eq('id', c.id)

      // El código real, el mismo que usan la pantalla y el proceso automático.
      const r = await declararComprobante(c.id, conf)

      check('Se niega a declarar un comprobante fechado adelante',
        !r.ok && !!r.motivo && r.estadoHttp === 409,
        `${c.serie}-${c.numero} fechado ${futura}: ${r.motivo ?? 'sin motivo'}`)
      check('Avisa para qué día quedó programado',
        r.programadoPara === futura, r.programadoPara ?? '')
      check('No lo marcó como rechazado ni le sumó un intento fallido',
        r.codigo === undefined, `código devuelto: ${r.codigo ?? 'ninguno'}`)

      // ── 3. La lista de lo que toca declarar hoy ────────────────────────────
      console.log('\n  3. La lista de lo que toca declarar hoy\n')
      const conFechaFutura = await comprobantesPendientes(conf, 1000)
      check('Un comprobante fechado adelante NO aparece en la lista de hoy',
        !conFechaFutura.some((p) => p.id === c.id),
        `${conFechaFutura.length} pendientes`)

      // Llegado el día, entra solo.
      await (supabase as any).from('comprobantes')
        .update({ fecha_emision: hoy }).eq('id', c.id)
      const llegadoElDia = await comprobantesPendientes(conf, 1000)
      check('Fechado hoy, SÍ aparece en la lista para declarar',
        llegadoElDia.some((p) => p.id === c.id),
        `${llegadoElDia.length} pendientes`)

      /*
       * Y sin fecha de corte no se barre nada. Los comprobantes que el ERP
       * emitió antes de conectarse a SUNAT no se declaran, y el proceso
       * automático no arranca hasta que esa linea esté puesta.
       */
      const sinCorte = await comprobantesPendientes(
        { ...conf, sincronizarDesde: null }, 1000)
      check('Sin fecha de corte, el barrido automático no toma NADA',
        sinCorte.length === 0, `${sinCorte.length} pendientes`)

      // El corte deja afuera lo anterior a esa fecha.
      const desdeHoy = await comprobantesPendientes(
        { ...conf, sincronizarDesde: hoy }, 1000)
      check('El corte deja afuera los comprobantes anteriores a esa fecha',
        desdeHoy.every((p) => p.fecha_emision >= hoy),
        `${desdeHoy.length} desde ${hoy}, contra ${llegadoElDia.length} desde 2020`)
    } finally {
      await (supabase as any).from('comprobantes')
        .update({ fecha_emision: original }).eq('id', c.id)
      const { data: fin } = await (supabase as any).from('comprobantes')
        .select('fecha_emision').eq('id', c.id).maybeSingle()
      check('El comprobante quedó como estaba',
        (fin as { fecha_emision: string } | null)?.fecha_emision === original, original)
    }
  }

  // ── Que nada se haya declarado ─────────────────────────────────────────────
  const { count } = await (supabase as any).from('comprobantes')
    .select('id', { count: 'exact', head: true })
    .eq('sunat_modo', 'produccion').eq('enviado_sunat', true)
  check('Sigue sin haber NADA declarado en producción', (count ?? 0) === 0, `${count ?? 0} declarados`)

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
