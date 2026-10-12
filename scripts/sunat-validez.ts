/**
 * Diagnóstico: consulta de validez de SUNAT (billValidService, validaCDPcriterios),
 * la misma de la consulta de validez pública. Solo lectura.
 *   SUNAT_USUARIO_SOL=... SUNAT_CLAVE_SOL=... npx tsx scripts/sunat-validez.ts F002-64 F002-78
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const URL = 'https://e-factura.sunat.gob.pe/ol-it-wsconsvalidcpe/billValidService'
;(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  for (const arg of process.argv.slice(2)) {
    const [serie, numero] = arg.split('-')
    const { data: c } = await admin.from('comprobantes').select('tipo, fecha_emision, total, clientes(ruc, dni)')
      .eq('serie', serie).eq('numero', numero.padStart(8, '0')).maybeSingle()
    const [a, m, d] = c.fecha_emision.split('-')
    const docCli = c.clientes?.ruc || c.clientes?.dni || ''
    const tipoDoc = c.clientes?.ruc ? '6' : '1'
    const sobre = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>20519883296${process.env.SUNAT_USUARIO_SOL}</wsse:Username><wsse:Password>${process.env.SUNAT_CLAVE_SOL}</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header><soapenv:Body><ser:validaCDPcriterios><rucEmisor>20519883296</rucEmisor><tipoCDP>${c.tipo === 'factura' ? '01' : '03'}</tipoCDP><serieCDP>${serie}</serieCDP><numeroCDP>${Number(numero)}</numeroCDP><tipoDocIdReceptor>${tipoDoc}</tipoDocIdReceptor><numeroDocIdReceptor>${docCli}</numeroDocIdReceptor><fechaEmision>${d}/${m}/${a}</fechaEmision><importeTotal>${Number(c.total).toFixed(2)}</importeTotal><nroAutorizacion></nroAutorizacion></ser:validaCDPcriterios></soapenv:Body></soapenv:Envelope>`
    const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' }, body: sobre })
    const t = await res.text()
    const cod = t.match(/<statusCode>(.*?)<\/statusCode>/)?.[1]
    const msg = t.match(/<statusMessage>(.*?)<\/statusMessage>/)?.[1] ?? t.match(/<faultstring>(.*?)<\/faultstring>/)?.[1]
    console.log(`${arg} (${c.fecha_emision}, S/ ${c.total}): HTTP ${res.status} · ${cod ?? '—'} · ${msg ?? t.replace(/\s+/g, ' ').slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, 4000))
  }
})()
