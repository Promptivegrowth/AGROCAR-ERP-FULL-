'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  DollarSign, Plus, Loader2, CreditCard, Banknote, Smartphone, Building2,
  Lock, Unlock, RefreshCw
} from 'lucide-react'
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

const METODO_ICONS: Record<string, React.ElementType> = {
  efectivo: Banknote,
  yape: Smartphone,
  plin: Smartphone,
  transferencia: Building2,
  tarjeta: CreditCard,
}

const METODO_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
}

const METODO_COLORS: Record<string, string> = {
  efectivo: 'text-green-600 bg-green-50',
  yape: 'text-purple-600 bg-purple-50',
  plin: 'text-blue-600 bg-blue-50',
  transferencia: 'text-orange-600 bg-orange-50',
  tarjeta: 'text-pink-600 bg-pink-50',
}

// Ruta: /caja — Módulo de caja diaria (apertura/cierre, cobros del día)
export default function CajaPage() {
  const supabase = createClient()

  const [caja, setCaja] = useState<any>(null)
  const [cobros, setCobros] = useState<any[]>([])
  const [vendedores, setVendedores] = useState<any[]>([])
  const [clientes, setClientes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    cliente_id: '',
    vendedor_id: '',
    monto: '',
    metodo_pago: 'efectivo',
    referencia: '',
    tipo: 'cobranza' as const,
  })

  const today = new Date().toISOString().split('T')[0]

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: cajaData }, { data: cobrosData }, { data: vend }, { data: cli }] = await Promise.all([
      supabase.from('caja_sesiones').select('*').gte('fecha_apertura', today + 'T00:00:00').lte('fecha_apertura', today + 'T23:59:59').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase
        .from('cobros')
        .select(`
          id, efectivo, yape, plin, transferencia, total, tipo, notas, created_at,
          clientes(razon_social),
          profiles!cobros_cobrador_id_fkey(full_name)
        `)
        .eq('fecha', today)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').in('role', ['vendedor', 'repartidor']).eq('activo', true).order('full_name'),
      supabase.from('clientes').select('id, razon_social').eq('estado', 'activo').order('razon_social').limit(200),
    ])
    setCaja(cajaData)
    setCobros(cobrosData ?? [])
    setVendedores(vend ?? [])
    setClientes(cli ?? [])
    setLoading(false)
  }, [today])

  useEffect(() => { loadData() }, [loadData])

  const abrirCaja = async () => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('caja_sesiones').insert({
      cajero_id: user?.id ?? null,
      fecha_apertura: new Date().toISOString(),
      saldo_inicial: 0,
      estado: 'abierta',
    } as any)
    setSaving(false)
    if (error) {
      toast.error('Error al abrir caja', { description: error.message })
    } else {
      toast.success('Caja aperturada', { description: 'La caja del día quedó abierta.' })
    }
    loadData()
  }

  const cerrarCaja = async () => {
    if (!caja) return
    setSaving(true)
    const totalFinal = cobros.reduce((acc: number, c: any) => acc + (c.total ?? 0), 0)
    const { error } = await supabase.from('caja_sesiones').update({
      estado: 'cerrada',
      fecha_cierre: new Date().toISOString(),
      saldo_final: totalFinal,
    } as any).eq('id', caja.id)
    setSaving(false)
    if (error) {
      toast.error('Error al cerrar caja', { description: error.message })
    } else {
      toast.success('Caja cerrada', { description: `Saldo final registrado: ${totalFinal.toFixed(2)} S/.` })
    }
    loadData()
  }

  const registrarCobro = async () => {
    if (!form.cliente_id || !form.monto) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const monto = parseFloat(form.monto)
    const { error } = await supabase.from('cobros').insert({
      cliente_id: form.cliente_id,
      cobrador_id: user?.id ?? null,
      tipo: 'cobranza' as const,
      fecha: today,
      efectivo: form.metodo_pago === 'efectivo' ? monto : 0,
      yape: form.metodo_pago === 'yape' ? monto : 0,
      plin: form.metodo_pago === 'plin' ? monto : 0,
      transferencia: form.metodo_pago === 'transferencia' ? monto : 0,
      total: monto,
      notas: form.referencia || null,
    })
    setSaving(false)
    setDialogOpen(false)
    if (error) {
      toast.error('Error al registrar cobro', { description: error.message })
    } else {
      toast.success('Cobro registrado', {
        description: `S/ ${monto.toFixed(2)} · ${form.metodo_pago}`,
      })
    }
    setForm({ cliente_id: '', vendedor_id: '', monto: '', metodo_pago: 'efectivo', referencia: '', tipo: 'cobranza' })
    loadData()
  }

  // Detectar método de pago predominante de un cobro
  const getMetodoPago = (c: any): string => {
    if ((c.yape ?? 0) > 0) return 'yape'
    if ((c.plin ?? 0) > 0) return 'plin'
    if ((c.transferencia ?? 0) > 0) return 'transferencia'
    return 'efectivo'
  }

  // Resumen por método de pago
  const resumenMetodos = cobros.reduce((acc: Record<string, number>, c: any) => {
    const metodo = getMetodoPago(c)
    acc[metodo] = (acc[metodo] ?? 0) + (c.total ?? 0)
    return acc
  }, {} as Record<string, number>)

  const totalCobrado = cobros.reduce((acc: number, c: any) => acc + (c.total ?? 0), 0)

  // Resumen por vendedor
  const resumenVendedores = cobros.reduce((acc: Record<string, number>, c: any) => {
    const nombre = c.profiles?.full_name ?? 'Sin asignar'
    acc[nombre] = (acc[nombre] ?? 0) + (c.total ?? 0)
    return acc
  }, {} as Record<string, number>)

  const cajaAbierta = caja?.estado === 'abierta'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Caja</h1>
          <p className="text-sm text-gray-500 mt-0.5">Caja diaria y registro de cobros — {formatDate(today)}</p>
        </div>
        <div className="flex gap-2">
          {!caja ? (
            <Button onClick={abrirCaja} disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
              <Unlock className="w-4 h-4" /> Abrir Caja
            </Button>
          ) : cajaAbierta ? (
            <>
              <Button onClick={() => setDialogOpen(true)} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                <Plus className="w-4 h-4" /> Registrar Cobro
              </Button>
              <Button onClick={cerrarCaja} disabled={saving} variant="outline" className="gap-2">
                <Lock className="w-4 h-4" /> Cerrar Caja
              </Button>
            </>
          ) : (
            <Badge className="bg-gray-100 text-gray-600 px-3 py-1.5 text-sm">Caja Cerrada</Badge>
          )}
        </div>
      </div>

      {/* Estado de caja */}
      <div className={`rounded-xl p-4 border ${cajaAbierta ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-3">
          {cajaAbierta
            ? <Unlock className="w-5 h-5 text-green-600" />
            : <Lock className="w-5 h-5 text-gray-400" />
          }
          <p className={`text-sm font-semibold ${cajaAbierta ? 'text-green-800' : 'text-gray-600'}`}>
            {!caja ? 'Caja no aperturada hoy' : cajaAbierta ? 'Caja abierta' : 'Caja cerrada'}
          </p>
          <span className={`text-sm ${cajaAbierta ? 'text-green-600' : 'text-gray-400'}`}>
            · Total cobrado: <strong>{formatCurrency(totalCobrado)}</strong>
          </span>
        </div>
      </div>

      {/* Resumen por método */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Object.entries(METODO_LABELS).map(([key, label]) => {
          const Icon = METODO_ICONS[key] ?? DollarSign
          const monto = resumenMetodos[key] ?? 0
          return (
            <Card key={key} className="border-gray-200 shadow-sm">
              <CardContent className="p-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${METODO_COLORS[key]}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <p className="text-xs text-gray-500 font-medium">{label}</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrency(monto)}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Cobros del día */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Cobros del Día ({cobros.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : cobros.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No hay cobros registrados hoy</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['Hora', 'Vendedor', 'Cliente', 'Método', 'Monto'].map((h) => (
                          <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {cobros.map((c: any) => {
                        const metodo = getMetodoPago(c)
                        const Icon = METODO_ICONS[metodo] ?? DollarSign
                        return (
                          <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-2.5 px-4 text-gray-500 text-xs">
                              {new Date(c.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' })}
                            </td>
                            <td className="py-2.5 px-4 text-gray-700">{c.profiles?.full_name ?? '—'}</td>
                            <td className="py-2.5 px-4 font-medium text-gray-900">{c.clientes?.razon_social ?? '—'}</td>
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-1.5">
                                <Icon className="w-3.5 h-3.5 text-gray-400" />
                                <span className="text-xs text-gray-600 capitalize">{METODO_LABELS[metodo] ?? metodo}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 font-bold text-green-600">{formatCurrency(c.total ?? 0)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Liquidación por vendedor */}
        <div>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Liquidación por Vendedor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(resumenVendedores).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Sin datos</p>
              ) : (
                Object.entries(resumenVendedores)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([nombre, monto]) => (
                    <div key={nombre} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-green-100 rounded-full flex items-center justify-center">
                          <span className="text-xs font-bold text-green-600">
                            {nombre.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 truncate max-w-[120px]">{nombre}</p>
                      </div>
                      <p className="text-sm font-bold text-green-600">{formatCurrency(monto)}</p>
                    </div>
                  ))
              )}
              {Object.entries(resumenVendedores).length > 0 && (
                <div className="pt-2 border-t border-gray-100 flex justify-between">
                  <span className="text-sm font-semibold text-gray-700">Total</span>
                  <span className="text-sm font-bold text-gray-900">{formatCurrency(totalCobrado)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog Registrar Cobro */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Cobro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Cliente *</Label>
              <Select value={form.cliente_id} onValueChange={(v) => setForm((f) => ({ ...f, cliente_id: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar cliente..." />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.razon_social}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Vendedor</Label>
              <Select value={form.vendedor_id} onValueChange={(v) => setForm((f) => ({ ...f, vendedor_id: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar vendedor..." />
                </SelectTrigger>
                <SelectContent>
                  {vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Monto (S/) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  value={form.monto}
                  onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Método de Pago</Label>
                <Select value={form.metodo_pago} onValueChange={(v) => setForm((f) => ({ ...f, metodo_pago: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="yape">Yape</SelectItem>
                    <SelectItem value="plin">Plin</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                    <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Referencia / N° Operación</Label>
              <Input
                placeholder="Ej. 12345678"
                value={form.referencia}
                onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))}
                className="mt-1"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button
                onClick={registrarCobro}
                disabled={saving || !form.cliente_id || !form.monto}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Registrar Cobro
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
