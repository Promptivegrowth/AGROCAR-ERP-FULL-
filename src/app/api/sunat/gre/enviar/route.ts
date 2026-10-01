import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { configuracionGre } from '@/lib/sunat/gre-config'
import { declararGuia, consultarGuia } from '@/lib/sunat/gre-declarar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Declarar una guía de remisión ante SUNAT, o consultar cómo salió.
 *
 * Todo lo que decide si una guía se declara vive en `lib/sunat/gre-declarar`;
 * acá queda solo quién puede pedirlo. No hay ambiente de pruebas: cada envío
 * es real, por eso solo administración, gerencia y facturación.
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

  const cuerpo = await req.json().catch(() => ({})) as { guia_id?: string; accion?: 'enviar' | 'consultar' }
  if (!cuerpo.guia_id) return NextResponse.json({ error: 'Falta guia_id' }, { status: 400 })

  const conf = await configuracionGre()
  if (!conf.listo) return NextResponse.json({ error: conf.motivo }, { status: 409 })

  try {
    const r = cuerpo.accion === 'consultar'
      ? await consultarGuia(cuerpo.guia_id, conf, 3)
      : await declararGuia(cuerpo.guia_id, conf)
    if (r.motivo) return NextResponse.json({ error: r.motivo, guia: r.guia }, { status: r.estadoHttp ?? 500 })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo completar' }, { status: 502 })
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
