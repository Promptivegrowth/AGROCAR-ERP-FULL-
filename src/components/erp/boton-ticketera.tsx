'use client'

import { useEffect, useState } from 'react'
import { Printer, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  equiposDisponibles, equipoElegido, guardarEquipo, encolarTicket, esperarImpresion,
  conectado, type Equipo,
} from '@/lib/cola-impresion'
import { ticketDesdeNodo } from '@/lib/ticket-imagen'

/**
 * Espera a que las imágenes del ticket estén cargadas.
 *
 * El logo y el QR son imágenes: si se dibuja el ticket antes de que terminen
 * de cargar, salen en blanco y el comprobante se imprime sin ellas — sin dar
 * ningún error.
 */
async function imagenesListas() {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.ticket-imprimible img'))
  await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise<void>((listo) => {
    img.addEventListener('load', () => listo(), { once: true })
    img.addEventListener('error', () => listo(), { once: true })
  })))
}

/**
 * Imprime en la ticketera lo que se está viendo, sin pasar por el diálogo del
 * navegador.
 *
 * Toma los tickets de la propia pantalla —los nodos marcados como
 * `ticket-imprimible`—, los dibuja y los deja en la cola; el agente de la
 * computadora elegida los levanta e imprime, normalmente en menos de un
 * segundo. El corte lo decide el ticket y no el driver, así que no sobra papel.
 *
 * Sirve igual para un comprobante suelto que para un lote: la diferencia es
 * cuántos nodos hay en la pantalla.
 *
 * Si no hay ninguna computadora registrada el botón no aparece y queda el de
 * siempre: nadie se queda sin poder imprimir.
 */
export default function BotonTicketera({ auto = false }: { auto?: boolean } = {}) {
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [elegido, setElegido] = useState<string>('')
  const [cuantos, setCuantos] = useState(0)
  const [progreso, setProgreso] = useState<number | null>(null)
  const [listo, setListo] = useState(false)
  const [yaSalio, setYaSalio] = useState(false)

  const imprimir = async () => {
    if (!elegido) { toast.error('Elige en qué computadora imprimir'); return }
    const nodos = Array.from(document.querySelectorAll<HTMLElement>('.ticket-imprimible'))
    if (nodos.length === 0) { toast.error('No hay ningún ticket en pantalla'); return }

    setProgreso(0)
    await imagenesListas()
    const ids: string[] = []
    try {
      for (let i = 0; i < nodos.length; i++) {
        const ticket = await ticketDesdeNodo(nodos[i])
        const r = await encolarTicket(
          ticket.aBase64(),
          elegido,
          nodos[i].dataset.comprobante ?? undefined,
        )
        if (!r.ok) {
          toast.error(`No se pudo enviar ${nodos[i].dataset.comprobante ?? 'el ticket'}`, { description: r.error })
          setProgreso(null)
          return
        }
        ids.push(r.id)
        setProgreso(i + 1)
      }
    } catch (e: any) {
      setProgreso(null)
      toast.error('No se pudo preparar el ticket', { description: e?.message })
      return
    }

    // Se espera solo al último: la ticketera los imprime en orden, así que si
    // ese salió, salieron todos.
    const fin = await esperarImpresion(ids[ids.length - 1], 10 + ids.length * 3)
    setProgreso(null)

    if (fin === 'impreso') {
      setListo(true)
      setTimeout(() => setListo(false), 2500)
      toast.success(ids.length === 1 ? 'Ticket impreso' : `${ids.length} tickets impresos`)
    } else if (fin === 'error') {
      toast.error('La ticketera no pudo imprimirlo', {
        description: 'Revisa que esté encendida y con papel.',
      })
    } else {
      const eq = equipos.find((e) => e.id === elegido)
      toast.warning('Enviado, esperando a la ticketera', {
        description: eq && conectado(eq)
          ? 'Debería salir en un momento.'
          : `${eq?.nombre ?? 'Esa computadora'} no está conectada. Sale cuando se encienda.`,
      })
    }
  }

  useEffect(() => {
    let vivo = true
    equiposDisponibles().then((lista) => {
      if (!vivo) return
      setEquipos(lista)
      const guardado = equipoElegido()
      const valido = guardado && lista.some((e) => e.id === guardado) ? guardado : null
      setElegido(valido ?? lista[0]?.id ?? '')
    })
    setCuantos(document.querySelectorAll('.ticket-imprimible').length)
    return () => { vivo = false }
  }, [])

  /**
   * Cuando la pantalla se abrió justamente para imprimir —el lote, que llega
   * desde el botón de Facturación— no hay nada más que preguntar: esa ya es la
   * orden. Sale solo, sin que nadie apriete nada.
   */
  useEffect(() => {
    if (!auto || !elegido || yaSalio) return
    setYaSalio(true)
    let cancelado = false
    void (async () => {
      await imagenesListas()
      if (!cancelado) void imprimir()
    })()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, elegido])

  if (equipos.length === 0 || cuantos === 0) return null

  const enCurso = progreso !== null

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
        disabled={enCurso}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-60"
      >
        {enCurso ? <Loader2 className="w-4 h-4 animate-spin" />
          : listo ? <CheckCircle2 className="w-4 h-4" />
          : <Printer className="w-4 h-4" />}
        {enCurso
          ? (cuantos > 1 ? `Enviando ${progreso}/${cuantos}…` : 'Imprimiendo…')
          : listo ? 'Impreso'
          : cuantos > 1 ? `Imprimir ${cuantos} en ticketera` : 'Imprimir en ticketera'}
      </button>
    </div>
  )
}
