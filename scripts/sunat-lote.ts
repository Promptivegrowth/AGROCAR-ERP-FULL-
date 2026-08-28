/**
 * Prueba masiva contra el servicio BETA de SUNAT.
 *
 * Una factura aceptada no prueba gran cosa: prueba que ese caso funciona. Lo
 * que hace falta antes de producción es pasar el catálogo entero de
 * situaciones reales —kilos con decimales, boletas de una línea y de quince,
 * DNI y RUC, montos de dos soles y de tres mil, los comprobantes que la
 * auditoría marcó como raros— y ver cuáles rebotan.
 *
 *   npx tsx scripts/sunat-lote.ts [cuantos]
 *
 * Reenviar el mismo comprobante devuelve 4000, "ya fue presentado": eso
 * también es un aceptado, y se cuenta como tal.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { construirInvoice, type ItemUbl } from '../src/lib/sunat/ubl'
import { abrirCertificado, firmarXml, comprimir, enviarASunat } from '../src/lib/sunat/firma'

const EMISOR = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
  direccion: 'CAL. EMILIO FORERO NRO 553A - TACNA',
}

function cargarEnvLocal() {
  const f = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(f)) return
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

function env(n: string): string {
  const v = process.env[n]
  if (!v) throw new Error(`Falta la variable de entorno ${n}`)
  return v
}

interface Resultado {
  id: string
  tipo: string
  lineas: number
  total: number
  totalErp: number
  cuadra: boolean
  codigo: string | null
  mensaje: string | null
  ok: boolean
  observaciones: string[]
}

async function main() {
  cargarEnvLocal()
  const cuantos = Number(process.argv[2] ?? 60)

  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data, error } = await supabase.from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, subtotal, igv, total, moneda, estado,
    clientes(razon_social, ruc, dni, direccion),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).neq('estado', 'anulado').in('tipo', ['factura', 'boleta']).limit(20000)
  if (error) throw error

  const todos = (data ?? []) as any[]
  const hoy = new Date().toISOString().slice(0, 10)

  /*
   * La muestra se arma a propósito, no al azar: se toman los extremos de cada
   * dimensión que puede romper algo. Lo que sale bien en el medio de la
   * distribución no dice nada; lo que rompe está en los bordes.
   */
  const conLineas = (c: any) => (c.comprobantes_items ?? []).length
  const orden = <T,>(arr: T[], f: (x: T) => number) => [...arr].sort((a, b) => f(b) - f(a))
  const elegidos = new Map<string, any>()
  const meter = (lista: any[], n: number) => lista.slice(0, n).forEach((c) => elegidos.set(c.id, c))

  const emitibles = todos.filter((c) => c.fecha_emision <= hoy)

  meter(orden(emitibles, conLineas), 6)                                          // más líneas
  meter(emitibles.filter((c) => conLineas(c) === 1), 4)                          // una sola línea
  meter(orden(emitibles, (c) => Number(c.total)), 4)                             // montos altos
  meter(orden(emitibles, (c) => -Number(c.total)), 4)                            // montos bajos
  meter(emitibles.filter((c) => c.tipo === 'factura'), 8)                         // facturas
  meter(emitibles.filter((c) => c.tipo === 'boleta' && c.clientes?.dni), 8)       // boletas con DNI
  meter(emitibles.filter((c) => c.tipo === 'boleta' && c.clientes?.ruc), 4)       // boletas a empresa
  meter(emitibles.filter((c) => (c.comprobantes_items ?? [])                      // cantidades con decimales
    .some((i: any) => Number(i.cantidad) % 1 !== 0)), 8)
  meter(emitibles.filter((c) => {                                                 // los descuadrados
    const s = (c.comprobantes_items ?? []).reduce((a: number, i: any) => a + Number(i.subtotal ?? 0), 0)
    return Math.abs(s - Number(c.total)) > 0.005
  }), 5)
  meter(emitibles.filter((c) => Number(c.total) >= 700 && c.tipo === 'boleta'), 4) // boletas sobre el umbral
  meter([...emitibles].sort(() => Math.random() - 0.5), Math.max(0, cuantos - elegidos.size))

  const muestra = Array.from(elegidos.values()).slice(0, cuantos)
  console.log(`\nMuestra: ${muestra.length} comprobantes de ${emitibles.length} emitibles.\n`)

  const resultados: Resultado[] = []
  for (const c of muestra) {
    const items: ItemUbl[] = c.comprobantes_items.map((it: any) => ({
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      igv_porcentaje: it.igv_porcentaje ?? 18,
      descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
      codigo: it.productos?.codigo ?? null,
      unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
    }))

    let r: Resultado
    try {
      const { xml, nombreArchivo, totales } = construirInvoice({
        comprobante: {
          serie: c.serie, numero: c.numero, tipo: c.tipo,
          fecha_emision: c.fecha_emision, moneda: c.moneda || 'PEN',
          cliente: c.clientes,
        },
        emisor: EMISOR,
        items,
      })
      const zip = await comprimir(nombreArchivo, firmarXml(xml, cert))
      const res = await enviarASunat({
        modo: 'beta', usuario: `${EMISOR.ruc}MODDATOS`, clave: 'MODDATOS', nombreArchivo, zip,
      })
      // 4000 es "ya fue presentado": el comprobante esta bien, solo repetido.
      const aceptado = res.codigo === '0' || res.codigo === '4000'
        || (res.mensaje ?? '').includes('ya fue presentado')
      r = {
        id: `${c.serie}-${c.numero}`, tipo: c.tipo, lineas: items.length,
        total: totales.total, totalErp: Number(c.total),
        cuadra: Math.abs(totales.total - Number(c.total)) < 0.005,
        codigo: res.codigo, mensaje: res.mensaje, ok: aceptado,
        observaciones: res.observaciones ?? [],
      }
    } catch (e) {
      r = {
        id: `${c.serie}-${c.numero}`, tipo: c.tipo, lineas: items.length,
        total: 0, totalErp: Number(c.total), cuadra: false,
        codigo: 'ERROR', mensaje: e instanceof Error ? e.message : String(e),
        ok: false, observaciones: [],
      }
    }

    resultados.push(r)
    process.stdout.write(r.ok ? (r.cuadra ? '.' : '$') : 'X')

    // Beta pide expresamente que no se lo bombardee. Un respiro entre envios
    // evita los 401 pasajeros y hace la tanda reproducible.
    await new Promise((res) => setTimeout(res, 1200))
  }

  // ── Informe ──────────────────────────────────────────────────────────────
  const ok = resultados.filter((r) => r.ok)
  const fallan = resultados.filter((r) => !r.ok)
  const descuadran = resultados.filter((r) => !r.cuadra)

  console.log('\n\n' + '═'.repeat(76))
  console.log('  ENVÍO MASIVO AL SERVICIO DE PRUEBAS DE SUNAT')
  console.log('═'.repeat(76))
  console.log(`\n  Enviados            ${resultados.length}`)
  console.log(`  Aceptados           ${ok.length}`)
  console.log(`  Rechazados          ${fallan.length}`)
  console.log(`  Con total distinto  ${descuadran.length}   (el XML no coincide con el ERP)`)

  const porTipo = (t: string) => resultados.filter((r) => r.tipo === t)
  console.log(`\n  Facturas  ${porTipo('factura').filter((r) => r.ok).length}/${porTipo('factura').length}`)
  console.log(`  Boletas   ${porTipo('boleta').filter((r) => r.ok).length}/${porTipo('boleta').length}`)
  const lineas = resultados.map((r) => r.lineas)
  console.log(`\n  Líneas por comprobante: de ${Math.min(...lineas)} a ${Math.max(...lineas)}`)
  const totales = resultados.map((r) => r.totalErp)
  console.log(`  Importes: de S/ ${Math.min(...totales).toFixed(2)} a S/ ${Math.max(...totales).toFixed(2)}`)

  if (fallan.length) {
    console.log(`\n${'─'.repeat(76)}\n  RECHAZADOS\n${'─'.repeat(76)}`)
    for (const r of fallan) console.log(`  ${r.id}  [${r.codigo}]  ${r.mensaje}`)
  }
  if (descuadran.length) {
    console.log(`\n${'─'.repeat(76)}\n  TOTAL DISTINTO AL DEL ERP\n${'─'.repeat(76)}`)
    for (const r of descuadran) {
      console.log(`  ${r.id}   ERP S/ ${r.totalErp.toFixed(2)}   declarado S/ ${r.total.toFixed(2)}   dif ${(r.total - r.totalErp).toFixed(2)}`)
    }
  }
  const conObs = resultados.filter((r) => r.observaciones.length)
  if (conObs.length) {
    console.log(`\n${'─'.repeat(76)}\n  ACEPTADOS CON OBSERVACIONES\n${'─'.repeat(76)}`)
    for (const r of conObs) console.log(`  ${r.id}: ${r.observaciones.join(' · ')}`)
  }

  console.log('\n' + '═'.repeat(76))
  const listo = fallan.length === 0 && descuadran.length === 0
  console.log(`  ${listo ? 'Todos aceptados y todos cuadran.' : 'Hay algo que corregir antes de producción.'}`)
  console.log('═'.repeat(76) + '\n')

  fs.mkdirSync('.sunat', { recursive: true })
  fs.writeFileSync('.sunat/lote.json', JSON.stringify(resultados, null, 1))
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
