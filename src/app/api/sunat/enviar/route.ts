import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { configuracionSunat } from '@/lib/sunat/config'
import { declararComprobante } from '@/lib/sunat/declarar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Enviar un comprobante a SUNAT.
 *
 * Un envío a producción no se deshace: el comprobante queda declarado y para
 * dejarlo sin efecto hay que emitir una nota de crédito o una comunicación de
 * baja, cada una con su plazo. Por eso acá hay tres barreras antes de tocar el
 * servicio real, y hay que pasarlas todas:
 *
 *   1. Quien llama tiene que estar autenticado y ser administrador o facturador
 *   2. El sistema tiene que estar en modo producción CON credenciales cargadas
 *      (lo resuelve `configuracionSunat`, no esta ruta)
 *   3. Quien manda tiene que declarar contra qué modo cree que está enviando
 *
 * La tercera es la que evita el accidente de verdad. Si la pantalla cree que
 * está en pruebas y el servidor está en producción, el envío se rechaza en vez
 * de emitir algo real que nadie esperaba.
 */
export async function POST(req: Request) {
  // ── 1. Quién llama ────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: perfil } = await (supabase as any)
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!perfil || !['administrador', 'facturador'].includes(perfil.role)) {
    return NextResponse.json({ error: 'Sin permisos para enviar comprobantes a SUNAT' }, { status: 403 })
  }

  const cuerpo = await req.json().catch(() => ({})) as {
    comprobante_id?: string
    modo_esperado?: string
  }
  if (!cuerpo.comprobante_id) {
    return NextResponse.json({ error: 'Falta comprobante_id' }, { status: 400 })
  }

  let conf
  try {
    conf = await configuracionSunat()
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo leer la configuración de SUNAT' },
      { status: 500 },
    )
  }

  // ── 3. Que las dos partes estén de acuerdo sobre a dónde se envía ────────
  if (cuerpo.modo_esperado && cuerpo.modo_esperado !== conf.modo) {
    return NextResponse.json({
      error: `No se envió nada. La pantalla cree que el sistema está en "${cuerpo.modo_esperado}" `
        + `y en realidad está en "${conf.modo}". Recargá la página y volvé a intentar.`,
    }, { status: 409 })
  }

  /*
   * Todo lo que decide si este comprobante se declara vive en
   * `declararComprobante`, que es la misma función que usa el envío automático
   * de la madrugada. Acá arriba quedan solo las barreras que dependen de QUIÉN
   * pide el envío; las que dependen del comprobante están allá, una sola vez.
   */
  const r = await declararComprobante(cuerpo.comprobante_id, conf)

  if (r.motivo) {
    return NextResponse.json(
      { error: r.motivo, ...(r.programadoPara ? { programado_para: r.programadoPara } : {}) },
      { status: r.estadoHttp ?? 500 },
    )
  }

  return NextResponse.json({
    ok: r.ok,
    modo: conf.modo,
    razon: conf.razon,
    comprobante: r.comprobante,
    codigo: r.codigo,
    mensaje: r.mensaje,
    observaciones: r.observaciones ?? [],
    declarado: r.declarado,
  })
}

/** Con qué servicio está hablando el sistema. Lo consulta la pantalla. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  try {
    const conf = await configuracionSunat()
    return NextResponse.json({
      modo: conf.modo,
      razon: conf.razon,
      envio_automatico: conf.envioAutomatico,
      sincronizar_desde: conf.sincronizarDesde,
      certificado: {
        titular: conf.certificado.titular,
        vence: conf.certificado.vence.toISOString().slice(0, 10),
      },
    })
  } catch (e) {
    /*
     * Que SUNAT no este configurado no es una falla del servidor: es un estado
     * valido y esperable -por ejemplo antes de cargar el certificado-. Se
     * responde 200 con el motivo, y la pantalla muestra su cartel de aviso.
     * Devolver 500 llenaba la consola de errores rojos y hacia parecer que algo
     * se habia roto.
     */
    return NextResponse.json({
      modo: null,
      razon: '',
      envio_automatico: false,
      sincronizar_desde: null,
      error: e instanceof Error ? e.message : 'No se pudo leer la configuración',
    })
  }
}
