/**
 * Declarar guías desde esta computadora, con el mismo código que el servidor.
 * Sirve para regularizar o depurar sin esperar un despliegue.
 *
 * ENVÍA DE VERDAD. Pide las credenciales en el entorno, nunca en el código:
 *   CERT_PFX=... CERT_PASS=... SUNAT_GRE_CLIENT_ID=... SUNAT_GRE_CLIENT_SECRET=...
 *   SUNAT_USUARIO_SOL=... SUNAT_CLAVE_SOL=... npx tsx scripts/gre-declarar-local.ts T002 1 7
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { declararGuia } from '../src/lib/sunat/gre-declarar'
import { abrirCertificado } from '../src/lib/sunat/firma'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

async function main() {
  const [serie = 'T002', d = '1', h = d] = process.argv.slice(2)
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { configuracionGre } = await import('../src/lib/sunat/gre-config')
  process.env.SUNAT_CERT_BASE64 = fs.readFileSync(process.env.CERT_PFX!).toString('base64')
  process.env.SUNAT_CERT_PASSWORD = process.env.CERT_PASS
  const conf = await configuracionGre()
  if (!conf.listo) throw new Error(conf.motivo)
  void abrirCertificado
  const { data: guias } = await (admin as any).from('guias_remision').select('id, serie, numero, enviado_sunat')
    .eq('serie', serie).gte('numero', Number(d)).lte('numero', Number(h)).order('numero')
  console.log(`\nDECLARAR ${serie} ${d}..${h} (local)\n`)
  for (const g of guias) {
    if (g.enviado_sunat) { console.log(`  --   ${g.serie}-${g.numero} ya aceptada`); continue }
    const r = await declararGuia(g.id, conf)
    console.log(`  ${r.ok ? 'OK  ' : 'MAL '} ${r.guia} · ${r.estado ?? ''} ${r.codigo ? `[${r.codigo}]` : ''} ${(r.mensaje ?? r.motivo ?? '').slice(0, 400)}`)
    if (!r.ok) { console.log('\n  Se detiene acá.'); break }
    await new Promise((res) => setTimeout(res, 1500))
  }
  console.log()
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
