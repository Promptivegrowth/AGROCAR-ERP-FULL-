/**
 * ¿Cuánto se adelanta la facturación al reparto, en los datos reales?
 *
 * Daniel pide que la fecha de emisión sea la del reparto. Antes de cambiar
 * nada conviene saber de qué tamaño es el problema: cuántos comprobantes se
 * emiten antes del día en que salen, con cuántos días de anticipación, y qué
 * pasaría con el plazo de envío de SUNAT en cada caso.
 *
 *   npx tsx scripts/medir-anticipacion.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

function cargarEnvLocal() {
  const f = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(f)) return
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const env = (n: string) => {
  const v = process.env[n]
  if (!v) throw new Error(`Falta ${n}`)
  return v
}

const DIA = 86400000
const dias = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DIA)

const DIA_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const nombreDia = (f: string) => DIA_SEMANA[new Date(`${f}T12:00:00Z`).getUTCDay()]

async function main() {
  cargarEnvLocal()
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data, error } = await (supabase as any)
    .from('comprobantes')
    .select('serie, numero, tipo, fecha_emision, fecha_despacho, estado')
    .in('tipo', ['factura', 'boleta'])
    .neq('estado', 'anulado')
    .not('fecha_despacho', 'is', null)
    .order('fecha_emision', { ascending: true })
  if (error) throw error

  const filas = (data ?? []) as {
    serie: string; numero: string; tipo: string
    fecha_emision: string; fecha_despacho: string
  }[]

  console.log(`\nANTICIPACIÓN ENTRE EMISIÓN Y REPARTO`)
  console.log(`${filas.length} comprobantes con fecha de despacho registrada.\n`)

  const porBrecha = new Map<number, number>()
  for (const f of filas) {
    const d = dias(f.fecha_despacho, f.fecha_emision)
    porBrecha.set(d, (porBrecha.get(d) ?? 0) + 1)
  }

  console.log('  Días entre la emisión y el reparto:')
  for (const d of Array.from(porBrecha.keys()).sort((a, b) => a - b)) {
    const n = porBrecha.get(d)!
    const pct = ((n / filas.length) * 100).toFixed(1)
    const etiqueta = d === 0 ? 'mismo día'
      : d > 0 ? `reparte ${d} día${d > 1 ? 's' : ''} después`
        : `reparte ${-d} día${-d > 1 ? 's' : ''} ANTES de emitir`
    console.log(`    ${String(d).padStart(3)}  ${String(n).padStart(4)} (${pct.padStart(5)}%)  ${etiqueta}`)
  }

  // El caso que a Daniel le preocupa: emitir viernes/sábado para repartir el lunes.
  const adelantados = filas.filter((f) => dias(f.fecha_despacho, f.fecha_emision) > 0)
  console.log(`\n  Se emiten antes del reparto: ${adelantados.length} de ${filas.length}`)
  console.log(`  (${((adelantados.length / filas.length) * 100).toFixed(1)}% del total)\n`)

  // Con el plazo de 3 días calendario desde el día siguiente a la emisión:
  // ¿cuánto del plazo queda vivo recién el día del reparto?
  console.log('  Con el plazo actual de SUNAT (3 días desde el día siguiente a la emisión),')
  console.log('  cuánto plazo QUEDA el día en que recién sale la mercadería:\n')
  const restante = new Map<number, number>()
  for (const f of adelantados) {
    const usados = dias(f.fecha_despacho, f.fecha_emision)
    const queda = 3 - usados
    restante.set(queda, (restante.get(queda) ?? 0) + 1)
  }
  for (const q of Array.from(restante.keys()).sort((a, b) => b - a)) {
    const n = restante.get(q)!
    const nota = q <= 0 ? '  ← el plazo YA VENCIÓ el día del reparto'
      : q === 1 ? '  ← queda un solo día' : ''
    console.log(`    quedan ${String(q).padStart(2)} día(s):  ${String(n).padStart(4)} comprobantes${nota}`)
  }

  // ¿Qué día de la semana se emite y qué día se reparte?
  console.log('\n  Los que más se adelantan, por día de la semana:\n')
  const combos = new Map<string, number>()
  for (const f of adelantados) {
    const k = `emite ${nombreDia(f.fecha_emision).padEnd(9)} → reparte ${nombreDia(f.fecha_despacho)}`
    combos.set(k, (combos.get(k) ?? 0) + 1)
  }
  const top = Array.from(combos.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
  for (const [k, n] of top) console.log(`    ${String(n).padStart(4)}  ${k}`)
  console.log()
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
