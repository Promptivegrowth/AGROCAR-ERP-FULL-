/**
 * Diagnóstico: llama getStatus y getStatusCdr de SUNAT para un comprobante y
 * muestra la respuesta tal cual (solo lectura).
 *   SUNAT_USUARIO_SOL=... SUNAT_CLAVE_SOL=... npx tsx scripts/sunat-consulta-cruda.ts F002-78
 */
const URL_CONSULTA = 'https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService'
;(async () => {
  for (const arg of process.argv.slice(2)) {
    const [serie, numero] = arg.split('-')
    const tipo = serie.startsWith('F') ? '01' : '03'
    for (const op of ['getStatus', 'getStatusCdr']) {
      const sobre = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>20519883296${process.env.SUNAT_USUARIO_SOL}</wsse:Username><wsse:Password>${process.env.SUNAT_CLAVE_SOL}</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header><soapenv:Body><ser:${op}><rucComprobante>20519883296</rucComprobante><tipoComprobante>${tipo}</tipoComprobante><serieComprobante>${serie}</serieComprobante><numeroComprobante>${Number(numero)}</numeroComprobante></ser:${op}></soapenv:Body></soapenv:Envelope>`
      const res = await fetch(URL_CONSULTA, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' }, body: sobre })
      const t = await res.text()
      const cod = t.match(/<statusCode>(.*?)<\/statusCode>/)?.[1]
      const msg = t.match(/<statusMessage>(.*?)<\/statusMessage>/)?.[1] ?? t.match(/<faultstring>(.*?)<\/faultstring>/)?.[1]
      console.log(`${arg} ${op}: HTTP ${res.status} · ${cod ?? '—'} · ${msg ?? t.slice(0, 120)} · CDR ${/<content>/.test(t) ? 'sí' : 'no'}`)
      await new Promise((r) => setTimeout(r, 4000))
    }
  }
})()
