'use client'

import { Printer, FileSpreadsheet, MessageCircle } from 'lucide-react'
import { construirLinkWhatsapp, esTelefonoPeruanoValido } from '@/lib/whatsapp'
import { formatCurrency } from '@/lib/utils'

export default function CobranzasClienteActions({
  clienteId, clienteNombre, clienteTelefono, saldo, aFavor = 0,
}: {
  clienteId: string
  clienteNombre: string
  clienteTelefono: string | null
  saldo: number
  aFavor?: number
}) {
  const telOk = esTelefonoPeruanoValido(clienteTelefono ?? '')
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const reporteUrl = `${baseUrl}/reporte-publico/estado-cuenta/${clienteId}`
  const mensaje = saldo > 0
    ? `Hola ${clienteNombre}, te compartimos tu estado de cuenta con AGROCAR.\n` +
      `Saldo pendiente: S/ ${saldo.toFixed(2)}\n\n` +
      `Detalle: ${reporteUrl}\n\n` +
      `Si ya realizaste tu pago, por favor envíanos el comprobante. ¡Gracias!\n` +
      `— AGROCAR S.R.L.`
    : `Hola ${clienteNombre}, te compartimos tu estado de cuenta con AGROCAR.\n` +
      `✓ Cuenta al día — sin saldo pendiente.\n` +
      // Si pago por adelantado conviene que lo sepa: evita el reclamo de
      // "yo ya te pague" cuando llegue la proxima boleta con el descuento.
      (aFavor > 0.01 ? `Tienes S/ ${aFavor.toFixed(2)} a favor para tu proxima compra.\n` : '') +
      `\nDetalle: ${reporteUrl}\n\n` +
      `¡Gracias por tu confianza!\n— AGROCAR S.R.L.`
  const waLink = telOk ? construirLinkWhatsapp(clienteTelefono!, mensaje) : null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={`/api/reportes/cobranzas-cliente/${clienteId}/excel`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-green-700 rounded-md hover:bg-green-800"
      >
        <FileSpreadsheet className="w-3 h-3" />
        Excel
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
      >
        <Printer className="w-3 h-3" />
        PDF
      </button>
      {waLink ? (
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700"
          title={`Enviar a ${clienteTelefono}`}
        >
          <MessageCircle className="w-3 h-3" />
          WhatsApp ({formatCurrency(saldo)})
        </a>
      ) : (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-gray-400 bg-gray-700/40 rounded-md cursor-not-allowed"
          title="El cliente no tiene un teléfono celular peruano válido cargado">
          <MessageCircle className="w-3 h-3" />
          WhatsApp
        </span>
      )}
    </div>
  )
}
