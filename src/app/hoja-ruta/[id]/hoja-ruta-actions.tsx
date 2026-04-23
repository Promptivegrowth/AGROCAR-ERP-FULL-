'use client'

import { Printer, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function HojaRutaActions({ telefono, numero }: { telefono: string | null; numero: string }) {
  const imprimir = () => window.print()

  const enviarWhatsapp = () => {
    if (!telefono) return
    const url = `https://wa.me/51${telefono}?text=${encodeURIComponent(
      `Hola, te comparto la hoja de ruta *${numero}* de AGROCAR. Revisa el detalle en tu sistema.`,
    )}`
    window.open(url, '_blank')
  }

  return (
    <div className="flex items-center gap-2">
      {telefono && (
        <Button onClick={enviarWhatsapp} variant="outline" className="gap-2 text-green-700 border-green-300 hover:bg-green-50">
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </Button>
      )}
      <Button onClick={imprimir} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
        <Printer className="w-4 h-4" /> Imprimir / PDF
      </Button>
    </div>
  )
}
