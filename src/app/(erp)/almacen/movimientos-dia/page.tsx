'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Package, Search, Loader2, Calendar } from 'lucide-react'

/**
 * Movimientos del día — control de almacén.
 *
 * Vista para cuadrar el almacén: muestra todos los productos que salieron
 * (se vendieron/facturaron) en un rango de fechas, con filtros por vendedor,
 * tipo de comprobante y código de producto.
 *
 * Al hacer click en una fila, se abre un dialog con los clientes que
 * compraron ese producto (con cantidad, peso, precio unitario y subtotal).
 *
 * NO es un reporte exportable — es para visualización operativa.
 * Daniel pidió esto para cuadrar lo que sale del almacén y detectar
 * productos adicionales / devoluciones (estas últimas en el módulo
 * Notas de Crédito por ahora).
 *
 * Filtrar por despacho
 * --------------------
 * Por fecha esta vista nunca cuadra contra la hoja de ruta que el repartidor
 * lleva impresa, y no porque una de las dos esté mal: miden cosas distintas.
 * La hoja de ruta agrupa por VIAJE —lo que sube al camión— y un viaje puede
 * llevar pedidos de días anteriores que quedaron sin entregar. Esta vista
 * agrupa por FECHA DEL COMPROBANTE. El 26/08/2026 la diferencia fueron
 * S/ 503.38: tres pedidos facturados el 25 que salieron con el reparto del 26.
 *
 * Por eso se puede elegir un despacho: ahí se ve exactamente lo que subió a
 * ese camión —los mismos pedidos, el mismo monto, las mismas unidades y
 * kilos— y cuadra contra el papel. Al elegirlo, el rango de fechas queda de
 * lado: manda el despacho.
 */

interface ItemRow {
  comp_id: string
  comp_serie: string
  comp_numero: number
  comp_tipo: string
  comp_fecha: string
  /** El dia en que la mercaderia sale del almacen: por este se agrupa. */
  comp_fecha_despacho: string | null
  comp_created_at: string
  cliente_nombre: string
  cliente_doc: string
  vendedor_id: string | null
  vendedor_nombre: string
  producto_id: string | null
  codigo: string
  producto_nombre: string
  familia: string
  cantidad: number
  peso_unit: number
  peso_total: number
  precio_unit: number
  subtotal: number
}

/** Un viaje, como aparece en el selector y en la línea de cuadre. */
interface Despacho {
  id: string
  numero: string
  fecha_despacho: string
  total_pedidos: number
  total_monto: number
  placa: string
}

interface ProductoAgg {
  producto_id: string | null
  codigo: string
  nombre: string
  familia: string
  cantidad: number
  peso: number
  total_venta: number
  pup: number  // precio unitario promedio
  items: ItemRow[]
}

export default function MovimientosDiaPage() {
  const supabase = createClient()

  const hoy = hoyLima()
  const [desde, setDesde] = useState(hoy)
  const [hasta, setHasta] = useState(hoy)
  const [tipoComp, setTipoComp] = useState<string>('todos')
  const [vendedorId, setVendedorId] = useState<string>('todos')
  const [despachoId, setDespachoId] = useState<string>('todos')
  const [filtroProducto, setFiltroProducto] = useState('')
  const [vendedores, setVendedores] = useState<{ id: string; full_name: string }[]>([])
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(false)
  const [openProducto, setOpenProducto] = useState<ProductoAgg | null>(null)

  // Cargar vendedores para el filtro
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['vendedor', 'facturador', 'administrador'])
        .eq('activo', true)
        .order('full_name')
      setVendedores((data ?? []) as any)
    })()
  }, [supabase])

  // Despachos recientes para el filtro. Se acotan a los últimos 60 días
  // porque el selector se vuelve inmanejable con un año entero y el cuadre
  // siempre se hace sobre repartos de esta semana o la pasada.
  useEffect(() => {
    ;(async () => {
      const desdeD = new Date(hoy + 'T00:00:00-05:00')
      desdeD.setDate(desdeD.getDate() - 60)
      const { data } = await (supabase as any)
        .from('despachos')
        .select('id, numero, fecha_despacho, total_pedidos, total_monto, vehiculos(placa)')
        .gte('fecha_despacho', desdeD.toISOString().slice(0, 10))
        .order('fecha_despacho', { ascending: false })
        .order('numero', { ascending: false })
      setDespachos(((data ?? []) as any[]).map((d) => ({
        id: d.id,
        numero: d.numero,
        fecha_despacho: d.fecha_despacho,
        total_pedidos: Number(d.total_pedidos ?? 0),
        total_monto: Number(d.total_monto ?? 0),
        placa: d.vehiculos?.placa ?? '—',
      })))
    })()
  }, [supabase, hoy])

  const loadMovimientos = useCallback(async () => {
    setLoading(true)
    try {
      /*
       * Si hay un despacho elegido, primero hay que saber qué pedidos llevaba.
       * No alcanza con mirar la fecha: un viaje puede cargar pedidos de días
       * anteriores que quedaron sin entregar, y son justamente esos los que
       * hacen que el cuadre por fecha no dé.
       */
      let pedidosDelDespacho: string[] | null = null
      if (despachoId !== 'todos') {
        const { data: di } = await (supabase as any)
          .from('despachos_items')
          .select('pedido_id')
          .eq('despacho_id', despachoId)
        pedidosDelDespacho = ((di ?? []) as any[])
          .map((x) => x.pedido_id)
          .filter(Boolean)
        // Un despacho sin pedidos no debe caer al filtro por fecha y mostrar
        // todo el día como si fuera suyo: mejor vacío que un número inventado.
        if (pedidosDelDespacho.length === 0) {
          setItems([])
          return
        }
      }

      let q = (supabase as any)
        .from('comprobantes_items')
        .select(`
          cantidad, precio_unitario, subtotal, descripcion, producto_id,
          productos(id, codigo, nombre, descripcion, peso_kg, familias(nombre)),
          comprobantes!inner(
            id, serie, numero, tipo, fecha_emision, fecha_despacho, created_at, estado,
            clientes(razon_social, ruc, dni),
            cliente_externo_nombre,
            pedidos(vendedor_id, profiles!pedidos_vendedor_id_fkey(full_name))
          )
        `)
        .neq('comprobantes.estado', 'anulado')

      if (pedidosDelDespacho) {
        q = q.in('comprobantes.pedido_id', pedidosDelDespacho)
      } else {
        /*
         * Se agrupa por la fecha de DESPACHO, no por la de emision.
         *
         * AGROCAR factura hoy lo que reparte manana: se deja todo impreso la
         * noche anterior. El consolidado tiene que contar esa mercaderia el dia
         * que sale del almacen, que es lo que el almacenero esta cuadrando.
         *
         * Antes se agrupaba por fecha de emision y coincidia de casualidad,
         * porque la emision copiaba la fecha de despacho del pedido. Eso dejo
         * de pasar cuando la emision se acoto a hoy -SUNAT rechaza comprobantes
         * fechados adelante-, y entonces los 55 comprobantes emitidos el 2 de
         * setiembre para repartir el 3 desaparecieron del consolidado del 3.
         *
         * Las dos fechas son correctas y cada una sirve para algo distinto: la
         * de emision es la legal, la de despacho es la operativa. Este reporte
         * es operativo.
         */
        q = q
          .gte('comprobantes.fecha_despacho', desde)
          .lte('comprobantes.fecha_despacho', hasta)
      }

      if (tipoComp !== 'todos') q = q.eq('comprobantes.tipo', tipoComp)
      const { data, error } = await q

      if (error) {
        console.error(error)
        setItems([])
        return
      }

      let rows: ItemRow[] = (data ?? []).map((it: any) => {
        const cant = Number(it.cantidad ?? 0)
        const pesoUnit = Number(it.productos?.peso_kg ?? 0)
        return {
          comp_id: it.comprobantes.id,
          comp_serie: it.comprobantes.serie,
          comp_numero: it.comprobantes.numero,
          comp_tipo: it.comprobantes.tipo,
          comp_fecha: it.comprobantes.fecha_emision,
          comp_fecha_despacho: it.comprobantes.fecha_despacho,
          comp_created_at: it.comprobantes.created_at,
          cliente_nombre: it.comprobantes.clientes?.razon_social ?? it.comprobantes.cliente_externo_nombre ?? 'Consumidor final',
          cliente_doc: it.comprobantes.clientes?.ruc ?? it.comprobantes.clientes?.dni ?? '',
          vendedor_id: it.comprobantes.pedidos?.vendedor_id ?? null,
          vendedor_nombre: it.comprobantes.pedidos?.profiles?.full_name ?? '—',
          producto_id: it.producto_id,
          codigo: it.productos?.codigo ?? '—',
          // Daniel pidió mostrar la descripción completa del producto
          // (con presentación: gramaje, marca, etc.) — no solo el nombre corto.
          // Prioridad: productos.descripcion → productos.nombre → item.descripcion
          producto_nombre: (it.productos?.descripcion?.trim()
                          || it.productos?.nombre
                          || it.descripcion
                          || '—'),
          familia: it.productos?.familias?.nombre ?? '—',
          cantidad: cant,
          peso_unit: pesoUnit,
          peso_total: cant * pesoUnit,
          precio_unit: Number(it.precio_unitario ?? 0),
          subtotal: Number(it.subtotal ?? 0),
        }
      })

      // Filtro por vendedor (en cliente porque no se puede chainear .eq sobre relación anidada)
      if (vendedorId !== 'todos') {
        rows = rows.filter((r) => r.vendedor_id === vendedorId)
      }

      setItems(rows)
    } finally {
      setLoading(false)
    }
  }, [supabase, desde, hasta, tipoComp, vendedorId, despachoId])

  useEffect(() => { loadMovimientos() }, [loadMovimientos])

  // Agregación por producto + filtro por texto
  const productosAgg = useMemo<ProductoAgg[]>(() => {
    const q = filtroProducto.trim().toLowerCase()
    const map = new Map<string, ProductoAgg>()
    items.forEach((it) => {
      // Filtro por código/nombre
      if (q.length > 0 &&
          !it.codigo.toLowerCase().includes(q) &&
          !it.producto_nombre.toLowerCase().includes(q)) return
      const key = it.producto_id ?? `__${it.codigo}`
      const acc = map.get(key) ?? {
        producto_id: it.producto_id,
        codigo: it.codigo,
        nombre: it.producto_nombre,
        familia: it.familia,
        cantidad: 0, peso: 0, total_venta: 0, pup: 0,
        items: [],
      }
      acc.cantidad += it.cantidad
      acc.peso += it.peso_total
      acc.total_venta += it.subtotal
      acc.items.push(it)
      map.set(key, acc)
    })
    const arr = Array.from(map.values())
    arr.forEach((p) => {
      p.pup = p.cantidad > 0 ? p.total_venta / p.cantidad : 0
    })
    return arr.sort((a, b) => b.total_venta - a.total_venta)
  }, [items, filtroProducto])

  const totales = useMemo(() => ({
    productos: productosAgg.length,
    cantidad: productosAgg.reduce((a, p) => a + p.cantidad, 0),
    peso: productosAgg.reduce((a, p) => a + p.peso, 0),
    total: productosAgg.reduce((a, p) => a + p.total_venta, 0),
    comprobantes: new Set(items.map((i) => i.comp_id)).size,
  }), [productosAgg, items])

  const despachoSel = useMemo(
    () => despachos.find((d) => d.id === despachoId) ?? null,
    [despachos, despachoId],
  )

  // Elegir una fecha es decir "quiero ver por fecha": suelta el despacho.
  const setHoyRango = () => { setDespachoId('todos'); setDesde(hoy); setHasta(hoy) }
  const setAyer = () => {
    const d = new Date(hoy + 'T00:00:00-05:00'); d.setDate(d.getDate() - 1)
    const s = d.toISOString().slice(0, 10)
    setDespachoId('todos'); setDesde(s); setHasta(s)
  }
  const setSemana = () => {
    const d = new Date(hoy + 'T00:00:00-05:00'); d.setDate(d.getDate() - 6)
    setDespachoId('todos'); setDesde(d.toISOString().slice(0, 10)); setHasta(hoy)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" />
            Movimientos del día
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {despachoSel
              ? `Despacho ${despachoSel.numero} · ${formatDate(despachoSel.fecha_despacho)} · ${despachoSel.placa} — lo que subió a ese camión`
              : 'Lo que sale del almacén, por día de despacho — para cuadrar'}
          </p>
        </div>
        <div className="text-right bg-black text-white rounded-lg px-4 py-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Monto Total</p>
          <p className="text-xl font-bold text-[#FBE600]">{formatCurrency(totales.total)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-[10px] text-gray-500">Despacho (hoja de ruta)</Label>
            <Select value={despachoId} onValueChange={setDespachoId}>
              <SelectTrigger className="w-64 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Por fecha (no por despacho)</SelectItem>
                {despachos.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.numero} · {formatDate(d.fecha_despacho)} · {d.placa} · {d.total_pedidos} ped.
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={`flex gap-1 ${despachoSel ? 'opacity-40 pointer-events-none' : ''}`}>
            <button onClick={setHoyRango}
              className={`px-2 py-1.5 text-xs font-semibold rounded border ${
                desde === hoy && hasta === hoy ? 'bg-[#FBE600] border-yellow-500' : 'bg-white border-gray-300 hover:bg-gray-50'
              }`}>
              <Calendar className="w-3 h-3 inline mr-0.5" />Hoy
            </button>
            <button onClick={setAyer}
              className="px-2 py-1.5 text-xs font-semibold rounded border bg-white border-gray-300 hover:bg-gray-50">
              Ayer
            </button>
            <button onClick={setSemana}
              className="px-2 py-1.5 text-xs font-semibold rounded border bg-white border-gray-300 hover:bg-gray-50">
              7 días
            </button>
          </div>
          <div className={despachoSel ? 'opacity-40 pointer-events-none' : ''}>
            <Label className="text-[10px] text-gray-500">Desde (despacho)</Label>
            <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-36 h-8 text-xs" />
          </div>
          <div className={despachoSel ? 'opacity-40 pointer-events-none' : ''}>
            <Label className="text-[10px] text-gray-500">Hasta (despacho)</Label>
            <Input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className="w-36 h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">Tipo Comp.</Label>
            <Select value={tipoComp} onValueChange={setTipoComp}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="factura">Factura</SelectItem>
                <SelectItem value="boleta">Boleta</SelectItem>
                <SelectItem value="nota_pedido_interna">Doc. interno</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-gray-500">Vendedor</Label>
            <Select value={vendedorId} onValueChange={setVendedorId}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[10px] text-gray-500">Producto (código o nombre)</Label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input value={filtroProducto} onChange={(e) => setFiltroProducto(e.target.value)}
                className="pl-7 h-8 text-xs" placeholder="Buscar..." />
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-500 mt-2">
          {totales.productos} productos · {totales.cantidad.toFixed(2)} unidades · {totales.peso.toFixed(2)} kg ·
          {' '}{totales.comprobantes} comprobantes
        </p>

        {/*
          El cuadre contra el papel. Se muestra solo con un despacho elegido,
          que es cuando las dos cifras son comparables: mismo viaje, mismos
          pedidos. Si la diferencia no es cero hay algo real que mirar —un
          pedido sin comprobante, uno anulado— y no un desfase de fechas.
        */}
        {despachoSel && (
          <div className="mt-2 border-t border-gray-200 pt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px]">
            <span className="font-semibold text-gray-700">
              Cuadre contra la hoja de ruta {despachoSel.numero}
            </span>
            <span className="text-gray-600">
              Hoja de ruta: <strong>{despachoSel.total_pedidos}</strong> pedidos ·
              {' '}<strong>{formatCurrency(despachoSel.total_monto)}</strong>
            </span>
            <span className="text-gray-600">
              Facturado: <strong>{totales.comprobantes}</strong> comprobantes ·
              {' '}<strong>{formatCurrency(totales.total)}</strong>
            </span>
            {(() => {
              // Se compara con un centavo de tolerancia: los subtotales se
              // redondean por línea y una suma de 138 líneas puede quedar a
              // medio centavo sin que falte nada.
              const dif = totales.total - despachoSel.total_monto
              const cuadra = Math.abs(dif) < 0.01 && !filtroProducto.trim() && tipoComp === 'todos' && vendedorId === 'todos'
              if (cuadra) {
                return <span className="px-2 py-0.5 rounded bg-green-100 text-green-800 font-semibold">Cuadra exacto</span>
              }
              if (filtroProducto.trim() || tipoComp !== 'todos' || vendedorId !== 'todos') {
                return <span className="text-gray-500">(hay otros filtros puestos — quitalos para cuadrar el total)</span>
              }
              return (
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                  Diferencia: {formatCurrency(dif)}
                </span>
              )
            })()}
          </div>
        )}
      </div>

      {/* Tabla principal */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : productosAgg.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">
            {despachoSel
              ? 'Ese despacho no tiene pedidos facturados.'
              : 'Sin movimientos en el período seleccionado.'}
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="border-b border-gray-200">
                  <th className="text-left p-2 font-semibold text-gray-600 w-20">Cód.</th>
                  <th className="text-left p-2 font-semibold text-gray-600">Producto</th>
                  <th className="text-left p-2 font-semibold text-gray-600 w-32">Familia</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-20">Cant.</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-20">Peso (kg)</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-28">Total venta</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-20">P.U.P.</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-16">Clientes</th>
                </tr>
              </thead>
              <tbody>
                {productosAgg.map((p) => (
                  <tr
                    key={p.codigo}
                    onClick={() => setOpenProducto(p)}
                    className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                    title="Click para ver clientes que compraron este producto"
                  >
                    <td className="p-2 font-mono text-[10px] text-gray-700">{p.codigo}</td>
                    <td className="p-2 font-medium text-gray-900">{p.nombre}</td>
                    <td className="p-2 text-gray-600 text-[11px] truncate max-w-[140px]">{p.familia}</td>
                    <td className="p-2 text-right font-mono font-semibold">{p.cantidad.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{p.peso.toFixed(3)}</td>
                    <td className="p-2 text-right font-mono font-bold">{formatCurrency(p.total_venta)}</td>
                    <td className="p-2 text-right font-mono text-gray-600">{p.pup.toFixed(3)}</td>
                    <td className="p-2 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">
                        {new Set(p.items.map((i) => i.cliente_nombre)).size}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-gray-100 z-10">
                <tr className="border-t-2 border-gray-300 font-bold">
                  <td colSpan={3} className="p-2 text-right">TOTALES</td>
                  <td className="p-2 text-right font-mono">{totales.cantidad.toFixed(2)}</td>
                  <td className="p-2 text-right font-mono">{totales.peso.toFixed(3)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(totales.total)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Dialog: Clientes que compraron el producto */}
      <Dialog open={!!openProducto} onOpenChange={(o) => !o && setOpenProducto(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              <span className="font-mono text-xs text-gray-500">{openProducto?.codigo}</span>{' '}
              {openProducto?.nombre}
            </DialogTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              {openProducto?.items.length ?? 0} ventas ·
              {' '}{openProducto?.cantidad.toFixed(2)} unidades ·
              {' '}{formatCurrency(openProducto?.total_venta ?? 0)} ·
              Familia: <strong>{openProducto?.familia}</strong>
            </p>
          </DialogHeader>
          {openProducto && (
            <div className="mt-2">
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-2">Fecha</th>
                    <th className="text-left p-2">Comprobante</th>
                    <th className="text-left p-2">Cliente</th>
                    <th className="text-left p-2">Vendedor</th>
                    <th className="text-right p-2">Cant.</th>
                    <th className="text-right p-2">Peso</th>
                    <th className="text-right p-2">P. Unit.</th>
                    <th className="text-right p-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {openProducto.items
                    .sort((a, b) => b.comp_created_at.localeCompare(a.comp_created_at))
                    .map((it, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="p-2 font-mono">{formatDate(it.comp_fecha)}</td>
                        <td className="p-2 font-mono text-[10px]">
                          <span className="capitalize text-gray-500">{it.comp_tipo}</span>{' '}
                          {it.comp_serie}-{String(it.comp_numero).padStart(8, '0')}
                        </td>
                        <td className="p-2">
                          <div className="font-semibold text-gray-900 truncate max-w-[200px]">{it.cliente_nombre}</div>
                          {it.cliente_doc && <div className="text-[10px] text-gray-500 font-mono">{it.cliente_doc}</div>}
                        </td>
                        <td className="p-2 text-gray-700 truncate max-w-[140px]">{it.vendedor_nombre}</td>
                        <td className="p-2 text-right font-mono font-semibold">{it.cantidad.toFixed(2)}</td>
                        <td className="p-2 text-right font-mono">{it.peso_total.toFixed(3)}</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(it.precio_unit)}</td>
                        <td className="p-2 text-right font-mono font-bold">{formatCurrency(it.subtotal)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot className="bg-gray-100 font-bold border-t-2 border-gray-300">
                  <tr>
                    <td colSpan={4} className="p-2 text-right">TOTAL</td>
                    <td className="p-2 text-right font-mono">{openProducto.cantidad.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{openProducto.peso.toFixed(3)}</td>
                    <td className="p-2 text-right font-mono text-gray-600">{openProducto.pup.toFixed(3)}</td>
                    <td className="p-2 text-right font-mono bg-[#FBE600]">{formatCurrency(openProducto.total_venta)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="text-[10px] text-gray-500 mt-2 italic">
                💡 Para devoluciones por producto, ve a <strong>Almacén → Notas de Crédito</strong>.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
