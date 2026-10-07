'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Loader2, Printer } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA } from '@/lib/empresa'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Liquidación mensual de documentos internos (Daniel, 05-06/10/2026).
 *
 * La Procesadora de Alimentos AGROCAR (otra empresa) entrega agua y hielo con
 * un reporte de producción: entra como documento interno. Al cerrar el mes,
 * la Procesadora le factura a AGROCAR solo lo que se vendió con factura y
 * boleta. Este reporte dice cuánto es, y registra esa factura: queda en el
 * Registro de Compras con su IGV, pero no vuelve a sumar stock (la mercadería
 * ya entró). Precios con IGV, como los ingresa Daniel. Todo lo calcula la base
 * (liquidacion_internos, registrar_factura_regularizacion: migración 130).
 */

type Proveedor = { id: string; razon_social: string; ruc: string | null; con_internos: boolean }
type Fila = {
  producto_id: string; codigo: string; producto: string; unidad: string | null
  ingresado: number; vendido_factura: number; vendido_boleta: number; vendido_interno: number
  notas_credito: number; a_facturar: number; ya_facturado: number; pendiente: number; precio: number; importe: number
}
type Datos = { filas: Fila[]; total: number; base: number; igv: number; facturas: { id: string; numero: string; fecha: string; total: number }[] }

const num = (n: number) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 3 })
function finDeMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

export default function LiquidacionInternosPage() {
  const supabase = createClient()
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [proveedorId, setProveedorId] = useState('')
  const [mes, setMes] = useState(hoyLima().slice(0, 7))
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [registrar, setRegistrar] = useState(false)
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState('')
  const [lineas, setLineas] = useState<{ producto_id: string; producto: string; cantidad: string; precio: string }[]>([])
  const [guardando, setGuardando] = useState(false)

  const desde = `${mes}-01`
  const hasta = finDeMes(mes)
  const proveedor = proveedores.find((p) => p.id === proveedorId)

  useEffect(() => {
    ;(async () => {
      const { data } = await (supabase.rpc as any)('proveedores_con_internos')
      const lista = (data ?? []) as Proveedor[]
      setProveedores(lista)
      const preferido = lista.find((p) => p.ruc === '20602230792') ?? lista.find((p) => p.con_internos) ?? lista[0]
      if (preferido) setProveedorId(preferido.id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cargar = useCallback(async () => {
    if (!proveedorId) return
    setCargando(true)
    const { data, error } = await (supabase.rpc as any)('liquidacion_internos', { p_proveedor_id: proveedorId, p_desde: desde, p_hasta: hasta })
    setCargando(false)
    if (error) { toast.error('No se pudo cargar la liquidación', { description: error.message }); return }
    const n = (v: any) => Number(v ?? 0)
    setDatos({
      filas: (data.filas ?? []).map((f: any) => ({
        ...f, ingresado: n(f.ingresado), vendido_factura: n(f.vendido_factura), vendido_boleta: n(f.vendido_boleta),
        vendido_interno: n(f.vendido_interno), notas_credito: n(f.notas_credito), a_facturar: n(f.a_facturar),
        ya_facturado: n(f.ya_facturado), pendiente: n(f.pendiente), precio: n(f.precio), importe: n(f.importe),
      })),
      total: n(data.total), base: n(data.base), igv: n(data.igv), facturas: data.facturas ?? [],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorId, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const abrirRegistro = () => {
    if (!datos) return
    setNumero('')
    setFecha(hasta < hoyLima() ? hasta : hoyLima())
    setLineas(datos.filas.filter((f) => f.pendiente > 0).map((f) => ({
      producto_id: f.producto_id, producto: f.producto, cantidad: String(f.pendiente), precio: String(f.precio),
    })))
    setRegistrar(true)
  }
  const totalFactura = useMemo(() => lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0), [lineas])

  const guardar = async () => {
    if (!numero.trim()) { toast.error('Indica el número de la factura'); return }
    setGuardando(true)
    const { error } = await (supabase.rpc as any)('registrar_factura_regularizacion', {
      p_proveedor_id: proveedorId, p_numero: numero.trim(), p_fecha: fecha,
      p_items: lineas.filter((l) => Number(l.cantidad) > 0).map((l) => ({
        producto_id: l.producto_id, cantidad: Number(l.cantidad), precio_unitario: Number(l.precio),
      })),
    })
    setGuardando(false)
    if (error) { toast.error('No se pudo registrar la factura', { description: error.message, duration: 10000 }); return }
    toast.success(`Factura ${numero.trim()} registrada`, {
      description: `Total ${formatCurrency(totalFactura)}. Va al Registro de Compras con su IGV y no suma stock.`,
    })
    setRegistrar(false)
    cargar()
  }

  const nombreMes = new Date(`${desde}T12:00:00Z`).toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="space-y-4 print:space-y-2" data-liquidacion>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          table { font-size: 9pt !important; }
        }
        .print-only { display: none; }
      ` }} />

      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidación de documentos internos</h1>
          <p className="mt-0.5 text-sm text-gray-500">Lo que el proveedor debe facturar en el mes: lo vendido con factura y boleta</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Proveedor</Label>
            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} aria-label="Proveedor"
              className="mt-1 block h-9 max-w-[320px] rounded-md border border-gray-300 bg-white px-2 text-sm">
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}{p.con_internos ? ' · con internos' : ''}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Mes</Label>
            <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="mt-1 h-9 w-40" data-mes />
          </div>
          <Button variant="outline" onClick={() => window.print()} className="h-9 gap-1"><Printer className="h-4 w-4" /> Imprimir</Button>
          <Button onClick={abrirRegistro} disabled={!datos || datos.filas.every((f) => f.pendiente <= 0)}
            className="h-9 gap-1 bg-[#FBE600] font-semibold text-black hover:bg-[#E5D100]" data-registrar-factura>
            <FileText className="h-4 w-4" /> Registrar factura del proveedor
          </Button>
        </div>
      </div>

      <div className="print-only">
        <p className="text-base font-bold">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
        <p className="text-sm font-semibold">Liquidación de documentos internos — {nombreMes}</p>
        <p className="text-xs">Proveedor: {proveedor?.razon_social} {proveedor?.ruc ? `· RUC ${proveedor.ruc}` : ''}</p>
      </div>

      {cargando && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>}

      {datos && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-xs font-semibold text-gray-500">VALOR DE VENTA</p><p className="text-lg font-bold">{formatCurrency(datos.base)}</p></div>
            <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-xs font-semibold text-gray-500">IGV 18%</p><p className="text-lg font-bold">{formatCurrency(datos.igv)}</p></div>
            <div className="rounded-lg border border-yellow-400 bg-[#FBE600] p-3" data-total-pendiente><p className="text-xs font-semibold">PENDIENTE DE FACTURAR</p><p className="text-lg font-bold">{formatCurrency(datos.total)}</p></div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-2 text-left">Producto</th>
                  <th className="p-2 text-right" title="Lo que entró en el mes con documentos internos">Ingresó (doc. int.)</th>
                  <th className="p-2 text-right">Vendido factura</th>
                  <th className="p-2 text-right">Vendido boleta</th>
                  <th className="p-2 text-right" title="No se le factura a AGROCAR">Vendido doc. interno</th>
                  <th className="p-2 text-right">A facturar</th>
                  <th className="p-2 text-right">Ya facturado</th>
                  <th className="p-2 text-right">Pendiente</th>
                  <th className="p-2 text-right">Precio (c/IGV)</th>
                  <th className="p-2 text-right">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {datos.filas.length === 0 ? (
                  <tr><td colSpan={10} className="p-6 text-center text-gray-400">Este proveedor no tiene productos ingresados</td></tr>
                ) : datos.filas.map((f) => (
                  <tr key={f.producto_id} data-fila-liq>
                    <td className="p-2"><span className="font-mono text-[10px] text-gray-400">{f.codigo}</span> {f.producto}</td>
                    <td className="p-2 text-right font-mono">{num(f.ingresado)}</td>
                    <td className="p-2 text-right font-mono">{num(f.vendido_factura)}</td>
                    <td className="p-2 text-right font-mono">{num(f.vendido_boleta)}</td>
                    <td className="p-2 text-right font-mono text-gray-400">{num(f.vendido_interno)}</td>
                    <td className="p-2 text-right font-mono font-semibold">{num(f.a_facturar)}</td>
                    <td className="p-2 text-right font-mono">{num(f.ya_facturado)}</td>
                    <td className={`p-2 text-right font-mono font-bold ${f.pendiente < 0 ? 'text-red-600' : ''}`}>{num(f.pendiente)}</td>
                    <td className="p-2 text-right font-mono">{f.precio.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono font-semibold">{formatCurrency(f.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos.filas.some((f) => f.pendiente < 0) && (
            <p className="text-xs text-red-700">Hay productos con pendiente negativo: se facturó más de lo vendido con factura y boleta en el mes.</p>
          )}
          <p className="text-[11px] text-gray-500">
            A facturar = vendido con factura + vendido con boleta − notas de crédito. Lo vendido con documento interno no se factura.
            Pendiente = a facturar − facturas del proveedor ya registradas en el mes. Precio pactado (con IGV) del último documento interno.
          </p>

          {datos.facturas.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <p className="mb-1 font-semibold text-gray-700">Facturas del proveedor ya registradas en {nombreMes}</p>
              {datos.facturas.map((f) => (
                <p key={f.id} className="text-xs text-gray-600">{f.numero} · {formatDate(f.fecha)} · {formatCurrency(Number(f.total))}</p>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={registrar} onOpenChange={setRegistrar}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Registrar factura de {proveedor?.razon_social}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm" data-dialogo-regularizacion>
            <p className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
              Va al Registro de Compras con su IGV (crédito fiscal) y <b>no suma stock</b>: la mercadería ya entró con los documentos internos.
              Viene precargada con lo pendiente; ajústala a lo que diga la factura.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">N° de factura *</Label>
                <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="E001-123" className="mt-1 font-mono" data-numero-factura /></div>
              <div><Label className="text-xs">Fecha de la factura *</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1" /></div>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500"><th className="py-1">Producto</th><th className="w-24 py-1 text-right">Cantidad</th><th className="w-24 py-1 text-right">Precio c/IGV</th><th className="w-24 py-1 text-right">Importe</th></tr></thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={l.producto_id}>
                    <td className="py-1 pr-2">{l.producto}</td>
                    <td className="py-1"><Input type="number" step="0.001" min="0" value={l.cantidad} className="h-8 text-right"
                      onChange={(e) => setLineas((ls) => ls.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} /></td>
                    <td className="py-1"><Input type="number" step="0.01" min="0" value={l.precio} className="h-8 text-right"
                      onChange={(e) => setLineas((ls) => ls.map((x, j) => j === i ? { ...x, precio: e.target.value } : x))} /></td>
                    <td className="py-1 text-right font-mono">{formatCurrency((Number(l.cantidad) || 0) * (Number(l.precio) || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-right text-sm">
              Valor de venta {formatCurrency(totalFactura / 1.18)} · IGV {formatCurrency(totalFactura - totalFactura / 1.18)} · <b>Total {formatCurrency(totalFactura)}</b>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRegistrar(false)} disabled={guardando}>Cancelar</Button>
              <Button onClick={guardar} disabled={guardando || !numero.trim() || totalFactura <= 0}
                className="gap-1 bg-[#FBE600] font-semibold text-black hover:bg-[#E5D100]" data-guardar-factura>
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar factura
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
