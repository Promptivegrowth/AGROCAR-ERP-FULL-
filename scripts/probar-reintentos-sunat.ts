/**
 * Prueba sin red de enviarASunat: cuántas veces envía y qué devuelve según lo
 * que conteste SUNAT (11/10/2026, 0140 por reintentos tras un 502).
 *   npx tsx scripts/probar-reintentos-sunat.ts
 */
import { enviarASunat } from '../src/lib/sunat/firma'
import { quedaEnProceso } from '../src/lib/sunat/declarar'

const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
const fault = (cod: string, msg: string) => `<soap-env:Envelope><soap-env:Body><soap-env:Fault><faultcode>soap-env:Server.${cod}</faultcode><faultstring>${msg}</faultstring></soap-env:Fault></soap-env:Body></soap-env:Envelope>`

async function caso(nombre: string, respuestas: (() => Response)[]) {
  let llamadas = 0
  ;(globalThis as any).fetch = async () => { const r = respuestas[Math.min(llamadas, respuestas.length - 1)]; llamadas++; return r() }
  const r = await enviarASunat({ modo: 'produccion', usuario: 'u', clave: 'c', nombreArchivo: 'x', zip: Buffer.from('z') })
  return { llamadas, r }
}

;(async () => {
  let x = await caso('502', [() => new Response('<html>Bad Gateway</html>', { status: 502 })])
  check('502 de SUNAT: un solo envío, sin reintento inmediato', x.llamadas === 1 && x.r.tipo === 'sin_respuesta', `${x.llamadas} envío(s) · ${x.r.tipo} · ${x.r.mensaje}`)

  x = await caso('504', [() => new Response('', { status: 504 })])
  check('504: un solo envío', x.llamadas === 1 && x.r.tipo === 'sin_respuesta', `${x.llamadas} · ${x.r.mensaje}`)

  x = await caso('red', [() => { throw new Error('socket hang up') }])
  check('Sin respuesta (red/tiempo): un solo envío', x.llamadas === 1 && x.r.tipo === 'sin_respuesta', `${x.llamadas} · ${x.r.mensaje}`)

  x = await caso('401', [() => new Response('', { status: 401 })])
  check('401 (SUNAT apurado): sí reintenta, 3 veces', x.llamadas === 3, `${x.llamadas} envíos`)

  x = await caso('401→ok', [() => new Response('', { status: 401 }), () => new Response(fault('0140', 'Existe un Documento igual en Proceso'), { status: 400 })])
  check('401 y luego respuesta: se detiene en la respuesta', x.llamadas === 2 && x.r.tipo === 'fault', `${x.llamadas} · ${x.r.codigo}`)

  x = await caso('0140', [() => new Response(fault('0140', 'Existe un Documento igual en Proceso'), { status: 400 })])
  check('0140: un envío, devuelve el código para quedar "en proceso"', x.llamadas === 1 && /(^|\.)01[04]0$/.test(x.r.codigo ?? ''), `${x.r.codigo}`)

  x = await caso('2325 con 500', [() => new Response(fault('2325', 'El certificado usado no es el comunicado'), { status: 500 })])
  check('Rechazo real con HTTP 500 (2325): un envío y queda como rechazo', x.llamadas === 1 && x.r.tipo === 'fault' && !/(^|\.)01[04]0$/.test(x.r.codigo ?? ''), `${x.r.codigo}`)

  // Qué queda "en proceso" (se reintenta) y qué es un rechazo de verdad
  const casos: [string, { tipo: string; codigo: string | null }, boolean][] = [
    ['0140', { tipo: 'fault', codigo: 'soap-env:Server.0140' }, true],
    ['0100', { tipo: 'fault', codigo: 'soap-env:Server.0100' }, true],
    ['Fault genérico del servidor', { tipo: 'fault', codigo: 'soap-env:Server' }, true],
    ['Sin respuesta', { tipo: 'sin_respuesta', codigo: null }, true],
    ['2325 certificado', { tipo: 'fault', codigo: 'soap-env:Server.2325' }, false],
    ['0102 usuario o clave', { tipo: 'fault', codigo: 'soap-env:Client.0102' }, false],
    ['CDR con rechazo 2017', { tipo: 'cdr', codigo: '2017' }, false],
    ['CDR aceptado con obs. 4000', { tipo: 'cdr', codigo: '4000' }, false],
  ]
  for (const [n, r, esperado] of casos) check(`${n}: ${esperado ? 'en proceso' : 'no en proceso'}`, quedaEnProceso(r) === esperado)

  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((v) => !v)) process.exit(1)
})()
