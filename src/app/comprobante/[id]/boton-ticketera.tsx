'use client'

import { useEffect, useState } from 'react'
import { Printer, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  equiposDisponibles, equipoElegido, guardarEquipo, encolarTicket, esperarImpresion,
  conectado, type Equipo,
} from '@/lib/cola-impresion'
import { construirTicket, type DatosTicket } from '@/lib/ticket-comprobante'

/**
 * Imprime el ticket en la ticketera, sin pasar por el diálogo del navegador.
 *
 * El ticket se arma acá en ESC/POS y se deja en la cola; el agente de la
 * computadora elegida lo levanta e imprime, normalmente en menos de un segundo.
 * El corte lo decide el ticket y no el driver, así que no sobra papel.
 *
 * Si no hay ninguna computadora registrada el botón no aparece y queda el de
 * siempre: nadie se queda sin poder imprimir.
 */
export default function BotonTicketera({ datos }: { datos: DatosTicket }) {
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [elegido, setElegido] = useState<string>('')
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'impreso'>('listo')

  useEffect(() => {
    let vivo = true
    equiposDisponibles().then((lista) => {
      if (!vivo) return
      setEquipos(lista)
      const guardado = equipoElegido()
      const valido = guardado && lista.some((e) => e.id === guardado) ? guardado : null
      setElegido(valido ?? lista[0]?.id ?? '')
    })
    return () => { vivo = false }
  }, [])

  if (equipos.length === 0) return null

  const imprimir = async () => {
    if (!elegido) { toast.error('Elegí en qué computadora imprimir'); return }
    setEstado('enviando')
    try {
      const ticket = await construirTicket(datos, true)
      const r = await encolarTicket(ticket.aBase64(), elegido, datos.serieNumero)
      if (!r.ok) {
        toast.error('No se pudo enviar', { description: r.error })
        setEstado('listo')
        return
      }

      const fin = await esperarImpresion(r.id)
      if (fin === 'impreso') {
        setEstado('impreso')
        setTimeout(() => setEstado('listo'), 2500)
        toast.success('Ticket impreso')
      } else if (fin === 'error') {
        setEstado('listo')
        toast.error('La ticketera no pudo imprimirlo', {
          description: 'Revisá que esté encendida y con papel.',
        })
      } else {
        setEstado('listo')
        const eq = equipos.find((e) => e.id === elegido)
        toast.warning('Enviado, esperando a la ticketera', {
          description: eq && conectado(eq)
            ? 'Debería salir en un momento.'
            : `${eq?.nombre ?? 'Esa computadora'} no está conectada. El ticket sale cuando se encienda.`,
        })
      }
    } catch (e: any) {
      setEstado('listo')
      toast.error('No se pudo armar el ticket', { description: e?.message })
    }
  }

  return (
    <div className="flex items-center gap-2">
      {equipos.length > 1 && (
        <select
          value={elegido}
          onChange={(e) => { setElegido(e.target.value); guardarEquipo(e.target.value) }}
          className="h-8 max-w-[190px] px-2 text-xs border border-gray-300 rounded-md bg-white"
          title="En qué computadora se imprime"
        >
          {equipos.map((e) => (
            <option key={e.id} value={e.id}>
              {conectado(e) ? '● ' : '○ '}{e.nombre}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={imprimir}
        disabled={estado === 'enviando'}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-60"
      >
        {estado === 'enviando' ? <Loader2 className="w-4 h-4 animate-spin" />
          : estado === 'impreso' ? <CheckCircle2 className="w-4 h-4" />
          : <Printer className="w-4 h-4" />}
        {estado === 'enviando' ? 'Imprimiendo…' : estado === 'impreso' ? 'Impreso' : 'Imprimir en ticketera'}
      </button>
    </div>
  )
}
