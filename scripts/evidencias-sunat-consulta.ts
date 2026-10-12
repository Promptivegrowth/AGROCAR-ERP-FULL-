/**
 * Carpeta de evidencias para SUNAT: comprobantes con constancia (CDR) de
 * aceptado que la consulta de SUNAT no muestra (desde el 10/10/2026).
 *
 * Por cada comprobante: el XML firmado que se envió y la constancia ZIP que
 * devolvió SUNAT. Más un resumen (CSV) con cada intento de envío y lo que
 * responde hoy la consulta, y un caso de control que sí aparece. Solo lee.
 *
 *   SUNAT_USUARIO_SOL=... SUNAT_CLAVE_SOL=... npx tsx scripts/evidencias-sunat-consulta.ts "<carpeta destino>"
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { consultarEnSunat } from '../src/lib/sunat/consulta'
import { traerTodo } from '../src/lib/supabase/paginar'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const RUC = '20519883296'
const COD: Record<string, string> = { factura: '01', boleta: '03' }
const lima = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false }) : '')
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const destino = process.argv[2]
  if (!destino) throw new Error('Falta la carpeta destino')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any

  const comps = await traerTodo<any>((a, b) => admin.from('comprobantes')
    .select('id, tipo, serie, numero, fecha_emision, total, sunat_codigo, sunat_mensaje, sunat_enviado_at, sunat_xml, sunat_cdr, sunat_verificacion, clientes(razon_social, ruc, dni)')
    .eq('enviado_sunat', true).eq('sunat_modo', 'produccion').eq('sunat_verificacion', 'no_existe')
    .order('fecha_emision').order('serie').order('numero').range(a, b))
  const control = await admin.from('comprobantes')
    .select('id, tipo, serie, numero, fecha_emision, total, sunat_codigo, sunat_mensaje, sunat_enviado_at, sunat_xml, sunat_cdr, clientes(razon_social, ruc, dni)')
    .eq('serie', 'F002').eq('numero', '00000064').maybeSingle()

  fs.mkdirSync(path.join(destino, 'XML_enviados'), { recursive: true })
  fs.mkdirSync(path.join(destino, 'CDR_constancias_SUNAT'), { recursive: true })
  fs.mkdirSync(path.join(destino, 'CONTROL_comprobante_que_si_figura'), { recursive: true })

  const guardar = (c: any, carpetaXml: string, carpetaCdr: string) => {
    const base = `${RUC}-${COD[c.tipo]}-${c.serie}-${c.numero}`
    fs.writeFileSync(path.join(carpetaXml, `${base}.xml`), c.sunat_xml ?? '', 'utf8')
    if (c.sunat_cdr) fs.writeFileSync(path.join(carpetaCdr, `R-${base}.zip`), Buffer.from(c.sunat_cdr, 'base64'))
  }

  const filas = [['Comprobante', 'Tipo', 'Fecha emisión', 'Cliente', 'Doc. cliente', 'Total S/', 'Intentos de envío (fecha y hora Lima · respuesta SUNAT)',
    'Constancia (CDR)', 'Consulta SUNAT hoy (getStatus)', 'Hora de la consulta']]
  let n = 0
  for (const c of comps) {
    guardar(c, path.join(destino, 'XML_enviados'), path.join(destino, 'CDR_constancias_SUNAT'))
    const { data: bit } = await admin.from('sunat_bitacora').select('intento, enviado_at, aceptado, codigo, mensaje')
      .eq('comprobante_id', c.id).order('intento')
    const intentos = (bit ?? []).map((b: any) => `#${b.intento} ${lima(b.enviado_at)} · ${b.aceptado ? 'ACEPTADO' : 'no recibido'} · ${(b.codigo ?? '').replace(/^.*\./, '')} ${b.mensaje ?? ''}`.trim()).join(' | ')
    const q = await consultarEnSunat(c)
    filas.push([`${c.serie}-${c.numero}`, c.tipo, c.fecha_emision, c.clientes?.razon_social ?? '', c.clientes?.ruc ?? c.clientes?.dni ?? '',
      Number(c.total).toFixed(2), intentos, `${c.sunat_codigo} · ${c.sunat_mensaje ?? ''}`, `${q.codigo ?? ''} · ${q.mensaje}`, lima(new Date().toISOString())])
    n++
    if (n % 20 === 0) console.log(`  ${n}/${comps.length}`)
    await esperar(3500)
  }

  if (control.data) {
    const c = control.data
    guardar(c, path.join(destino, 'CONTROL_comprobante_que_si_figura'), path.join(destino, 'CONTROL_comprobante_que_si_figura'))
    const q = await consultarEnSunat(c)
    fs.writeFileSync(path.join(destino, 'CONTROL_comprobante_que_si_figura', 'LEEME.txt'),
      `Comprobante de control enviado con el mismo sistema, certificado y usuario SOL el ${lima(c.sunat_enviado_at)}.\r\n`
      + `Constancia: ${c.sunat_codigo} · ${c.sunat_mensaje}\r\nConsulta SUNAT hoy: ${q.codigo} · ${q.mensaje}\r\n`, 'utf8')
  }

  const csv = filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  fs.writeFileSync(path.join(destino, 'RESUMEN_comprobantes.csv'), '﻿' + csv, 'utf8')
  console.log(`Listo: ${comps.length} comprobantes en ${destino}`)
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1) })
