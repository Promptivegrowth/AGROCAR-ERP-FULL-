/**
 * Cuando el sistema se niega a declarar, ¿queda rastro? ¿Del correcto?
 *
 * Hay dos clases de negativa y no se anotan igual:
 *
 *   - "todavía no es su fecha" es una respuesta normal. El comprobante está
 *     bien y no hay nada que arreglar: no se le escribe nada encima.
 *   - "el total no coincide con el impreso" es un problema de verdad, y tiene
 *     que quedar anotado. Si no, el envío automático de la madrugada lo saltea
 *     todos los días y nadie se entera.
 *
 * Se ejerce contra la misma función que usan la pantalla y el proceso
 * automático, y se deja todo como estaba.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/probar-rastro-de-negativas.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { abrirCertificado } from '../src/lib/sunat/firma'
import { declararComprobante } from '../src/lib/sunat/declarar'
import type { ConfiguracionSunat } from '../src/lib/sunat/config'

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

const LIMA = 5 * 60 * 60 * 1000
const hoyLima = () => new Date(Date.now() - LIMA).toISOString().slice(0, 10)
const enDias = (n: number) => {
  const d = new Date(`${hoyLima()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const conf: ConfiguracionSunat = {
    modo: 'beta',
    usuario: '20519883296MODDATOS',
    clave: 'MODDATOS',
    certificado: abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS')),
    envioAutomatico: false,
    sincronizarDesde: '2020-01-01',
    razon: 'prueba',
  }

  console.log('\nRASTRO DE LAS NEGATIVAS\n')

  const leer = async (id: string) => {
    const { data } = await (supabase as any).from('comprobantes')
      .select('serie, numero, fecha_emision, sunat_estado, sunat_mensaje, sunat_enviado_at, enviado_sunat')
      .eq('id', id).maybeSingle()
    return data as any
  }

  // ── Caso 1: descuadre de un céntimo. Tiene que quedar anotado ────────────
  // B002-00000674 difiere en un céntimo entre el ERP y el XML.
  const { data: trabado } = await (supabase as any).from('comprobantes')
    .select('id, serie, numero, sunat_estado, sunat_mensaje, sunat_enviado_at')
    .eq('serie', 'B002').eq('numero', '00000674').maybeSingle()

  check('Está el comprobante descuadrado para probar', !!trabado,
    trabado ? `${(trabado as any).serie}-${(trabado as any).numero}` : '')

  if (trabado) {
    const t = trabado as any
    const antes = { estado: t.sunat_estado, mensaje: t.sunat_mensaje, cuando: t.sunat_enviado_at }
    try {
      const r = await declararComprobante(t.id, conf)
      check('Se niega a declararlo por el descuadre', !r.ok && r.estadoHttp === 422,
        (r.motivo ?? '').slice(0, 110))

      const despues = await leer(t.id)
      check('Queda anotado como error en el comprobante',
        despues.sunat_estado === 'error', despues.sunat_estado ?? 'sin estado')
      check('El motivo anotado explica el descuadre',
        /no coincide/.test(despues.sunat_mensaje ?? ''),
        (despues.sunat_mensaje ?? '').slice(0, 90))
      check('No quedó marcado como declarado', despues.enviado_sunat === false)
    } finally {
      await (supabase as any).from('comprobantes').update({
        sunat_estado: antes.estado, sunat_mensaje: antes.mensaje, sunat_enviado_at: antes.cuando,
      }).eq('id', t.id)
      const vuelto = await leer(t.id)
      check('El comprobante quedó como estaba',
        (vuelto.sunat_estado ?? null) === (antes.estado ?? null),
        `estado: ${vuelto.sunat_estado ?? 'ninguno'}`)
    }
  }

  // ── Caso 2: todavía no es su fecha. NO tiene que ensuciar nada ───────────
  const { data: normal } = await (supabase as any).from('comprobantes')
    .select('id, serie, numero, fecha_emision, sunat_estado, sunat_mensaje, sunat_enviado_at')
    .in('tipo', ['factura', 'boleta']).eq('enviado_sunat', false).neq('estado', 'anulado')
    .is('sunat_estado', null)
    .order('fecha_emision', { ascending: false }).limit(1).maybeSingle()

  check('Hay un comprobante limpio para el segundo caso', !!normal,
    normal ? `${(normal as any).serie}-${(normal as any).numero}` : '')

  if (normal) {
    const n = normal as any
    const fechaOriginal = n.fecha_emision
    try {
      await (supabase as any).from('comprobantes')
        .update({ fecha_emision: enDias(2) }).eq('id', n.id)

      const r = await declararComprobante(n.id, conf)
      check('Se niega porque todavía no llegó su día', !r.ok && r.estadoHttp === 409,
        r.programadoPara ?? '')

      const despues = await leer(n.id)
      check('NO lo ensucia: sigue sin estado de SUNAT',
        despues.sunat_estado === null,
        `estado: ${despues.sunat_estado ?? 'ninguno'}`)
      check('NO le inventa un mensaje de error',
        despues.sunat_mensaje === null,
        `mensaje: ${despues.sunat_mensaje ?? 'ninguno'}`)
      check('NO le pone fecha de envío', despues.sunat_enviado_at === null)
    } finally {
      await (supabase as any).from('comprobantes')
        .update({ fecha_emision: fechaOriginal }).eq('id', n.id)
      const vuelto = await leer(n.id)
      check('El segundo comprobante quedó como estaba',
        vuelto.fecha_emision === fechaOriginal, vuelto.fecha_emision)
    }
  }

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
