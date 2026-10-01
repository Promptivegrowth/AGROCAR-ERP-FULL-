import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { consultarEnSunat, leerCdr, type ResultadoConsulta } from '@/lib/sunat/consulta'
import { hoyLima } from '@/lib/fechas-pe'
import { diaDeEnvio, venceElPlazo, normalizarDiasEspera } from '@/lib/sunat/plazo'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Verificar con SUNAT que un comprobante llegó y fue aceptado.
 *
 * Daniel pidió poder ver el estado de cada comprobante y comprobar desde ahí
 * que llegó bien a SUNAT. Lo que el ERP anota al enviar es lo que el ERP cree;
 * esto se lo pregunta a SUNAT, por el servicio de consulta, que solo lee.
 *
 * Dos pruebas, y se muestran las dos:
 *   - la consulta en vivo: SUNAT dice si lo tiene y en qué estado
 *   - la constancia (CDR) guardada: el documento firmado por SUNAT al recibirlo
 *
 * El estado del ERP se corrige en UN solo caso: SUNAT confirma que lo tiene
 * aceptado y el ERP no lo había anotado —el envío se cortó después de que
 * SUNAT ya lo había recibido—. Ahí se recupera la constancia y se marca
 * declarado, porque es SUNAT quien lo afirma.
 *
 * Al revés no: si SUNAT dice que no lo tiene, o que lo rechazó, y el ERP lo da
 * por aceptado, se avisa y no se toca. Un envío recién hecho puede tardar unos
 * minutos en aparecer en la consulta, y reenviarlo a ciegas lo haría rebotar
 * por duplicado. Eso lo decide una persona mirando.
 */

const ROLES = ['administrador', 'gerente', 'facturador', 'contador', 'caja']
const TOPE = 60

type Veredicto = 'ok' | 'pendiente' | 'problema' | 'sin_consulta' | 'no_aplica'

export interface ResultadoVerificacion {
  id: string
  comprobante: string
  veredicto: Veredicto
  resumen: string
  consulta: Pick<ResultadoConsulta, 'estado' | 'codigo' | 'mensaje'> | null
  cdr: Awaited<ReturnType<typeof leerCdr>> | null
  recuperado: boolean
}

async function verificarUno(id: string): Promise<ResultadoVerificacion> {
  const admin = createAdminClient()
  const { data: c } = await (admin as any).from('comprobantes')
    .select('id, serie, numero, tipo, fecha_emision, estado, enviado_sunat, sunat_modo, sunat_cdr')
    .eq('id', id).maybeSingle()
  if (!c) {
    return { id, comprobante: '', veredicto: 'no_aplica', resumen: 'El comprobante no existe', consulta: null, cdr: null, recuperado: false }
  }
  const nombre = `${c.serie}-${c.numero}`
  const base = { id, comprobante: nombre }

  if (!['factura', 'boleta'].includes(c.tipo)) {
    return { ...base, veredicto: 'no_aplica', resumen: `Los documentos de tipo "${c.tipo}" no se declaran a SUNAT.`, consulta: null, cdr: null, recuperado: false }
  }

  // La constancia guardada, si hay.
  let cdr: ResultadoVerificacion['cdr'] = null
  if (c.sunat_cdr) {
    try { cdr = await leerCdr(c.sunat_cdr, nombre) } catch { cdr = null }
  }

  const consulta = await consultarEnSunat(c)
  const yaDeclarado = !!c.enviado_sunat && c.sunat_modo === 'produccion'
  const patch: Record<string, unknown> = {
    sunat_verificado_at: new Date().toISOString(),
    sunat_verificacion: consulta.estado,
  }
  let recuperado = false
  let veredicto: Veredicto
  let resumen: string

  switch (consulta.estado) {
    case 'aceptado': {
      veredicto = 'ok'
      resumen = 'SUNAT lo tiene y está ACEPTADO.'
      if (!yaDeclarado) {
        // SUNAT lo tiene aunque el ERP no lo había anotado: se recupera.
        Object.assign(patch, {
          enviado_sunat: true,
          sunat_estado: 'aceptado',
          sunat_modo: 'produccion',
          sunat_codigo: consulta.cdrCodigo ?? '0',
          sunat_mensaje: consulta.cdrMensaje ?? consulta.mensaje,
        })
        recuperado = true
        resumen += ' El ERP no lo tenía anotado: se recuperó la constancia y quedó como declarado.'
      }
      if (!c.sunat_cdr && consulta.cdrZipBase64) {
        patch.sunat_cdr = consulta.cdrZipBase64
        try { cdr = await leerCdr(consulta.cdrZipBase64, nombre) } catch { /* se muestra sin CDR */ }
      }
      break
    }
    case 'rechazado':
      veredicto = 'problema'
      resumen = yaDeclarado
        ? 'ATENCIÓN: el ERP lo da por aceptado, pero SUNAT dice que está RECHAZADO. Revisar.'
        : 'SUNAT lo tiene RECHAZADO. Hay que corregirlo y emitir uno nuevo.'
      break
    case 'baja':
      veredicto = 'problema'
      resumen = 'SUNAT lo tiene DADO DE BAJA.'
      break
    case 'no_existe':
      if (yaDeclarado) {
        veredicto = 'problema'
        resumen = 'ATENCIÓN: el ERP lo da por aceptado, pero SUNAT no lo encuentra. Si se acaba de enviar, '
          + 'volver a verificar en unos minutos; si sigue igual, avisar a soporte antes de reenviar.'
      } else {
        const { data: fila } = await (admin as any).from('configuracion')
          .select('valor').eq('clave', 'sunat_dias_espera').maybeSingle()
        const envio = diaDeEnvio(c.fecha_emision, normalizarDiasEspera(fila?.valor))
        const vence = venceElPlazo(c.fecha_emision)
        const dmy = (f: string) => f.split('-').reverse().join('/')
        const hoy = hoyLima()
        veredicto = 'pendiente'
        if (hoy < envio) {
          resumen = `Todavía no se declaró: está en el plazo para corregir. Se declara solo el ${dmy(envio)}`
            + ` (plazo SUNAT: ${dmy(vence)}). Hasta entonces se puede editar o anular.`
        } else if (hoy <= vence) {
          resumen = `SUNAT todavía no lo tiene y ya debía declararse: vence el ${dmy(vence)}. Declararlo ahora.`
        } else {
          veredicto = 'problema'
          resumen = `FUERA DE PLAZO: SUNAT no lo tiene y el plazo venció el ${dmy(vence)}. Consultar con el contador.`
        }
        if (c.enviado_sunat) resumen += ' (Se había enviado solo en modo pruebas.)'
      }
      break
    default:
      veredicto = 'sin_consulta'
      resumen = `No se pudo consultar a SUNAT (${consulta.mensaje}).`
        + (cdr?.valido ? ' La constancia guardada sí confirma que fue aceptado.' : '')
  }

  await (admin as any).from('comprobantes').update(patch).eq('id', id)

  return {
    ...base, veredicto, resumen, recuperado, cdr,
    consulta: { estado: consulta.estado, codigo: consulta.codigo, mensaje: consulta.mensaje },
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: perfil } = await (supabase as any)
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!perfil || !ROLES.includes(perfil.role)) {
    return NextResponse.json({ error: 'Sin permisos para verificar comprobantes' }, { status: 403 })
  }

  const cuerpo = await req.json().catch(() => ({})) as { comprobante_id?: string; comprobante_ids?: string[] }
  const ids = cuerpo.comprobante_ids ?? (cuerpo.comprobante_id ? [cuerpo.comprobante_id] : [])
  if (ids.length === 0) return NextResponse.json({ error: 'Falta comprobante_id' }, { status: 400 })
  if (ids.length > TOPE) {
    return NextResponse.json({ error: `Se pueden verificar hasta ${TOPE} por vez` }, { status: 400 })
  }

  const resultados: ResultadoVerificacion[] = []
  for (const id of ids) {
    resultados.push(await verificarUno(id))
    // El servicio de consulta también limita el ritmo.
    if (ids.length > 1) await new Promise((r) => setTimeout(r, 400))
  }
  return NextResponse.json({ resultados })
}
