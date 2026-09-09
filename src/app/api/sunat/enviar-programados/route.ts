import { NextResponse } from 'next/server'
import { configuracionSunat } from '@/lib/sunat/config'
import { declararComprobante, comprobantesPendientes } from '@/lib/sunat/declarar'
import { hoyLima } from '@/lib/fechas-pe'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Declarar cada mañana los comprobantes que ya llegaron a su fecha.
 *
 * Los comprobantes se imprimen la noche anterior al reparto -el camión sale a
 * las 3:30 de la mañana y a esa hora no hay nadie en la oficina- y salen
 * fechados el día en que se entrega la mercadería. Ese día nadie tiene que
 * acordarse de apretar nada: este proceso los busca y los declara.
 *
 * Que corra el mismo día en que están fechados es lo que hace que el plazo de
 * envío -3 días calendario desde el día siguiente a la emisión, RS
 * 003-2023/SUNAT- empiece a correr recién cuando la mercadería sale, y no dos
 * días antes mientras los papeles esperan en la oficina.
 *
 * No decide nada por su cuenta: usa `declararComprobante`, la misma función que
 * el botón de la pantalla, con las mismas barreras. Lo único propio es a quién
 * le abre la puerta y el ritmo con que envía.
 *
 * Mientras `sunat_envio_automatico` esté apagado, este proceso mira y no toca.
 */
export async function GET(req: Request) {
  /*
   * Solo Vercel Cron. Sin el secreto configurado esto no corre: es preferible
   * que el envío automático no funcione a que quede una dirección que cualquiera
   * pueda golpear para declarar comprobantes.
   */
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return NextResponse.json({
      error: 'Falta CRON_SECRET en el servidor. El envío automático está deshabilitado.',
    }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  let conf
  try {
    conf = await configuracionSunat()
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'No se pudo leer la configuración de SUNAT',
    }, { status: 503 })
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
      envio_automatico: false,
      razon: 'El envío automático está apagado: no se declaró nada.',
      habria_enviado: pendientes.length,
      comprobantes: pendientes.map((c) => `${c.serie}-${c.numero} (${c.fecha_emision})`),
    })
  }

  const pendientes = await comprobantesPendientes(conf)
  const enviados: string[] = []
  const fallados: { comprobante: string; motivo: string }[] = []

  for (const c of pendientes) {
    const r = await declararComprobante(c.id, conf)
    if (r.ok) enviados.push(r.comprobante)
    else fallados.push({ comprobante: r.comprobante, motivo: r.motivo ?? r.mensaje ?? 'rechazado' })

    // SUNAT limita el ritmo: sin pausa empieza a devolver 401 que no son de
    // credenciales. Con esta pausa un lote de 150 tarda unos tres minutos.
    await new Promise((r) => setTimeout(r, 1200))
  }

  return NextResponse.json({
    fecha: hoy,
    modo: conf.modo,
    envio_automatico: true,
    pendientes: pendientes.length,
    enviados: enviados.length,
    fallados: fallados.length,
    detalle_fallados: fallados.slice(0, 20),
  })
}
