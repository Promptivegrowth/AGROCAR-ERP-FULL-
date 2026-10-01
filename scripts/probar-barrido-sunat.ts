/**
 * El barrido automático: qué toma, quién lo puede disparar y qué deja anotado.
 *
 * No envía nada a SUNAT. La selección se prueba con distintos días de espera
 * simulados sobre los comprobantes reales —solo lee—, y la ruta se llama de
 * verdad: sin clave, con una clave falsa y con la del respaldo. Con la del
 * respaldo corre el barrido completo, que hoy no tiene nada por declarar
 * (lo emitido espera dos días) y solo anota que corrió.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/probar-barrido-sunat.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { comprobantesPendientes } from '../src/lib/sunat/declarar'
import type { ConfiguracionSunat } from '../src/lib/sunat/config'
import { hoyLima } from '../src/lib/fechas-pe'
import { normalizarDiasEspera, sumarDias, diaDeEnvio, venceElPlazo } from '../src/lib/sunat/plazo'

const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const resultados: boolean[] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push(ok)
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  console.log(`\nEL BARRIDO AUTOMÁTICO — ${BASE}\n`)

  // ── 1. Las cuentas del plazo ───────────────────────────────────────────
  console.log('  1. El plazo\n')
  check('Emitido el 01/10 se declara el 03/10', diaDeEnvio('2026-10-01', 2) === '2026-10-03')
  check('…y vence el 04/10', venceElPlazo('2026-10-01') === '2026-10-04')
  check('Cruza de mes bien', diaDeEnvio('2026-10-31', 2) === '2026-11-02' && venceElPlazo('2026-12-30') === '2027-01-02')
  check('Nunca espera más de 2 días (el 3º es de reserva)', normalizarDiasEspera('5') === 2 && normalizarDiasEspera('3') === 2)
  check('Sin valor o basura, 2 por omisión', normalizarDiasEspera('') === 2 && normalizarDiasEspera('abc') === 2 && normalizarDiasEspera(undefined) === 2)
  check('0 es válido (envío el mismo día)', normalizarDiasEspera('0') === 0)

  // ── 2. Qué toma el barrido, con los comprobantes reales ───────────────
  console.log('\n  2. Qué toma el barrido\n')
  const { data: conf } = await (admin as any).from('configuracion').select('clave, valor')
    .in('clave', ['sunat_sincronizar_desde', 'sunat_dias_espera'])
  const c: Record<string, string> = {}
  ;(conf ?? []).forEach((f: any) => { c[f.clave] = f.valor })
  const { data: todos } = await (admin as any).from('comprobantes').select('fecha_emision')
    .in('tipo', ['factura', 'boleta']).neq('estado', 'anulado').eq('enviado_sunat', false)
    .gte('fecha_emision', c.sunat_sincronizar_desde)
  const fechas = ((todos ?? []) as { fecha_emision: string }[]).map((x) => x.fecha_emision)
  const hoy = hoyLima()
  const base: ConfiguracionSunat = {
    modo: 'produccion', usuario: '', clave: '', certificado: null as any, envioAutomatico: true,
    sincronizarDesde: c.sunat_sincronizar_desde, diasEspera: normalizarDiasEspera(c.sunat_dias_espera), razon: '',
  }
  const hoyToma = await comprobantesPendientes(base, 1000)
  const esperadoHoy = fechas.filter((f) => f <= sumarDias(hoy, -base.diasEspera)).length
  check(`Hoy (${hoy}), con ${base.diasEspera} días de espera, toma lo que corresponde`, hoyToma.length === esperadoHoy,
    `${hoyToma.length} (de ${fechas.length} sin declarar)`)

  // Simular el día del envío: con diasEspera = -(días hasta el 03/10)
  const ultimo = fechas.sort().at(-1)!
  const diaEnvio = diaDeEnvio(ultimo, base.diasEspera)
  const desfase = Math.round((Date.parse(diaEnvio) - Date.parse(hoy)) / 86_400_000)
  const enSuDia = await comprobantesPendientes({ ...base, diasEspera: base.diasEspera - desfase }, 1000)
  check(`El ${diaEnvio} toma los del ${ultimo}`, enSuDia.filter((x) => x.fecha_emision === ultimo).length === fechas.filter((f) => f === ultimo).length,
    `${enSuDia.length} comprobantes`)
  const ordenados = enSuDia.every((x, i) => i === 0 || `${enSuDia[i - 1].fecha_emision}${enSuDia[i - 1].serie}${enSuDia[i - 1].numero}` <= `${x.fecha_emision}${x.serie}${x.numero}`)
  check('En orden de fecha, serie y correlativo', ordenados,
    `${enSuDia[0]?.serie}-${enSuDia[0]?.numero} … ${enSuDia.at(-1)?.serie}-${enSuDia.at(-1)?.numero}`)
  const unDiaAntes = await comprobantesPendientes({ ...base, diasEspera: base.diasEspera - desfase + 1 }, 1000)
  check(`Un día antes (${sumarDias(diaEnvio, -1)}) todavía no los toma`, !unDiaAntes.some((x) => x.fecha_emision === ultimo))
  const sinCorte = await comprobantesPendientes({ ...base, sincronizarDesde: null }, 1000)
  check('Sin fecha de inicio no toma nada', sinCorte.length === 0)

  // ── 3. Quién puede dispararlo ─────────────────────────────────────────
  console.log('\n  3. Quién puede dispararlo\n')
  const url = `${BASE}/api/sunat/enviar-programados`
  const sin = await fetch(url)
  check('Sin clave: 401', sin.status === 401, `HTTP ${sin.status}`)
  const falsa = await fetch(url, { headers: { Authorization: 'Bearer ' + 'x'.repeat(64) } })
  check('Con clave falsa: 401', falsa.status === 401, `HTTP ${falsa.status}`)

  const { data: tk } = await (admin as any).from('sunat_respaldo_token').select('token').eq('id', 1).single()
  const { data: antes } = await (admin as any).from('comprobantes').select('id', { count: 'exact', head: true }).eq('enviado_sunat', true)
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tk.token}` } })
  const j = await r.json()
  check('Con la clave del respaldo: corre', r.status === 200 && j.origen === 'respaldo', `HTTP ${r.status} · ${JSON.stringify(j).slice(0, 160)}`)
  check(`Hoy no declaró nada (lo emitido espera ${base.diasEspera} días)`, j.enviados === esperadoHoy && esperadoHoy === 0, `enviados ${j.enviados}`)
  const { count: enviadosAhora } = await (admin as any).from('comprobantes').select('id', { count: 'exact', head: true }).eq('enviado_sunat', true)
  check('Ningún comprobante cambió a enviado', (enviadosAhora ?? 0) === ((antes as any)?.count ?? 0) || (enviadosAhora ?? 0) === 0, `${enviadosAhora}`)
  const { data: ub } = await (admin as any).from('configuracion').select('valor').eq('clave', 'sunat_ultimo_barrido').maybeSingle()
  const anotado = ub?.valor ? JSON.parse(ub.valor) : null
  check('Dejó anotado que corrió', !!anotado?.at && Date.now() - Date.parse(anotado.at) < 120_000, anotado ? `${anotado.at} origen ${anotado.origen}` : 'nada')

  const bien = resultados.filter(Boolean).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.stack); process.exit(1) })
