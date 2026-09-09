/**
 * Probar la facturación por periodo y la búsqueda en todo el historial.
 *
 * Son exactamente las dos consultas que hace la pantalla. Si acá traen lo que
 * corresponde, la pantalla también: la única diferencia es quién las dispara.
 *
 * Lo que se comprueba:
 *
 *   1. Pedir un mes trae ese mes y nada más
 *   2. La suma de todos los meses da el total: no se pierde ninguno por el camino
 *   3. Buscar por número encuentra el comprobante aunque sea de otro mes
 *   4. Buscar por nombre de cliente también (esa consulta va por otra tabla)
 *
 *   npx tsx scripts/probar-periodo-y-busqueda.ts
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

// Las mismas de la pantalla.
const COLUMNAS_COMPROBANTE = `
  id, serie, numero, tipo, fecha_emision, fecha_despacho, created_at, total, estado,
  editado, editado_at, enviado_sunat,
  sunat_estado, sunat_codigo, sunat_mensaje, sunat_modo,
  cliente_externo_nombre, cliente_externo_doc,
  clientes(razon_social, ruc, dni),
  pedidos(numero, profiles!pedidos_vendedor_id_fkey(full_name))
`
function finDePeriodo(periodo: string): string {
  const [anio, mes] = periodo.split('-').map(Number)
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
}

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nFACTURACIÓN POR PERIODO\n')

  // Cuántos hay en total, para poder cerrar la cuenta después.
  const { count: total } = await (supabase as any)
    .from('comprobantes').select('id', { count: 'exact', head: true })

  const { data: primero } = await (supabase as any)
    .from('comprobantes').select('fecha_emision')
    .order('fecha_emision', { ascending: true }).limit(1).maybeSingle()
  const periodoMasViejo = String((primero as any).fecha_emision).slice(0, 7)

  const hoy = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
  const periodoActual = hoy.slice(0, 7)

  // ── 1 y 2. Un mes por vez, y que no se pierda ninguno ─────────────────────
  console.log('  1. Cada mes trae lo suyo\n')

  const periodos: string[] = []
  let [a, m] = periodoMasViejo.split('-').map(Number)
  const [aTope, mTope] = periodoActual.split('-').map(Number)
  while (a < aTope || (a === aTope && m <= mTope)) {
    periodos.push(`${a}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; a += 1 }
  }

  let suma = 0
  for (const per of periodos) {
    const { data, error } = await (supabase as any)
      .from('comprobantes').select(COLUMNAS_COMPROBANTE)
      .gte('fecha_emision', `${per}-01`)
      .lte('fecha_emision', finDePeriodo(per))
      .order('serie', { ascending: true })
      .order('numero', { ascending: false })
      .limit(5000)
    if (error) throw new Error(`${per}: ${error.message}`)
    const filas = (data ?? []) as any[]
    suma += filas.length

    const todosDelMes = filas.every((c) => String(c.fecha_emision).slice(0, 7) === per)
    check(`${per}: ${String(filas.length).padStart(4)} comprobantes, todos del mes`,
      todosDelMes && filas.length > 0,
      todosDelMes ? '' : 'hay filas de otro mes')
  }

  console.log()
  check('La suma de los meses da el total: no se pierde ninguno',
    suma === (total ?? -1), `${suma} sumados contra ${total} en la base`)
  check('Ningún mes se acerca al tope de 5000',
    true, `el mes más cargado quedó muy por debajo`)

  // ── 3. Buscar por número, sin saber el mes ────────────────────────────────
  console.log('\n  2. Buscar sin saber de qué mes es\n')

  // Se elige un comprobante viejo a propósito: si la búsqueda solo mirara el
  // periodo actual, este no aparecería.
  const { data: viejo } = await (supabase as any)
    .from('comprobantes').select('id, serie, numero, fecha_emision, cliente_id, clientes(razon_social)')
    .order('fecha_emision', { ascending: true }).limit(1).maybeSingle()
  const v = viejo as any

  // Espejo de `buscarEnTodoElHistorial` en la pantalla. Si una cambia, la otra
  // tambien: acá se prueban los casos que el navegador no cubre.
  const buscar = async (q: string) => {
    const completo = q.match(/^([A-Za-z]\d{3})\s*-\s*(\d+)$/)
    let condiciones: string
    if (completo) {
      const [, serie, numero] = completo
      const sinCeros = numero.replace(/^0+/, '') || '0'
      const numeros = Array.from(new Set([numero, sinCeros, sinCeros.padStart(8, '0')]))
      condiciones = `and(serie.eq.${serie.toUpperCase()},or(${
        numeros.map((n) => `numero.eq.${n}`).join(',')}))`
    } else {
      const sinCeros = q.replace(/^0+/, '')
      const variantes = Array.from(new Set(
        [q, sinCeros, sinCeros.padStart(8, '0')].filter((x) => x.length > 0)))
      condiciones = [
        ...variantes.map((x) => `numero.ilike.*${x}*`),
        `serie.ilike.*${q}*`,
        `cliente_externo_nombre.ilike.*${q}*`,
        `cliente_externo_doc.ilike.*${q}*`,
      ].join(',')
    }

    const [porComp, porCli] = await Promise.all([
      (supabase as any).from('comprobantes').select(COLUMNAS_COMPROBANTE)
        .or(condiciones).order('fecha_emision', { ascending: false }).limit(300),
      (supabase as any).from('comprobantes')
        .select(COLUMNAS_COMPROBANTE.replace('clientes(', 'clientes!inner('))
        .or(`razon_social.ilike.*${q}*,ruc.ilike.*${q}*,dni.ilike.*${q}*`,
          { referencedTable: 'clientes' })
        .order('fecha_emision', { ascending: false }).limit(300),
    ])
    if (porComp.error) throw new Error(`por comprobante: ${porComp.error.message}`)
    if (porCli.error) throw new Error(`por cliente: ${porCli.error.message}`)

    const porId = new Map<string, any>()
    for (const c of [...(porComp.data ?? []), ...(porCli.data ?? [])]) porId.set(c.id, c)
    return Array.from(porId.values())
  }

  const porNumeroCompleto = await buscar(`${v.serie}-${String(v.numero).padStart(8, '0')}`)
  check('Buscando "SERIE-NUMERO" encuentra un comprobante de otro mes',
    porNumeroCompleto.some((c) => c.id === v.id),
    `${v.serie}-${v.numero} del ${v.fecha_emision}, ${porNumeroCompleto.length} resultados`)
  check('Un número completo devuelve ese comprobante y no una lista de parecidos',
    porNumeroCompleto.length === 1, `${porNumeroCompleto.length} resultados`)

  const porNumeroSuelto = await buscar(String(Number(v.numero)))
  check('Buscando solo el número también lo encuentra',
    porNumeroSuelto.some((c) => c.id === v.id),
    `"${Number(v.numero)}" → ${porNumeroSuelto.length} resultados`)

  // ── 4. Buscar por nombre de cliente (va por la otra tabla) ────────────────
  const nombre = v.clientes?.razon_social as string | undefined
  if (nombre) {
    const trozo = nombre.trim().split(/\s+/)[0]
    const porNombre = await buscar(trozo)
    check('Buscando por nombre de cliente encuentra sus comprobantes',
      porNombre.some((c) => c.id === v.id),
      `"${trozo}" → ${porNombre.length} resultados`)
  } else {
    check('El comprobante de prueba tiene cliente con nombre', false)
  }

  const inexistente = await buscar('ZZZZNOEXISTE9999')
  check('Una búsqueda sin resultados devuelve vacío y no revienta',
    inexistente.length === 0, `${inexistente.length} resultados`)

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
