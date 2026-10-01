/**
 * Ensayo de las guías por declarar: se arman y firman con el código real y
 * NO se envían. Muestra lo que iría a SUNAT y lo que falta.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/gre-ensayo-guias.ts
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
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const conf: any = {
    listo: true, motivo: '', declararDesde: '2026-10-01',
    certificado: abrirCertificado(fs.readFileSync(process.env.CERT_PFX!), process.env.CERT_PASS!),
    credenciales: null,
  }
  const { data } = await (admin as any).from('guias_remision').select('id, serie, numero')
    .eq('enviado_sunat', false).order('serie').order('numero')
  console.log(`\nENSAYO DE GUÍAS — ${data.length} sin declarar (no se envía nada)\n`)
  let bien = 0
  for (const g of data) {
    const r = await declararGuia(g.id, conf, { soloArmar: true })
    if (r.xml) {
      bien++
      const x = r.xml
      const v = (re: RegExp) => x.match(re)?.[1] ?? '—'
      console.log(`  OK   ${r.guia}  emisión ${v(/<cbc:IssueDate>([^<]+)/)} ${v(/<cbc:IssueTime>([^<]+)/)}`
        + ` · traslado ${v(/<cbc:StartDate>([^<]+)/)} · conductor ${v(/<cbc:FirstName><!\[CDATA\[([^\]]+)/)} / ${v(/<cbc:FamilyName><!\[CDATA\[([^\]]+)/)}`
        + ` · licencia ${v(/<cac:IdentityDocumentReference>\s*<cbc:ID>([^<]+)/)} · placa ${v(/<cac:TransportEquipment>\s*<cbc:ID>([^<]+)/)}`
        + ` · ubigeos ${(x.match(/<cbc:ID schemeAgencyName="PE:INEI"[^>]*>(\d{6})/g) ?? []).map((s) => s.slice(-6)).join('→')}`)
      if (g.numero === data[0].numero) fs.writeFileSync('.sunat/ensayo-guia.xml', x)
    } else {
      console.log(`  MAL  ${r.guia}: ${r.motivo}`)
    }
  }
  console.log(`\n  ${bien} de ${data.length} listas para declarar.\n`)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
