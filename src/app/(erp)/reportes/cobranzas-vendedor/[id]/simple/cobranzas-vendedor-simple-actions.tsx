'use client'

import Link from 'next/link'
import { Printer, FileText, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CobranzasVendedorSimpleActions({ vendedorId }: { vendedorId: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link href={`/reportes/cobranzas-vendedor/${vendedorId}`}>
        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
          <FileText className="w-3.5 h-3.5" /> Vista premium
        </Button>
      </Link>
      <a
        href={`/api/reportes/cobranzas-vendedor/${vendedorId}/excel`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-green-700 rounded-md hover:bg-green-800"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
      </a>
      <Button
        size="sm"
        onClick={() => window.print()}
        className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 h-8 text-xs"
      >
        <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
      </Button>
    </div>
  )
}
