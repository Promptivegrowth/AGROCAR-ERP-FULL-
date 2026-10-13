/**
 * Exporta a JSON los comprobantes aceptados por SUNAT (con CDR) que no figuran
 * en su consulta, con sus intentos de envío. Para el informe PDF. Solo lee.
 *   npx tsx scripts/exportar-afectados-sunat.ts salida.json
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { traerTodo } from '../src/lib/supabase/paginar'
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
;(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const comps = await traerTodo<any>((a, b) => admin.from('comprobantes')
    .select('id, serie, numero, tipo, fecha_emision, total, sunat_codigo, sunat_mensaje, sunat_verificacion, sunat_verificado_at, cliente_externo_nombre, clientes(razon_social, ruc, dni)')
    .eq('enviado_sunat', true).eq('sunat_modo', 'produccion').neq('sunat_verificacion', 'aceptado')
    .order('serie').order('numero').range(a, b))
  const bit = await traerTodo<any>((a, b) => admin.from('sunat_bitacora').select('comprobante_id, intento, enviado_at, aceptado, codigo, mensaje')
    .gte('enviado_at', '2026-10-06T05:00:00Z').order('enviado_at').range(a, b))
  const todosAcept = await traerTodo<any>((a, b) => admin.from('sunat_bitacora').select('comprobante_id, enviado_at, aceptado')
    .eq('aceptado', true).gte('enviado_at', '2026-10-06T05:00:00Z').range(a, b))
  const ids = Array.from(new Set(todosAcept.map((x: any) => x.comprobante_id)))
  const verif: Record<string, string> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('comprobantes').select('id, sunat_verificacion').in('id', ids.slice(i, i + 200))
    for (const d of data ?? []) verif[d.id] = d.sunat_verificacion
  }
  fs.writeFileSync(process.argv[2], JSON.stringify({ comps, bit, todosAcept, verif }), 'utf8')
  console.log(`${comps.length} afectados · ${bit.length} intentos · ${todosAcept.length} aceptaciones`)
})()
