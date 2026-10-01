/**
 * Que la ticketera reciba los tickets de a uno y con descanso.
 *
 * El 30/09 se mandaron 62 comprobantes a la ticketera de Caja: salieron unos
 * 30 y se apagó. Ahora el servidor reparte de a uno, con 4 s entre tickets y
 * 20 s de descanso cada 20.
 *
 * Se prueba sin imprimir nada: un equipo de prueba, 25 tickets de mentira y un
 * agente simulado que pregunta cada segundo —como el real— y confirma cada
 * ticket al recibirlo. Al final se borra todo.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/probar-ritmo-impresion.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const resultados: boolean[] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push(ok)
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

const CUANTOS = 25

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  console.log(`\nEL RITMO DE LA TICKETERA — ${BASE}\n`)

  const token = crypto.randomUUID()
  const { data: equipo, error } = await (admin as any).from('equipos_impresion')
    .insert({ nombre: 'ZZ Prueba de ritmo', token, activo: false }).select('id').single()
  if (error) throw new Error(error.message)
  // Inactivo hasta tener la cola armada; se activa justo antes de empezar.
  try {
    const filas = Array.from({ length: CUANTOS }, (_, i) => ({
      equipo_id: equipo.id, contenido: Buffer.from(`ticket ${i + 1}`).toString('base64'),
      descripcion: `ZZ-${String(i + 1).padStart(3, '0')}`,
    }))
    const { error: e2 } = await (admin as any).from('cola_impresion').insert(filas)
    if (e2) throw new Error(e2.message)
    await (admin as any).from('equipos_impresion').update({ activo: true }).eq('id', equipo.id)

    const recibidos: { desc: string; t: number }[] = []
    let maxPorConsulta = 0
    const inicio = Date.now()
    while (recibidos.length < CUANTOS && Date.now() - inicio < 240_000) {
      const r = await fetch(`${BASE}/api/impresion/pendientes?token=${encodeURIComponent(token)}&version=prueba`)
      const j = await r.json()
      const trabajos = (j.trabajos ?? []) as { id: string; descripcion: string }[]
      maxPorConsulta = Math.max(maxPorConsulta, trabajos.length)
      for (const t of trabajos) {
        recibidos.push({ desc: t.descripcion, t: Date.now() })
        await fetch(`${BASE}/api/impresion/confirmar`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, id: t.id, ok: true }),
        })
        await esperar(350) // lo mismo que hace el agente entre tickets
      }
      await esperar(1000) // lo mismo que el agente entre consultas
    }

    const gaps = recibidos.slice(1).map((r, i) => (r.t - recibidos[i].t) / 1000)
    const minGap = Math.min(...gaps)
    const pausaLarga = gaps[19] ?? 0
    console.log(`  recibidos ${recibidos.length} en ${((recibidos.at(-1)!.t - recibidos[0].t) / 1000).toFixed(0)} s`)
    check('Llegaron todos', recibidos.length === CUANTOS, `${recibidos.length} de ${CUANTOS}`)
    check('En orden', recibidos.every((r, i) => r.desc === `ZZ-${String(i + 1).padStart(3, '0')}`))
    check('De a uno por consulta', maxPorConsulta === 1, `máximo ${maxPorConsulta}`)
    check('Al menos 4 s entre tickets', minGap >= 4, `mínimo ${minGap.toFixed(1)} s`)
    check('Descanso largo después del ticket 20', pausaLarga >= 20, `${pausaLarga.toFixed(1)} s entre el 20 y el 21`)
    const resto = gaps.filter((_, i) => i !== 19)
    check('Sin descansos largos fuera de lugar', resto.every((g) => g < 12),
      `máximo ${Math.max(...resto).toFixed(1)} s`)
  } finally {
    await (admin as any).from('cola_impresion').delete().eq('equipo_id', equipo.id)
    await (admin as any).from('equipos_impresion').delete().eq('id', equipo.id)
    console.log('  Equipo y tickets de prueba eliminados.')
  }
  const bien = resultados.filter(Boolean).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}
main().catch((e) => { console.error('\nFALLÓ:', e.stack); process.exit(1) })
