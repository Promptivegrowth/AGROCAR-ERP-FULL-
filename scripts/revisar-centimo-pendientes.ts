/**
 * Comprobantes sin declarar cuyo total del XML (construirInvoice) difiere del
 * impreso: los que la barrera de totales trabaría. Solo lee.
 *   npx tsx scripts/revisar-centimo-pendientes.ts
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { construirInvoice } from '../src/lib/sunat/ubl'
import { EMISOR_SUNAT } from '../src/lib/sunat/config'
import { traerTodo } from '../src/lib/supabase/paginar'
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
;(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const comps = await traerTodo<any>((a, b) => sb.from('comprobantes')
    .select('id, serie, numero, tipo, fecha_emision, total, clientes(razon_social, ruc, dni, direccion), comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje)')
    .in('tipo', ['factura', 'boleta']).neq('estado', 'anulado').eq('enviado_sunat', false).gte('fecha_emision', '2026-10-01').order('id').range(a, b))
  let malos = 0, ajustados = 0
  for (const c of comps) {
    const items = (c.comprobantes_items ?? []).map((it: any) => ({ cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), igv_porcentaje: it.igv_porcentaje ?? 18, descripcion: it.descripcion || 'X', codigo: null, unidad: 'NIU' }))
    const base = { serie: c.serie, numero: c.numero, tipo: c.tipo, fecha_emision: c.fecha_emision, moneda: 'PEN', forma_pago: 'contado', fecha_vencimiento: null, cliente: c.clientes }
    const antes = construirInvoice({ comprobante: base, emisor: EMISOR_SUNAT, items } as any)
    const ahora = construirInvoice({ comprobante: { ...base, total_impreso: Number(c.total) }, emisor: EMISOR_SUNAT, items } as any)
    if (antes.xml !== ahora.xml) { ajustados++; console.log(`  ajustado ${c.serie}-${c.numero}: ${antes.totales.total.toFixed(2)} -> ${ahora.totales.total.toFixed(2)} (impreso ${Number(c.total).toFixed(2)})`) }
    if (Math.abs(ahora.totales.total - Number(c.total)) > 0.005) { malos++; console.log(`${c.serie}-${c.numero} ${c.fecha_emision}: XML ${ahora.totales.total.toFixed(2)} vs impreso ${Number(c.total).toFixed(2)}`) }
  }
  console.log(`${comps.length} pendientes de declarar · ${ajustados} con XML ajustado · ${malos} todavía con diferencia`)
})()
