'use client'

import { Printer, FileSpreadsheet, MessageCircle } from 'lucide-react'
import { construirLinkWhatsapp, esTelefonoPeruanoValido } from '@/lib/whatsapp'
import { formatCurrency } from '@/lib/utils'
import { useOrigen } from '@/lib/use-origen'
import { mensajeEstadoCuenta, type PendienteMensaje } from '@/lib/mensaje-estado-cuenta'

export default function CobranzasClienteActions({
  clienteId, clienteNombre, clienteTelefono, saldo, aFavor = 0, pendientes = [],
}: {
  clienteId: string
  clienteNombre: string
  clienteTelefono: string | null
  saldo: number
  aFavor?: number
  pendientes?: PendienteMensaje[]
}) {
  const origen = useOrigen()
  const telOk = esTelefonoPeruanoValido(clienteTelefono ?? '')
  const mensaje = mensajeEstadoCuenta({
    clienteNombre,
    saldo,
    aFavor,
    pendientes,
    reporteUrl: `${origen}/reporte-publico/estado-cuenta/${clienteId}`,
    hoy: new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima' }),
  })
  // Sin el origen todavía, no se arma: saldría un enlace sin dominio.
  const waLink = telOk && origen ? construirLinkWhatsapp(clienteTelefono!, mensaje) : null

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
          data-whatsapp-estado
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
