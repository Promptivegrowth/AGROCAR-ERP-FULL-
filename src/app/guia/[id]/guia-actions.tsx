'use client'

import { Printer } from 'lucide-react'
import EnviarDocumento from '@/components/erp/enviar-documento'

export default function GuiaActions({ guiaId, numero, conXml = false, conCdr = false, cliente, telefono, email }: {
  guiaId: string; numero: string; conXml?: boolean; conCdr?: boolean
  cliente?: string | null; telefono?: string | null; email?: string | null
}) {
  return (
    <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5 mb-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="font-bold text-gray-900 text-sm">Guía de Remisión Electrónica</h1>
          <p className="text-[11px] text-gray-500 font-mono">{numero}</p>
        </div>
        <div className="flex items-center gap-3">
        {/* Para mandar al cliente o al chofer: PDF con Imprimir; XML y constancia, acá. */}
        {conXml && (
          <a href={`/api/documentos/guia/${guiaId}/xml`} className="text-xs text-blue-700 underline hover:text-blue-900">XML</a>
        )}
        {conCdr && (
          <a href={`/api/documentos/guia/${guiaId}/cdr`} className="text-xs text-blue-700 underline hover:text-blue-900">Constancia SUNAT</a>
        )}
        <EnviarDocumento tipo="guia" id={guiaId} titulo={`Guía de remisión ${numero}`}
          cliente={cliente} telefono={telefono} email={email} conXml={conXml} conCdr={conCdr} />
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
        >
          <Printer className="w-3.5 h-3.5" />
          Imprimir / PDF
        </button>
        </div>
      </div>
    </div>
  )
}
