'use client'

import { useEffect, useMemo, useState, useCallback, Fragment, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, MapPin, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LeafletMap, { type MapCircle } from '@/components/maps/leaflet-map'

// ── Tipos que devuelve la RPC dashboard_zonificado
interface Producto {
  id: string; codigo: string; nombre: string
  familia_key: string; familia: string; familia_codigo: string
  ventas: number; cantidad: number; peso: number
}
interface Cliente {
  id: string; nombre: string; grupo_key: string
  ventas: number; visitas: number
}
interface Grupo {
  key: string; nombre: string; ventas: number
  lat: number | null; lng: number | null; aproximado: boolean
}
interface Celda { p: string; g: string; v: number }
interface Datos {
  productos: Producto[]; clientes: Cliente[]; grupos: Grupo[]
  matriz: Celda[]
  totales: { ventas: number; cantidad: number; peso: number; visitas: number }
}

// El top 3 se pinta distinto; el resto en gris
const ORO = '#F59E0B'
const GRIS = '#9CA3AF'
const colorRank = (i: number) => (i < 3 ? ORO : GRIS)

const money = (v: number) =>
  'S/ ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const numero = (v: number, dec = 0) =>
  Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const hoyISO = () => new Date().toISOString().slice(0, 10)
const haceDias = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

type Vista = 'ventas' | 'visitas'
type Modo = 'visual' | 'tabular'
type Metrica = 'monto' | 'visitas'
/** Qué está seleccionado en el cruce */
type Seleccion =
  | { tipo: 'producto'; id: string }
  | { tipo: 'cliente'; id: string }
  | { tipo: 'grupo'; id: string }
  | null

/**
 * Barra horizontal del tablero. Vive fuera del componente y memoizada: si se
 * definiera adentro, React la trataría como un tipo nuevo en cada render y
 * remontaría las ~60 barras en cada clic, perdiendo las transiciones.
 */
const Barra = memo(function Barra({
  etiqueta, total, parte, max, color, seleccionado, atenuado, onClick, textoValor,
}: {
  etiqueta: string; total: number; parte: number | null; max: number
  color: string; seleccionado: boolean; atenuado: boolean
  onClick: () => void; textoValor: string
}) {
  const pctTotal = max > 0 ? Math.min(100, (Math.abs(total) / max) * 100) : 0
  const pctParte = parte != null && max > 0 ? Math.min(100, (Math.abs(parte) / max) * 100) : 0
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-2 py-1.5 text-left">
      <span className={`w-[110px] shrink-0 text-[11px] truncate ${atenuado ? 'text-gray-400' : 'text-gray-700'}`}
        title={etiqueta}>
        {etiqueta}
      </span>
      <span className="relative flex-1 h-6 rounded-sm overflow-hidden bg-gray-100">
        {/* Barra completa (atenuada cuando hay algo seleccionado) */}
        <span className="absolute inset-y-0 left-0 rounded-sm transition-all"
          style={{
            width: `${pctTotal}%`,
            backgroundColor: color,
            opacity: parte != null ? 0.28 : atenuado ? 0.3 : 1,
          }} />
        {/* Segmento resaltado de lo seleccionado */}
        {parte != null && pctParte > 0 && (
          <span className="absolute inset-y-0 left-0 rounded-sm transition-all"
            style={{ width: `${pctParte}%`, backgroundColor: color }} />
        )}
        <span className={`absolute inset-y-0 flex items-center px-1.5 text-[10px] font-semibold text-gray-800 ${
          parte != null ? 'justify-start' : 'right-1'
        }`}
          style={parte != null ? { left: `${Math.max(pctParte, 2)}%` } : undefined}>
          {parte != null ? textoValor : ''}
        </span>
        {seleccionado && <span className="absolute inset-0 ring-2 ring-black/60 rounded-sm" />}
      </span>
      <span className={`w-[92px] shrink-0 text-right text-[11px] font-mono ${
        atenuado ? 'text-gray-400' : 'text-gray-800'
      }`}>
        {parte == null ? textoValor : ''}
      </span>
    </button>
  )
})

/** Mini barra de fondo dentro de una celda de la tabla */
const Celda = memo(function Celda({
  valor, max, texto, color,
}: { valor: number; max: number; texto: string; color: string }) {
  return (
    <span className="relative inline-flex items-center justify-end w-full h-5 px-1 rounded-sm overflow-hidden">
      <span className="absolute inset-y-0 left-0 rounded-sm"
        style={{
          width: `${max > 0 ? Math.min(100, (Math.abs(valor) / max) * 100) : 0}%`,
          backgroundColor: color, opacity: 0.35,
        }} />
      <span className="relative text-[10px] font-mono">{texto}</span>
    </span>
  )
})

function Toggle({ modo, set }: { modo: Modo; set: (m: Modo) => void }) {
  return (
    <div className="flex justify-center gap-2 pt-2">
      {(['visual', 'tabular'] as const).map((m) => (
        <button key={m} type="button" onClick={() => set(m)}
          className={`px-4 py-1 rounded text-xs font-bold ${
            modo === m ? 'bg-[#FBE600] text-black' : 'bg-[#FEF3C7] text-gray-600 hover:bg-[#FDE68A]'
          }`}>
          {m}
        </button>
      ))}
    </div>
  )
}

export default function ZonificadoTab() {
  const supabase = createClient()

  // Filtros
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(hoyISO())
  const [tipoComp, setTipoComp] = useState('todos')
  const [vendedorId, setVendedorId] = useState('')
  const [conIgv, setConIgv] = useState(false)
  const [agruparPor, setAgruparPor] = useState<'zona' | 'distrito'>('zona')

  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([])
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Estado de la interfaz
  const [vista, setVista] = useState<Vista>('ventas')
  const [modoIzq, setModoIzq] = useState<Modo>('visual')
  const [modoDer, setModoDer] = useState<Modo>('visual')
  const [metricaCliente, setMetricaCliente] = useState<Metrica>('visitas')
  const [sel, setSel] = useState<Seleccion>(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await (supabase as any)
        .from('profiles').select('id, full_name, email')
        .in('role', ['vendedor', 'repartidor']).eq('activo', true).order('full_name')
      setVendedores((data ?? []).map((v: any) => ({ id: v.id, nombre: v.full_name || v.email })))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const { data, error: e } = await (supabase.rpc as any)('dashboard_zonificado', {
      p_desde: desde, p_hasta: hasta,
      p_tipo_comp: tipoComp === 'todos' ? null : tipoComp,
      p_vendedor_id: vendedorId || null,
      p_con_igv: conIgv,
      p_agrupar_por: agruparPor,
    })
    setCargando(false)
    if (e) { setError(e.message); setDatos(null); return }
    setDatos(data as Datos)
    setSel(null)
  }, [supabase, desde, hasta, tipoComp, vendedorId, conIgv, agruparPor])

  useEffect(() => { cargar() }, [cargar])

  // ── Cruce: monto de un producto dentro de un grupo
  const matrizPorProducto = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    ;(datos?.matriz ?? []).forEach((c) => {
      if (!m.has(c.p)) m.set(c.p, new Map())
      m.get(c.p)!.set(c.g, Number(c.v))
    })
    return m
  }, [datos])

  const matrizPorGrupo = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    ;(datos?.matriz ?? []).forEach((c) => {
      if (!m.has(c.g)) m.set(c.g, new Map())
      m.get(c.g)!.set(c.p, Number(c.v))
    })
    return m
  }, [datos])

  const clientePorId = useMemo(() => {
    const m = new Map<string, Cliente>()
    ;(datos?.clientes ?? []).forEach((c) => m.set(c.id, c))
    return m
  }, [datos])

  const alternar = (s: Seleccion) => {
    setSel((prev) =>
      prev && s && prev.tipo === s.tipo && prev.id === s.id ? null : s,
    )
  }

  // ── Panel izquierdo: productos (vista ventas) o clientes (vista visitas)
  const productos = datos?.productos ?? []
  const clientes = datos?.clientes ?? []
  const grupos = datos?.grupos ?? []

  /** Productos ordenados y agrupados por familia, respetando el ranking global */
  const productosPorFamilia = useMemo(() => {
    const rank = new Map(productos.map((p, i) => [p.id, i]))
    const fam = new Map<string, { nombre: string; codigo: string; items: Producto[] }>()
    productos.forEach((p) => {
      if (!fam.has(p.familia_key)) {
        fam.set(p.familia_key, { nombre: p.familia, codigo: p.familia_codigo, items: [] })
      }
      fam.get(p.familia_key)!.items.push(p)
    })
    return { grupos: Array.from(fam.entries()).sort((a, b) => a[1].codigo.localeCompare(b[1].codigo)), rank }
  }, [productos])

  /** Clientes visibles: si hay una zona elegida, solo los de esa zona */
  const clientesVisibles = useMemo(() => {
    const base = sel?.tipo === 'grupo' ? clientes.filter((c) => c.grupo_key === sel.id) : clientes
    const orden = [...base]
    if (metricaCliente === 'visitas') orden.sort((a, b) => b.visitas - a.visitas || b.ventas - a.ventas)
    else orden.sort((a, b) => b.ventas - a.ventas)
    return orden
  }, [clientes, sel, metricaCliente])

  /** Valor a mostrar por grupo, según lo que esté seleccionado */
  const valorGrupo = useCallback((g: Grupo): { total: number; parte: number | null } => {
    const total = Number(g.ventas)
    if (!sel) return { total, parte: null }
    if (sel.tipo === 'producto') {
      return { total, parte: matrizPorProducto.get(sel.id)?.get(g.key) ?? 0 }
    }
    if (sel.tipo === 'cliente') {
      const c = clientePorId.get(sel.id)
      return { total, parte: c && c.grupo_key === g.key ? c.ventas : 0 }
    }
    return { total, parte: null }
  }, [sel, matrizPorProducto, clientePorId])

  /** Valor a mostrar por producto, según lo que esté seleccionado */
  const valorProducto = useCallback((p: Producto): { total: number; parte: number | null } => {
    const total = Number(p.ventas)
    if (sel?.tipo === 'grupo') {
      return { total, parte: matrizPorGrupo.get(sel.id)?.get(p.id) ?? 0 }
    }
    return { total, parte: null }
  }, [sel, matrizPorGrupo])

  // ── Mapa
  const maxGrupo = useMemo(
    () => Math.max(1, ...grupos.map((g) => Math.abs(valorGrupo(g).parte ?? valorGrupo(g).total))),
    [grupos, valorGrupo],
  )

  const circulos: MapCircle[] = useMemo(() => {
    return grupos
      .filter((g) => g.lat != null && g.lng != null)
      .map((g) => {
        const { total, parte } = valorGrupo(g)
        const v = Math.abs(parte ?? total)
        // Radio por raíz: el ÁREA queda proporcional al monto, que es como el
        // ojo compara círculos.
        const r = 6 + 26 * Math.sqrt(Math.min(1, v / maxGrupo))
        const apagado = !!sel && (
          (sel.tipo === 'grupo' && sel.id !== g.key) ||
          (sel.tipo !== 'grupo' && v === 0)
        )
        return {
          id: g.key,
          lat: Number(g.lat), lng: Number(g.lng),
          radiusPx: r,
          color: ORO,
          dimmed: apagado,
          approximate: g.aproximado,
          label: g.nombre,
          value: parte != null ? `${money(parte)} de ${money(total)}` : money(total),
          onClick: () => alternar({ tipo: 'grupo', id: g.key }),
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, valorGrupo, maxGrupo, sel])

  /** Círculo de alcance: engloba las zonas con movimiento */
  const alcance = useMemo(() => {
    const pts = circulos.filter((c) => !c.dimmed)
    if (pts.length < 2) return null
    const lat = pts.reduce((a, c) => a + c.lat, 0) / pts.length
    const lng = pts.reduce((a, c) => a + c.lng, 0) / pts.length
    const distMax = Math.max(
      ...pts.map((c) => {
        const dLat = (c.lat - lat) * 111320
        const dLng = (c.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180)
        return Math.sqrt(dLat * dLat + dLng * dLng)
      }),
    )
    return { lat, lng, radiusMeters: distMax * 1.25 + 500, color: '#dc2626' }
  }, [circulos])

  const zonasAproximadas = grupos.filter((g) => g.aproximado).length

  const maxProducto = Math.max(1, ...productos.map((p) => Math.abs(p.ventas)))
  const maxCantidad = Math.max(1, ...productos.map((p) => Math.abs(p.cantidad)))
  const maxPeso = Math.max(1, ...productos.map((p) => Math.abs(p.peso)))
  const maxClienteVenta = Math.max(1, ...clientesVisibles.map((c) => Math.abs(c.ventas)))
  const maxClienteVisita = Math.max(1, ...clientesVisibles.map((c) => c.visitas))
  const maxCliente = metricaCliente === 'visitas' ? maxClienteVisita : maxClienteVenta

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[10px] text-gray-500">Desde</Label>
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-9 text-sm w-[150px]" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Hasta</Label>
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-9 text-sm w-[150px]" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Tipo Comp.</Label>
          <select value={tipoComp} onChange={(e) => setTipoComp(e.target.value)}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
            <option value="todos">Todos</option>
            <option value="factura">Factura</option>
            <option value="boleta">Boleta</option>
            <option value="nota_pedido_interna">Documento interno</option>
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Vendedor</Label>
          <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white max-w-[180px]">
            <option value="">Todos</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Monto</Label>
          <select value={conIgv ? 'con' : 'sin'} onChange={(e) => setConIgv(e.target.value === 'con')}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
            <option value="sin">Sin IGV</option>
            <option value="con">Con IGV</option>
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Agrupar por</Label>
          <select value={agruparPor} onChange={(e) => setAgruparPor(e.target.value as any)}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
            <option value="zona">Zona</option>
            <option value="distrito">Distrito</option>
          </select>
        </div>
      </div>

      {/* Switch ventas / visitas */}
      <div className="flex gap-2">
        {([['ventas', 'ventas'], ['visitas', 'N° visitas']] as const).map(([v, txt]) => (
          <button key={v} type="button" onClick={() => { setVista(v as Vista); setSel(null) }}
            className={`px-8 py-2 rounded text-sm font-semibold ${
              vista === v ? 'bg-gray-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}>
            {txt}
          </button>
        ))}
        {sel && (
          <button type="button" onClick={() => setSel(null)}
            className="ml-auto px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded">
            ✕ Quitar selección
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {cargando ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-gray-400" /></div>
      ) : !datos ? null : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          {/* ── Panel 1: productos o clientes */}
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-sm text-center flex-1">
                {vista === 'ventas' ? 'Categoría productos' : 'Categoría clientes'}
              </h3>
              {vista === 'visitas' && (
                <select value={metricaCliente} onChange={(e) => setMetricaCliente(e.target.value as Metrica)}
                  className="h-7 px-1 text-[11px] border border-gray-300 rounded bg-white">
                  <option value="visitas">Visitas</option>
                  <option value="monto">Monto</option>
                </select>
              )}
            </div>

            <div className="flex-1 overflow-y-auto max-h-[420px] pr-1">
              {vista === 'ventas' ? (
                modoIzq === 'visual' ? (
                  productos.length === 0 ? (
                    <p className="text-center text-gray-400 text-xs py-10">Sin ventas en el periodo</p>
                  ) : productosPorFamilia.grupos.map(([key, fam]) => (
                    <Fragment key={key}>
                      <p className="text-[10px] font-bold uppercase text-gray-500 bg-gray-50 px-1 py-0.5 mt-1 rounded">
                        {fam.codigo} · {fam.nombre}
                      </p>
                      {fam.items.map((p) => {
                        const { total, parte } = valorProducto(p)
                        const i = productosPorFamilia.rank.get(p.id) ?? 99
                        return (
                          <Barra key={p.id} etiqueta={p.nombre} total={total} parte={parte}
                            max={maxProducto} color={colorRank(i)}
                            seleccionado={sel?.tipo === 'producto' && sel.id === p.id}
                            atenuado={!!sel && !(sel.tipo === 'producto' && sel.id === p.id)}
                            onClick={() => alternar({ tipo: 'producto', id: p.id })}
                            textoValor={money(parte ?? total)} />
                        )
                      })}
                    </Fragment>
                  ))
                ) : (
                  <TablaProductos
                    grupos={productosPorFamilia.grupos} rank={productosPorFamilia.rank}
                    totales={datos.totales} maxV={maxProducto} maxC={maxCantidad} maxP={maxPeso}
                    sel={sel} onSel={(id: string) => alternar({ tipo: 'producto', id })}
                    valorProducto={valorProducto} />
                )
              ) : (
                modoIzq === 'visual' ? (
                  clientesVisibles.length === 0 ? (
                    <p className="text-center text-gray-400 text-xs py-10">Sin clientes en el periodo</p>
                  ) : clientesVisibles.map((c, i) => {
                    const v = metricaCliente === 'visitas' ? c.visitas : c.ventas
                    return (
                      <Barra key={c.id} etiqueta={c.nombre} total={v} parte={null}
                        max={maxCliente} color={colorRank(i)}
                        seleccionado={sel?.tipo === 'cliente' && sel.id === c.id}
                        atenuado={!!sel && !(sel.tipo === 'cliente' && sel.id === c.id)}
                        onClick={() => alternar({ tipo: 'cliente', id: c.id })}
                        textoValor={metricaCliente === 'visitas' ? `${numero(v)} vis.` : money(v)} />
                    )
                  })
                ) : (
                  <TablaClientes
                    clientes={clientesVisibles} maxV={maxClienteVenta} maxVis={maxClienteVisita}
                    sel={sel} onSel={(id: string) => alternar({ tipo: 'cliente', id })} />
                )
              )}
            </div>
            <Toggle modo={modoIzq} set={(m) => { setModoIzq(m); setSel(null) }} />
          </div>

          {/* ── Panel 2: puntos de venta */}
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col">
            <h3 className="font-bold text-sm text-center mb-1">Puntos venta</h3>
            <div className="flex-1 overflow-y-auto max-h-[420px] pr-1">
              {grupos.length === 0 ? (
                <p className="text-center text-gray-400 text-xs py-10">Sin movimiento en el periodo</p>
              ) : modoDer === 'visual' ? (
                grupos.map((g, i) => {
                  const { total, parte } = valorGrupo(g)
                  return (
                    <Barra key={g.key} etiqueta={g.nombre} total={total} parte={parte}
                      max={Math.max(1, ...grupos.map((x) => Math.abs(x.ventas)))} color={colorRank(i)}
                      seleccionado={sel?.tipo === 'grupo' && sel.id === g.key}
                      atenuado={!!sel && !(sel.tipo === 'grupo' && sel.id === g.key)}
                      onClick={() => alternar({ tipo: 'grupo', id: g.key })}
                      textoValor={money(parte ?? total)} />
                  )
                })
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-1">{agruparPor === 'zona' ? 'Zona' : 'Distrito'}</th>
                      <th className="text-right py-1 w-[110px]">Ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map((g) => {
                      const { total, parte } = valorGrupo(g)
                      return (
                        <tr key={g.key} onClick={() => alternar({ tipo: 'grupo', id: g.key })}
                          className={`border-b border-gray-100 cursor-pointer hover:bg-yellow-50 ${
                            sel?.tipo === 'grupo' && sel.id === g.key ? 'bg-yellow-100' : ''
                          }`}>
                          <td className="py-0.5">{g.nombre}</td>
                          <td className="py-0.5">
                            <Celda valor={parte ?? total} max={Math.max(1, ...grupos.map((x) => Math.abs(x.ventas)))}
                              texto={money(parte ?? total)} color={ORO} />
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="font-bold border-t-2 border-black">
                      <td className="py-1">TOTAL</td>
                      <td className="py-1 text-right font-mono">{money(datos.totales.ventas)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
            <Toggle modo={modoDer} set={(m) => { setModoDer(m); setSel(null) }} />
          </div>

          {/* ── Panel 3: mapa */}
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <h3 className="font-bold text-sm text-center mb-1 flex items-center justify-center gap-1">
              <MapPin className="w-4 h-4 text-[#F59E0B]" />
              {agruparPor === 'zona' ? 'Zonas' : 'Distritos'} en el mapa
            </h3>
            {circulos.length === 0 ? (
              <p className="text-center text-gray-400 text-xs py-16">Sin puntos para mostrar</p>
            ) : (
              <LeafletMap height="440px" circles={circulos} coverage={alcance} fitBounds />
            )}
            {zonasAproximadas > 0 && (
              <p className="text-[10px] text-amber-700 bg-amber-50 rounded p-1.5 mt-2 flex gap-1">
                <Info className="w-3 h-3 shrink-0 mt-px" />
                {zonasAproximadas} punto(s) con borde punteado tienen <b className="mx-1">ubicación aproximada</b>
                (estimada por distrito). Ajústalos en Maestros → Zonas.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Totales */}
      {datos && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi titulo="VENTAS DEL PERIODO" valor={money(datos.totales.ventas)} color="emerald" />
          <Kpi titulo="UNIDADES" valor={numero(datos.totales.cantidad, 2)} color="blue" />
          <Kpi titulo="PESO" valor={`${numero(datos.totales.peso, 2)} kg`} color="gray" />
          <Kpi titulo="VISITAS" valor={numero(datos.totales.visitas)} color="amber" />
        </div>
      )}
    </div>
  )
}

function Kpi({ titulo, valor, color }: { titulo: string; valor: string; color: string }) {
  const c: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    gray: 'bg-gray-50 border-gray-200 text-gray-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
  }
  return (
    <div className={`border rounded-lg p-3 ${c[color]}`}>
      <p className="text-[10px] uppercase font-semibold opacity-70">{titulo}</p>
      <p className="text-lg font-bold">{valor}</p>
    </div>
  )
}

// ── Tabla de productos: familia con subtotal y total general
function TablaProductos({
  grupos, totales, maxV, maxC, maxP, sel, onSel, valorProducto,
}: any) {
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-white">
        <tr className="border-b border-gray-300">
          <th className="text-left py-1">Productos</th>
          <th className="text-right py-1 w-[92px]">Ventas</th>
          <th className="text-right py-1 w-[68px]">Cantidad</th>
          <th className="text-right py-1 w-[72px]">Peso</th>
        </tr>
      </thead>
      <tbody>
        {grupos.map(([key, fam]: any) => {
          const sv = fam.items.reduce((a: number, p: Producto) => a + Number(p.ventas), 0)
          const sc = fam.items.reduce((a: number, p: Producto) => a + Number(p.cantidad), 0)
          const sp = fam.items.reduce((a: number, p: Producto) => a + Number(p.peso), 0)
          return (
            <Fragment key={key}>
              <tr className="bg-gray-50">
                <td colSpan={4} className="py-0.5 px-1 font-bold uppercase text-[10px] text-gray-600">
                  {fam.codigo} · {fam.nombre}
                </td>
              </tr>
              {fam.items.map((p: Producto) => {
                const { total, parte } = valorProducto(p)
                const activo = sel?.tipo === 'producto' && sel.id === p.id
                const atenuado = !!sel && !activo
                return (
                  <tr key={p.id} onClick={() => onSel(p.id)}
                    className={`border-b border-gray-100 cursor-pointer hover:bg-yellow-50 ${
                      activo ? 'bg-yellow-100' : ''} ${atenuado ? 'opacity-50' : ''}`}>
                    <td className="py-0.5 truncate max-w-[130px]" title={p.nombre}>{p.nombre}</td>
                    <td className="py-0.5"><Celda valor={parte ?? total} max={maxV} texto={money(parte ?? total)} color="#F59E0B" /></td>
                    <td className="py-0.5"><Celda valor={p.cantidad} max={maxC} texto={numero(p.cantidad, 2)} color="#9CA3AF" /></td>
                    <td className="py-0.5"><Celda valor={p.peso} max={maxP} texto={`${numero(p.peso, 1)} kg`} color="#9CA3AF" /></td>
                  </tr>
                )
              })}
              <tr className="border-b border-gray-300 font-semibold text-[10px] text-gray-700">
                <td className="py-0.5 text-right pr-2">Subtotal {fam.codigo}</td>
                <td className="py-0.5 text-right font-mono">{money(sv)}</td>
                <td className="py-0.5 text-right font-mono">{numero(sc, 2)}</td>
                <td className="py-0.5 text-right font-mono">{numero(sp, 1)} kg</td>
              </tr>
            </Fragment>
          )
        })}
        <tr className="font-bold border-t-2 border-black">
          <td className="py-1">TOTAL</td>
          <td className="py-1 text-right font-mono">{money(totales.ventas)}</td>
          <td className="py-1 text-right font-mono">{numero(totales.cantidad, 2)}</td>
          <td className="py-1 text-right font-mono">{numero(totales.peso, 1)} kg</td>
        </tr>
      </tbody>
    </table>
  )
}

// ── Tabla de clientes: ventas, visitas y ticket promedio
function TablaClientes({ clientes, maxV, maxVis, sel, onSel }: any) {
  const tv = clientes.reduce((a: number, c: Cliente) => a + Number(c.ventas), 0)
  const tvis = clientes.reduce((a: number, c: Cliente) => a + c.visitas, 0)
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-white">
        <tr className="border-b border-gray-300">
          <th className="text-left py-1">Clientes</th>
          <th className="text-right py-1 w-[92px]">Ventas</th>
          <th className="text-right py-1 w-[58px]">Visitas</th>
          <th className="text-right py-1 w-[76px]">Ticket prom.</th>
        </tr>
      </thead>
      <tbody>
        {clientes.map((c: Cliente) => {
          const activo = sel?.tipo === 'cliente' && sel.id === c.id
          const atenuado = !!sel && !activo
          return (
            <tr key={c.id} onClick={() => onSel(c.id)}
              className={`border-b border-gray-100 cursor-pointer hover:bg-yellow-50 ${
                activo ? 'bg-yellow-100' : ''} ${atenuado ? 'opacity-50' : ''}`}>
              <td className="py-0.5 truncate max-w-[130px]" title={c.nombre}>{c.nombre}</td>
              <td className="py-0.5"><Celda valor={c.ventas} max={maxV} texto={money(c.ventas)} color="#F59E0B" /></td>
              <td className="py-0.5"><Celda valor={c.visitas} max={maxVis} texto={numero(c.visitas)} color="#9CA3AF" /></td>
              <td className="py-0.5 text-right font-mono text-[10px]">
                {c.visitas > 0 ? money(c.ventas / c.visitas) : '—'}
              </td>
            </tr>
          )
        })}
        <tr className="font-bold border-t-2 border-black">
          <td className="py-1">TOTAL</td>
          <td className="py-1 text-right font-mono">{money(tv)}</td>
          <td className="py-1 text-right font-mono">{numero(tvis)}</td>
          <td className="py-1 text-right font-mono">{tvis > 0 ? money(tv / tvis) : '—'}</td>
        </tr>
      </tbody>
    </table>
  )
}
