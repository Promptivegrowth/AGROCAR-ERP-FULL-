'use client'

import Link from 'next/link'
import { Printer, FileText, Package2, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function HojaRutaSimpleActions({ despachoId }: { despachoId: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link href={`/hoja-ruta/${despachoId}`}>
        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
          <FileText className="w-3.5 h-3.5" /> Vista premium
        </Button>
      </Link>
      {/*
        Lo pidio Daniel, escrito a mano sobre una hoja de ruta: "agregar switch
        para poder imprimir solo de este carro". En un reparto salen entre 70 y
        100 comprobantes; imprimirlos todos juntos y separarlos despues en
        pilas por camion es media hora de trabajo manual.

        Va aca y no en Facturacion porque aca es donde esta parado el que lo
        necesita: con la hoja del camion en la mano.
      */}
      <Link href={`/comprobante/imprimir-lote?despacho=${despachoId}`} target="_blank">
        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50">
          <Receipt className="w-3.5 h-3.5" /> Comprobantes de este carro
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
