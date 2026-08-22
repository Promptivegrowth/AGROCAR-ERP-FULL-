'use client'

import EquiposImpresion from './equipos-client'

/**
 * Impresión de tickets.
 *
 * Acá se registran las computadoras que tienen ticketera. El ERP deja los
 * tickets en una cola y el agente de cada computadora los levanta e imprime.
 *
 * Antes el navegador le hablaba directo al agente, pero Chrome y Edge están
 * cerrando esa puerta: bloquean que una página de internet se comunique con
 * programas de la propia computadora. Con la cola el navegador no habla con
 * ninguna impresora, así que esa restricción deja de importar.
 */
export default function ImpresionTickets() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Impresión de tickets</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Computadoras que imprimen tickets y estado de cada una.
        </p>
      </div>

      <EquiposImpresion />
    </div>
  )
}
