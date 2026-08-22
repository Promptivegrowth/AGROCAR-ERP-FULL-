'use client'

import { useEffect, useState } from 'react'
import { Printer, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Diagnóstico de la impresión de tickets.
 *
 * Cuando el botón de ticketera no aparece no hay forma de saber por qué: el
 * navegador corta la llamada al agente y desde el ERP solo se ve que "no está".
 * Esta pantalla hace la prueba a la vista y dice qué contestó, para no tener
 * que abrir las herramientas de desarrollo en la computadora del usuario.
 */

type Prueba = { nombre: string; ok: boolean | null; detalle: string }

export default function DiagnosticoImpresion() {
  const [pruebas, setPruebas] = useState<Prueba[]>([])
  const [corriendo, setCorriendo] = useState(false)

  const correr = async () => {
    setCorriendo(true)
    const r: Prueba[] = []

    // 1. Dónde está corriendo el ERP
    const origen = typeof window !== 'undefined' ? window.location.origin : ''
    const seguro = origen.startsWith('https://')
    r.push({
      nombre: 'Dirección del sistema',
      ok: true,
      detalle: `${origen}${seguro ? ' (conexión segura)' : ''}`,
    })

    // 2. ¿Se puede llegar al agente sin pedirle respuesta?
    //
    // Con mode 'no-cors' el navegador manda el pedido igual pero no deja leer
    // la respuesta. Si esto pasa y lo de abajo falla, el agente está y quien
    // corta es la política del navegador, no la red.
    let alcanzable = false
    try {
      const control = new AbortController()
      const reloj = setTimeout(() => control.abort(), 4000)
      await fetch('http://127.0.0.1:9123/ping',
        { mode: 'no-cors', signal: control.signal, cache: 'no-store', targetAddressSpace: 'local' } as RequestInit)
      clearTimeout(reloj)
      alcanzable = true
      r.push({ nombre: 'Conexión con el agente', ok: true, detalle: 'El agente está escuchando y responde.' })
    } catch {
      r.push({
        nombre: 'Conexión con el agente',
        ok: false,
        detalle: 'No se llegó al agente. Puede estar cerrado, o el navegador corta la conexión con programas de esta computadora.',
      })
    }

    // 3. ¿Contesta con permiso para que el ERP lea la respuesta?
    try {
      const control = new AbortController()
      const reloj = setTimeout(() => control.abort(), 4000)
      const resp = await fetch('http://127.0.0.1:9123/ping', {
        signal: control.signal,
        cache: 'no-store',
        targetAddressSpace: 'local',
      } as RequestInit)
      clearTimeout(reloj)
      const d = await resp.json()
      r.push({
        nombre: 'Agente de impresión',
        ok: d?.ok === true,
        detalle: d?.ok
          ? `Respondió correctamente · versión ${d.version} · ${d.impresos ?? 0} tickets impresos`
          : `Contestó pero sin confirmar: ${JSON.stringify(d)}`,
      })
      if (Array.isArray(d?.impresoras)) {
        r.push({
          nombre: 'Impresoras que ve el agente',
          ok: d.impresoras.length > 0,
          detalle: d.impresoras.length ? d.impresoras.join(' · ') : 'ninguna',
        })
      }
    } catch (e: any) {
      const abortado = e?.name === 'AbortError'
      r.push({
        nombre: 'Agente de impresión',
        ok: false,
        detalle: abortado
          ? 'No contestó a tiempo. ¿Está corriendo el agente?'
          : alcanzable
            ? 'El agente está andando, pero el navegador no deja que el sistema lea su respuesta. ' +
              'Es una restricción del navegador para conexiones con programas de esta computadora ' +
              '(hay que habilitarla, ver abajo).'
            : `No se pudo conectar (${e?.message ?? 'error de red'}).`,
      })
    }

    // 4. Qué navegador es, que cambia cómo se habilita
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const esEdge = /Edg\//.test(ua)
    const esChrome = /Chrome\//.test(ua) && !esEdge
    r.push({
      nombre: 'Navegador',
      ok: true,
      detalle: esEdge ? 'Microsoft Edge' : esChrome ? 'Google Chrome' : ua.slice(0, 90),
    })

    setPruebas(r)
    setCorriendo(false)
  }

  useEffect(() => { void correr() }, [])

  const agenteOk = pruebas.find((p) => p.nombre === 'Agente de impresión')?.ok === true
  // El agente contesta pero el navegador no deja leerlo: hay que habilitarlo
  const bloqueado =
    !agenteOk && pruebas.find((p) => p.nombre === 'Conexión con el agente')?.ok === true

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Impresión de tickets</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Comprueba si esta computadora puede imprimir tickets directamente en la ticketera.
        </p>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Printer className="w-4 h-4" /> Resultado
          </CardTitle>
          <Button size="sm" variant="outline" onClick={correr} disabled={corriendo} className="gap-1.5">
            {corriendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Volver a probar
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {pruebas.length === 0 && corriendo && (
            <p className="text-sm text-gray-500">Probando…</p>
          )}
          {pruebas.map((p, i) => (
            <div key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0">
              {p.ok === true
                ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                : <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">{p.nombre}</p>
                <p className="text-xs text-gray-600 break-words">{p.detalle}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {pruebas.length > 0 && (
        agenteOk ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-900">
            <p className="font-semibold">Todo listo.</p>
            <p className="mt-1">
              Al facturar, los tickets salen directo por la ticketera y con el corte justo,
              sin que aparezca la ventana de impresión de Windows.
            </p>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 space-y-2">
            <p className="font-semibold">Esta computadora todavía imprime por el navegador.</p>
            <p>Los tickets salen igual, pero con la ventana de impresión y desperdiciando papel al final.</p>
            {bloqueado ? (
              <>
                <p className="pt-1">
                  El agente <b>está instalado y andando</b>, pero el navegador no lo deja
                  comunicarse con el sistema. Es una restricción para conexiones con
                  programas de la propia computadora.
                </p>
                <p className="font-semibold pt-1">Para habilitarlo en esta computadora:</p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>Ejecutar <b>habilitar-navegador.ps1</b> —viene junto al instalador del agente— como administrador.</li>
                  <li>Cerrar por completo el navegador y volver a abrirlo.</li>
                  <li>Volver a probar con el botón de arriba.</li>
                </ol>
              </>
            ) : (
              <>
                <p className="font-semibold pt-1">Para dejarlo automático:</p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>Ejecutar el instalador del agente de impresión en esta computadora.</li>
                  <li>Comprobar que quedó su ícono al lado del reloj.</li>
                  <li>Volver a probar con el botón de arriba.</li>
                </ol>
              </>
            )}
          </div>
        )
      )}
    </div>
  )
}
