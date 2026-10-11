/**
 * Diagnóstico: manda UNA vez, sin reintentos, el XML firmado ya guardado de un
 * comprobante y muestra la respuesta cruda de SUNAT (HTTP y cuerpo). No anota
 * nada en la base.
 *   SUNAT_USUARIO_SOL=... SUNAT_CLAVE_SOL=... npx tsx scripts/sunat-envio-crudo.ts F002-79
 */
import fs from 'node:fs'
import path from 'node:path'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
;(async () => {
  const JSZip = (await import('jszip')).default
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const [serie, numero] = process.argv[2].split('-')
  const { data: c } = await admin.from('comprobantes').select('tipo, sunat_xml').eq('serie', serie).eq('numero', numero.padStart(8, '0')).maybeSingle()
  const cod = c.tipo === 'factura' ? '01' : '03'
  const nombre = `20519883296-${cod}-${serie}-${numero.padStart(8, '0')}`
  const zip = new JSZip(); zip.file(`${nombre}.xml`, c.sunat_xml)
  const b64 = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64')
  const sobre = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>20519883296${process.env.SUNAT_USUARIO_SOL}</wsse:Username><wsse:Password>${process.env.SUNAT_CLAVE_SOL}</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header><soapenv:Body><ser:sendBill><fileName>${nombre}.zip</fileName><contentFile>${b64}</contentFile></ser:sendBill></soapenv:Body></soapenv:Envelope>`
  const t0 = Date.now()
  const res = await fetch('https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService', { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' }, body: sobre })
  const texto = await res.text()
  console.log(`HTTP ${res.status} en ${Date.now() - t0} ms`)
  console.log(texto.replace(/<applicationResponse>[\s\S]*?<\/applicationResponse>/, '<applicationResponse>[CDR]</applicationResponse>').slice(0, 1500))
})()
