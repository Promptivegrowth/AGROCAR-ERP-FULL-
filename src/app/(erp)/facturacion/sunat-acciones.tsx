'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, ShieldAlert, Send, FlaskConical } from 'lucide-react'

/**
 * Declarar comprobantes ante SUNAT, desde la pantalla de facturación.
 *
 * "Emitir factura" y "Declarar a SUNAT" son dos cosas distintas y el botón
 * tiene que decir cuál hace. Emitir crea el comprobante en el ERP: se puede
 * corregir, se puede anular, no salió de la empresa. Declarar lo manda a
 * SUNAT y a partir de ahí no se deshace —solo se corrige con una nota de
 * crédito—. Por eso el botón nunca dice "enviar" a secas.
 *
 * Y por eso también cambia de nombre según el modo: en pruebas dice que es
 * una prueba. La peor confusión posible sería creer que se declaró algo que
 * no se declaró, o al revés.
 */

export interface EstadoSunat {
  modo: 'beta' | 'produccion' | null
  razon: string
  envio_automatico: boolean
  sincronizar_desde: string | null
  certificado?: { titular: string; vence: string }
  error?: string
}

export function useEstadoSunat() {
  const [estado, setEstado] = useState<EstadoSunat | null>(null)

  useEffect(() => {
    fetch('/api/sunat/enviar')
      .then((r) => r.json())
      .then(setEstado)
      .catch(() => setEstado({ modo: null, razon: '', envio_automatico: false, sincronizar_desde: null, error: 'No se pudo consultar' }))
  }, [])

  return estado
}

/** El cartel que dice contra qué servicio está hablando el sistema. */
export function BannerSunat({ estado }: { estado: EstadoSunat | null }) {
  if (!estado) return null

  if (estado.error || !estado.modo) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="text-xs text-amber-900">
          <p className="font-semibold">SUNAT no está configurado</p>
          <p className="text-amber-800">{estado.error ?? 'Falta el certificado digital en el servidor.'}</p>
        </div>
      </div>
    )
  }

  const produccion = estado.modo === 'produccion'
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
      produccion ? 'border-emerald-300 bg-emerald-50' : 'border-sky-300 bg-sky-50'
    }`}>
      {produccion
        ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        : <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />}
      <div className={`text-xs ${produccion ? 'text-emerald-900' : 'text-sky-900'}`}>
        <p className="font-semibold">
          {produccion ? 'Declarando ante SUNAT' : 'Modo pruebas — nada queda declarado'}
        </p>
        <p className={produccion ? 'text-emerald-800' : 'text-sky-800'}>{estado.razon}</p>
        {estado.certificado && (
          <p className="mt-0.5 opacity-75">
            Certificado vigente hasta {estado.certificado.vence}
            {estado.envio_automatico ? ' · envío automático encendido' : ' · el envío es manual'}
          </p>
        )}
      </div>
    </div>
  )
}

export interface ComprobanteSunat {
  id: string
  serie: string
  numero: string | number
  tipo: string
  enviado_sunat?: boolean | null
  sunat_estado?: string | null
  sunat_codigo?: string | null
  sunat_mensaje?: string | null
  sunat_modo?: string | null
}

/** En qué situación está un comprobante frente a SUNAT. */
export function ChipSunat({ comp }: { comp: ComprobanteSunat }) {
  if (!['factura', 'boleta'].includes(comp.tipo)) {
    return <span className="text-[11px] text-gray-400">No se declara</span>
  }

  if (comp.enviado_sunat) {
    // Un comprobante aceptado en pruebas NO está declarado, y decir solo
    // "aceptado" haría creer que sí.
    const enPruebas = comp.sunat_modo !== 'produccion'
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          enPruebas ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'
        }`}
        title={comp.sunat_mensaje ?? undefined}
      >
        {enPruebas ? 'Aceptado en pruebas' : 'Declarado'}
      </span>
    )
  }

  if (comp.sunat_estado === 'rechazado' || comp.sunat_estado === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800"
        title={comp.sunat_mensaje ?? undefined}
      >
        Rechazado{comp.sunat_codigo ? ` ${comp.sunat_codigo}` : ''}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
      Sin declarar
    </span>
  )
}

/** El botón de una fila. */
export function BotonDeclarar(
  { comp, estado, onListo }: { comp: ComprobanteSunat; estado: EstadoSunat | null; onListo?: () => void },
) {
  const [enviando, setEnviando] = useState(false)

  const declarar = useCallback(async () => {
    if (!estado?.modo) return
    const produccion = estado.modo === 'produccion'
    const nombre = `${comp.serie}-${comp.numero}`

    if (produccion && !confirm(
      `¿Declarar ${nombre} ante SUNAT?\n\n`
      + 'Una vez declarado no se puede editar ni anular: solo corregirlo con una nota de crédito.',
    )) return

    setEnviando(true)
    try {
      const res = await fetch('/api/sunat/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // El modo que la pantalla cree que está activo viaja con el pedido: si
        // no coincide con el del servidor, no se envía nada.
        body: JSON.stringify({ comprobante_id: comp.id, modo_esperado: estado.modo }),
      })
      const r = await res.json()

      if (!res.ok) {
        toast.error(`${nombre} no se declaró`, { description: r.error, duration: 9000 })
      } else if (r.ok) {
        toast.success(r.declarado ? `${nombre} declarado ante SUNAT` : `${nombre} aceptado en pruebas`, {
          description: r.mensaje,
        })
      } else {
        toast.error(`SUNAT rechazó ${nombre}`, {
          description: `[${r.codigo}] ${r.mensaje}`,
          duration: 12000,
        })
      }
      onListo?.()
    } catch (e) {
      toast.error('No se pudo contactar al servidor', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setEnviando(false)
    }
  }, [comp, estado, onListo])

  if (!['factura', 'boleta'].includes(comp.tipo)) return null
  if (comp.enviado_sunat && comp.sunat_modo === 'produccion') return null
  if (!estado?.modo) return null

  const produccion = estado.modo === 'produccion'
  return (
    <button
      type="button"
      onClick={declarar}
      disabled={enviando}
      title={produccion
        ? 'Declarar este comprobante ante SUNAT. No se puede deshacer.'
        : 'Enviar al servicio de pruebas de SUNAT. No queda declarado.'}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50 ${
        produccion
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'border border-sky-300 bg-white text-sky-800 hover:bg-sky-50'
      }`}
    >
      {enviando
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : produccion ? <Send className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
      {enviando ? 'Enviando…' : produccion ? 'Declarar a SUNAT' : 'Probar con SUNAT'}
    </button>
  )
}
