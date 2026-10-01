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

  // Recibe el equipo explícito: al elegir con un botón, el estado `elegido`
  // todavía no se actualizó cuando se imprime.
  const imprimir = async (equipoId?: string) => {
    const destinoId = equipoId ?? elegido
    if (!destinoId) { toast.error('Elige en qué computadora imprimir'); return }
    const destino = equipos.find((e) => e.id === destinoId)?.nombre ?? ''
    const nodos = Array.from(document.querySelectorAll<HTMLElement>('.ticket-imprimible'))
    if (nodos.length === 0) { toast.error('No hay ningún ticket en pantalla'); return }

    setProgreso(0)
    await imagenesListas()
    // Cada ticketera corta a su propia distancia
    const avance = equipos.find((e) => e.id === destinoId)?.avance_corte_mm ?? undefined
    const ids: string[] = []
    try {
      for (let i = 0; i < nodos.length; i++) {
        const ticket = await ticketDesdeNodo(nodos[i], avance ?? undefined)
        const r = await encolarTicket(
          ticket.aBase64(),
          destinoId,
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
    // El servidor reparte de a uno, con 4 s entre tickets y 20 s de descanso
    // cada 20, para que la ticketera no se recaliente (ver
    // /api/impresion/pendientes). La espera tiene que alcanzar para eso.
    const fin = await esperarImpresion(
      ids[ids.length - 1],
      10 + ids.length * 5 + Math.floor(ids.length / 20) * 20,
    )
    setProgreso(null)

    if (fin === 'impreso') {
      setListo(true)
      setTimeout(() => setListo(false), 2500)
      toast.success(
        ids.length === 1 ? 'Ticket impreso' : `${ids.length} tickets impresos`,
        { description: destino ? `Salió por ${destino}` : undefined },
      )
    } else if (fin === 'error') {
      toast.error('La ticketera no pudo imprimirlo', {
        description: `Revisa que ${destino || 'la ticketera'} esté encendida y con papel.`,
      })
    } else {
      const eq = equipos.find((e) => e.id === destinoId)
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
   * desde Facturación, la venta directa o los comprobantes de un carro— y hay
   * UNA sola ticketera, no hay nada que preguntar: sale solo.
   *
   * Con más de una, no. Daniel: "no me da opción de escoger la impresora, se va
   * de frente a la caja". Salía solo por la última elegida en ese navegador o,
   * si nunca se había elegido, por la primera de la lista —Caja—, antes de que
   * nadie alcanzara a tocar el selector. Ahora se muestra un botón por
   * ticketera y se imprime con un clic en la que corresponde.
   *
   * Y lo mismo en el comprobante suelto, no solo en el lote: Daniel pidió que
   * la opción esté en todos los botones de impresión. El selector que había
   * ahí recordaba la última elegida y era fácil no verlo; con un botón por
   * ticketera no hay forma de imprimir sin decidir dónde.
   */
  const preguntar = equipos.length > 1
  useEffect(() => {
    if (!auto || equipos.length !== 1 || !elegido || yaSalio) return
    setYaSalio(true)
    let cancelado = false
    void (async () => {
      await imagenesListas()
      if (!cancelado) void imprimir()
    })()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, elegido, equipos])

  if (equipos.length === 0 || cuantos === 0) return null

  const enCurso = progreso !== null

  if (preguntar) {
    const cantidad = cuantos > 1 ? `${cuantos} ` : ''
    return (
      <div data-elegir-ticketera className="rounded-lg border border-yellow-300 bg-yellow-50 p-2">
        <p className="mb-1.5 text-xs font-semibold text-gray-800">
          {enCurso
            ? (cuantos > 1 ? `Enviando ${progreso}/${cuantos}…` : 'Imprimiendo…')
            : listo ? 'Impreso ✓ — ¿imprimir otra vez?' : '¿En qué ticketera imprimir?'}
        </p>
        <div className="flex flex-wrap gap-2">
          {equipos.map((e) => {
            const ultima = e.id === elegido
            return (
              <button
                key={e.id}
                type="button"
                data-ticketera={e.nombre}
                disabled={enCurso}
                onClick={() => { setElegido(e.id); guardarEquipo(e.id); void imprimir(e.id) }}
                title={ultima ? 'La última que se usó en esta computadora' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                  ultima
                    ? 'bg-[#FBE600] text-black hover:bg-[#E5D100]'
                    : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                {enCurso && ultima ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                Imprimir {cantidad}en {e.nombre}
                <span className={conectado(e) ? 'text-emerald-600' : 'text-gray-400'}
                  title={conectado(e) ? 'Conectada' : 'Sin conexión: sale cuando se encienda'}>
                  {conectado(e) ? '●' : '○'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }
  /**
   * A qué computadora va.
   *
   * Va en el propio botón y no solo en el selector de al lado: el selector se
   * acuerda de la última elección, así que es facil apretar Imprimir creyendo
   * que sale por la ticketera de al lado y que el papel salga en otra oficina.
   * Paso dos veces antes de que se entendiera.
   */
  const destino = equipos.find((e) => e.id === elegido)?.nombre ?? ''

  return (
    <div className="flex items-center gap-2">
      {equipos.length > 0 && (
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
        onClick={() => void imprimir()}
        disabled={enCurso}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-60"
      >
        {enCurso ? <Loader2 className="w-4 h-4 animate-spin" />
          : listo ? <CheckCircle2 className="w-4 h-4" />
          : <Printer className="w-4 h-4" />}
        {enCurso
          ? (cuantos > 1 ? `Enviando ${progreso}/${cuantos}…` : 'Imprimiendo…')
          : listo ? 'Impreso'
          : cuantos > 1
            ? `Imprimir ${cuantos} en ${destino || 'ticketera'}`
            : `Imprimir en ${destino || 'ticketera'}`}
      </button>
    </div>
  )
}
