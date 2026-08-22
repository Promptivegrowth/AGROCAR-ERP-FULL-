'use client'

import { useEffect, useState } from 'react'
import { Printer, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  estadoAgente, imprimirEscPos, impresoraElegida, guardarImpresora, adivinarTicketera,
} from '@/lib/agente-impresion'
import { construirTicket, type DatosTicket } from '@/lib/ticket-comprobante'

/**
 * Impresión del ticket por la ticketera, sin pasar por el navegador.
 *
 * El diálogo de impresión de Windows manda la página al driver, que la
 * convierte en imagen y corta según el tamaño de papel configurado, agregando
 * su propio margen: eso es el papel que sobraba en cada venta. Este botón manda
 * el ticket en ESC/POS al agente local, que se lo pasa a la impresora en crudo,
 * y el corte lo decide el propio ticket.
 *
 * Si el agente no está corriendo el botón no aparece, y queda el de siempre.
 * Nadie se queda sin poder imprimir porque un programa auxiliar esté apagado.
 */
export default function BotonTicketera({ datos }: { datos: DatosTicket }) {
  const [disponible, setDisponible] = useState(false)
  const [impresoras, setImpresoras] = useState<string[]>([])
  const [elegida, setElegida] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    let vivo = true
    estadoAgente().then((e) => {
      if (!vivo) return
      setDisponible(e.disponible)
      setImpresoras(e.impresoras)
      const guardada = impresoraElegida()
      const valida = guardada && e.impresoras.includes(guardada) ? guardada : null
      setElegida(valida ?? adivinarTicketera(e.impresoras))
    })
    return () => { vivo = false }
  }, [])

  if (!disponible) return null

  const imprimir = async () => {
    setEnviando(true)
    try {
      const ticket = await construirTicket(datos, true)
      const r = await imprimirEscPos(ticket.aBase64(), elegida)
      if (r.ok) {
        setListo(true)
        setTimeout(() => setListo(false), 2500)
        toast.success('Ticket enviado a la ticketera', {
          description: `${r.bytes} bytes · corte automático`,
        })
      } else if (r.motivo === 'sin-agente') {
        setDisponible(false)
        toast.error('El agente de impresión se cerró', {
          description: 'Usá "Imprimir / Guardar como PDF" mientras tanto.',
        })
      } else {
        toast.error('No se pudo imprimir', { description: r.detalle })
      }
    } catch (e: any) {
      toast.error('No se pudo armar el ticket', { description: e?.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {impresoras.length > 1 && (
        <select
          value={elegida ?? ''}
          onChange={(e) => { setElegida(e.target.value); guardarImpresora(e.target.value) }}
          className="h-8 max-w-[190px] px-2 text-xs border border-gray-300 rounded-md bg-white"
          title="Impresora de tickets de esta computadora"
        >
          <option value="">Elegir impresora…</option>
          {impresoras.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
      <button
        type="button"
        onClick={imprimir}
        disabled={enviando}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-60"
      >
        {enviando ? <Loader2 className="w-4 h-4 animate-spin" />
          : listo ? <CheckCircle2 className="w-4 h-4" />
          : <Printer className="w-4 h-4" />}
        {enviando ? 'Enviando…' : listo ? 'Impreso' : 'Imprimir en ticketera'}
      </button>
    </div>
  )
}
