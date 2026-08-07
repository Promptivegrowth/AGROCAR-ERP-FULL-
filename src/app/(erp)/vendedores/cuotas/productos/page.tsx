'use client'

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Save, Copy, Target, Search, Calculator, Eraser, ClipboardPaste, X, Download, Printer, RotateCcw } from 'lucide-react'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Vendedor { id: string; nombre: string }

interface ProductoRow {
  producto_id: string
  codigo: string
  descripcion: string
  familia_id: string | null
  linea_codigo: string
  linea_nombre: string
  cuota_cantidad: number
  cuota_valor: number
  precio_ref: number
  precio_es_promedio: boolean
  /** Lo que este vendedor vendió del producto el mes anterior */
  vendido_ant_cant: number
  vendido_ant_valor: number
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

const num = (v: number, dec = 2) =>
  Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec })

export default function CuotasPorProductoPage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()

  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [vendedorId, setVendedorId] = useState('')
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [productos, setProductos] = useState<ProductoRow[]>([])
  // Ediciones en curso: producto_id → {cant, valor}
  const [edits, setEdits] = useState<Map<string, { cant: number; valor: number }>>(new Map())
  // Filas cuyo valor se digitó a mano: no se recalculan con el precio promedio
  const [valorManual, setValorManual_] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [lineaFiltro, setLineaFiltro] = useState('')
  const [soloConCuota, setSoloConCuota] = useState(false)
  const [pegarAbierto, setPegarAbierto] = useState(false)
  const [textoPegado, setTextoPegado] = useState('')

  // Vendedores
  useEffect(() => {
    ;(async () => {
      const { data } = await (supabase as any)
        .from('profiles').select('id, full_name, email')
        .eq('role', 'vendedor').eq('activo', true).order('full_name')
      const vs = (data ?? []).map((v: any) => ({ id: v.id, nombre: v.full_name || v.email }))
      setVendedores(vs)
      if (vs.length > 0) setVendedorId((prev) => prev || vs[0].id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cargar = useCallback(async () => {
    if (!vendedorId) return
    setLoading(true)
    const { data, error } = await (supabase.rpc as any)('cuotas_producto_matriz', {
      p_anio: anio, p_mes: mes, p_vendedor_id: vendedorId,
    })
    setLoading(false)
    if (error) { toast.error('Error al cargar', { description: error.message }); return }
    const rows = ((data?.productos ?? []) as any[]).map((p) => ({
      ...p,
      cuota_cantidad: Number(p.cuota_cantidad),
      cuota_valor: Number(p.cuota_valor),
      precio_ref: Number(p.precio_ref),
      vendido_ant_cant: Number(p.vendido_ant_cant ?? 0),
      vendido_ant_valor: Number(p.vendido_ant_valor ?? 0),
    })) as ProductoRow[]
    setProductos(rows)
    const m = new Map<string, { cant: number; valor: number }>()
    // Si el valor guardado no coincide con cantidad × precio promedio, fue
    // digitado a mano: se respeta y no se vuelve a recalcular solo.
    const manuales = new Set<string>()
    rows.forEach((p) => {
      m.set(p.producto_id, { cant: p.cuota_cantidad, valor: p.cuota_valor })
      const auto = Math.round(p.cuota_cantidad * p.precio_ref * 100) / 100
      if (p.cuota_valor > 0 && Math.abs(p.cuota_valor - auto) > 0.01) manuales.add(p.producto_id)
    })
    setEdits(m)
    setValorManual_(manuales)
    setDirty(false)
  }, [supabase, anio, mes, vendedorId])

  useEffect(() => { cargar() }, [cargar])

  // Daniel solo digita la CANTIDAD: "yo ingreso... tienes que venderme este mes
  // cien unidades, automáticamente debe jalarme ese precio promedio y el total".
  // El valor se calcula solo al escribir la cantidad. Si alguien edita el valor
  // a mano, esa fila queda "fijada" y ya no se recalcula.
  const setCantidad = (id: string, valor: string) => {
    const cant = parseFloat(valor.replace(',', '.')) || 0
    const prod = productos.find((p) => p.producto_id === id)
    setEdits((prev) => {
      const next = new Map(prev)
      const actual = next.get(id) ?? { cant: 0, valor: 0 }
      const fijado = valorManual.has(id)
      const nuevoValor = fijado || !prod || prod.precio_ref <= 0
        ? actual.valor
        : Math.round(cant * prod.precio_ref * 100) / 100
      next.set(id, { cant, valor: nuevoValor })
      return next
    })
    setDirty(true)
  }

  const setValorManual = (id: string, valor: string) => {
    const n = parseFloat(valor.replace(',', '.')) || 0
    setEdits((prev) => {
      const next = new Map(prev)
      const actual = next.get(id) ?? { cant: 0, valor: 0 }
      next.set(id, { ...actual, valor: n })
      return next
    })
    setValorManual_((prev) => new Set(prev).add(id))
    setDirty(true)
  }

  // Devolver una fila al cálculo automático
  const reautomatizar = (id: string) => {
    const prod = productos.find((p) => p.producto_id === id)
    setValorManual_((prev) => { const n = new Set(prev); n.delete(id); return n })
    setEdits((prev) => {
      const next = new Map(prev)
      const actual = next.get(id) ?? { cant: 0, valor: 0 }
      if (prod && prod.precio_ref > 0) {
        next.set(id, { ...actual, valor: Math.round(actual.cant * prod.precio_ref * 100) / 100 })
      }
      return next
    })
    setDirty(true)
  }

  // Recalcular TODO con el precio promedio (respeta las filas fijadas a mano)
  const recalcularTodo = () => {
    let n = 0
    setEdits((prev) => {
      const next = new Map(prev)
      productos.forEach((p) => {
        const e = next.get(p.producto_id)
        if (!e || e.cant <= 0 || p.precio_ref <= 0 || valorManual.has(p.producto_id)) return
        next.set(p.producto_id, { ...e, valor: Math.round(e.cant * p.precio_ref * 100) / 100 })
        n++
      })
      return next
    })
    setDirty(true)
    toast.success(`${n} valores recalculados con el precio promedio`)
  }

  const limpiarTodo = () => {
    if (!confirm('¿Poner en cero TODAS las cuotas de este vendedor en el mes? (se aplica al guardar)')) return
    setEdits((prev) => {
      const next = new Map(prev)
      next.forEach((_, k) => next.set(k, { cant: 0, valor: 0 }))
      return next
    })
    setDirty(true)
  }

  // Importar pegado desde Excel: CODIGO <tab|;> CANTIDAD <tab|;> VALOR
  const importarPegado = () => {
    const porCodigo = new Map(productos.map((p) => [p.codigo.trim().toUpperCase(), p.producto_id]))
    let ok = 0
    const noEncontrados: string[] = []
    const next = new Map(edits)
    const manuales = new Set(valorManual)

    textoPegado.split(/\r?\n/).forEach((linea) => {
      if (!linea.trim()) return
      const partes = linea.split(/\t|;|,/).map((s) => s.trim())
      if (partes.length < 2) return
      const cod = partes[0].toUpperCase()
      const id = porCodigo.get(cod)
      if (!id) { if (noEncontrados.length < 12) noEncontrados.push(partes[0]); return }
      const cant = parseFloat((partes[1] || '0').replace(',', '.')) || 0
      const prod = productos.find((p) => p.producto_id === id)
      if (partes.length >= 3 && partes[2] !== '') {
        // Trae valor explícito: se respeta y queda fijado a mano
        next.set(id, { cant, valor: parseFloat(partes[2].replace(',', '.')) || 0 })
        manuales.add(id)
      } else {
        // Solo cantidad: el valor se calcula con el precio promedio
        next.set(id, {
          cant,
          valor: prod && prod.precio_ref > 0 ? Math.round(cant * prod.precio_ref * 100) / 100 : 0,
        })
        manuales.delete(id)
      }
      ok++
    })

    setEdits(next)
    setValorManual_(manuales)
    setDirty(true)
    setPegarAbierto(false)
    setTextoPegado('')
    if (ok > 0) toast.success(`${ok} productos actualizados desde el pegado`)
    if (noEncontrados.length > 0) {
      toast.warning(`${noEncontrados.length} códigos no existen`, { description: noEncontrados.join(', ') })
    }
    if (ok === 0 && noEncontrados.length === 0) toast.error('No se reconoció ninguna fila')
  }

  // Excel + impresión: Christopher los pidió para que los vendedores tengan
  // su cuota del mes en físico mientras se acostumbran al sistema.
  const exportarExcel = () => {
    const vend = vendedores.find((v) => v.id === vendedorId)?.nombre ?? ''
    const filas: string[] = []
    filas.push(`CUOTAS POR PRODUCTO;${MESES[mes-1]} ${anio};${vend}`)
    filas.push('LINEA;CODIGO;DESCRIPCION;CUOTA CANTIDAD;PRECIO PROMEDIO;CUOTA VALOR S/')
    grupos.forEach((g) => {
      g.items.forEach((p) => {
        const e = edits.get(p.producto_id) ?? { cant: 0, valor: 0 }
        if (e.cant === 0 && e.valor === 0) return
        filas.push([
          `${g.codigo} - ${g.nombre}`, p.codigo, `"${p.descripcion.replace(/"/g, "'")}"`,
          num(e.cant), num(p.precio_ref), num(e.valor),
        ].join(';'))
      })
      filas.push(`;;TOTAL LINEA ${g.codigo} - ${g.nombre};;;${num(totalLinea(g.items))}`)
    })
    filas.push(`;;TOTAL GENERAL;;;${num(totales.valor)}`)

    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cuotas_${anio}${String(mes).padStart(2, '0')}_${vend.replace(/\s+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const guardar = async () => {
    if (!vendedorId) return
    setSaving(true)
    const payload = productos.map((p) => {
      const e = edits.get(p.producto_id) ?? { cant: 0, valor: 0 }
      return { producto_id: p.producto_id, cuota_cantidad: e.cant, cuota_valor: e.valor }
    })
    const { data, error } = await (supabase.rpc as any)('upsert_cuotas_producto_mes', {
      p_anio: anio, p_mes: mes, p_vendedor_id: vendedorId, p_cuotas: payload,
    })
    setSaving(false)
    if (error) { toast.error('Error al guardar', { description: error.message }); return }
    toast.success(`Cuotas guardadas · ${MESES[mes-1]} ${anio}`, {
      description: `${data?.guardadas ?? 0} productos con cuota · las cuotas por familia se recalcularon solas`,
    })
    setDirty(false)
    cargar()
  }

  const copiarAnterior = async () => {
    if (dirty && !confirm('Tienes cambios sin guardar. ¿Descartarlos y copiar el mes anterior?')) return
    const { data, error } = await (supabase.rpc as any)('copiar_cuotas_producto_mes_anterior', {
      p_anio: anio, p_mes: mes, p_vendedor_id: vendedorId,
    })
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(`${data ?? 0} cuotas copiadas del mes anterior`)
    cargar()
  }

  // Líneas disponibles
  const lineas = useMemo(() => {
    const m = new Map<string, string>()
    productos.forEach((p) => m.set(p.linea_codigo, p.linea_nombre))
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [productos])

  // Filtrado + agrupado por línea
  const grupos = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtrados = productos.filter((p) => {
      if (lineaFiltro && p.linea_codigo !== lineaFiltro) return false
      if (q && !p.descripcion.toLowerCase().includes(q) && !p.codigo.toLowerCase().includes(q)) return false
      if (soloConCuota) {
        const e = edits.get(p.producto_id)
        if (!e || (e.cant === 0 && e.valor === 0)) return false
      }
      return true
    })
    const map = new Map<string, { codigo: string; nombre: string; items: ProductoRow[] }>()
    filtrados.forEach((p) => {
      const k = `${p.linea_codigo}|${p.linea_nombre}`
      if (!map.has(k)) map.set(k, { codigo: p.linea_codigo, nombre: p.linea_nombre, items: [] })
      map.get(k)!.items.push(p)
    })
    return Array.from(map.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [productos, busqueda, lineaFiltro, soloConCuota, edits])

  // Totales
  const totales = useMemo(() => {
    let valor = 0, conCuota = 0
    edits.forEach((e) => { valor += e.valor; if (e.cant > 0 || e.valor > 0) conCuota++ })
    return { valor, conCuota }
  }, [edits])

  const totalLinea = (items: ProductoRow[]) =>
    items.reduce((a, p) => a + (edits.get(p.producto_id)?.valor ?? 0), 0)

  const vendedorNombre = vendedores.find((v) => v.id === vendedorId)?.nombre ?? '—'

  return (
    <div className="space-y-4">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 10mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
        .hoja-cuotas table { font-size: 8pt !important; }
        .hoja-cuotas tr { break-inside: avoid; }
      }`}</style>

      {/* Hoja imprimible: la cuota del mes para entregarle al vendedor en físico */}
      <div className="hidden print:block hoja-cuotas">
        <div className="pb-2 mb-2 border-b-2 border-black">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-bold text-base">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
              <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
            </div>
            <div className="text-right text-xs">
              <p className="font-bold text-sm">CUOTA DEL MES POR PRODUCTO</p>
              <p>{MESES[mes-1]} {anio}</p>
            </div>
          </div>
          <p className="mt-2 text-sm font-bold uppercase">VENDEDOR: {vendedorNombre}</p>
        </div>

        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-y border-black">
              <th className="text-left px-1 py-1">CÓDIGO</th>
              <th className="text-left px-1 py-1">DESCRIPCIÓN</th>
              <th className="text-right px-1 py-1 w-[70px]">CANTIDAD</th>
              <th className="text-right px-1 py-1 w-[80px]">P. PROM.</th>
              <th className="text-right px-1 py-1 w-[90px]">VALOR S/</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => {
              const conCuota = g.items.filter((p) => {
                const e = edits.get(p.producto_id)
                return e && (e.cant > 0 || e.valor > 0)
              })
              if (conCuota.length === 0) return null
              return (
                <Fragment key={`print-${g.codigo}-${g.nombre}`}>
                  <tr>
                    <td colSpan={5} className="px-1 pt-2 pb-0.5 font-bold uppercase">
                      LÍNEA: {g.codigo} - {g.nombre}
                    </td>
                  </tr>
                  {conCuota.map((p) => {
                    const e = edits.get(p.producto_id)!
                    return (
                      <tr key={`print-${p.producto_id}`}>
                        <td className="px-1 py-0.5 font-mono">{p.codigo}</td>
                        <td className="px-1 py-0.5">{p.descripcion}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(e.cant)}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(p.precio_ref)}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(e.valor)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-y border-gray-400 font-bold">
                    <td colSpan={4} className="px-1 py-0.5 text-right uppercase">
                      TOTAL LÍNEA {g.codigo} - {g.nombre}
                    </td>
                    <td className="px-1 py-0.5 text-right font-mono">{num(totalLinea(g.items))}</td>
                  </tr>
                </Fragment>
              )
            })}
            <tr className="border-t-2 border-black font-bold text-[11px]">
              <td colSpan={4} className="px-1 py-2 text-right">TOTAL CUOTA DEL MES</td>
              <td className="px-1 py-2 text-right font-mono">S/ {num(totales.valor)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-10 flex justify-between text-[10px]">
          <div className="border-t border-black pt-1 w-[45%] text-center">Firma del vendedor</div>
          <div className="border-t border-black pt-1 w-[45%] text-center">Firma de gerencia</div>
        </div>
      </div>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-blue-600" />
            Cuotas por Producto
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Objetivo mensual de cada producto en <b>cantidad</b> y <b>valor</b> · agrupado por línea
          </p>
        </div>
        <Link href="/vendedores/cuotas"
          className="text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-md">
          Cuotas por familia
        </Link>
        <Link href={`/reportes/alcance-objetivos?anio=${anio}&mes=${mes}&vendedor=${vendedorId}`}
          className="text-xs px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-md">
          📊 Ver alcance de objetivos
        </Link>
      </div>

      {/* Barra de control */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <Label className="text-[10px] text-gray-500">Vendedor</Label>
            <select value={vendedorId} onChange={(e) => {
              if (dirty && !confirm('Tienes cambios sin guardar. ¿Cambiar de vendedor y descartarlos?')) return
              setVendedorId(e.target.value)
            }}
              className="block mt-1 h-9 px-2 w-full text-sm border border-gray-300 rounded-md bg-white">
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">Mes</Label>
            <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
              className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
              {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">Año</Label>
            <Input type="number" value={anio} onChange={(e) => setAnio(parseInt(e.target.value) || ahora.getFullYear())}
              className="w-24 h-9 text-sm" min={2024} max={2100} />
          </div>
          <div className="flex-1" />
          {dirty && <span className="text-xs font-semibold text-amber-700">⚠ Cambios sin guardar</span>}
          <Button onClick={guardar} disabled={saving || !dirty} className="bg-blue-600 hover:bg-blue-700 gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar cuotas
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-gray-400" />
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto o código…" className="h-8 pl-7 text-xs w-56" />
          </div>
          <select value={lineaFiltro} onChange={(e) => setLineaFiltro(e.target.value)}
            className="h-8 px-2 text-xs border border-gray-300 rounded-md bg-white">
            <option value="">Todas las líneas</option>
            {lineas.map(([cod, nom]) => <option key={cod} value={cod}>{cod} - {nom}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={soloConCuota} onChange={(e) => setSoloConCuota(e.target.checked)} className="w-3.5 h-3.5" />
            Solo con cuota
          </label>

          <div className="flex-1" />

          <Button variant="outline" size="sm" onClick={copiarAnterior} disabled={loading || saving} className="gap-1 h-8 text-xs">
            <Copy className="w-3.5 h-3.5" /> Copiar mes anterior
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPegarAbierto(true)} className="gap-1 h-8 text-xs">
            <ClipboardPaste className="w-3.5 h-3.5" /> Pegar desde Excel
          </Button>
          <Button variant="outline" size="sm" onClick={recalcularTodo} className="gap-1 h-8 text-xs">
            <Calculator className="w-3.5 h-3.5" /> Recalcular precios
          </Button>
          <Button variant="outline" size="sm" onClick={exportarExcel} className="gap-1 h-8 text-xs">
            <Download className="w-3.5 h-3.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1 h-8 text-xs">
            <Printer className="w-3.5 h-3.5" /> Imprimir
          </Button>
          <Button variant="outline" size="sm" onClick={limpiarTodo} className="gap-1 h-8 text-xs text-red-600 hover:bg-red-50">
            <Eraser className="w-3.5 h-3.5" /> Limpiar
          </Button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 no-print">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-semibold text-blue-700">CUOTA TOTAL DEL MES</p>
          <p className="text-xl font-bold text-blue-900">S/ {num(totales.valor)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-semibold text-emerald-700">PRODUCTOS CON CUOTA</p>
          <p className="text-xl font-bold text-emerald-900">{totales.conCuota}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-semibold text-gray-600">CATÁLOGO ACTIVO</p>
          <p className="text-xl font-bold text-gray-800">{productos.length}</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden no-print">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : grupos.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Sin productos que coincidan con el filtro</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="text-left p-2 font-semibold border-b w-[80px]">Código</th>
                  <th className="text-left p-2 font-semibold border-b">Descripción</th>
                  <th className="text-right p-2 font-semibold border-b w-[110px]">
                    Vendió mes ant.
                    <span className="block text-[9px] font-normal text-gray-400">referencia</span>
                  </th>
                  <th className="text-right p-2 font-semibold border-b w-[95px]">Precio prom.</th>
                  <th className="text-center p-2 font-semibold border-b w-[110px]">
                    Cuota cantidad
                    <span className="block text-[9px] font-normal text-blue-600">← escriba aquí</span>
                  </th>
                  <th className="text-center p-2 font-semibold border-b w-[135px]">
                    Cuota valor S/
                    <span className="block text-[9px] font-normal text-gray-400">se calcula solo</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <Fragment key={`${g.codigo}-${g.nombre}`}>
                    <tr className="bg-gray-100">
                      <td colSpan={5} className="px-2 py-1 font-bold uppercase text-gray-800">
                        LÍNEA: {g.codigo} - {g.nombre}
                        <span className="ml-2 font-normal text-gray-500">({g.items.length} productos)</span>
                      </td>
                      <td className="px-2 py-1 text-right font-bold font-mono text-gray-800">
                        S/ {num(totalLinea(g.items))}
                      </td>
                    </tr>
                    {g.items.map((p) => {
                      const e = edits.get(p.producto_id) ?? { cant: 0, valor: 0 }
                      const conCuota = e.cant > 0 || e.valor > 0
                      const fijado = valorManual.has(p.producto_id)
                      return (
                        <tr key={p.producto_id} className={`border-b border-gray-100 ${conCuota ? 'bg-yellow-50/40' : ''}`}>
                          <td className="p-1.5 font-mono text-gray-600">{p.codigo}</td>
                          <td className="p-1.5">{p.descripcion}</td>
                          <td className="p-1.5 text-right">
                            {p.vendido_ant_cant > 0 ? (
                              <button type="button"
                                onClick={() => setCantidad(p.producto_id, String(p.vendido_ant_cant))}
                                title={`Usar ${num(p.vendido_ant_cant)} como cuota (vendió S/ ${num(p.vendido_ant_valor)})`}
                                className="font-mono text-[11px] text-blue-700 hover:bg-blue-50 rounded px-1 py-0.5 underline decoration-dotted">
                                {num(p.vendido_ant_cant)}
                              </button>
                            ) : (
                              <span className="font-mono text-gray-300">—</span>
                            )}
                          </td>
                          <td className="p-1.5 text-right font-mono text-gray-500">
                            {p.precio_ref > 0 ? num(p.precio_ref) : '—'}
                            {p.precio_ref > 0 && !p.precio_es_promedio && (
                              <span title="No se vendió el mes pasado: se usa el precio de lista B"
                                className="ml-1 text-[9px] text-amber-600 font-sans">L</span>
                            )}
                          </td>
                          <td className="p-1">
                            <Input type="number" min="0" step="1" value={e.cant || ''} placeholder="0"
                              onChange={(ev) => setCantidad(p.producto_id, ev.target.value)}
                              className="h-7 text-xs text-right font-mono" />
                          </td>
                          <td className="p-1">
                            <div className="flex items-center gap-1">
                              <Input type="number" min="0" step="10" value={e.valor || ''} placeholder="0"
                                onChange={(ev) => setValorManual(p.producto_id, ev.target.value)}
                                title={fijado
                                  ? 'Valor digitado a mano — no se recalcula'
                                  : `Calculado: ${num(e.cant)} × ${num(p.precio_ref)}`}
                                className={`h-7 text-xs text-right font-mono ${
                                  fijado ? 'border-amber-400 bg-amber-50' : 'bg-gray-50 text-gray-700'
                                }`} />
                              {fijado && (
                                <button type="button" title="Volver al cálculo automático"
                                  onClick={() => reautomatizar(p.producto_id)}
                                  className="p-1 text-amber-600 hover:bg-amber-100 rounded">
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-gray-500 space-y-1 no-print">
        <p>
          💡 <b>Vendió mes ant.</b> es lo que este vendedor vendió de ese producto el mes
          pasado. Haz clic en el número para usarlo como cuota y ajustarlo desde ahí.
        </p>
        <p>
          <b>Precio prom.</b> es el precio promedio de venta real del mes anterior
          (total vendido ÷ cantidad vendida), por eso varía cada mes. Si el producto no se vendió
          el mes pasado se usa el precio de lista B y se marca con una <b className="text-amber-600">L</b>.
        </p>
        <p>
          Al guardar, la <b>cuota por familia</b> se recalcula automáticamente como la suma de las cuotas
          de sus productos — el vendedor la ve al instante en su aplicativo. Cantidad y valor en 0 = sin cuota.
        </p>
      </div>

      {/* Modal pegar desde Excel */}
      {pegarAbierto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-bold text-gray-900">Pegar cuotas desde Excel</h2>
              <button onClick={() => setPegarAbierto(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-600">
                Copia de tu Excel las columnas <b>CÓDIGO · CANTIDAD · VALOR</b> (el valor es opcional) y
                pégalas aquí. Una línea por producto. Se aceptan tabulaciones, punto y coma o comas.
              </p>
              <pre className="text-[10px] bg-gray-50 border rounded p-2 text-gray-600">
{`PT762A    2050    28526.41
PT746     60.4    2144.21
PT723J    190     4465.00`}
              </pre>
              <textarea value={textoPegado} onChange={(e) => setTextoPegado(e.target.value)}
                rows={10} placeholder="Pega aquí…"
                className="w-full border border-gray-300 rounded-md p-2 text-xs font-mono" />
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="outline" onClick={() => setPegarAbierto(false)}>Cancelar</Button>
              <Button onClick={importarPegado} disabled={!textoPegado.trim()} className="bg-blue-600 hover:bg-blue-700">
                Importar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
