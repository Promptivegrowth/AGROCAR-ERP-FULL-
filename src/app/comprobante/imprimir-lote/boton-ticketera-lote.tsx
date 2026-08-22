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
 * Impresión por lote directo a la ticketera.
 *
 * Se llega acá desde el botón "Imprimir tickets" de Facturación, que ya es la
 * orden de imprimir, así que arranca solo: no tiene sentido pedir un segundo
 * clic. El botón queda para repetir si hizo falta.
 *
 * Cada ticket se encola por separado y lleva su propio corte. Mandados juntos
 * la impresora los trata como un documento y corta una sola vez al final, que
 * es lo que pasaba antes con dos boletas saliendo pegadas.
 */
export default function BotonTicketeraLote({ tickets }: { tickets: DatosTicket[] }) {
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [elegido, setElegido] = useState<string>('')
  const [progreso, setProgreso] = useState<number | null>(null)
  const [listo, setListo] = useState(false)
  const [yaEnvio, setYaEnvio] = useState(false)

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

  const imprimirTodos = async (equipoId: string) => {
    setProgreso(0)
    let fallidos = 0
    let ultimoError = ''
    let ultimoId: string | null = null

    for (let i = 0; i < tickets.length; i++) {
      setProgreso(i + 1)
      try {
        const t = await construirTicket(tickets[i], true)
        const r = await encolarTicket(t.aBase64(), equipoId, tickets[i].serieNumero)
        if (r.ok) ultimoId = r.id
        else { fallidos++; ultimoError = r.error }
      } catch (e: any) {
        fallidos++
        ultimoError = e?.message ?? 'no se pudo armar el ticket'
      }
    }

    // Se espera solo al último: si ese salió, los anteriores ya pasaron por la
    // impresora, porque el agente los toma en orden.
    if (ultimoId) await esperarImpresion(ultimoId, 20)

    setProgreso(null)
    const enviados = tickets.length - fallidos
    if (fallidos === 0) {
      setListo(true)
      setTimeout(() => setListo(false), 3000)
      toast.success(`${enviados} ticket${enviados === 1 ? '' : 's'} a la ticketera`, {
        description: 'Cada uno con su corte',
      })
    } else {
      toast.error(`Se enviaron ${enviados} de ${tickets.length}`, { description: ultimoError })
    }
  }

  // Llega desde "Imprimir tickets": esa ya es la orden, imprime al abrirse
  useEffect(() => {
    if (!elegido || tickets.length === 0 || yaEnvio) return
    setYaEnvio(true)
    void imprimirTodos(elegido)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegido, tickets.length])

  if (equipos.length === 0 || tickets.length === 0) return null

  const enCurso = progreso !== null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {equipos.length > 1 && (
        <select
          value={elegido}
          onChange={(e) => { setElegido(e.target.value); guardarEquipo(e.target.value) }}
          className="h-9 max-w-[190px] px-2 text-xs border border-gray-300 rounded-md bg-white"
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
        onClick={() => imprimirTodos(elegido)}
        disabled={enCurso}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-70"
      >
        {enCurso ? <Loader2 className="w-4 h-4 animate-spin" />
          : listo ? <CheckCircle2 className="w-4 h-4" />
          : <Printer className="w-4 h-4" />}
        {enCurso
          ? `Enviando ${progreso} de ${tickets.length}…`
          : listo
            ? 'Impresos'
            : `Imprimir ${tickets.length} en ticketera`}
      </button>
    </div>
  )
}
