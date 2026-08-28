/**
 * Contra qué servicio de SUNAT se habla, y con qué credenciales.
 *
 * Este archivo existe por una sola razón: que un envío a producción nunca
 * pueda salir por descuido. Un comprobante enviado a producción queda
 * declarado ante SUNAT y no se deshace —para dejarlo sin efecto hay que emitir
 * una nota de crédito o una comunicación de baja, con su propio plazo—, así
 * que la barrera tiene que estar acá, en un solo lugar, y no repartida por
 * cada pantalla que llame al envío.
 *
 * Producción exige DOS condiciones a la vez, y ninguna alcanza sola:
 *
 *   1. `sunat_modo` = 'produccion' en la configuración del ERP
 *   2. las credenciales SOL de producción cargadas en el servidor
 *
 * Si falta cualquiera de las dos, se envía a beta. Un descuido en un solo
 * lugar no puede emitir nada real.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { abrirCertificado, type Certificado, type ModoSunat } from './firma'

export interface ConfiguracionSunat {
  modo: ModoSunat
  usuario: string
  clave: string
  certificado: Certificado
  envioAutomatico: boolean
  /** Por qué quedó en este modo. Se muestra en pantalla para que nadie dude. */
  razon: string
}

/** El emisor, tal como SUNAT lo tiene registrado. */
export const EMISOR_SUNAT = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
  direccion: 'CAL. EMILIO FORERO NRO 553A - TACNA',
}

/**
 * En beta el usuario es el RUC seguido de MODDATOS, con esa misma palabra como
 * clave. Es público y es igual para todos: por eso nada de lo que se manda ahí
 * queda declarado.
 */
const BETA = { usuario: `${EMISOR_SUNAT.ruc}MODDATOS`, clave: 'MODDATOS' }

function leerCertificado(): Certificado {
  const b64 = process.env.SUNAT_CERT_BASE64
  const clave = process.env.SUNAT_CERT_PASSWORD
  if (!b64) throw new Error('Falta SUNAT_CERT_BASE64: el certificado digital no está cargado en el servidor')
  if (!clave) throw new Error('Falta SUNAT_CERT_PASSWORD')

  const cert = abrirCertificado(Buffer.from(b64, 'base64'), clave)

  // Un certificado vencido rechaza todo lo que firme, y el mensaje de SUNAT no
  // dice que sea eso. Mejor enterarse acá.
  if (cert.vence < new Date()) {
    throw new Error(`El certificado digital venció el ${cert.vence.toISOString().slice(0, 10)}`)
  }
  return cert
}

export async function configuracionSunat(): Promise<ConfiguracionSunat> {
  const supabase = createAdminClient()
  const { data } = await (supabase as any)
    .from('configuracion')
    .select('clave, valor')
    .in('clave', ['sunat_modo', 'sunat_envio_automatico'])

  const conf: Record<string, string> = {}
  ;((data ?? []) as { clave: string; valor: string }[]).forEach((c) => { conf[c.clave] = c.valor })

  const quiereProduccion = conf.sunat_modo === 'produccion'
  const usuarioSol = process.env.SUNAT_USUARIO_SOL
  const claveSol = process.env.SUNAT_CLAVE_SOL
  const hayCredenciales = !!(usuarioSol && claveSol)

  const certificado = leerCertificado()
  const envioAutomatico = conf.sunat_envio_automatico === 'true'

  if (quiereProduccion && hayCredenciales) {
    return {
      modo: 'produccion',
      // SUNAT espera el RUC pegado al usuario secundario: 20519883296USERFAC4.
      usuario: `${EMISOR_SUNAT.ruc}${usuarioSol}`,
      clave: claveSol!,
      certificado,
      envioAutomatico,
      razon: 'Modo producción: los comprobantes quedan declarados ante SUNAT.',
    }
  }

  return {
    modo: 'beta',
    usuario: BETA.usuario,
    clave: BETA.clave,
    certificado,
    envioAutomatico,
    razon: quiereProduccion
      ? 'Se pidió producción pero faltan las credenciales SOL en el servidor. Se envía a beta: nada queda declarado.'
      : 'Modo pruebas: nada de lo que se envía queda declarado ante SUNAT.',
  }
}
