'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Loader2, CheckCircle, AlertCircle, DollarSign, Receipt, Eye, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import VentaDirectaDialog from './venta-directa-dialog'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { puedeEmitirFactura, serieDeTipoComprobante, tipoComprobanteSugerido } from '@/lib/cliente-utils'

const ESTADO_SUNAT: Record<string, { label: string; className: string }> = {
  emitido: { label: 'Emitido', className: 'bg-blue-100 text-blue-700' },
  enviado_sunat: { label: 'Enviado SUNAT', className: 'bg-yellow-100 text-yellow-700' },
  aceptado: { label: 'Aceptado', className: 'bg-green-100 text-green-700' },
  rechazado: { label: 'Rechazado', className: 'bg-red-100 text-red-700' },
  anulado: { label: 'Anulado', className: 'bg-gray-100 text-gray-500' },
}

export default function FacturacionPage() {
  const supabase = createClient()

  const [pedidosPendientes, setPedidosPendientes] = useState<any[]>([])
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tipoCambio, setTipoCambio] = useState<number | null>(null)
  const [tipoCambioFecha, setTipoCambioFecha] = useState<string | null>(null)
  const [facturarDialog, setFacturarDialog] = useState(false)
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState<any>(null)
  const [tipoComprobante, setTipoComprobante] = useState<string>('factura')
  const [serie, setSerie] = useState('F001')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [ventaDirectaOpen, setVentaDirectaOpen] = useState(false)
  const [comprobanteEmitidoId, setComprobanteEmitidoId] = useState<string | null>(null)
  const [comprobanteEmitidoLabel, setComprobanteEmitidoLabel] = useState<string>('')

  const loadData = useCallback(async () => {
    setLoading(true)

    const [{ data: pedidos }, { data: comp }, { data: tc }] = await Promise.all([
      supabase
        .from('pedidos')
        .select(`
          id, numero, subtotal, igv, incluir_igv, total, estado, created_at, cliente_id,
          clientes(razon_social, ruc, dni, tipo_comprobante_preferido)
        `)
        .eq('estado', 'enviado')
        .order('created_at', { ascending: true }),
      supabase
        .from('comprobantes')
        .select(`
          id, serie, numero, tipo, fecha_emision, total, estado,
          clientes(razon_social)
        `)
        .order('fecha_emision', { ascending: false })
        .limit(50),
      // TC más reciente disponible (si hoy no hay, usa el último día hábil)
      supabase
        .from('tipo_cambio')
        .select('fecha, compra, venta')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    setPedidosPendientes(pedidos ?? [])
    setComprobantes(comp ?? [])
    if (tc) {
      setTipoCambio(Number(tc.venta ?? 0) || null)
      setTipoCambioFecha(tc.fecha ?? null)
    } else {
      setTipoCambio(null)
      setTipoCambioFecha(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleFacturar = (pedido: any) => {
    setPedidoSeleccionado(pedido)
    const cliente = pedido.clientes ?? {}
    // Usar tipo_comprobante_preferido del cliente, con fallback a regla SUNAT
    const tipo = cliente.tipo_comprobante_preferido ?? tipoComprobanteSugerido(cliente)
    setTipoComprobante(tipo)
    setSerie(serieDeTipoComprobante(tipo))
    setFacturarDialog(true)
  }

  const confirmarFacturacion = async () => {
    if (!pedidoSeleccionado) return
    setSaving(true)

    // Obtener correlativo atómico desde la BD (serie + número)
    const { data: corr, error: corrErr } = await (supabase.rpc as any)('siguiente_correlativo', { p_tipo: tipoComprobante })
    if (corrErr || !corr || corr.length === 0) {
      setSaving(false)
      toast.error('Falta configurar numeración', {
        description: corrErr?.message ?? 'Ve a Configuración → Numeración de Comprobantes.',
      })
      return
    }
    const serieReal = corr[0].serie as string
    const numero = corr[0].numero as string

    // Respetar incluir_igv del pedido. Si el pedido ya tiene IGV calculado, usarlo directamente.
    const pedSubtotal = Number(pedidoSeleccionado.subtotal ?? 0)
    const pedIgv = Number(pedidoSeleccionado.igv ?? 0)
    const pedTotal = Number(pedidoSeleccionado.total ?? 0)
    const incluirIgv = pedidoSeleccionado.incluir_igv !== false
    // Si el pedido no tiene igv pero incluir_igv=true, calcular a partir del total (legacy)
    const igvCalc = pedIgv > 0 ? pedIgv : (incluirIgv ? pedTotal * 0.18 / 1.18 : 0)
    const subtotalCalc = pedIgv > 0 ? pedSubtotal : (incluirIgv ? pedTotal - igvCalc : pedTotal)

    const { data: compInsertado, error: compError } = await (supabase.from('comprobantes') as any).insert({
      pedido_id: pedidoSeleccionado.id,
      cliente_id: pedidoSeleccionado.cliente_id,
      tipo: tipoComprobante as any,
      serie: serieReal,
      numero,
      fecha_emision: new Date().toISOString().split('T')[0],
      subtotal: subtotalCalc,
      igv: igvCalc,
      total: pedTotal > 0 ? pedTotal : subtotalCalc + igvCalc,
      moneda: 'PEN',
      estado: 'emitido',
    }).select('id').single()

    if (compError || !compInsertado) {
      setSaving(false)
      toast.error('Error al emitir comprobante', { description: compError?.message })
      return
    }

    // Snapshot de items en comprobantes_items (formato SUNAT, inmutable)
    const { data: pedidoItems } = await supabase
      .from('pedidos_items')
      .select('producto_id, cantidad, precio_unitario, subtotal, productos(nombre, descripcion)')
      .eq('pedido_id', pedidoSeleccionado.id)
    if (pedidoItems && pedidoItems.length > 0) {
      const itemsCompr = pedidoItems.map((it: any) => ({
        comprobante_id: compInsertado.id,
        producto_id: it.producto_id,
        descripcion: it.productos?.descripcion?.trim() || it.productos?.nombre || '—',
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        subtotal: it.subtotal,
        igv_porcentaje: incluirIgv ? 18 : 0,
      }))
      await (supabase.from('comprobantes_items') as any).insert(itemsCompr)
    }

    const { error: pedError } = await supabase
      .from('pedidos')
      .update({ estado: 'facturado', updated_at: new Date().toISOString() })
      .eq('id', pedidoSeleccionado.id)

    setSaving(false)
    setFacturarDialog(false)

    if (pedError) {
      toast.error('Error al actualizar pedido', { description: pedError.message })
      return
    }

    const label = `${serieReal}-${numero}`
    const mensaje = `Comprobante ${label} generado correctamente`
    setSuccessMsg(mensaje)
    setComprobanteEmitidoId(compInsertado?.id ?? null)
    setComprobanteEmitidoLabel(label)
    toast.success('Comprobante emitido', { description: mensaje })
    setTimeout(() => { setSuccessMsg(''); setComprobanteEmitidoId(null) }, 10000)
    loadData()
  }

  const updateSerie = (tipo: string) => {
    setTipoComprobante(tipo)
    setSerie(tipo === 'factura' ? 'F001' : tipo === 'boleta' ? 'B001' : 'T001')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Facturación</h1>
          <p className="text-sm text-gray-500 mt-0.5">Emisión de comprobantes electrónicos</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5"
            title={tipoCambioFecha ? `Tipo de cambio del ${formatDate(tipoCambioFecha)}` : 'Sin tipo de cambio registrado'}>
            <DollarSign className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-blue-700 font-medium">
              T/C: {tipoCambio != null ? `S/ ${tipoCambio.toFixed(3)}` : '—'}
            </span>
            {tipoCambioFecha && (
              <span className="text-[10px] text-blue-500/70 font-mono">
                {formatDate(tipoCambioFecha)}
              </span>
            )}
          </div>
          <Button
            onClick={() => setVentaDirectaOpen(true)}
            className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
          >
            <Receipt className="w-4 h-4" /> Venta Directa
          </Button>
        </div>
      </div>

      <VentaDirectaDialog
        open={ventaDirectaOpen}
        onOpenChange={setVentaDirectaOpen}
        onCreated={loadData}
      />

      {successMsg && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <p className="text-sm text-green-800 font-medium">{successMsg}</p>
          </div>
          {comprobanteEmitidoId && (
            <Link
              href={`/comprobante/${comprobanteEmitidoId}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 bg-white border border-green-300 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              Ver {comprobanteEmitidoLabel}
              <ExternalLink className="w-3 h-3 opacity-60" />
            </Link>
          )}
        </div>
      )}

      <Tabs defaultValue="pendientes">
        <TabsList className="bg-gray-100 p-1 rounded-xl">
          <TabsTrigger value="pendientes" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Pedidos Pendientes
            {pedidosPendientes.length > 0 && (
              <span className="ml-2 bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                {pedidosPendientes.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="emitidos" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Comprobantes Emitidos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pendientes" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Pedidos listos para facturar ({pedidosPendientes.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : pedidosPendientes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <CheckCircle className="w-10 h-10 mb-3 text-green-300" />
                  <p className="text-sm">No hay pedidos pendientes de facturar</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['Pedido', 'Cliente', 'RUC / DNI', 'Fecha', 'Total', 'Acción'].map((h) => (
                          <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pedidosPendientes.map((pedido) => (
                        <tr key={pedido.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-gray-600">{pedido.numero}</td>
                          <td className="py-3 px-4 font-medium text-gray-900">{pedido.clientes?.razon_social ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-500 font-mono text-xs">
                            {pedido.clientes?.ruc ?? pedido.clientes?.dni ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-gray-500 text-xs">{formatDate(pedido.created_at)}</td>
                          <td className="py-3 px-4 font-semibold text-gray-800">{formatCurrency(pedido.total ?? 0)}</td>
                          <td className="py-3 px-4">
                            <Button
                              size="sm"
                              onClick={() => handleFacturar(pedido)}
                              className="h-7 bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold text-xs gap-1"
                            >
                              <FileText className="w-3.5 h-3.5" /> Facturar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="emitidos" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Comprobantes Emitidos</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : comprobantes.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">No hay comprobantes emitidos</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['Serie-Número', 'Tipo', 'Cliente', 'Fecha', 'Total', 'Estado SUNAT', 'Acciones'].map((h) => (
                          <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {comprobantes.map((c) => {
                        const estadoCfg = ESTADO_SUNAT[c.estado] ?? ESTADO_SUNAT.emitido
                        return (
                          <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-3 px-4 font-mono text-xs font-semibold">
                              <Link
                                href={`/comprobante/${c.id}`}
                                target="_blank"
                                className="text-green-700 hover:text-green-800 hover:underline"
                                title="Ver / imprimir comprobante"
                              >
                                {c.serie}-{c.numero}
                              </Link>
                            </td>
                            <td className="py-3 px-4 capitalize text-xs text-gray-600">{c.tipo}</td>
                            <td className="py-3 px-4 text-gray-800">{(c.clientes as any)?.razon_social ?? '—'}</td>
                            <td className="py-3 px-4 text-gray-500 text-xs">{formatDate(c.fecha_emision)}</td>
                            <td className="py-3 px-4 font-semibold text-gray-800">{formatCurrency(c.total ?? 0)}</td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${estadoCfg.className}`}>
                                {estadoCfg.label}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <Link
                                href={`/comprobante/${c.id}`}
                                target="_blank"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                                title="Ver / imprimir en nueva pestaña"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Ver
                                <ExternalLink className="w-3 h-3 opacity-50" />
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Facturar */}
      <Dialog open={facturarDialog} onOpenChange={setFacturarDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Emitir Comprobante</DialogTitle>
          </DialogHeader>
          {pedidoSeleccionado && (
            <div className="space-y-4 mt-2">
              <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Pedido:</span>
                  <span className="font-mono font-semibold">{pedidoSeleccionado.numero}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cliente:</span>
                  <span className="font-medium">{pedidoSeleccionado.clientes?.razon_social}</span>
                </div>
                {(() => {
                  const st = Number(pedidoSeleccionado.subtotal ?? 0)
                  const ig = Number(pedidoSeleccionado.igv ?? 0)
                  const tt = Number(pedidoSeleccionado.total ?? 0)
                  const incIgv = pedidoSeleccionado.incluir_igv !== false
                  return (
                    <>
                      <div className="border-t border-gray-200 pt-1.5 mt-1.5" />
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Subtotal</span><span className="font-mono">{formatCurrency(st > 0 ? st : tt / (incIgv ? 1.18 : 1))}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>IGV (18%) {!incIgv && <span className="text-amber-600">· desactivado</span>}</span>
                        <span className="font-mono">{formatCurrency(ig > 0 ? ig : (incIgv ? tt - tt / 1.18 : 0))}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-1">
                        <span className="font-semibold">Total:</span>
                        <span className="font-bold text-green-600">{formatCurrency(tt)}</span>
                      </div>
                    </>
                  )
                })()}
              </div>

              <div>
                <Label>Tipo de Comprobante</Label>
                <Select value={tipoComprobante} onValueChange={updateSerie}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="factura" disabled={!puedeEmitirFactura(pedidoSeleccionado.clientes ?? {})}>
                      Factura {!puedeEmitirFactura(pedidoSeleccionado.clientes ?? {}) && '(cliente sin RUC)'}
                    </SelectItem>
                    <SelectItem value="boleta">Boleta de Venta</SelectItem>
                    <SelectItem value="nota_pedido_interna">Documento Interno</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Preseleccionado según el comprobante preferido del cliente.
                </p>
              </div>

              <div>
                <Label>Serie</Label>
                <Input
                  value={serie}
                  onChange={(e) => setSerie(e.target.value.toUpperCase())}
                  className="mt-1 font-mono"
                  maxLength={4}
                />
              </div>

              <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <p className="text-xs text-yellow-700">
                  El comprobante se emitirá y el pedido pasará a estado &quot;Facturado&quot;.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setFacturarDialog(false)}>Cancelar</Button>
                <Button
                  onClick={confirmarFacturacion}
                  disabled={saving}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirmar y Emitir
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
