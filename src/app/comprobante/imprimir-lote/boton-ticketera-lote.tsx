'use client'

import { useEffect, useState } from 'react'
import { Printer, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  estadoAgente, imprimirEscPos, impresoraElegida, guardarImpresora, adivinarTicketera,
} from '@/lib/agente-impresion'
import { construirTicket, type DatosTicket } from '@/lib/ticket-comprobante'

/**
 * Impresión por lote directa a la ticketera.
 *
 * Los tickets se mandan de a uno, cada uno con su propio corte. Es a propósito:
 * si se mandaran todos juntos en un solo envío, la impresora los trata como un
 * documento y algunos drivers cortan una sola vez al final, que es justo el
 * problema que Daniel reportó al imprimir dos boletas y recibirlas pegadas.
 *
 * Además, mandando de a uno, si falla el número siete se sabe cuál fue y los
 * seis anteriores ya salieron.
 */
export default function BotonTicketeraLote({ tickets }: { tickets: DatosTicket[] }) {
  const [disponible, setDisponible] = useState(false)
  const [impresoras, setImpresoras] = useState<string[]>([])
  const [elegida, setElegida] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<number | null>(null)
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

  if (!disponible || tickets.length === 0) return null

  const imprimirTodos = async () => {
    setProgreso(0)
    let fallidos = 0
    let ultimoError = ''

    for (let i = 0; i < tickets.length; i++) {
      setProgreso(i + 1)
      try {
        const t = await construirTicket(tickets[i], true)
        const r = await imprimirEscPos(t.aBase64(), elegida)
        if (!r.ok) {
          fallidos++
          ultimoError = r.motivo === 'sin-agente' ? 'el agente se cerró' : (r.detalle ?? 'error')
          if (r.motivo === 'sin-agente') break
        }
      } catch (e: any) {
        fallidos++
        ultimoError = e?.message ?? 'error al armar el ticket'
      }
      // Un respiro entre tickets: el búfer de estas impresoras es chico y
      // encimarlos hace que se pierda alguno.
      await new Promise((r) => setTimeout(r, 350))
    }

    setProgreso(null)
    const salieron = tickets.length - fallidos
    if (fallidos === 0) {
      setListo(true)
      setTimeout(() => setListo(false), 3000)
      toast.success(`${salieron} ticket${salieron === 1 ? '' : 's'} impreso${salieron === 1 ? '' : 's'}`, {
        description: 'Cada uno con su corte',
      })
    } else {
      toast.error(`Salieron ${salieron} de ${tickets.length}`, { description: ultimoError })
    }
  }

  const enCurso = progreso !== null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {impresoras.length > 1 && (
        <select
          value={elegida ?? ''}
          onChange={(e) => { setElegida(e.target.value); guardarImpresora(e.target.value) }}
          className="h-9 max-w-[190px] px-2 text-xs border border-gray-300 rounded-md bg-white"
          title="Impresora de tickets de esta computadora"
        >
          <option value="">Elegir impresora…</option>
          {impresoras.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
      <button
        type="button"
        onClick={imprimirTodos}
        disabled={enCurso}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-70"
      >
        {enCurso ? <Loader2 className="w-4 h-4 animate-spin" />
          : listo ? <CheckCircle2 className="w-4 h-4" />
          : <Printer className="w-4 h-4" />}
        {enCurso
          ? `Imprimiendo ${progreso} de ${tickets.length}…`
          : listo
            ? 'Impresos'
            : `Imprimir ${tickets.length} en ticketera`}
      </button>
    </div>
  )
}
