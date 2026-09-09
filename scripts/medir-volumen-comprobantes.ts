/**
 * ¿Cuántos comprobantes hay, y a qué ritmo crecen?
 *
 * La pantalla de Facturación los trae todos de una, con un tope de 1000. Antes
 * de tocar nada conviene saber cuánto falta para chocar contra ese tope, porque
 * el día que lo cruce los comprobantes viejos van a dejar de aparecer sin que
 * nadie se entere.
 *
 *   npx tsx scripts/medir-volumen-comprobantes.ts
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

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']

async function main() {
  cargarEnvLocal()
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data, error } = await (supabase as any)
    .from('comprobantes')
    .select('tipo, fecha_emision, estado')
    .order('fecha_emision', { ascending: true })
  if (error) throw error

  const filas = (data ?? []) as { tipo: string; fecha_emision: string; estado: string }[]

  console.log(`\nVOLUMEN DE COMPROBANTES\n`)
  console.log(`  Total en el sistema: ${filas.length}`)
  console.log(`  Tope que carga la pantalla hoy: 1000`)

  // Por mes y por tipo
  const porMes = new Map<string, Map<string, number>>()
  for (const f of filas) {
    const mes = f.fecha_emision.slice(0, 7)
    if (!porMes.has(mes)) porMes.set(mes, new Map())
    const m = porMes.get(mes)!
    m.set(f.tipo, (m.get(f.tipo) ?? 0) + 1)
  }

  const meses = Array.from(porMes.keys()).sort()
  console.log(`\n  Por mes:\n`)
  const tipos = ['factura', 'boleta', 'nota_pedido_interna', 'nota_credito']
  const etiqueta: Record<string, string> = {
    factura: 'facturas', boleta: 'boletas',
    nota_pedido_interna: 'doc. internos', nota_credito: 'notas cred.',
  }
  console.log(`    mes        total   ` + tipos.map((t) => etiqueta[t].padStart(14)).join(''))
  let acumulado = 0
  for (const mes of meses) {
    const m = porMes.get(mes)!
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0)
    acumulado += total
    const [y, mm] = mes.split('-')
    const nombre = `${MES[Number(mm) - 1]} ${y}`
    console.log(
      `    ${nombre.padEnd(9)} ${String(total).padStart(5)}   `
      + tipos.map((t) => String(m.get(t) ?? 0).padStart(14)).join('')
      + `     (acumulado ${acumulado})`,
    )
  }

  // Ritmo: comprobantes por dia habil, sobre el ultimo mes completo de datos
  const primera = filas[0]?.fecha_emision
  const ultima = filas[filas.length - 1]?.fecha_emision
  const dias = Math.max(1, Math.round(
    (Date.parse(`${ultima}T12:00:00Z`) - Date.parse(`${primera}T12:00:00Z`)) / 86400000) + 1)
  const porDia = filas.length / dias

  console.log(`\n  Del ${primera} al ${ultima}: ${dias} días, ${porDia.toFixed(1)} comprobantes por día.`)

  const faltan = 1000 - filas.length
  if (faltan <= 0) {
    console.log(`\n  YA SE PASÓ DEL TOPE: hay ${filas.length - 1000} comprobantes que la pantalla no muestra.`)
  } else {
    const diasParaTope = Math.round(faltan / porDia)
    const fechaTope = new Date(Date.now() + diasParaTope * 86400000)
    console.log(`\n  Faltan ${faltan} para llegar al tope de 1000: unos ${diasParaTope} días`)
    console.log(`  (alrededor del ${fechaTope.toISOString().slice(0, 10)}).`)
    console.log(`\n  A partir de ahí, los comprobantes más viejos dejan de aparecer en pantalla.`)
  }
  console.log()
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
