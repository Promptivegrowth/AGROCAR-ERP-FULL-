/**
 * Que lo que contesta SUNAT quede guardado contra el comprobante.
 *
 * Recorre el mismo camino que la ruta de envío —resolver el modo, armar,
 * firmar, mandar, guardar— sobre un comprobante real, y después vuelve a leer
 * la fila para comprobar que quedó todo: el código, el mensaje, la constancia
 * y el XML firmado.
 *
 * Va contra beta, siempre. El modo lo decide `configuracionSunat` y este
 * script no lo toca; si el sistema estuviera en producción, se planta.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-probar-guardado.ts
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

async function main() {
  cargarEnvLocal()
  process.env.SUNAT_CERT_BASE64 = fs.readFileSync(env('CERT_PFX')).toString('base64')
  process.env.SUNAT_CERT_PASSWORD = env('CERT_PASS')
  // Sin credenciales SOL cargadas, la configuración solo puede dar beta.
  delete process.env.SUNAT_USUARIO_SOL
  delete process.env.SUNAT_CLAVE_SOL

  const { configuracionSunat, EMISOR_SUNAT } = await import('../src/lib/sunat/config')
  const { construirInvoice } = await import('../src/lib/sunat/ubl')
  const { firmarXml, comprimir, enviarASunat } = await import('../src/lib/sunat/firma')

  const conf = await configuracionSunat()
  if (conf.modo !== 'beta') {
    throw new Error(`Esta prueba solo corre contra beta y el sistema resolvió "${conf.modo}". No se envió nada.`)
  }
  console.log(`\n  Modo: ${conf.modo} — ${conf.razon}\n`)

  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const { data, error } = await supabase.from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, total, sunat_intentos,
    clientes(razon_social, ruc, dni, direccion, credito_dias),
    pedidos(tipo_pago),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).eq('serie', 'F002').eq('numero', '00000045').maybeSingle()
  if (error) throw error
  const c = data as any
  if (!c) throw new Error('No se encontró el comprobante de prueba')

  const items = (c.comprobantes_items ?? []).map((it: any) => ({
    cantidad: Number(it.cantidad),
    precio_unitario: Number(it.precio_unitario),
    igv_porcentaje: it.igv_porcentaje ?? 18,
    descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
    codigo: it.productos?.codigo ?? null,
    unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
  }))

  const diasCredito = Number(c.clientes?.credito_dias ?? 0)
  const esCredito = c.pedidos?.tipo_pago === 'credito' && diasCredito > 0
  let vencimiento: string | null = null
  if (esCredito) {
    const d = new Date(`${c.fecha_emision}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + diasCredito)
    vencimiento = d.toISOString().slice(0, 10)
  }
  console.log(`  Forma de pago: ${esCredito ? `credito, vence ${vencimiento}` : 'contado'}
`)

  const { xml, nombreArchivo, totales } = construirInvoice({
    comprobante: {
      serie: c.serie, numero: c.numero, tipo: c.tipo,
      fecha_emision: c.fecha_emision, moneda: 'PEN',
      forma_pago: esCredito ? 'credito' : 'contado',
      fecha_vencimiento: vencimiento,
      cliente: c.clientes,
    },
    emisor: EMISOR_SUNAT,
    items,
  })

  if (Math.abs(totales.total - Number(c.total)) > 0.005) {
    throw new Error(`No se envía: total calculado ${totales.total} vs comprobante ${c.total}`)
  }

  const firmado = firmarXml(xml, conf.certificado)
  const zip = await comprimir(nombreArchivo, firmado)
  const r = await enviarASunat({
    modo: conf.modo, usuario: conf.usuario, clave: conf.clave, nombreArchivo, zip,
  })
  const aceptado = r.codigo === '0' || r.codigo === '4000'

  await supabase.from('comprobantes').update({
    enviado_sunat: aceptado,
    sunat_estado: aceptado ? 'aceptado' : 'rechazado',
    sunat_codigo: r.codigo,
    sunat_mensaje: r.mensaje,
    sunat_observaciones: r.observaciones ?? null,
    sunat_cdr: r.cdrZipBase64 ?? null,
    sunat_xml: firmado,
    sunat_modo: conf.modo,
    sunat_enviado_at: new Date().toISOString(),
    sunat_intentos: (c.sunat_intentos ?? 0) + 1,
  } as any).eq('id', c.id)

  // ── Volver a leer y comprobar qué quedó ──────────────────────────────────
  const { data: g } = await supabase.from('comprobantes')
    .select('serie, numero, enviado_sunat, sunat_estado, sunat_codigo, sunat_mensaje, sunat_modo, sunat_cdr, sunat_xml, sunat_enviado_at, sunat_intentos')
    .eq('id', c.id).maybeSingle()
  const x = g as any

  const filas: [string, string, boolean][] = [
    ['Comprobante', `${x.serie}-${x.numero}`, true],
    ['Marcado como enviado', String(x.enviado_sunat), x.enviado_sunat === aceptado],
    ['Estado', x.sunat_estado, x.sunat_estado === 'aceptado'],
    ['Código', x.sunat_codigo, x.sunat_codigo === '0' || x.sunat_codigo === '4000'],
    ['Mensaje', (x.sunat_mensaje ?? '').slice(0, 46), !!x.sunat_mensaje],
    ['Modo', x.sunat_modo, x.sunat_modo === 'beta'],
    ['Constancia guardada', x.sunat_cdr ? `${x.sunat_cdr.length} caracteres` : 'sin CDR (rechazo)', aceptado ? !!x.sunat_cdr : true],
    ['XML firmado guardado', x.sunat_xml ? `${x.sunat_xml.length} caracteres` : 'NO', !!x.sunat_xml],
    ['Cuándo se envió', (x.sunat_enviado_at ?? '').slice(0, 19), !!x.sunat_enviado_at],
    ['Intentos', String(x.sunat_intentos), x.sunat_intentos > 0],
  ]

  console.log('  LO QUE QUEDÓ GUARDADO\n')
  for (const [k, v, ok] of filas) console.log(`  ${ok ? 'OK  ' : 'MAL '} ${k.padEnd(24)} ${v}`)

  const todo = filas.every(([, , ok]) => ok)
  console.log(`\n  ${todo ? 'Todo se guardó correctamente.' : 'Falta guardar algo.'}`)
  console.log('  Ojo: sunat_modo dice "beta", así que este comprobante NO está declarado ante SUNAT.\n')
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
