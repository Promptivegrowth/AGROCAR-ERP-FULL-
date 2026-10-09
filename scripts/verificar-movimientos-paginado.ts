/**
 * Movimientos del día por rango: con más de mil ítems la consulta salía cortada
 * (Daniel, 09/10). Compara una sola consulta contra la paginada. Solo mira.
 *   npx tsx scripts/verificar-movimientos-paginado.ts
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { traerTodo } from '../src/lib/supabase/paginar'
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
const consulta = () => sb.from('comprobantes_items').select('subtotal, comprobantes!inner(estado, fecha_despacho)')
  .neq('comprobantes.estado', 'anulado').gte('comprobantes.fecha_despacho', '2026-10-01').lte('comprobantes.fecha_despacho', '2026-10-09').order('id')
;(async () => {
  const { data: sola } = await consulta()
  const todo = await traerTodo<any>((a, b) => consulta().range(a, b))
  const s = (x: any[]) => Math.round(x.reduce((t, i) => t + Number(i.subtotal), 0) * 100) / 100
  console.log('antes (una consulta):', sola.length, 'filas, S/', s(sola))
  console.log('ahora (paginado):   ', todo.length, 'filas, S/', s(todo))
})()
