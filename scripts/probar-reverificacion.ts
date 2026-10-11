/** Solo lee: qué comprobantes volvería a verificar el barrido (no envía nada). */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
;(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const hace3h = new Date(Date.now() - 3 * 3600_000).toISOString()
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
  const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 10)
  const { data, error } = await admin.from('comprobantes')
    .select('serie, numero, fecha_emision, sunat_verificacion, sunat_verificado_at')
    .eq('enviado_sunat', true).eq('sunat_modo', 'produccion')
    .or(`sunat_verificado_at.is.null,and(sunat_verificacion.in.(no_existe,error),sunat_verificado_at.lt.${hace3h})`)
    .gte('fecha_emision', d.toISOString().slice(0, 10))
    .order('sunat_verificado_at', { ascending: true, nullsFirst: true })
    .order('fecha_emision', { ascending: true })
    .limit(150)
  if (error) { console.log('ERROR', error.message); process.exit(1) }
  const porFecha: Record<string, number> = {}
  for (const c of data) porFecha[`${c.fecha_emision} ${c.sunat_verificacion ?? 'sin verificar'}`] = (porFecha[`${c.fecha_emision} ${c.sunat_verificacion ?? 'sin verificar'}`] ?? 0) + 1
  console.log(data.length, 'a verificar', porFecha)
})()
