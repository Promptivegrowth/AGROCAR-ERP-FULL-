import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { configuracionSunat, type ConfiguracionSunat } from '@/lib/sunat/config'
import { declararComprobante, comprobantesPendientes } from '@/lib/sunat/declarar'
import { consultarEnSunat } from '@/lib/sunat/consulta'
import { hoyLima } from '@/lib/fechas-pe'
import { sumarDias } from '@/lib/sunat/plazo'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Declarar cada mañana los comprobantes que ya cumplieron su espera.
 *
 * Los comprobantes se imprimen la noche anterior al reparto -el camión sale a
 * las 3:30 de la mañana y a esa hora no hay nadie en la oficina- y salen
 * fechados el día en que se entrega la mercadería. Nadie tiene que acordarse
 * de apretar nada: este proceso los busca y los declara.
 *
 * Pero no el mismo día. Daniel quiere usar el plazo de SUNAT -hasta el tercer
 * día calendario siguiente a la emisión, RS 000003-2023/SUNAT- para anular o
 * editar desde el sistema si hubo un error o una devolución. Así que espera
 * `sunat_dias_espera` días (2 por omisión): lo del 01/10 sale el 03/10, y el
 * 04/10 queda de reserva por si ese envío falla. Ver `lib/sunat/plazo.ts`.
 *
 * No decide nada por su cuenta: usa `declararComprobante`, la misma función que
 * el botón de la pantalla, con las mismas barreras. Lo único propio es a quién
 * le abre la puerta, el ritmo con que envía y el tiempo que se da.
 *
 * Mientras `sunat_envio_automatico` esté apagado, este proceso mira y no toca.
 */

/**
 * Quién puede disparar el barrido.
 *
 * Vercel Cron, con CRON_SECRET. Y el respaldo: un programador en la propia base
 * (pg_cron, migración 117) que llama dos veces más al día con una clave que
 * vive solo en la base. Si un día Vercel no corre el cron, el respaldo lo
 * cubre; si corren los dos, no pasa nada: cada comprobante se reserva antes de
 * enviarse y lo ya declarado se saltea.
 *
 * Sin ninguna de las dos claves no entra nadie: es preferible que el envío no
 * corra a dejar una dirección que cualquiera pueda golpear para declarar.
 */
async function autorizado(req: Request): Promise<'vercel' | 'respaldo' | null> {
  const h = req.headers.get('authorization') ?? ''
  const dado = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!dado) return null
  const igual = (a: string, b: string) => {
    const x = Buffer.from(a)
    const y = Buffer.from(b)
    return x.length === y.length && crypto.timingSafeEqual(x, y)
  }
  const secreto = process.env.CRON_SECRET
  if (secreto && igual(dado, secreto)) return 'vercel'
  const { data } = await (createAdminClient() as any)
    .from('sunat_respaldo_token').select('token').eq('id', 1).maybeSingle()
  if (data?.token && igual(dado, String(data.token))) return 'respaldo'
  return null
}

/**
 * Lo que hizo cada barrido queda anotado en la configuración, para que Estado
 * SUNAT muestre cuándo corrió por última vez y avise si un día no corrió.
 */
async function anotarBarrido(resumen: Record<string, unknown>) {
  await (createAdminClient() as any).from('configuracion').upsert({
    clave: 'sunat_ultimo_barrido',
    valor: JSON.stringify({ ...resumen, at: new Date().toISOString() }),
    descripcion: 'Último envío automático a SUNAT (lo escribe el sistema).',
  }, { onConflict: 'clave' })
}

/**
 * Después de enviar, se le pregunta a SUNAT por lo declarado en los últimos
 * días que todavía no se verificó. La constancia ya prueba la aceptación; esto
 * es la segunda opinión, la de la consulta, y deja a la vista cualquier
 * diferencia en Estado SUNAT ("Para revisar").
 */
async function verificarDeclarados(conf: ConfiguracionSunat, hastaMs: number) {
  if (conf.modo !== 'produccion') return { verificados: 0, diferencias: [] as string[] }
  const admin = createAdminClient() as any
  const { data } = await admin.from('comprobantes')
    .select('id, tipo, serie, numero')
    .eq('enviado_sunat', true).eq('sunat_modo', 'produccion')
    .is('sunat_verificado_at', null)
    .gte('fecha_emision', sumarDias(hoyLima(), -10))
    .order('fecha_emision', { ascending: true })
    .limit(150)
  let verificados = 0
  const diferencias: string[] = []
  for (const c of (data ?? []) as { id: string; tipo: string; serie: string; numero: string }[]) {
    if (Date.now() > hastaMs) break
    const r = await consultarEnSunat(c)
    // No se pudo preguntar: queda sin verificar y entra en el próximo barrido.
    if (r.estado === 'error') continue
    await admin.from('comprobantes').update({
      sunat_verificado_at: new Date().toISOString(),
      sunat_verificacion: r.estado,
    }).eq('id', c.id)
    verificados++
    if (r.estado !== 'aceptado') diferencias.push(`${c.serie}-${c.numero}: ${r.estado}`)
    await new Promise((res) => setTimeout(res, 300))
  }
  return { verificados, diferencias }
}

export async function GET(req: Request) {
  const inicio = Date.now()
  /*
   * Se deja de empezar envíos a los 230 s: la función tiene 300 y un envío
   * puede tardar. Lo que quede sale en el próximo barrido —el respaldo de la
   * tarde o el de mañana—, todavía dentro del plazo.
   */
  const LIMITE_ENVIOS_MS = inicio + 230_000
  const LIMITE_TOTAL_MS = inicio + 270_000

  const quien = await autorizado(req)
  if (!quien) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  let conf: ConfiguracionSunat
  try {
    conf = await configuracionSunat()
  } catch (e) {
    const error = e instanceof Error ? e.message : 'No se pudo leer la configuración de SUNAT'
    await anotarBarrido({ origen: quien, error })
    return NextResponse.json({ error }, { status: 503 })
  }

  const hoy = hoyLima()

  /*
   * Sin fecha de inicio de sincronización no se barre nada. Es la línea que
   * separa los comprobantes históricos -que no se declaran nunca- de los que sí,
   * y hasta que Daniel la fije no hay forma de saber de qué lado cae cada uno.
   */
  if (!conf.sincronizarDesde) {
    return NextResponse.json({
      fecha: hoy,
      modo: conf.modo,
      dias_espera: conf.diasEspera,
      envio_automatico: conf.envioAutomatico,
      razon: 'No hay fecha de inicio de sincronización configurada: no se declaró nada. '
        + 'Los comprobantes anteriores a esa fecha no se declaran nunca.',
      enviados: 0,
    })
  }

  /*
   * El interruptor. Apagado, este proceso informa qué habría enviado y no envía
   * nada: sirve para mirar durante unos días que la lista sea la esperada antes
   * de dejarlo declarar solo.
   */
  if (!conf.envioAutomatico) {
    const pendientes = await comprobantesPendientes(conf)
    return NextResponse.json({
      fecha: hoy,
      modo: conf.modo,
      dias_espera: conf.diasEspera,
      envio_automatico: false,
      razon: 'El envío automático está apagado: no se declaró nada.',
      habria_enviado: pendientes.length,
      comprobantes: pendientes.map((c) => `${c.serie}-${c.numero} (${c.fecha_emision})`),
    })
  }

  const pendientes = await comprobantesPendientes(conf)
  const enviados: string[] = []
  const fallados: { comprobante: string; motivo: string }[] = []
  let quedaron = 0

  for (let i = 0; i < pendientes.length; i++) {
    if (Date.now() > LIMITE_ENVIOS_MS) { quedaron = pendientes.length - i; break }
    const r = await declararComprobante(pendientes[i].id, conf)
    if (r.ok) enviados.push(r.comprobante)
    // "Ya se está enviando" no es una falla: lo tiene otro proceso.
    else if (r.estadoHttp !== 409) {
      fallados.push({ comprobante: r.comprobante, motivo: r.motivo ?? r.mensaje ?? 'rechazado' })
    }

    // SUNAT limita el ritmo: sin pausa empieza a devolver 401 que no son de
    // credenciales.
    await new Promise((res) => setTimeout(res, 1200))
  }

  const verificacion = await verificarDeclarados(conf, LIMITE_TOTAL_MS)

  const resumen = {
    origen: quien,
    fecha: hoy,
    modo: conf.modo,
    dias_espera: conf.diasEspera,
    pendientes: pendientes.length,
    enviados: enviados.length,
    fallados: fallados.length,
    quedaron_para_despues: quedaron,
    verificados: verificacion.verificados,
    diferencias: verificacion.diferencias.length,
    segundos: Math.round((Date.now() - inicio) / 1000),
  }
  await anotarBarrido({
    ...resumen,
    detalle_fallados: fallados.slice(0, 10),
    detalle_diferencias: verificacion.diferencias.slice(0, 10),
  })

  return NextResponse.json({
    ...resumen,
    envio_automatico: true,
    detalle_fallados: fallados.slice(0, 20),
    detalle_diferencias: verificacion.diferencias.slice(0, 20),
  })
}
