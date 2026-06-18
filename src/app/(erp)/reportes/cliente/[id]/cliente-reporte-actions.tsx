'use client'

import { useRouter } from 'next/navigation'
import { Printer, FileSpreadsheet, MessageCircle } from 'lucide-react'
import { construirLinkWhatsapp, esTelefonoPeruanoValido } from '@/lib/whatsapp'

export default function ClienteReporteActions({
  clienteId, clienteNombre, clienteTelefono, desde, hasta,
}: {
  clienteId: string
  clienteNombre: string
  clienteTelefono: string | null
  desde: string
  hasta: string
}) {
  const router = useRouter()
  const setRango = (k: 'desde' | 'hasta', v: string) => {
    const otros = k === 'desde' ? { hasta } : { desde }
    router.push(`/reportes/cliente/${clienteId}?desde=${k === 'desde' ? v : otros.desde}&hasta=${k === 'hasta' ? v : otros.hasta}`)
  }
  const hoyStr = new Date().toISOString().split('T')[0]
  const elAnio = `${new Date().getFullYear()}-01-01`
  const historiaCompleta = '2020-01-01'

  // WhatsApp link al reporte público (HTML) — el cliente lo abre, ve todo
  // bonito, y puede usar "Guardar como PDF" del navegador.
  const telOk = esTelefonoPeruanoValido(clienteTelefono ?? '')
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const reporteUrl = `${baseUrl}/reporte-publico/cliente/${clienteId}?desde=${desde}&hasta=${hasta}`
  const mensaje =
    `Hola ${clienteNombre}, te compartimos tu reporte de compras con AGROCAR.\n` +
    `Período: del ${desde} al ${hasta}.\n\n` +
    `Ver reporte: ${reporteUrl}\n\n` +
    `— AGROCAR S.R.L.`
  const waLink = telOk
    ? construirLinkWhatsapp(clienteTelefono!, mensaje)
    : null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => router.push(`/reportes/cliente/${clienteId}?desde=${historiaCompleta}&hasta=${hoyStr}`)}
          className="px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20"
          title="Toda la historia (desde 2020)"
        >
          Todo
        </button>
        <button
          type="button"
          onClick={() => router.push(`/reportes/cliente/${clienteId}?desde=${elAnio}&hasta=${hoyStr}`)}
          className="px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20"
        >
          Este año
        </button>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <label className="text-gray-300">Desde:</label>
        <input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => setRango('desde', e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black"
        />
        <label className="text-gray-300 ml-1">Hasta:</label>
        <input
          type="date"
          value={hasta}
          min={desde}
          max={hoyStr}
          onChange={(e) => setRango('hasta', e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black"
        />
      </div>
      <a
        href={`/api/reportes/cliente/${clienteId}/excel?desde=${desde}&hasta=${hasta}`}
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
          WhatsApp
        </a>
      ) : (
        <span
          title="El cliente no tiene un teléfono celular peruano válido cargado en su ficha"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-gray-400 bg-gray-700/40 rounded-md cursor-not-allowed"
        >
          <MessageCircle className="w-3 h-3" />
          WhatsApp
        </span>
      )}
    </div>
  )
}
