import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { configuracionGre, EMISOR_GRE } from '@/lib/sunat/gre-config'
import { construirGuiaRemision, type ItemGuia } from '@/lib/sunat/gre-ubl'
import { firmarXml } from '@/lib/sunat/firma'
import { obtenerToken, comprimirGuia, enviarGuia, consultarTicket } from '@/lib/sunat/gre-envio'
import { hoyLima } from '@/lib/fechas-pe'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Declarar una guía de remisión ante SUNAT.
 *
 * Acá hay que ser más cuidadoso que con las facturas, por una razón concreta:
 * **la guía no tiene ambiente de pruebas**. El servicio REST es uno solo. Con
 * los comprobantes, equivocarse en beta no cuesta nada; acá cada envío queda.
 *
 * Por eso las barreras, todas antes de tocar SUNAT:
 *
 *   1. quien llama está autenticado y tiene rol para hacerlo
 *   2. el envío de guías está encendido Y hay credenciales (`configuracionGre`)
 *   3. hay fecha de inicio y la guía es posterior
 *   4. la guía no fue declarada antes
 *
 * El envío es asíncrono: esto devuelve un ticket, no un veredicto. El resultado
 * se pregunta con la misma ruta y `accion: 'consultar'`.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: perfil } = await (supabase as any)
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!perfil || !['administrador', 'gerente', 'facturador'].includes(perfil.role)) {
    return NextResponse.json({ error: 'Sin permisos para declarar guías de remisión' }, { status: 403 })
  }

  const cuerpo = await req.json().catch(() => ({})) as {
    guia_id?: string
    accion?: 'enviar' | 'consultar'
  }
  if (!cuerpo.guia_id) {
    return NextResponse.json({ error: 'Falta guia_id' }, { status: 400 })
  }

  const conf = await configuracionGre()
  if (!conf.listo) {
    return NextResponse.json({ error: conf.motivo }, { status: 409 })
  }

  const admin = createAdminClient()
  const { data, error } = await (admin as any).from('guias_remision').select(`
    id, serie, numero, estado, enviado_sunat, sunat_ticket, sunat_estado, sunat_intentos,
    fecha_emision, fecha_inicio_traslado, motivo_traslado, motivo_descripcion,
    modalidad_traslado, punto_partida, punto_llegada, ubigeo_partida, ubigeo_llegada,
    peso_bruto_total, unidad_peso, vehiculo_placa,
    conductor_nombre, conductor_doc, conductor_licencia,
    transportista_ruc, transportista_razon_social,
    cliente_externo_nombre, cliente_externo_doc,
    clientes(razon_social, ruc, dni, ubigeo),
    comprobantes(tipo, serie, numero),
    guias_remision_items(codigo, descripcion, cantidad, unidad_medida, orden)
  `).eq('id', cuerpo.guia_id).maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'La guía no existe' }, { status: 404 })

  const g = data as any
  const nombre = `${g.serie}-${String(g.numero).padStart(8, '0')}`

  // ── Consultar el resultado de un envío anterior ──────────────────────────
  if (cuerpo.accion === 'consultar') {
    if (!g.sunat_ticket) {
      return NextResponse.json({ error: `${nombre} todavía no se envió a SUNAT` }, { status: 409 })
    }
    try {
      const token = await obtenerToken(conf.credenciales!)
      const r = await consultarTicket({ token, ticket: g.sunat_ticket })
      await (admin as any).from('guias_remision').update({
        sunat_estado: r.estado,
        sunat_codigo: r.codigo,
        sunat_mensaje: r.mensaje,
        sunat_cdr: r.cdrZipBase64 ?? null,
        enviado_sunat: r.estado === 'aceptado',
      }).eq('id', g.id)

      return NextResponse.json({
        ok: r.estado === 'aceptado',
        guia: nombre,
        ticket: g.sunat_ticket,
        estado: r.estado,
        codigo: r.codigo,
        mensaje: r.mensaje,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'No se pudo consultar el ticket' },
        { status: 502 },
      )
    }
  }

  // ── Enviar ───────────────────────────────────────────────────────────────
  if (g.estado === 'anulada') {
    return NextResponse.json({ error: `${nombre} está anulada` }, { status: 400 })
  }
  if (g.enviado_sunat) {
    return NextResponse.json({
      error: `${nombre} ya fue aceptada por SUNAT. Para dejarla sin efecto hay que darla de baja.`,
    }, { status: 409 })
  }
  if (g.sunat_estado === 'procesando' && g.sunat_ticket) {
    return NextResponse.json({
      error: `${nombre} ya está en SUNAT esperando resultado (ticket ${g.sunat_ticket}). `
        + 'Consultá el ticket en vez de volver a enviarla.',
      ticket: g.sunat_ticket,
    }, { status: 409 })
  }

  /*
   * La fecha de corte. Igual que con los comprobantes: lo emitido antes de
   * conectarse no se declara. Acá pesa más porque no hay vuelta atrás.
   */
  if (!conf.declararDesde) {
    return NextResponse.json({
      error: 'No hay fecha de inicio configurada para las guías. Hasta fijarla no se declara ninguna.',
    }, { status: 409 })
  }
  const fechaGuia = String(g.fecha_inicio_traslado ?? '').slice(0, 10)
  if (fechaGuia < conf.declararDesde) {
    return NextResponse.json({
      error: `${nombre} es del ${fechaGuia}, anterior al inicio (${conf.declararDesde}). `
        + 'Las guías anteriores no se declaran.',
    }, { status: 409 })
  }
  if (fechaGuia > hoyLima()) {
    return NextResponse.json({
      error: `${nombre} tiene fecha de traslado ${fechaGuia} y hoy es ${hoyLima()}. `
        + 'Se declara el día del traslado.',
    }, { status: 409 })
  }

  // El destinatario y su ubigeo.
  const cli = g.clientes ?? {}
  const ubigeoLlegada = String(g.ubigeo_llegada ?? cli.ubigeo ?? '').trim()

  const items: ItemGuia[] = ((g.guias_remision_items ?? []) as any[])
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map((it) => ({
      codigo: it.codigo ?? null,
      descripcion: (it.descripcion ?? '').trim() || 'PRODUCTO',
      cantidad: Number(it.cantidad ?? 0),
      unidad: it.unidad_medida || 'NIU',
    }))

  // El nombre del conductor viene en un solo campo; SUNAT lo quiere partido.
  const partes = String(g.conductor_nombre ?? '').trim().split(/\s+/)
  const conductorNombres = partes.slice(0, 2).join(' ') || '-'
  const conductorApellidos = partes.slice(2).join(' ') || partes.slice(0, 1).join(' ') || '-'

  try {
    const { xml, nombreArchivo } = construirGuiaRemision({
      guia: {
        serie: g.serie,
        numero: g.numero,
        fecha_emision: String(g.fecha_emision ?? '').slice(0, 10) || hoyLima(),
        fecha_inicio_traslado: fechaGuia,
        motivo_traslado: g.motivo_traslado,
        motivo_descripcion: g.motivo_descripcion,
        peso_bruto_total: Number(g.peso_bruto_total ?? 0),
        unidad_peso: g.unidad_peso || 'KGM',
        partida: { ubigeo: String(g.ubigeo_partida ?? ''), direccion: g.punto_partida ?? '' },
        llegada: { ubigeo: ubigeoLlegada, direccion: g.punto_llegada ?? '' },
        destinatario: {
          razon_social: cli.razon_social ?? g.cliente_externo_nombre ?? '—',
          ruc: cli.ruc ?? null,
          dni: cli.dni ?? g.cliente_externo_doc ?? null,
        },
        transporte: {
          modalidad: g.modalidad_traslado,
          placa: g.vehiculo_placa,
          conductor_nombres: conductorNombres,
          conductor_apellidos: conductorApellidos,
          conductor_doc: g.conductor_doc,
          conductor_licencia: g.conductor_licencia,
          transportista_ruc: g.transportista_ruc,
          transportista_razon_social: g.transportista_razon_social,
        },
        comprobante_relacionado: g.comprobantes
          ? {
            tipo: g.comprobantes.tipo === 'factura' ? '01' : '03',
            serie: g.comprobantes.serie,
            numero: g.comprobantes.numero,
          }
          : null,
      },
      emisor: EMISOR_GRE,
      items,
    })

    const firmado = firmarXml(xml, conf.certificado!)
    const zip = await comprimirGuia(nombreArchivo, firmado)
    const token = await obtenerToken(conf.credenciales!)
    const r = await enviarGuia({ token, nombreArchivo, zip })

    await (admin as any).from('guias_remision').update({
      sunat_ticket: r.ticket ?? null,
      sunat_estado: r.ok ? 'procesando' : 'error',
      sunat_codigo: r.codigo ?? null,
      sunat_mensaje: r.mensaje ?? null,
      sunat_xml: firmado,
      sunat_enviado_at: new Date().toISOString(),
      sunat_intentos: (g.sunat_intentos ?? 0) + 1,
    }).eq('id', g.id)

    return NextResponse.json({
      ok: r.ok,
      guia: nombre,
      ticket: r.ticket,
      // Que quede claro que esto no es un veredicto.
      mensaje: r.ok
        ? 'Enviada. SUNAT la está procesando: consultá el ticket para saber si la aceptó.'
        : r.mensaje,
      codigo: r.codigo,
    })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error inesperado al enviar la guía'
    await (admin as any).from('guias_remision').update({
      sunat_estado: 'error',
      sunat_mensaje: mensaje,
      sunat_enviado_at: new Date().toISOString(),
      sunat_intentos: (g.sunat_intentos ?? 0) + 1,
    }).eq('id', g.id)
    return NextResponse.json({ error: mensaje }, { status: 500 })
  }
}

/** Si el sistema está en condiciones de declarar guías, y qué falta si no. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const conf = await configuracionGre()
  return NextResponse.json({
    listo: conf.listo,
    motivo: conf.motivo,
    declarar_desde: conf.declararDesde,
  })
}
