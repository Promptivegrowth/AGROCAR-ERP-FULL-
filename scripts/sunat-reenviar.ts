/**
 * Reenvía a SUNAT comprobantes puntuales, con el mismo código del sistema
 * (declararComprobante: reserva, firma, envío y anotación). Uno por uno, con
 * pausa, para no apurar al servicio.
 *   SUNAT_CERT_BASE64=... SUNAT_CERT_PASSWORD=... SUNAT_USUARIO_SOL=... SUNAT_CLAVE_SOL=... \
 *     npx tsx scripts/sunat-reenviar.ts F002-79 [B002-...]
 */
import fs from 'node:fs'
import path from 'node:path'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

;(async () => {
  const { createAdminClient } = await import('../src/lib/supabase/admin')
  const { configuracionSunat } = await import('../src/lib/sunat/config')
  const { declararComprobante } = await import('../src/lib/sunat/declarar')
  const conf = await configuracionSunat()
  console.log(`Modo: ${conf.modo}`)
  if (conf.modo !== 'produccion') { console.log('No es producción: no se envía nada.'); return }
  const admin = createAdminClient() as any
  for (const arg of process.argv.slice(2)) {
    const [serie, numero] = arg.split('-')
    const { data: c } = await admin.from('comprobantes').select('id').eq('serie', serie).eq('numero', numero.padStart(8, '0')).maybeSingle()
    if (!c) { console.log(`${arg}: no existe en el ERP`); continue }
    const r = await declararComprobante(c.id, conf)
    console.log(`${arg}: ${r.declarado ? 'DECLARADO' : 'no declarado'} · ${r.motivo ?? ''}`)
    await new Promise((res) => setTimeout(res, 5000))
  }
})()
