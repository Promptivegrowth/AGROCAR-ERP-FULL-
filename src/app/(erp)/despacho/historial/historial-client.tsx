'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Truck, FileText, Play, CheckCircle, Clock, MapPin, Package, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import CamionSVG from '@/components/camion-svg'
import { motion, AnimatePresence } from 'framer-motion'

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  preparacion: { label: 'En Preparación', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  en_ruta:     { label: 'En Ruta',        className: 'bg-blue-100 text-blue-700 border-blue-200 animate-pulse' },
  completado:  { label: 'Completado',     className: 'bg-green-100 text-green-700 border-green-200' },
  cancelado:   { label: 'Cancelado',      className: 'bg-gray-100 text-gray-500 border-gray-200' },
}

function formatDuracion(minutos: number | null | undefined) {
  if (minutos == null) return '—'
  const m = Math.max(0, Math.round(Number(minutos)))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m`
}

export default function HistorialClient({ despachosIniciales }: { despachosIniciales: any[] }) {
  const supabase = createClient()
  const router = useRouter()
  const [despachos, setDespachos] = useState<any[]>(despachosIniciales)
  const [, setTick] = useState(0)
  const [finalizarDialog, setFinalizarDialog] = useState<any>(null)
  const [kmInput, setKmInput] = useState('')
  const [notasFin, setNotasFin] = useState('')
  const [saving, setSaving] = useState(false)

  // Tick cada 30s para actualizar cronómetros de flota en vivo
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [])

  const enRuta = useMemo(() => despachos.filter((d) => d.estado === 'en_ruta'), [despachos])
  const enPreparacion = useMemo(() => despachos.filter((d) => d.estado === 'preparacion'), [despachos])
  const otros = useMemo(() => despachos.filter((d) => !['en_ruta', 'preparacion'].includes(d.estado)), [despachos])

  async function iniciarRuta(despacho: any) {
    if (!confirm(`¿Confirmar salida del vehículo ${despacho.placa}?`)) return
    setSaving(true)
    const { error } = await (supabase as any)
      .from('despachos')
      .update({ estado: 'en_ruta', hora_salida: new Date().toISOString() })
      .eq('id', despacho.id)
    setSaving(false)
    if (error) {
      toast.error('No se pudo iniciar la ruta', { description: error.message })
      return
    }
    toast.success('Ruta iniciada', { description: `${despacho.placa} marcado en ruta.` })
    setDespachos((prev) => prev.map((d) => d.id === despacho.id
      ? { ...d, estado: 'en_ruta', hora_salida: new Date().toISOString(), minutos_transcurridos: 0 }
      : d))
    router.refresh()
  }

  async function abrirFinalizar(despacho: any) {
    setFinalizarDialog(despacho)
    setKmInput('')
    setNotasFin('')
  }

  async function confirmarFinalizar() {
    if (!finalizarDialog) return
    setSaving(true)
    const ahora = new Date()
    const salida = new Date(finalizarDialog.hora_salida)
    const duracionMin = Math.round((ahora.getTime() - salida.getTime()) / 60000)
    const payload: any = {
      estado: 'completado',
      hora_retorno: ahora.toISOString(),
      duracion_minutos: duracionMin,
    }
    if (kmInput.trim()) payload.km_recorridos = parseFloat(kmInput)
    if (notasFin.trim()) payload.notas = notasFin

    const { error } = await (supabase as any)
      .from('despachos')
      .update(payload)
      .eq('id', finalizarDialog.id)
    setSaving(false)
    if (error) {
      toast.error('No se pudo cerrar la ruta', { description: error.message })
      return
    }
    toast.success('Ruta finalizada', {
      description: `${finalizarDialog.placa} regresó al almacén en ${formatDuracion(duracionMin)}.`,
    })
    setFinalizarDialog(null)
    setDespachos((prev) => prev.map((d) => d.id === finalizarDialog.id
      ? { ...d, ...payload, minutos_transcurridos: duracionMin }
      : d))
    router.refresh()
  }

  const minutosAhora = (despacho: any): number | null => {
    if (despacho.estado !== 'en_ruta' || !despacho.hora_salida) return Number(despacho.minutos_transcurridos) || null
    return (Date.now() - new Date(despacho.hora_salida).getTime()) / 60000
  }

  return (
    <div className="space-y-5">
      {/* Flota en vivo */}
      {enRuta.length > 0 && (
        <Card className="border-blue-200 shadow-sm bg-gradient-to-br from-blue-50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-blue-900">
              <Activity className="w-5 h-5 animate-pulse" />
              Flota en Vivo ({enRuta.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence>
              {enRuta.map((d) => {
                const mins = minutosAhora(d)
                const pctEntregado = d.total_pedidos > 0 ? (Number(d.pedidos_entregados) / Number(d.total_pedidos)) * 100 : 0
                return (
                  <motion.div
                    key={d.id}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-xl border-2 border-blue-200 p-3 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div style={{ width: 80 }}>
                        <CamionSVG tipo={d.vehiculo_tipo ?? 'zona'} cargaPct={d.capacidad_kg > 0 ? (Number(d.peso_total_kg) / Number(d.capacidad_kg)) * 100 : 0} className="w-full h-auto" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold font-mono text-gray-900">{d.placa}</p>
                        <p className="text-[11px] text-gray-500 truncate">{d.numero}</p>
                        <Badge className="mt-1 text-[10px] bg-blue-100 text-blue-700 border-blue-200 animate-pulse">En Ruta</Badge>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-[10px] text-gray-500 uppercase flex items-center gap-1"><Clock className="w-3 h-3" /> Tiempo</p>
                        <p className="text-sm font-bold font-mono text-blue-700">{formatDuracion(mins)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-[10px] text-gray-500 uppercase">Salida</p>
                        <p className="text-xs font-mono text-gray-700">
                          {new Date(d.hora_salida).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[11px] text-gray-600 mb-1">
                        <span>Entregados: <strong className="text-gray-900">{d.pedidos_entregados}/{d.total_pedidos}</strong></span>
                        <span className="font-mono text-gray-500">{pctEntregado.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 transition-all" style={{ width: `${pctEntregado}%` }} />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5">
                      <Button onClick={() => abrirFinalizar(d)} disabled={saving} size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-1 h-7 text-xs">
                        <CheckCircle className="w-3 h-3" /> Finalizar
                      </Button>
                      <Link href={`/hoja-ruta/${d.id}`} target="_blank">
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2">
                          <FileText className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </CardContent>
        </Card>
      )}

      {/* En preparación */}
      {enPreparacion.length > 0 && (
        <Card className="border-amber-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-800">
              <Package className="w-5 h-5" /> Listos para salir ({enPreparacion.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {enPreparacion.map((d) => (
              <div key={d.id} className="bg-white rounded-xl border border-amber-200 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold font-mono text-gray-900">{d.placa}</p>
                    <p className="text-[11px] text-gray-500">{d.numero}</p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {d.total_pedidos} paradas · {Number(d.peso_total_kg ?? 0).toFixed(0)} kg · {formatCurrency(Number(d.total_monto ?? 0))}
                    </p>
                  </div>
                  <Badge className="text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200">Listo</Badge>
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <Button onClick={() => iniciarRuta(d)} disabled={saving} size="sm" className="flex-1 bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-1 h-7 text-xs">
                    <Play className="w-3 h-3" /> Iniciar ruta
                  </Button>
                  <Link href={`/hoja-ruta/${d.id}`} target="_blank">
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2">
                      <FileText className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Historial completado */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Truck className="w-4 h-4" /> Historial ({otros.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  {['N°', 'Fecha', 'Vehículo', 'Paradas', 'Peso', 'Total', 'Salida', 'Retorno', 'Duración', 'Km', 'Estado', 'Hoja de Ruta'].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {otros.map((d) => {
                  const cfg = ESTADO_CONFIG[d.estado] ?? ESTADO_CONFIG.preparacion
                  return (
                    <tr key={d.id} className="hover:bg-gray-50/50">
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold text-gray-800">{d.numero}</td>
                      <td className="py-2.5 px-3 text-gray-600 text-xs">{formatDate(d.fecha_despacho)}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono text-xs font-semibold">{d.placa ?? '—'}</div>
                        {d.vehiculo_descripcion && <div className="text-[10px] text-gray-500">{d.vehiculo_descripcion}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        {d.pedidos_entregados}/{d.total_pedidos}
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono">{Number(d.peso_total_kg ?? 0).toFixed(1)} kg</td>
                      <td className="py-2.5 px-3 text-xs font-semibold">{formatCurrency(d.total_monto ?? 0)}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-600 font-mono">
                        {d.hora_salida ? new Date(d.hora_salida).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-600 font-mono">
                        {d.hora_retorno ? new Date(d.hora_retorno).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono text-gray-700">{formatDuracion(d.duracion_minutos)}</td>
                      <td className="py-2.5 px-3 text-xs font-mono">{d.km_recorridos ? `${Number(d.km_recorridos).toFixed(1)} km` : '—'}</td>
                      <td className="py-2.5 px-3">
                        <Badge className={`text-[10px] ${cfg.className} border`}>{cfg.label}</Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/hoja-ruta/${d.id}`} target="_blank" className="text-xs text-blue-700 hover:underline font-medium">Premium</Link>
                          <Link href={`/hoja-ruta/${d.id}/simple`} target="_blank" className="text-xs text-gray-600 hover:underline">Simple</Link>
                          <Link href={`/hoja-ruta/${d.id}/almacen`} target="_blank" className="text-xs text-blue-700 hover:underline">📦 Almacén</Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Finalizar */}
      <Dialog open={!!finalizarDialog} onOpenChange={(o) => !o && setFinalizarDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finalizar ruta · {finalizarDialog?.placa}</DialogTitle>
          </DialogHeader>
          {finalizarDialog && (
            <div className="space-y-3 mt-2">
              <div className="bg-blue-50 rounded-lg p-3 text-sm">
                <p className="text-xs text-blue-700 uppercase font-semibold">Tiempo en ruta</p>
                <p className="text-2xl font-bold text-blue-900 font-mono mt-1">
                  {formatDuracion(minutosAhora(finalizarDialog))}
                </p>
                <p className="text-xs text-blue-600">
                  Salida: {new Date(finalizarDialog.hora_salida).toLocaleString('es-PE')}
                </p>
              </div>
              <div>
                <Label>Kilómetros recorridos (opcional)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={kmInput}
                  onChange={(e) => setKmInput(e.target.value)}
                  placeholder="Ej: 45.2"
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label>Observaciones (opcional)</Label>
                <Textarea
                  value={notasFin}
                  onChange={(e) => setNotasFin(e.target.value)}
                  placeholder="Comentarios, devoluciones, incidentes..."
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setFinalizarDialog(null)}>Cancelar</Button>
                <Button
                  onClick={confirmarFinalizar}
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-700 text-white gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Confirmar retorno
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
