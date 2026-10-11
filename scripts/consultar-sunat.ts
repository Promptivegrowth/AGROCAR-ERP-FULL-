/**
 * Pregunta a SUNAT (servicio de consulta, solo lee) el estado de comprobantes.
 * No envía ni cambia nada.
 *   SUNAT_USUARIO_SOL=... SUNAT_CLAVE_SOL=... npx tsx scripts/consultar-sunat.ts F002-71 F002-78 ...
 */
import { consultarEnSunat } from '../src/lib/sunat/consulta'

;(async () => {
  for (const arg of process.argv.slice(2)) {
    const [serie, numero] = arg.split('-')
    const tipo = serie.startsWith('F') ? 'factura' : 'boleta'
    const r = await consultarEnSunat({ tipo, serie, numero })
    console.log(`${arg}: ${r.estado} · ${r.codigo ?? '—'} · ${r.mensaje}${r.cdrCodigo != null ? ` · CDR ${r.cdrCodigo}` : ''}`)
  }
})()
