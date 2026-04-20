'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Printer, Truck, Loader2, ChevronDown, ChevronRight, Package } from 'lucide-react'
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

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  preparacion: { label: 'En Preparación', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  en_ruta: { label: 'En Ruta', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  completado: { label: 'Completado', className: 'bg-green-100 text-green-700 border-green-200' },
  cancelado: { label: 'Cancelado', className: 'bg-red-100 text-red-700 border-red-200' },
}

export default function DespachoPage() {
  const supabase = createClient()

  const [consolidados, setConsolidados] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [vehiculos, setVehiculos] = useState<any[]>([])
  const [pedidosFacturados, setPedidosFacturados] = useState<any[]>([])
  const [selectedVehiculo, setSelectedVehiculo] = useState('')
  const [selectedFecha, setSelectedFecha] = useState(new Date().toISOString().split('T')[0])
  const [selectedPedidos, setSelectedPedidos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: cons }, { data: veh }, { data: pedFact }] = await Promise.all([
      supabase
        .from('despachos')
        .select(`
          id, numero, fecha_despacho, estado, notas,
          vehiculos(placa, descripcion),
          profiles!despachos_conductor_id_fkey(full_name),
          despachos_items(
            id, estado,
            pedidos(numero, total, clientes(razon_social))
          )
        `)
        .order('fecha_despacho', { ascending: false })
        .limit(20),
      supabase.from('vehiculos').select('id, placa, descripcion').eq('activo', true).order('placa'),
      supabase
        .from('pedidos')
        .select(`id, numero, total, clientes(razon_social)`)
        .eq('estado', 'facturado')
        .order('created_at', { ascending: false }),
    ])
    setConsolidados(cons ?? [])
    setVehiculos(veh ?? [])
    setPedidosFacturados(pedFact ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id])
  }

  const togglePedido = (id: string) => {
    setSelectedPedidos((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])
  }

  const handleCrear = async () => {
    if (!selectedVehiculo || selectedPedidos.length === 0) return
    setSaving(true)

    const numero = `DSP-${Date.now().toString().slice(-8)}`
    const { data: despacho, error } = await supabase.from('despachos').insert({
      numero,
      vehiculo_id: selectedVehiculo,
      fecha_despacho: selectedFecha,
      estado: 'preparacion' as any,
    } as any).select().single()

    if (error || !despacho) {
      setSaving(false)
      toast.error('Error al crear consolidado', { description: error?.message ?? 'No se pudo crear el despacho.' })
      return
    }

    const items = selectedPedidos.map((pid) => ({
      despacho_id: despacho.id,
      pedido_id: pid,
      estado: 'pendiente',
    }))
    const { error: itemsError } = await supabase.from('despachos_items').insert(items as any)
    if (itemsError) {
      setSaving(false)
      toast.error('Error al asignar pedidos', { description: itemsError.message })
      return
    }

    const { error: updError } = await supabase
      .from('pedidos')
      .update({ estado: 'despachado', updated_at: new Date().toISOString() })
      .in('id', selectedPedidos)

    setSaving(false)
    setDialogOpen(false)
    setSelectedPedidos([])
    setSelectedVehiculo('')

    if (updError) {
      toast.error('Consolidado creado con advertencias', {
        description: updError.message,
        action: {
          label: 'Ver Guía',
          onClick: () => window.open(`/guia-remision/${despacho.id}`, '_blank'),
        },
      })
    } else {
      toast.success('Consolidado creado', {
        description: `${selectedPedidos.length} pedido(s) asignado(s) al despacho.`,
        action: {
          label: 'Ver Guía',
          onClick: () => window.open(`/guia-remision/${despacho.id}`, '_blank'),
        },
      })
    }

    loadData()
  }

  const cambiarEstado = async (despachoId: string, nuevoEstado: string) => {
    const { error } = await supabase.from('despachos').update({ estado: nuevoEstado as any }).eq('id', despachoId)
    if (error) {
      toast.error('Error al cambiar estado', { description: error.message })
    } else {
      toast.success('Estado actualizado', {
        description: `Despacho marcado como "${ESTADO_CONFIG[nuevoEstado]?.label ?? nuevoEstado}".`,
      })
    }
    loadData()
  }

  const imprimirHojaRuta = (consolidado: any) => {
    const win = window.open('', '_blank', 'width=800,height=600')
    if (!win) return
    const items = consolidado.despachos_items ?? []
    win.document.write(`
      <html>
        <head>
          <title>Hoja de Ruta - ${consolidado.numero ?? ''}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
            h1 { font-size: 18px; color: #16a34a; margin-bottom: 4px; }
            .meta { color: #666; margin-bottom: 16px; font-size: 11px; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #f3f4f6; text-align: left; padding: 8px; font-size: 10px; text-transform: uppercase; }
            td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
            .total { font-weight: bold; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h1>AGROCAR SRL — Hoja de Ruta</h1>
          <div class="meta">
            Vehículo: ${consolidado.vehiculos?.placa ?? '—'} — ${consolidado.vehiculos?.descripcion ?? ''}
            &nbsp;|&nbsp; Fecha: ${formatDate(consolidado.fecha_despacho)}
            &nbsp;|&nbsp; Estado: ${ESTADO_CONFIG[consolidado.estado]?.label ?? consolidado.estado}
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Entregado</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item: any, i: number) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${item.pedidos?.numero ?? '—'}</td>
                  <td>${item.pedidos?.clientes?.razon_social ?? '—'}</td>
                  <td class="total">S/ ${(item.pedidos?.total ?? 0).toFixed(2)}</td>
                  <td>[ ]</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <script>window.print()</script>
        </body>
      </html>
    `)
    win.document.close()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Despacho</h1>
          <p className="text-sm text-gray-500 mt-0.5">Consolidados de despacho y hojas de ruta</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
          <Plus className="w-4 h-4" /> Nuevo Consolidado
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
        </div>
      ) : consolidados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Truck className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">No hay consolidados de despacho</p>
        </div>
      ) : (
        <div className="space-y-3">
          {consolidados.map((cons) => {
            const isOpen = expanded.includes(cons.id)
            const estadoCfg = ESTADO_CONFIG[cons.estado] ?? ESTADO_CONFIG.preparacion
            const items = cons.despachos_items ?? []
            const total = items.reduce((acc: number, item: any) => acc + (item.pedidos?.total ?? 0), 0)

            return (
              <Card key={cons.id} className="border-gray-200 shadow-sm overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(cons.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                      <Truck className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900 text-sm">
                          {cons.vehiculos?.placa ?? '—'} — {cons.vehiculos?.descripcion ?? ''}
                        </p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${estadoCfg.className}`}>
                          {estadoCfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(cons.fecha_despacho)} · {items.length} pedidos · {formatCurrency(total)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {cons.estado === 'preparacion' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); cambiarEstado(cons.id, 'en_ruta') }}
                        className="h-7 text-xs"
                      >
                        Iniciar Ruta
                      </Button>
                    )}
                    {cons.estado === 'en_ruta' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); cambiarEstado(cons.id, 'completado') }}
                        className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                      >
                        Completar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => { e.stopPropagation(); imprimirHojaRuta(cons) }}
                      className="h-7 text-xs gap-1"
                    >
                      <Printer className="w-3.5 h-3.5" /> Imprimir
                    </Button>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-gray-100">
                    {items.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">Sin pedidos asignados</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50/50 border-b border-gray-100">
                          <tr>
                            {['#', 'Pedido', 'Cliente', 'Total', 'Estado'].map((h) => (
                              <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {items.map((item: any, idx: number) => (
                            <tr key={item.id} className="hover:bg-gray-50/50">
                              <td className="py-2.5 px-4 text-gray-400 text-xs">{idx + 1}</td>
                              <td className="py-2.5 px-4 font-mono text-xs text-gray-600">{item.pedidos?.numero ?? '—'}</td>
                              <td className="py-2.5 px-4 text-gray-800">{item.pedidos?.clientes?.razon_social ?? '—'}</td>
                              <td className="py-2.5 px-4 font-semibold text-gray-800">{formatCurrency(item.pedidos?.total ?? 0)}</td>
                              <td className="py-2.5 px-4">
                                {item.estado === 'entregado'
                                  ? <Badge className="text-xs bg-green-100 text-green-700">Entregado</Badge>
                                  : item.estado === 'rechazado'
                                    ? <Badge className="text-xs bg-red-100 text-red-700">Rechazado</Badge>
                                    : <Badge variant="outline" className="text-xs">Pendiente</Badge>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialog Nuevo Consolidado */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo Consolidado de Despacho</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Vehículo *</Label>
                <Select value={selectedVehiculo} onValueChange={setSelectedVehiculo}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar vehículo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vehiculos.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.placa} — {v.descripcion}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={selectedFecha}
                  onChange={(e) => setSelectedFecha(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="mb-2 block">
                Pedidos Facturados ({pedidosFacturados.length} disponibles)
              </Label>
              {pedidosFacturados.length === 0 ? (
                <div className="flex items-center justify-center py-8 border border-dashed border-gray-200 rounded-lg text-gray-400">
                  <p className="text-sm">No hay pedidos facturados disponibles</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                  {pedidosFacturados.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPedidos.includes(p.id)}
                        onChange={() => togglePedido(p.id)}
                        className="w-4 h-4 rounded text-green-600"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{p.clientes?.razon_social ?? '—'}</p>
                        <p className="text-xs text-gray-500 font-mono">{p.numero}</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-700">{formatCurrency(p.total ?? 0)}</span>
                    </label>
                  ))}
                </div>
              )}
              {selectedPedidos.length > 0 && (
                <p className="text-xs text-green-600 mt-1 font-medium">
                  {selectedPedidos.length} pedido(s) seleccionado(s)
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button
                onClick={handleCrear}
                disabled={saving || !selectedVehiculo || selectedPedidos.length === 0}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Crear Consolidado
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
