/**
 * Compara las consultas por vendedor sin paginar (una sola) contra paginadas:
 * deben devolver lo mismo mientras haya menos de mil filas. Solo lee.
 *   npx tsx scripts/probar-paginado-vendedor.ts
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { traerTodo } from '../src/lib/supabase/paginar'
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
const suma = (xs: any[], k: string) => Math.round(xs.reduce((a, x) => a + Number(x[k] ?? 0), 0) * 100) / 100
;(async () => {
  const { data: v } = await sb.from('profiles').select('id, full_name').ilike('full_name', 'MIJAEL%').single()
  const { data: cls } = await sb.from('clientes').select('id').eq('vendedor_id', v.id)
  const ids = (cls ?? []).map((c: any) => c.id)
  const c1 = (await sb.from('comprobantes').select('id, total').in('cliente_id', ids).neq('estado', 'anulado')).data
  const c2 = await traerTodo<any>((a, b) => sb.from('comprobantes').select('id, total').in('cliente_id', ids).neq('estado', 'anulado').order('id').range(a, b))
  const a1 = (await sb.from('cobros_aplicaciones').select('comprobante_id, monto_aplicado, cobros!inner(cliente_id)').in('cobros.cliente_id', ids)).data
  const a2 = await traerTodo<any>((a, b) => sb.from('cobros_aplicaciones').select('comprobante_id, monto_aplicado, cobros!inner(cliente_id)').in('cobros.cliente_id', ids).order('id').range(a, b))
  const k1 = (await sb.from('cobros').select('cliente_id, total').in('cliente_id', ids)).data
  const k2 = await traerTodo<any>((a, b) => sb.from('cobros').select('cliente_id, total').in('cliente_id', ids).order('id').range(a, b))
  console.log(`${v.full_name}: ${ids.length} clientes`)
  console.log(`  comprobantes   una consulta ${c1.length} · S/ ${suma(c1, 'total')}  | paginado ${c2.length} · S/ ${suma(c2, 'total')}`)
  console.log(`  aplicaciones   una consulta ${a1.length} · S/ ${suma(a1, 'monto_aplicado')}  | paginado ${a2.length} · S/ ${suma(a2, 'monto_aplicado')}`)
  console.log(`  cobros         una consulta ${k1.length} · S/ ${suma(k1, 'total')}  | paginado ${k2.length} · S/ ${suma(k2, 'total')}`)
  const ok = c1.length === c2.length && a1.length === a2.length && k1.length === k2.length
    && suma(c1, 'total') === suma(c2, 'total') && suma(a1, 'monto_aplicado') === suma(a2, 'monto_aplicado') && suma(k1, 'total') === suma(k2, 'total')
  console.log(ok ? '  IGUALES' : '  DISTINTOS'); if (!ok) process.exit(1)
})()
