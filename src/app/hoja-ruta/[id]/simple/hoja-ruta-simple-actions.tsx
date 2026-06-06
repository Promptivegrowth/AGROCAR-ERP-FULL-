'use client'

import Link from 'next/link'
import { Printer, FileText, Package2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function HojaRutaSimpleActions({ despachoId }: { despachoId: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link href={`/hoja-ruta/${despachoId}`}>
        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
          <FileText className="w-3.5 h-3.5" /> Vista premium
        </Button>
      </Link>
      <Link href={`/hoja-ruta/${despachoId}/almacen`}>
        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs text-blue-700 border-blue-300 hover:bg-blue-50">
          <Package2 className="w-3.5 h-3.5" /> Consolidado almacén
        </Button>
      </Link>
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
