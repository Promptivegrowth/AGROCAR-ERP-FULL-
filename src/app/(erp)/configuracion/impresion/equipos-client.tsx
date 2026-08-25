'use client'

import { useEffect, useState } from 'react'
import { Printer, Plus, Copy, Check, Loader2, Trash2, CircleDot } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Computadoras con ticketera.
 *
 * Cada una se registra una vez y recibe un código. El agente de impresión usa
 * ese código para preguntar si hay tickets para ella; con eso alcanza, no
 * necesita usuario ni contraseña del sistema, y si una computadora se pierde
 * basta con desactivarla acá.
 */

type Equipo = {
  id: string
  nombre: string
  token: string
  impresora: string | null
  activo: boolean
  ultima_conexion: string | null
  version_agente: string | null
  avance_corte_mm: number | null
  impresora_detectada: string | null
  impresoras_disponibles: string | null
}

export default function EquiposImpresion() {
  const supabase = createClient()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [cargando, setCargando] = useState(true)
  const [nombre, setNombre] = useState('')
  const [creando, setCreando] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  const cargar = async () => {
    const { data } = await (supabase as any)
      .from('equipos_impresion')
      .select('*')
      .order('created_at', { ascending: true })
    setEquipos((data ?? []) as Equipo[])
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
    // Se refresca solo para ver cuándo un equipo se conecta por primera vez
    const reloj = setInterval(() => void cargar(), 10000)
    return () => clearInterval(reloj)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const agregar = async () => {
    const n = nombre.trim()
    if (!n) { toast.error('Ponle un nombre', { description: 'Por ejemplo: Caja principal' }); return }
    setCreando(true)
    const { error } = await (supabase as any).from('equipos_impresion').insert({ nombre: n })
    setCreando(false)
    if (error) { toast.error('No se pudo agregar', { description: error.message }); return }
    setNombre('')
    await cargar()
    toast.success('Computadora agregada', { description: 'Copia el código y pégalo en el agente.' })
  }

  const cambiarActivo = async (e: Equipo) => {
    await (supabase as any).from('equipos_impresion').update({ activo: !e.activo }).eq('id', e.id)
    await cargar()
  }

  /**
   * Cuánto adelanta el papel esa ticketera antes de cortar.
   *
   * La cuchilla no está a la misma distancia del cabezal en todos los modelos:
   * con 15 mm una corta justo y otra se come la última línea del comprobante.
   * Es el único ajuste que hay que tocar cuando el corte no sale bien.
   */
  const cambiarAvance = async (e: Equipo, valor: string) => {
    const mm = parseFloat(valor)
    if (!Number.isFinite(mm) || mm < 5 || mm > 40) {
      toast.error('Entre 5 y 40 mm', {
        description: 'Menos corta el comprobante; más solo desperdicia papel.',
      })
      return
    }
    const { error } = await (supabase as any)
      .from('equipos_impresion').update({ avance_corte_mm: mm }).eq('id', e.id)
    if (error) { toast.error('No se pudo guardar', { description: error.message }); return }
    await cargar()
    toast.success(`${e.nombre}: corta ${mm} mm más abajo`, {
      description: 'Imprime un ticket para ver cómo queda.',
    })
  }

  /**
   * Forzar por cuál impresora imprime esa computadora.
   *
   * El agente adivina por el nombre, y en una computadora con dos entradas
   * parecidas —la real y alguna que quedó de antes— puede elegir la
   * equivocada: Windows acepta el trabajo, el agente lo da por impreso y no
   * sale papel. Acá se elige la correcta sin ir hasta la computadora.
   */
  const forzarImpresora = async (e: Equipo, nombre: string) => {
    const { error } = await (supabase as any)
      .from('equipos_impresion')
      .update({ impresora: nombre || null })
      .eq('id', e.id)
    if (error) { toast.error('No se pudo guardar', { description: error.message }); return }
    await cargar()
    toast.success(
      nombre ? `${e.nombre} imprimirá por ${nombre}` : `${e.nombre} vuelve a detectarla sola`,
      { description: 'El cambio se aplica en el próximo ticket.' },
    )
  }

  const borrar = async (e: Equipo) => {
    if (!confirm(`¿Quitar "${e.nombre}"? El agente de esa computadora dejará de imprimir.`)) return
    await (supabase as any).from('equipos_impresion').delete().eq('id', e.id)
    await cargar()
    toast.success('Computadora quitada')
  }

  const copiar = async (e: Equipo) => {
    const texto = `url=${window.location.origin}\ntoken=${e.token}\n`
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(e.id)
      setTimeout(() => setCopiado(null), 2500)
      toast.success('Configuración copiada', { description: 'Pégala en el archivo agente.config' })
    } catch {
      toast.error('No se pudo copiar', { description: texto })
    }
  }

  /** Un equipo cuenta como conectado si dio señales en el último minuto. */
  const conectado = (e: Equipo) => {
    if (!e.ultima_conexion) return false
    return Date.now() - new Date(e.ultima_conexion).getTime() < 60_000
  }

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Printer className="w-4 h-4" /> Computadoras con ticketera
        </CardTitle>
        <p className="text-xs text-gray-500">
          Cada computadora que imprima tickets se registra acá una vez y recibe un código.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Nombre de la computadora (ej: Caja principal)"
            value={nombre}
            onChange={(ev) => setNombre(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') void agregar() }}
            className="text-sm"
          />
          <Button onClick={agregar} disabled={creando} className="gap-1.5 shrink-0">
            {creando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Agregar
          </Button>
        </div>

        {cargando ? (
          <p className="text-sm text-gray-500 py-4 text-center">Cargando…</p>
        ) : equipos.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            Todavía no hay ninguna. Agrega la primera con el campo de arriba.
          </p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {equipos.map((e) => (
              <div key={e.id} className="p-3 flex items-start gap-3 flex-wrap">
                <CircleDot
                  className={`w-4 h-4 mt-0.5 shrink-0 ${conectado(e) ? 'text-green-600' : 'text-gray-300'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {e.nombre}
                    {!e.activo && <span className="ml-2 text-[10px] text-gray-500 font-normal">(desactivada)</span>}
                  </p>
                  {/* Una computadora conectada pero sin ticketera imprime
                      nada: eso tiene que verse acá y no descubrirse recién al
                      facturar. */}
                  {conectado(e) && (
                    e.impresora_detectada
                      ? <p className="text-[11px] text-gray-600">Imprime por: <span className="font-medium">{e.impresora_detectada}</span></p>
                      : <p className="text-[11px] text-red-600 font-semibold">
                          No encuentra ninguna ticketera — elegirla desde el menú del agente
                        </p>
                  )}
                  <p className="text-[11px] text-gray-500">
                    {conectado(e)
                      ? `Conectada · agente v${e.version_agente ?? '?'}`
                      : e.ultima_conexion
                        ? `Última vez: ${new Date(e.ultima_conexion).toLocaleString('es-PE', { timeZone: 'America/Lima' })}`
                        : 'Todavía no se ha conectado'}
                  </p>
                  {/* Elegir la impresora a distancia: la lista la informa el
                      propio agente de esa computadora. */}
                  {conectado(e) && e.impresoras_disponibles && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-500">Usar:</span>
                      <select
                        value={e.impresora ?? ''}
                        onChange={(ev) => void forzarImpresora(e, ev.target.value)}
                        className="h-7 max-w-[240px] px-1 text-[11px] border border-gray-300 rounded bg-white"
                      >
                        <option value="">Detectar sola{e.impresora_detectada ? ` (${e.impresora_detectada})` : ''}</option>
                        {e.impresoras_disponibles.split('|').filter(Boolean).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <code className="text-[10px] text-gray-400 break-all">{e.token}</code>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="flex items-center gap-1 text-[11px] text-gray-600 mr-1"
                         title="Si el corte se come la última línea, súbelo. Si sobra papel en blanco al final, bájalo.">
                    Corte
                    <input
                      type="number" min={5} max={40} step={0.5}
                      defaultValue={e.avance_corte_mm ?? 15}
                      onBlur={(ev) => {
                        const v = ev.target.value
                        if (parseFloat(v) !== (e.avance_corte_mm ?? 15)) void cambiarAvance(e, v)
                      }}
                      className="w-14 h-7 px-1 text-xs text-right border border-gray-300 rounded"
                    />
                    mm
                  </label>
                  <Button size="sm" variant="outline" onClick={() => copiar(e)} className="gap-1 text-xs">
                    {copiado === e.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiado === e.id ? 'Copiado' : 'Copiar código'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => cambiarActivo(e)} className="text-xs">
                    {e.activo ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => borrar(e)} className="text-xs text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
          <p className="font-semibold">Cómo dejar lista una computadora</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Agregarla acá con un nombre y copiar su código.</li>
            <li>En esa computadora, ejecutar el instalador del agente de impresión.</li>
            <li>Pegar el código cuando lo pida. Listo: el punto se pone verde.</li>
            <li>
              Si al imprimir el corte se come la última línea, subir los milímetros
              de «Corte»; si sobra papel en blanco al final, bajarlos.
            </li>
            <li>
              Si dice que imprimió y no sale papel, probar otra impresora en «Usar»:
              hay computadoras con más de una entrada parecida y Windows acepta el
              trabajo igual.
            </li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
