'use client'

import { useEffect, useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { normalizarTelefonoPeruano } from '@/lib/whatsapp'

/**
 * Mandar un comprobante o una guía al cliente, por WhatsApp o por correo.
 *
 * Daniel, 01/10: "todos los comprobantes deben estar listos para enviar al
 * cliente ya sea por correo o WhatsApp". El mensaje lleva los enlaces al PDF,
 * al XML y a la constancia de SUNAT: las páginas abren sin usuario, así que el
 * cliente descarga lo que necesite desde su celular o su correo.
 *
 * WhatsApp abre la conversación con el celular del cliente si lo tiene
 * registrado; si no, deja elegir el contacto. El correo abre el programa de
 * correo de la computadora con todo ya escrito (no hace falta un servicio de
 * envío propio).
 */
export interface EnviarDocumentoProps {
  tipo: 'comprobante' | 'guia'
  id: string
  /** "Factura F002-00000015", "Guía de remisión T002-00000007" */
  titulo: string
  cliente?: string | null
  total?: number | null
  telefono?: string | null
  email?: string | null
  conXml?: boolean
  conCdr?: boolean
  /** Botones chicos, solo ícono: para las filas de una lista. */
  compacto?: boolean
}

export function armarMensaje(p: EnviarDocumentoProps, origen: string): { asunto: string; cuerpo: string } {
  const pdf = p.tipo === 'guia' ? `${origen}/guia/${p.id}` : `${origen}/comprobante/${p.id}?formato=a4`
  const lineas = [
    `Hola${p.cliente ? ` ${p.cliente}` : ''}, le enviamos su ${p.titulo} de AGROCAR S.R.L.`,
    ...(p.total != null ? [`Importe: S/ ${Number(p.total).toFixed(2)}`] : []),
    '',
    `PDF: ${pdf}`,
    ...(p.conXml ? [`XML: ${origen}/api/documentos/${p.tipo}/${p.id}/xml`] : []),
    ...(p.conCdr ? [`Constancia SUNAT (CDR): ${origen}/api/documentos/${p.tipo}/${p.id}/cdr`] : []),
    '',
    'Gracias por su preferencia.',
    'AGROCAR S.R.L. · RUC 20519883296',
  ]
  return { asunto: `${p.titulo} - AGROCAR S.R.L.`, cuerpo: lineas.join('\n') }
}

export default function EnviarDocumento(props: EnviarDocumentoProps) {
  // El origen se lee en el navegador: así los enlaces sirven igual en
  // producción y en pruebas.
  const [origen, setOrigen] = useState('')
  useEffect(() => { setOrigen(window.location.origin) }, [])
  if (!origen) return null

  const { asunto, cuerpo } = armarMensaje(props, origen)
  const tel = normalizarTelefonoPeruano(props.telefono)
  const wa = tel
    ? `https://wa.me/51${tel}?text=${encodeURIComponent(cuerpo)}`
    : `https://wa.me/?text=${encodeURIComponent(cuerpo)}`
  const correo = `mailto:${encodeURIComponent(props.email?.trim() ?? '')}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`

  const base = props.compacto
    ? 'inline-flex items-center justify-center h-7 w-7 rounded-md text-xs font-semibold'
    : 'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold'
  return (
    <span className="no-print print:hidden inline-flex items-center gap-1.5" data-enviar-documento>
      <a href={wa} target="_blank" rel="noopener noreferrer"
        className={`${base} bg-[#25D366] hover:bg-[#1FB659] text-white`}
        title={tel ? `Enviar por WhatsApp al ${tel}` : 'Enviar por WhatsApp (elegir contacto)'}
        data-whatsapp>
        <Send className="w-3.5 h-3.5" />{!props.compacto && 'WhatsApp'}
      </a>
      <a href={correo}
        className={`${base} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}
        title={props.email ? `Enviar por correo a ${props.email}` : 'Enviar por correo'}
        data-correo>
        <Mail className="w-3.5 h-3.5" />{!props.compacto && 'Correo'}
      </a>
    </span>
  )
}
