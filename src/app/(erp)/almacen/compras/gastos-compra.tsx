'use client'

/**
 * Flete (y otros gastos de traer la mercadería) prorrateado al costo de una
 * compra ya aplicada.
 *
 * Daniel, 31/10/2026: El Catalán facturó aparte el transporte del mondongo
 * (F003-3962, S/ 1,592.25 con detracción de S/ 64). El flete puede venir con
 * factura, con recibo por honorarios o sin comprobante. Se reparte entre los
 * productos según lo recibido (por valor o por cantidad) y sube el costo como
 * una nota de débito. Las reglas las pone registrar_gasto_compra, migración 153.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ItemCompra {
  id: string
  cantidad: number
  cantidad_recibida?: number | null
  precio_unitario: number
  productos?: { codigo?: string; nombre?: string; descripcion?: string | null } | null
}

const COMPROBANTE = { factura: 'Factura', recibo_honorarios: 'Recibo por honorarios', ninguno: 'Sin comprobante' } as const
type Comprobante = keyof typeof COMPROBANTE
type Base = 'valor' | 'cantidad'
const r2 = (v: number) => Math.round(v * 100) / 100
const nombreDe = (it: ItemCompra) => it.productos?.descripcion?.trim() || it.productos?.nombre || '—'
const recibido = (it: ItemCompra) => Number(it.cantidad_recibida ?? it.cantidad)

export default function GastosCompra({ compra, items, onCambio }: {
  compra: { id: string; estado: string; proveedor_id?: string | null; numero_factura_proveedor?: string | null }
  items: ItemCompra[]
  onCambio: () => void
}) {
  const supabase = createClient()
  const [gastos, setGastos] = useState<any[]>([])
  const [proveedores, setProveedores] = useState<{ id: string; razon_social: string; ruc: string | null }[]>([])
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [comprobante, setComprobante] = useState<Comprobante>('factura')
  const [proveedorId, setProveedorId] = useState('')
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState(hoyLima())
  const [concepto, setConcepto] = useState('Flete')
  const [base, setBase] = useState<Base>('valor')
  const [totalDoc, setTotalDoc] = useState('')
  const [detraccion, setDetraccion] = useState('')

  const cargar = useCallback(async () => {
    const { data } = await (supabase as any).from('gastos_compra')
      .select(`id, comprobante, numero, fecha_emision, concepto, base_prorrateo, subtotal, igv, total, detraccion,
        importe_a_stock, importe_a_costo_ventas, estado, motivo_anulacion, proveedores(razon_social),
        gastos_compra_items(cantidad, importe, por_unidad, unidades_en_stock, costo_anterior, costo_nuevo, productos(nombre, descripcion))`)
      .eq('compra_id', compra.id).order('created_at')
    setGastos(data ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compra.id])
  useEffect(() => { void cargar() }, [cargar])

  const puedeRegistrar = compra.estado === 'aplicada'

  const abrir = async () => {
    if (proveedores.length === 0) {
      const { data } = await supabase.from('proveedores').select('id, razon_social, ruc').eq('activo', true).order('razon_social')
      setProveedores((data ?? []) as any)
    }
    setComprobante('factura'); setProveedorId(compra.proveedor_id ?? ''); setNumero(''); setFecha(hoyLima())
    setConcepto('Flete'); setBase('valor'); setTotalDoc(''); setDetraccion('')
    setAbierto(true)
  }

  const total = Number(totalDoc || 0)
  const det = comprobante === 'factura' ? Number(detraccion || 0) : 0
  const baseImponible = comprobante === 'factura' ? r2(total / 1.18) : total

  // El mismo reparto que hace la base: según lo recibido; la última línea se lleva el redondeo.
  const reparto = useMemo(() => {
    const lineas = items.filter((it) => recibido(it) > 0)
    const peso = (it: ItemCompra) => (base === 'valor' ? recibido(it) * Number(it.precio_unitario) : recibido(it))
    const suma = lineas.reduce((a, it) => a + peso(it), 0)
    let asignado = 0
    return lineas.map((it, i) => {
      const importe = i === lineas.length - 1 ? r2(total - asignado) : r2(suma > 0 ? (total * peso(it)) / suma : 0)
      asignado = r2(asignado + importe)
      return { it, importe, porUnidad: recibido(it) > 0 ? importe / recibido(it) : 0 }
    })
  }, [items, base, total])

  const guardar = async () => {
    if (!(total > 0)) { toast.error('Falta el total', { description: 'Escríbelo tal como figura en el comprobante, con IGV si lo tiene.' }); return }
    if (comprobante !== 'ninguno' && !numero.trim()) { toast.error('Falta el número del comprobante', { description: 'Por ejemplo F003-3962' }); return }
    if (comprobante !== 'ninguno' && !proveedorId) { toast.error('Elige quién emitió el comprobante'); return }
    if (!concepto.trim()) { toast.error('Falta el concepto'); return }
    setGuardando(true)
    const { data, error } = await (supabase.rpc as any)('registrar_gasto_compra', {
      p_compra_id: compra.id, p_comprobante: comprobante, p_proveedor_id: proveedorId || null,
      p_numero: comprobante === 'ninguno' ? (numero.trim() || null) : numero, p_fecha: fecha, p_concepto: concepto,
      p_base_prorrateo: base, p_total: total, p_detraccion: det,
    })
    setGuardando(false)
    if (error) { toast.error('No se pudo registrar', { description: error.message, duration: 10000 }); return }
    const costos = ((data?.productos ?? []) as any[]).map((p) => `${p.producto}: costo ${Number(p.costo_anterior).toFixed(2)} → ${Number(p.costo_nuevo).toFixed(2)}`).join(' · ')
    toast.success(`${concepto.trim()} ${data?.numero ?? ''} registrado`, {
      description: `${costos}${Number(data?.a_costo_ventas) ? ` · ${formatCurrency(Number(data.a_costo_ventas))} de lo ya vendido va al costo de ventas` : ''}`,
      duration: 12000,
    })
    setAbierto(false)
    await cargar()
    onCambio()
  }

  const anular = async (g: any) => {
    const m = prompt(`¿Anular ${g.concepto.toLowerCase()} ${g.numero ?? ''}? El costo vuelve a como estaba. Indica el motivo:`)
    if (!m?.trim()) return
    const { error } = await (supabase.rpc as any)('anular_gasto_compra', { p_gasto_id: g.id, p_motivo: m.trim() })
    if (error) { toast.error('No se pudo anular', { description: error.message }); return }
    toast.success('Anulado', { description: 'El costo volvió a como estaba.' })
    await cargar()
    onCambio()
  }

  if (!puedeRegistrar && gastos.length === 0) return null

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 space-y-2" data-gastos-compra>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-sky-900">Flete y otros gastos de la compra</p>
          <p className="text-[11px] text-sky-800">
            El transporte (o la estiba) de esta mercadería se reparte entre los productos y sube su costo. Con factura, recibo por honorarios o sin comprobante.
          </p>
        </div>
        {puedeRegistrar && (
          <Button size="sm" onClick={abrir} className="bg-sky-600 hover:bg-sky-700 text-white text-xs" data-registrar-flete>
            + Registrar flete
          </Button>
        )}
      </div>

      {gastos.map((g) => (
        <div key={g.id} className={`rounded-md border bg-white p-2.5 text-xs ${g.estado === 'anulada' ? 'opacity-60' : ''}`} data-flete={g.numero ?? g.id}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-semibold text-gray-900">
              {g.concepto} · {COMPROBANTE[g.comprobante as Comprobante]} {g.numero ?? ''}
              <span className="ml-2 font-normal text-gray-500">{formatDate(g.fecha_emision)}{g.proveedores?.razon_social ? ` · ${g.proveedores.razon_social}` : ''}</span>
              {g.estado === 'anulada' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">ANULADO</span>}
            </p>
            <p className="font-mono font-semibold">
              +{formatCurrency(g.total)}
              {Number(g.igv) > 0 && <span className="ml-1 font-normal text-gray-500">(base {formatCurrency(g.subtotal)} + IGV {formatCurrency(g.igv)})</span>}
            </p>
          </div>
          {Number(g.detraccion) > 0 && (
            <p className="text-gray-600 mt-0.5">Detracción {formatCurrency(g.detraccion)} · al proveedor {formatCurrency(Number(g.total) - Number(g.detraccion))}</p>
          )}
          {(g.gastos_compra_items ?? []).map((i: any, k: number) => (
            <p key={k} className="text-gray-700 mt-0.5">
              {i.productos?.descripcion?.trim() || i.productos?.nombre}: {formatCurrency(i.importe)} ({Number(i.por_unidad).toFixed(4)} por unidad)
              {i.costo_anterior != null && Number(i.unidades_en_stock) > 0 && (
                <span className="text-sky-700"> · costo {Number(i.costo_anterior).toFixed(2)} → {Number(i.costo_nuevo).toFixed(2)}</span>
              )}
            </p>
          ))}
          {g.estado === 'aplicada' && (
            <div className="flex items-center justify-between gap-2 mt-1">
              <p className="text-[11px] text-gray-500">
                Reparto por {g.base_prorrateo} · al stock {formatCurrency(g.importe_a_stock)}
                {Number(g.importe_a_costo_ventas) !== 0 && ` · al costo de ventas (ya vendido) ${formatCurrency(g.importe_a_costo_ventas)}`}
              </p>
              <button type="button" onClick={() => anular(g)} className="text-[11px] font-semibold text-red-600 hover:underline">Anular</button>
            </div>
          )}
          {g.estado === 'anulada' && g.motivo_anulacion && <p className="text-[11px] text-red-700 mt-0.5">Motivo: {g.motivo_anulacion}</p>}
        </div>
      ))}

      <Dialog open={abierto} onOpenChange={(o) => { if (!guardando) setAbierto(o) }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar flete · compra {compra.numero_factura_proveedor}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Comprobante</Label>
                <select value={comprobante} onChange={(e) => setComprobante(e.target.value as Comprobante)} aria-label="Comprobante"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm">
                  {Object.entries(COMPROBANTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <Label className="text-xs">Emitido por{comprobante === 'ninguno' ? ' (opcional)' : ''}</Label>
                <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} aria-label="Emitido por"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm">
                  <option value="">— Elegir —</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}{p.ruc ? ` · ${p.ruc}` : ''}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Número{comprobante === 'ninguno' ? ' (opcional)' : ''}</Label>
                <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ej.: F003-3962" className="mt-1 h-9" aria-label="Número del comprobante" />
              </div>
              <div>
                <Label className="text-xs">Fecha de emisión</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1 h-9" aria-label="Fecha del comprobante" />
              </div>
              <div>
                <Label className="text-xs">Total (S/){comprobante === 'factura' ? ', con IGV' : ''}</Label>
                <Input type="number" step="0.01" min="0" value={totalDoc} onChange={(e) => setTotalDoc(e.target.value)} placeholder="Escribe el total"
                  className={`mt-1 h-9 ${!(total > 0) ? 'border-red-400 ring-1 ring-red-300' : ''}`} aria-label="Total del flete" />
              </div>
              {comprobante === 'factura' && (
                <div>
                  <Label className="text-xs">Detracción (S/)</Label>
                  <Input type="number" step="0.01" min="0" value={detraccion} onChange={(e) => setDetraccion(e.target.value)} placeholder="Si tiene"
                    className="mt-1 h-9" aria-label="Detracción" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Concepto</Label>
                <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} className="mt-1 h-9" aria-label="Concepto" />
              </div>
              <div>
                <Label className="text-xs">Repartir entre los productos</Label>
                <select value={base} onChange={(e) => setBase(e.target.value as Base)} aria-label="Base del reparto"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm">
                  <option value="valor">Por valor (lo que costó cada producto)</option>
                  <option value="cantidad">Por cantidad (kilos o unidades recibidas)</option>
                </select>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-gray-500 uppercase text-[10px]">
                    <th className="p-2 text-left">Producto</th>
                    <th className="p-2 text-right">Recibido</th>
                    <th className="p-2 text-right">Costo compra</th>
                    <th className="p-2 text-right">Parte del flete</th>
                    <th className="p-2 text-right">Por unidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reparto.map(({ it, importe, porUnidad }) => (
                    <tr key={it.id}>
                      <td className="p-2">{nombreDe(it)}</td>
                      <td className="p-2 text-right font-mono">{recibido(it)}</td>
                      <td className="p-2 text-right font-mono">{Number(it.precio_unitario).toFixed(2)}</td>
                      <td className="p-2 text-right font-mono">{total > 0 ? formatCurrency(importe) : '—'}</td>
                      <td className="p-2 text-right font-mono">{total > 0 ? `+${porUnidad.toFixed(4)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`rounded-lg p-3 text-xs ${total > 0 ? 'bg-sky-50 border border-sky-200 text-sky-900' : 'bg-amber-50 border border-amber-200 text-amber-900'}`} data-resumen-flete>
              {!(total > 0) && <p className="font-semibold text-red-700">Falta escribir el Total, tal como figura en el comprobante.</p>}
              {total > 0 && comprobante === 'factura' && (
                <p>Entra al Registro de compras y al SIRE como factura: base {formatCurrency(baseImponible)} + IGV {formatCurrency(r2(total - baseImponible))}.
                  {det > 0 && ` Detracción ${formatCurrency(det)}: al proveedor se le paga ${formatCurrency(r2(total - det))} y la detracción se deposita en su cuenta del Banco de la Nación.`}</p>
              )}
              {total > 0 && comprobante !== 'factura' && (
                <p>{comprobante === 'recibo_honorarios' ? 'El recibo por honorarios no tiene IGV ni va al SIRE de compras.' : 'Sin comprobante: no hay IGV ni va al SIRE.'} En el Registro de compras de gerencia suma con lo sin factura.</p>
              )}
              <p className="mt-0.5">Sube el costo de las unidades que siguen en stock (con IGV, como todo costo en el sistema); lo que corresponde a unidades ya vendidas va al costo de ventas.</p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</Button>
              <Button onClick={guardar} disabled={guardando} className="bg-sky-600 hover:bg-sky-700 text-white gap-2" data-guardar-flete>
                {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
                Registrar flete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
