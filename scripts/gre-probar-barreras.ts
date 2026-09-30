/**
 * Que la guía no se pueda declarar por descuido.
 *
 * Con los comprobantes, equivocarse en beta no cuesta nada. Acá sí: la guía no
 * tiene ambiente de pruebas, así que cada envío queda. Estas son las barreras
 * que lo impiden, ejercidas de verdad.
 *
 * Nada de esto envía nada a SUNAT — salvo pedir un token, que no declara.
 *
 *   npx tsx scripts/gre-probar-barreras.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { configuracionGre } from '../src/lib/sunat/gre-config'
import { obtenerToken } from '../src/lib/sunat/gre-envio'

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

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nLAS BARRERAS DE LA GUÍA DE REMISIÓN\n')

  const leer = async () => {
    const { data } = await (supabase as any).from('configuracion')
      .select('clave, valor').in('clave', ['gre_activo', 'gre_declarar_desde'])
    const c: Record<string, string> = {}
    ;((data ?? []) as any[]).forEach((f) => { c[f.clave] = f.valor })
    return c
  }
  const poner = async (clave: string, valor: string) => {
    await (supabase as any).from('configuracion').update({ valor }).eq('clave', clave)
  }

  const antes = await leer()
  console.log(`  estado antes: ${JSON.stringify(antes)}\n`)

  try {
    // ── 1. Apagado: no se envía ────────────────────────────────────────────
    await poner('gre_activo', 'false')
    let conf = await configuracionGre()
    check('Apagado, se niega a declarar', !conf.listo, conf.motivo.slice(0, 90))

    // ── 2. Encendido pero sin fecha de corte ───────────────────────────────
    await poner('gre_activo', 'true')
    await poner('gre_declarar_desde', '')
    conf = await configuracionGre()
    check('Encendido, reconoce las credenciales', conf.listo, conf.motivo.slice(0, 90))
    check('Pero avisa que sin fecha de corte no declara ninguna',
      conf.declararDesde === null && /sin fecha de inicio/i.test(conf.motivo))

    // ── 3. Con fecha: recién ahí queda listo ───────────────────────────────
    await poner('gre_declarar_desde', '2026-10-01')
    conf = await configuracionGre()
    check('Con fecha de corte, queda listo', conf.listo && conf.declararDesde === '2026-10-01',
      conf.motivo.slice(0, 90))

    // ── 4. El token, con el código de producción ───────────────────────────
    if (conf.credenciales) {
      const token = await obtenerToken(conf.credenciales)
      check('El token se obtiene con el código real', token.length > 100,
        `${token.length} caracteres`)
    } else {
      check('El token se obtiene con el código real', false, 'sin credenciales')
    }

    // ── 5. Sin credenciales de la API, no hay forma ────────────────────────
    const guardado = process.env.SUNAT_GRE_CLIENT_ID
    delete process.env.SUNAT_GRE_CLIENT_ID
    conf = await configuracionGre()
    check('Sin las credenciales de la API, se niega', !conf.listo,
      conf.motivo.slice(0, 90))
    if (guardado) process.env.SUNAT_GRE_CLIENT_ID = guardado
  } finally {
    await poner('gre_activo', antes.gre_activo ?? 'false')
    await poner('gre_declarar_desde', antes.gre_declarar_desde ?? '')
    const despues = await leer()
    console.log(`\n  estado después: ${JSON.stringify(despues)}`)
    const igual = despues.gre_activo === antes.gre_activo
      && despues.gre_declarar_desde === antes.gre_declarar_desde
    check('Todo quedó como estaba', igual)

    const { count } = await (supabase as any).from('guias_remision')
      .select('id', { count: 'exact', head: true }).not('sunat_ticket', 'is', null)
    check('Ninguna guía se envió a SUNAT', (count ?? 0) === 0, `${count ?? 0} con ticket`)
  }

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
