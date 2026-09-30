/**
 * Con qué credenciales y contra qué se declara una guía de remisión.
 *
 * Existe por la misma razón que `config.ts` para las facturas: que una guía no
 * pueda declararse por descuido. Y acá pesa más, porque la guía **no tiene
 * ambiente de pruebas**. El servicio REST de SUNAT es uno solo: lo que se
 * manda, queda.
 *
 * Por eso la condición para enviar es más estricta que la de los comprobantes.
 * Hacen falta las tres cosas a la vez:
 *
 *   1. `gre_activo` = 'true' en la configuración del ERP
 *   2. las credenciales de la API cargadas en el servidor
 *   3. las credenciales SOL, que la API pide además de las de la aplicación
 *
 * Si falta cualquiera, no se envía nada y se explica cuál falta. No hay un
 * modo "beta" al que caer: o se declara de verdad, o no se declara.
 *
 * Para probar el XML sin declarar está el servicio beta de guías por SOAP
 * —`scripts/gre-probar-en-beta.ts`—, que valida la estructura y no registra
 * nada.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { abrirCertificado, type Certificado } from './firma'
import type { CredencialesGre } from './gre-envio'

/** El emisor, tal como SUNAT lo tiene registrado. */
export const EMISOR_GRE = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
}

export interface ConfiguracionGre {
  /** Si no está listo, `motivo` dice qué falta. */
  listo: boolean
  motivo: string
  credenciales?: CredencialesGre
  certificado?: Certificado
  /** Desde qué fecha se declaran guías. Lo anterior no se toca. */
  declararDesde: string | null
}

function leerCertificado(): Certificado {
  const b64 = process.env.SUNAT_CERT_BASE64
  const clave = process.env.SUNAT_CERT_PASSWORD
  if (!b64) throw new Error('Falta SUNAT_CERT_BASE64: el certificado digital no está cargado en el servidor')
  if (!clave) throw new Error('Falta SUNAT_CERT_PASSWORD')
  return abrirCertificado(Buffer.from(b64, 'base64'), clave)
}

export async function configuracionGre(): Promise<ConfiguracionGre> {
  const supabase = createAdminClient()
  const { data } = await (supabase as any)
    .from('configuracion').select('clave, valor')
    .in('clave', ['gre_activo', 'gre_declarar_desde'])

  const conf: Record<string, string> = {}
  ;((data ?? []) as { clave: string; valor: string }[]).forEach((c) => { conf[c.clave] = c.valor })

  const declararDesde = /^\d{4}-\d{2}-\d{2}$/.test(conf.gre_declarar_desde ?? '')
    ? conf.gre_declarar_desde
    : null

  const clientId = process.env.SUNAT_GRE_CLIENT_ID
  const clientSecret = process.env.SUNAT_GRE_CLIENT_SECRET
  const usuarioSol = process.env.SUNAT_USUARIO_SOL
  const claveSol = process.env.SUNAT_CLAVE_SOL

  const faltan: string[] = []
  if (conf.gre_activo !== 'true') faltan.push('el envío de guías está apagado en la configuración')
  if (!clientId || !clientSecret) faltan.push('faltan las credenciales de la API (SUNAT_GRE_CLIENT_ID / SUNAT_GRE_CLIENT_SECRET)')
  if (!usuarioSol || !claveSol) faltan.push('faltan las credenciales SOL (SUNAT_USUARIO_SOL / SUNAT_CLAVE_SOL)')

  if (faltan.length > 0) {
    return {
      listo: false,
      motivo: `No se declara ninguna guía: ${faltan.join('; ')}.`,
      declararDesde,
    }
  }

  let certificado: Certificado
  try {
    certificado = leerCertificado()
  } catch (e) {
    return {
      listo: false,
      motivo: e instanceof Error ? e.message : 'No se pudo leer el certificado',
      declararDesde,
    }
  }

  return {
    listo: true,
    motivo: declararDesde
      ? `Guías activas desde el ${declararDesde}: lo emitido antes no se declara.`
      : 'Guías activas, pero sin fecha de inicio: hasta fijarla no se declara ninguna.',
    credenciales: {
      clientId: clientId!,
      clientSecret: clientSecret!,
      usuarioSol: usuarioSol!,
      claveSol: claveSol!,
      ruc: EMISOR_GRE.ruc,
    },
    certificado,
    declararDesde,
  }
}
