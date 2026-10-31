'use client'

/**
 * Notas de débito y de crédito del proveedor sobre una compra ya aplicada.
 *
 * Daniel, 31/10/2026: Ti-Cay facturó el queso cheddar a S/ 6.40 y después
 * mandó la nota de débito F001-00000082 por la diferencia (precio correcto
 * S/ 7.50). La factura no se toca —es el documento tal como se emitió—: la nota
 * se registra aparte, entra al Registro de compras y ajusta el costo. Las
 * reglas (estados, cantidades, que el total cuadre con el papel) las pone
 * registrar_nota_proveedor, migración 150.
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

interface Linea { incluir: boolean; cantidad: string; precio: string }

const TIPO = { debito: 'Nota de débito', credito: 'Nota de crédito' } as const
const r2 = (v: number) => Math.round(v * 100) / 100
const nombreDe = (it: ItemCompra) => it.productos?.descripcion?.trim() || it.productos?.nombre || '—'

export default function NotasProveedor({ compra, items, onCambio }: {
  compra: { id: string; estado: string; documento_interno?: boolean; numero_factura_proveedor?: string | null; incluir_igv?: boolean }
  items: ItemCompra[]
  onCambio: () => void
}) {
  const supabase = createClient()
  const [notas, setNotas] = useState<any[]>([])
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [tipo, setTipo] = useState<'debito' | 'credito'>('debito')
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState(hoyLima())
  const [motivo, setMotivo] = useState('')
  const [totalDoc, setTotalDoc] = useState('')
  const [lineas, setLineas] = useState<Record<string, Linea>>({})

  const cargar = useCallback(async () => {
    const { data } = await (supabase as any).from('notas_proveedor')
      .select(`id, tipo, numero, fecha_emision, motivo, subtotal, igv, total, importe_a_stock, importe_a_costo_ventas, estado, motivo_anulacion,
        notas_proveedor_items(cantidad, precio_facturado, precio_correcto, importe, unidades_en_stock, costo_anterior, costo_nuevo,
          productos(codigo, nombre, descripcion))`)
      .eq('compra_id', compra.id).order('created_at')
    setNotas(data ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compra.id])
  useEffect(() => { void cargar() }, [cargar])

  const puedeRegistrar = compra.estado === 'aplicada' && !compra.documento_interno

  const abrir = () => {
    setTipo('debito'); setNumero(''); setFecha(hoyLima()); setMotivo(''); setTotalDoc('')
    setLineas(Object.fromEntries(items.map((it) => [it.id, {
      incluir: false,
      cantidad: String(Number(it.cantidad_recibida ?? it.cantidad)),
      precio: '',
    }])))
    setAbierto(true)
  }

  // Lo que suma cada línea marcada: (precio correcto − facturado) × cantidad
  const calculo = useMemo(() => {
    const filas = items.map((it) => {
      const l = lineas[it.id]
      const cant = Number(l?.cantidad || 0)
      const precio = l?.precio === '' || l?.precio == null ? NaN : Number(l.precio)
      const dif = Number.isFinite(precio) ? precio - Number(it.precio_unitario) : NaN
      return { it, l, cant, precio, dif, importe: Number.isFinite(dif) ? r2(cant * dif) : 0 }
    })
    const marcadas = filas.filter((f) => f.l?.incluir)
    const suma = r2(Math.abs(marcadas.reduce((a, f) => a + f.importe, 0)))
    return { filas, marcadas, suma }
  }, [items, lineas])

  const total = Number(totalDoc || 0)
  const cuadra = calculo.marcadas.length > 0 && total > 0 && Math.abs(calculo.suma - total) <= 0.05
  const base = compra.incluir_igv === false ? total : r2(total / 1.18)

  const guardar = async () => {
    if (!numero.trim()) { toast.error('Falta el número de la nota', { description: 'Tal como figura en el documento, por ejemplo F001-00000082' }); return }
    if (!motivo.trim()) { toast.error('Falta el motivo'); return }
    if (calculo.marcadas.length === 0) { toast.error('Marca al menos un producto'); return }
    for (const f of calculo.marcadas) {
      if (!Number.isFinite(f.precio)) { toast.error(`Falta el precio correcto de ${nombreDe(f.it)}`); return }
    }
    if (!cuadra) {
      toast.error('No cuadra con el documento', { description: `Lo cargado suma ${formatCurrency(calculo.suma)} y el total de la nota es ${formatCurrency(total)}.` })
      return
    }
    setGuardando(true)
    const { data, error } = await (supabase.rpc as any)('registrar_nota_proveedor', {
      p_compra_id: compra.id, p_tipo: tipo, p_numero: numero, p_fecha: fecha, p_motivo: motivo,
      p_items: calculo.marcadas.map((f) => ({ compra_item_id: f.it.id, cantidad: f.cant, precio_correcto: f.precio })),
      p_total_documento: total,
    })
    setGuardando(false)
    if (error) { toast.error('No se pudo registrar la nota', { description: error.message, duration: 10000 }); return }
    const costos = ((data?.productos ?? []) as any[]).map((p) => `${p.producto}: costo ${Number(p.costo_anterior).toFixed(2)} → ${Number(p.costo_nuevo).toFixed(2)}`).join(' · ')
    toast.success(`${TIPO[tipo]} ${data?.numero} registrada`, {
      description: `${costos}${Number(data?.a_costo_ventas) ? ` · ${formatCurrency(Math.abs(Number(data.a_costo_ventas)))} de lo ya vendido va al costo de ventas` : ''}`,
      duration: 12000,
    })
    setAbierto(false)
    await cargar()
    onCambio()
  }

  const anular = async (n: any) => {
    const m = prompt(`¿Anular la ${TIPO[n.tipo as 'debito' | 'credito'].toLowerCase()} ${n.numero}? Se devuelve el costo. Indica el motivo:`)
    if (!m?.trim()) return
    const { error } = await (supabase.rpc as any)('anular_nota_proveedor', { p_nota_id: n.id, p_motivo: m.trim() })
    if (error) { toast.error('No se pudo anular', { description: error.message }); return }
    toast.success(`Nota ${n.numero} anulada`, { description: 'El costo volvió a como estaba.' })
    await cargar()
    onCambio()
  }

  if (!puedeRegistrar && notas.length === 0) return null

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2" data-notas-proveedor>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-violet-900">Notas de débito / crédito del proveedor</p>
          <p className="text-[11px] text-violet-800">
            Para diferencias de precio después de aplicar la compra. La factura no se modifica: la nota se registra aparte y ajusta el costo.
          </p>
        </div>
        {puedeRegistrar && (
          <Button size="sm" onClick={abrir} className="bg-violet-600 hover:bg-violet-700 text-white text-xs" data-registrar-nota>
            + Registrar nota
          </Button>
        )}
      </div>

      {notas.map((n) => (
        <div key={n.id} className={`rounded-md border bg-white p-2.5 text-xs ${n.estado === 'anulada' ? 'opacity-60' : ''}`} data-nota={n.numero}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-semibold text-gray-900">
              {TIPO[n.tipo as 'debito' | 'credito']} {n.numero}
              <span className="ml-2 font-normal text-gray-500">{formatDate(n.fecha_emision)}</span>
              {n.estado === 'anulada' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">ANULADA</span>}
            </p>
            <p className="font-mono font-semibold">
              {n.tipo === 'credito' ? '−' : '+'}{formatCurrency(n.total)}
              <span className="ml-1 font-normal text-gray-500">(base {formatCurrency(n.subtotal)} + IGV {formatCurrency(n.igv)})</span>
            </p>
          </div>
          <p className="text-gray-600 mt-0.5">{n.motivo}</p>
          {(n.notas_proveedor_items ?? []).map((i: any, k: number) => (
            <p key={k} className="text-gray-700 mt-0.5">
              {i.productos?.descripcion?.trim() || i.productos?.nombre}: {Number(i.cantidad)} u. · facturado {formatCurrency(i.precio_facturado)} → correcto {formatCurrency(i.precio_correcto)}
              {i.costo_anterior != null && Number(i.unidades_en_stock) > 0 && (
                <span className="text-violet-700"> · costo {Number(i.costo_anterior).toFixed(2)} → {Number(i.costo_nuevo).toFixed(2)}</span>
              )}
            </p>
          ))}
          {n.estado === 'aplicada' && (
            <div className="flex items-center justify-between gap-2 mt-1">
              <p className="text-[11px] text-gray-500">
                Al stock {formatCurrency(Math.abs(Number(n.importe_a_stock)))}
                {Number(n.importe_a_costo_ventas) !== 0 && ` · al costo de ventas (ya vendido) ${formatCurrency(Math.abs(Number(n.importe_a_costo_ventas)))}`}
              </p>
              <button type="button" onClick={() => anular(n)} className="text-[11px] font-semibold text-red-600 hover:underline">Anular</button>
            </div>
          )}
          {n.estado === 'anulada' && n.motivo_anulacion && <p className="text-[11px] text-red-700 mt-0.5">Motivo: {n.motivo_anulacion}</p>}
        </div>
      ))}

      <Dialog open={abierto} onOpenChange={(o) => { if (!guardando) setAbierto(o) }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar nota del proveedor · compra {compra.numero_factura_proveedor}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Tipo</Label>
                <select value={tipo} onChange={(e) => setTipo(e.target.value as 'debito' | 'credito')} aria-label="Tipo de nota"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm">
                  <option value="debito">Nota de débito (sube el precio)</option>
                  <option value="credito">Nota de crédito (baja el precio)</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Número</Label>
                <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="F001-00000082" className="mt-1 h-9" aria-label="Número de la nota" />
              </div>
              <div>
                <Label className="text-xs">Fecha de emisión</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1 h-9" aria-label="Fecha de la nota" />
              </div>
              <div>
                <Label className="text-xs">Total de la nota (S/)</Label>
                <Input type="number" step="0.01" min="0" value={totalDoc} onChange={(e) => setTotalDoc(e.target.value)} placeholder="554.40" className="mt-1 h-9" aria-label="Total de la nota" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Motivo</Label>
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Diferencia de precio" className="mt-1 h-9" aria-label="Motivo" />
            </div>

            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-gray-500 uppercase text-[10px]">
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-left">Producto</th>
                    <th className="p-2 text-right">Cantidad</th>
                    <th className="p-2 text-right">P. facturado</th>
                    <th className="p-2 text-right">P. correcto</th>
                    <th className="p-2 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {calculo.filas.map(({ it, l, importe, dif }) => (
                    <tr key={it.id} className={l?.incluir ? 'bg-violet-50/60' : ''}>
                      <td className="p-2 text-center">
                        <input type="checkbox" checked={!!l?.incluir} aria-label={`Incluir ${nombreDe(it)}`}
                          onChange={(e) => setLineas({ ...lineas, [it.id]: { ...l!, incluir: e.target.checked } })} />
                      </td>
                      <td className="p-2">{nombreDe(it)}</td>
                      <td className="p-2 text-right">
                        <input type="number" step="any" min="0" value={l?.cantidad ?? ''} disabled={!l?.incluir} aria-label={`Cantidad ${nombreDe(it)}`}
                          onChange={(e) => setLineas({ ...lineas, [it.id]: { ...l!, cantidad: e.target.value } })}
                          className="h-8 w-20 rounded border border-gray-300 px-1 text-right disabled:bg-gray-50" />
                      </td>
                      <td className="p-2 text-right font-mono">{Number(it.precio_unitario).toFixed(2)}</td>
                      <td className="p-2 text-right">
                        <input type="number" step="any" min="0" value={l?.precio ?? ''} disabled={!l?.incluir} aria-label={`Precio correcto ${nombreDe(it)}`}
                          onChange={(e) => setLineas({ ...lineas, [it.id]: { ...l!, precio: e.target.value } })}
                          className="h-8 w-20 rounded border border-gray-300 px-1 text-right disabled:bg-gray-50" />
                      </td>
                      <td className="p-2 text-right font-mono">{l?.incluir && Number.isFinite(dif) ? formatCurrency(importe) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-500">Precios con IGV, igual que en la compra. Marca solo los productos que trae la nota.</p>

            <div className={`rounded-lg p-3 text-xs ${cuadra ? 'bg-green-50 border border-green-200 text-green-900' : 'bg-amber-50 border border-amber-200 text-amber-900'}`} data-cuadre>
              <p className="font-semibold">
                Suma de los productos: {formatCurrency(calculo.suma)} · Total de la nota: {formatCurrency(total)}
                {cuadra ? ' ✓ cuadra' : calculo.marcadas.length ? ' — no cuadra todavía' : ''}
              </p>
              {total > 0 && <p className="mt-0.5">Se registra con base {formatCurrency(base)} + IGV {formatCurrency(r2(total - base))} en el Registro de compras.</p>}
              <p className="mt-0.5">
                {tipo === 'debito' ? 'Sube' : 'Baja'} el costo de las unidades que siguen en stock; lo que corresponde a unidades ya vendidas va al costo de ventas.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</Button>
              <Button onClick={guardar} disabled={guardando || !cuadra} className="bg-violet-600 hover:bg-violet-700 text-white gap-2" data-guardar-nota>
                {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
                Registrar {TIPO[tipo].toLowerCase()}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
