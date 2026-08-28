/**
 * ¿Está la base en condiciones de emitir electrónicamente?
 *
 * Antes de mandar nada a producción conviene saber qué comprobantes SUNAT
 * rechazaría, y por qué. Este script recorre todo lo emitido y aplica las
 * reglas que validan del otro lado: documento del cliente, unidades de medida,
 * descripciones, decimales, montos, correlativos.
 *
 * No corrige nada. Solo dice qué hay que arreglar y cuánto pesa cada cosa.
 *
 *   npx tsx scripts/sunat-auditoria.ts
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

/** Dígito verificador del RUC peruano (módulo 11 con pesos fijos). */
function rucValido(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((a, p, i) => a + p * Number(ruc[i]), 0)
  const resto = suma % 11
  const dv = (11 - resto) % 10
  return dv === Number(ruc[10])
}

interface Hallazgo {
  regla: string
  gravedad: 'bloquea' | 'observa'
  detalle: string
  afectados: string[]
}

async function main() {
  cargarEnvLocal()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await supabase.from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, subtotal, igv, total, moneda, estado,
    cliente_id, cliente_externo_nombre,
    clientes(razon_social, ruc, dni, direccion),
    comprobantes_items(cantidad, precio_unitario, subtotal, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(simbolo, codigo_sunat)))
  `).limit(20000)
  if (error) throw error

  const comps = (data ?? []) as any[]
  const electronicos = comps.filter((c) => c.tipo === 'factura' || c.tipo === 'boleta')
  const vigentes = electronicos.filter((c) => c.estado !== 'anulado')

  const hallazgos: Hallazgo[] = []
  const add = (regla: string, gravedad: Hallazgo['gravedad'], detalle: string, afectados: string[]) => {
    if (afectados.length) hallazgos.push({ regla, gravedad, detalle, afectados })
  }
  const nombre = (c: any) => `${c.serie}-${c.numero}`

  // ── Identificación del receptor ──────────────────────────────────────────
  add('Factura sin RUC', 'bloquea',
    'SUNAT rechaza una factura cuyo receptor no tenga RUC. Hay que reemplazarla por boleta o cargar el RUC.',
    vigentes.filter((c) => c.tipo === 'factura' && !c.clientes?.ruc).map(nombre))

  add('RUC con dígito verificador inválido', 'bloquea',
    'El número no supera el módulo 11. SUNAT lo rechaza aunque tenga once dígitos.',
    vigentes.filter((c) => c.clientes?.ruc && !rucValido(c.clientes.ruc))
      .map((c) => `${nombre(c)} (${c.clientes.ruc})`))

  add('DNI que no tiene ocho dígitos', 'bloquea',
    'El documento del receptor debe tener el largo que le corresponde a su tipo.',
    vigentes.filter((c) => !c.clientes?.ruc && c.clientes?.dni && !/^\d{8}$/.test(c.clientes.dni))
      .map((c) => `${nombre(c)} (${c.clientes.dni})`))

  add('Boleta de S/ 700 o más sin identificar al comprador', 'bloquea',
    'Desde ese monto SUNAT exige nombre y documento del comprador.',
    vigentes.filter((c) => c.tipo === 'boleta' && Number(c.total) >= 700
      && !c.clientes?.dni && !c.clientes?.ruc).map((c) => `${nombre(c)} (S/ ${c.total})`))

  add('Comprobante sin cliente registrado', 'bloquea',
    'No hay a quién declarar el comprobante.',
    vigentes.filter((c) => !c.clientes).map(nombre))

  // ── Contenido ────────────────────────────────────────────────────────────
  add('Comprobante sin líneas', 'bloquea',
    'Un comprobante sin detalle no se puede emitir.',
    vigentes.filter((c) => !c.comprobantes_items?.length).map(nombre))

  add('Importe total en cero o negativo', 'bloquea',
    'No corresponde a una venta.',
    vigentes.filter((c) => Number(c.total) <= 0).map(nombre))

  const sinUnidad = vigentes.filter((c) => (c.comprobantes_items ?? [])
    .some((i: any) => !i.productos?.unidades_medida?.codigo_sunat))
  add('Producto sin código de unidad de medida', 'observa',
    'Se envía NIU (unidad) por omisión. SUNAT lo acepta, pero la unidad declarada no será la real.',
    sinUnidad.map(nombre))

  const sinDesc = vigentes.filter((c) => (c.comprobantes_items ?? [])
    .some((i: any) => !((i.productos?.descripcion || '').trim() || i.productos?.nombre || i.descripcion)))
  add('Línea sin descripción', 'bloquea', 'La descripción del ítem es obligatoria.', sinDesc.map(nombre))

  const descLarga = vigentes.filter((c) => (c.comprobantes_items ?? [])
    .some((i: any) => ((i.productos?.descripcion || '').trim() || i.productos?.nombre || i.descripcion || '').length > 500))
  add('Descripción de más de 500 caracteres', 'observa',
    'SUNAT trunca o rechaza descripciones muy largas.', descLarga.map(nombre))

  // ── Aritmética ───────────────────────────────────────────────────────────
  const descuadre = vigentes.filter((c) => {
    const suma = (c.comprobantes_items ?? []).reduce((a: number, i: any) => a + Number(i.subtotal ?? 0), 0)
    return Math.abs(suma - Number(c.total)) > 0.005
  })
  add('El total no es la suma de sus líneas', 'bloquea',
    'SUNAT recalcula y rechaza por inconsistencia.',
    descuadre.map((c) => `${nombre(c)} (líneas ${(c.comprobantes_items ?? [])
      .reduce((a: number, i: any) => a + Number(i.subtotal ?? 0), 0).toFixed(2)} vs total ${Number(c.total).toFixed(2)})`))

  const igvRaro = vigentes.filter((c) => (c.comprobantes_items ?? [])
    .some((i: any) => ![0, 18].includes(Number(i.igv_porcentaje ?? 18))))
  add('Línea con un IGV distinto de 0 % o 18 %', 'observa',
    'Hay que decidir qué afectación declarar para esa línea.', igvRaro.map(nombre))

  const monedaRara = vigentes.filter((c) => c.moneda && c.moneda !== 'PEN')
  add('Moneda distinta de soles', 'observa',
    'Funciona, pero exige declarar el tipo de cambio del día.',
    monedaRara.map((c) => `${nombre(c)} (${c.moneda})`))

  // ── Fechas ───────────────────────────────────────────────────────────────
  const hoy = new Date().toISOString().slice(0, 10)
  add('Fecha de emisión futura', 'bloquea', 'SUNAT no acepta comprobantes con fecha posterior a hoy.',
    vigentes.filter((c) => c.fecha_emision > hoy).map((c) => `${nombre(c)} (${c.fecha_emision})`))

  const limite = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
  const vencidos = vigentes.filter((c) => c.fecha_emision < limite)
  add('Emitido hace más de 7 días', 'observa',
    'El plazo para enviar es de 3 días hábiles en facturas y 5 días calendario en boletas. Lo ya emitido antes de conectar SUNAT queda fuera de plazo.',
    vencidos.map(nombre))

  // ── Informe ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(76))
  console.log('  AUDITORÍA DE EMISIÓN ELECTRÓNICA — AGROCAR S.R.L.')
  console.log('═'.repeat(76))
  console.log(`\n  Comprobantes en la base        ${comps.length}`)
  console.log(`  De ellos, electrónicos        ${electronicos.length}  (facturas y boletas)`)
  console.log(`  Vigentes (no anulados)        ${vigentes.length}`)
  console.log(`  Documentos internos           ${comps.length - electronicos.length}  (no se envían a SUNAT)`)

  const bloquean = hallazgos.filter((h) => h.gravedad === 'bloquea')
  const observan = hallazgos.filter((h) => h.gravedad === 'observa')

  const bloque = (titulo: string, lista: Hallazgo[]) => {
    console.log(`\n${'─'.repeat(76)}\n  ${titulo}\n${'─'.repeat(76)}`)
    if (!lista.length) { console.log('\n  Nada que corregir.\n'); return }
    for (const h of lista) {
      console.log(`\n  ${h.regla}  —  ${h.afectados.length} comprobante(s)`)
      console.log(`    ${h.detalle}`)
      console.log(`    ${h.afectados.slice(0, 8).join(', ')}${h.afectados.length > 8 ? `, y ${h.afectados.length - 8} más` : ''}`)
    }
    console.log()
  }

  bloque('IMPIDEN EMITIR', bloquean)
  bloque('CONVIENE REVISAR', observan)

  const afectadosBloqueo = new Set(bloquean.flatMap((h) => h.afectados.map((a) => a.split(' ')[0])))
  console.log('═'.repeat(76))
  console.log(`  ${afectadosBloqueo.size} de ${vigentes.length} comprobantes tienen algo que impide emitirlos.`)
  console.log(`  ${vigentes.length - afectadosBloqueo.size} saldrían sin problema.`)
  console.log('═'.repeat(76) + '\n')

  fs.mkdirSync('.sunat', { recursive: true })
  fs.writeFileSync('.sunat/auditoria.json', JSON.stringify({ hallazgos, vigentes: vigentes.length }, null, 1))
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
