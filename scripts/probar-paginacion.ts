/**
 * Que las consultas traigan TODAS las filas, no las primeras mil.
 *
 * Supabase corta cualquier consulta en mil filas y no avisa. Poner
 * `.limit(5000)` no sirve: el tope lo impone el servidor y gana. La única
 * salida es pedir de a páginas, y eso es lo que se comprueba acá contra los
 * totales reales de la base.
 *
 *   npx tsx scripts/probar-paginacion.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { traerTodo, TOPE_POR_PAGINA } from '../src/lib/supabase/paginar'

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

  console.log('\nTRAER TODAS LAS FILAS, NO LAS PRIMERAS MIL\n')

  const contar = async (tabla: string) => {
    const { count } = await (supabase as any).from(tabla)
      .select('id', { count: 'exact', head: true })
    return count as number
  }

  for (const tabla of ['cobros', 'comprobantes', 'caja_movimientos']) {
    const total = await contar(tabla)

    // Lo que traía el código viejo: una sola consulta, sin acotar.
    const { data: viejo } = await (supabase as any).from(tabla).select('id')
    const conCorte = (viejo ?? []).length

    // Lo que trae ahora.
    const todo = await traerTodo<{ id: string }>((desde, hasta) =>
      (supabase as any).from(tabla).select('id')
        .order('id', { ascending: true }).range(desde, hasta))

    check(`${tabla}: trae las ${total} filas`, todo.length === total,
      `antes traía ${conCorte}, ahora ${todo.length}`)

    const distintos = new Set(todo.map((r) => r.id)).size
    check(`${tabla}: sin filas repetidas entre páginas`, distintos === todo.length,
      `${distintos} distintos de ${todo.length}`)

    if (total > TOPE_POR_PAGINA) {
      check(`${tabla}: la consulta vieja SÍ se cortaba`, conCorte === TOPE_POR_PAGINA,
        `traía ${conCorte} de ${total} — faltaban ${total - conCorte}`)
    }
  }

  // El caso que reportó Daniel: los cobros ya liquidados que figuraban pendientes.
  const { data: pend } = await (supabase as any).rpc('cobros_sin_liquidar')
  check('Cobros realmente pendientes de liquidar', (pend ?? []).length === 0,
    `${(pend ?? []).length} pendientes`)

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
