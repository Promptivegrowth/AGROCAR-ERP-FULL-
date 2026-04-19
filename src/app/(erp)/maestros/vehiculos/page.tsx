'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Edit, ToggleLeft, ToggleRight, Loader2, Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const vehiculoSchema = z.object({
  placa: z.string().min(5, 'Mínimo 5 caracteres').max(10, 'Máximo 10 caracteres'),
  descripcion: z.string().min(2, 'Mínimo 2 caracteres'),
  tipo: z.enum(['zona', 'auxiliar']),
  capacidad_kg: z.coerce.number().min(0).optional(),
  anio: z.coerce.number().min(1990).max(2030).optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  activo: z.boolean().default(true),
})

type VehiculoFormData = z.infer<typeof vehiculoSchema>

const TIPO_CONFIG: Record<string, { label: string; className: string }> = {
  zona: { label: 'Zona', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  auxiliar: { label: 'Auxiliar', className: 'bg-purple-100 text-purple-700 border-purple-200' },
}

export default function VehiculosPage() {
  const supabase = createClient()

  const [vehiculos, setVehiculos] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingVehiculo, setEditingVehiculo] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<VehiculoFormData>({
    resolver: zodResolver(vehiculoSchema) as any,
    defaultValues: { tipo: 'zona', activo: true },
  })

  const loadVehiculos = useCallback(async () => {
    setLoading(true)
    const { data, count } = await supabase
      .from('vehiculos')
      .select('*', { count: 'exact' })
      .order('placa')
    setVehiculos(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => { loadVehiculos() }, [loadVehiculos])

  const openCreate = () => {
    setEditingVehiculo(null)
    reset({ tipo: 'zona', activo: true })
    setDialogOpen(true)
  }

  const openEdit = (vehiculo: any) => {
    setEditingVehiculo(vehiculo)
    reset({
      placa: vehiculo.placa,
      descripcion: vehiculo.descripcion,
      tipo: vehiculo.tipo,
      capacidad_kg: vehiculo.capacidad_kg ?? 0,
      anio: vehiculo.anio ?? undefined,
      marca: vehiculo.marca ?? '',
      modelo: vehiculo.modelo ?? '',
      activo: vehiculo.activo,
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: VehiculoFormData) => {
    setSaving(true)
    const payload = {
      ...data,
      placa: data.placa.toUpperCase(),
      marca: data.marca || null,
      modelo: data.modelo || null,
    }

    if (editingVehiculo) {
      await (supabase.from('vehiculos') as any).update(payload).eq('id', editingVehiculo.id)
    } else {
      await (supabase.from('vehiculos') as any).insert({ ...payload, created_at: new Date().toISOString() })
    }

    setSaving(false)
    setDialogOpen(false)
    loadVehiculos()
  }

  const toggleActivo = async (vehiculo: any) => {
    await supabase.from('vehiculos').update({ activo: !vehiculo.activo }).eq('id', vehiculo.id)
    loadVehiculos()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehículos</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} vehículos registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2">
          <Plus className="w-4 h-4" /> Nuevo Vehículo
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : vehiculos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Truck className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No hay vehículos registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Placa', 'Descripción', 'Tipo', 'Marca / Modelo', 'Año', 'Capacidad', 'Estado', 'Acciones'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {vehiculos.map((v) => {
                    const tipoCfg = TIPO_CONFIG[v.tipo] ?? TIPO_CONFIG.auxiliar
                    return (
                      <tr key={v.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-gray-800">{v.placa}</td>
                        <td className="py-3 px-4 text-gray-700">{v.descripcion}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tipoCfg.className}`}>
                            {tipoCfg.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-xs">
                          {v.marca ?? '—'} {v.modelo ? `/ ${v.modelo}` : ''}
                        </td>
                        <td className="py-3 px-4 text-gray-600">{v.anio ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs">
                          {v.capacidad_kg ? `${v.capacidad_kg.toLocaleString()} kg` : '—'}
                        </td>
                        <td className="py-3 px-4">
                          {v.activo
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                            : <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                          }
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(v)} className="h-7 w-7 p-0">
                              <Edit className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleActivo(v)} className="h-7 w-7 p-0">
                              {v.activo
                                ? <ToggleRight className="w-4 h-4 text-green-600" />
                                : <ToggleLeft className="w-4 h-4 text-gray-400" />
                              }
                            </Button>
                          </div>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVehiculo ? 'Editar Vehículo' : 'Nuevo Vehículo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Placa *</Label>
                <Input
                  {...register('placa')}
                  placeholder="ABC-123"
                  className="mt-1 font-mono uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
                {errors.placa && <p className="text-xs text-red-500 mt-1">{errors.placa.message}</p>}
              </div>
              <div>
                <Label>Tipo *</Label>
                <Select defaultValue="zona" onValueChange={(v) => setValue('tipo', v as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zona">Zona</SelectItem>
                    <SelectItem value="auxiliar">Auxiliar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Descripción *</Label>
              <Input {...register('descripcion')} placeholder="Ej. Camioneta reparto norte" className="mt-1" />
              {errors.descripcion && <p className="text-xs text-red-500 mt-1">{errors.descripcion.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Marca</Label>
                <Input {...register('marca')} placeholder="Toyota, Hyundai..." className="mt-1" />
              </div>
              <div>
                <Label>Modelo</Label>
                <Input {...register('modelo')} placeholder="Hilux, H100..." className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Año</Label>
                <Input {...register('anio')} type="number" min={1990} max={2030} placeholder="2020" className="mt-1" />
              </div>
              <div>
                <Label>Capacidad (kg)</Label>
                <Input {...register('capacidad_kg')} type="number" min={0} placeholder="1000" className="mt-1" />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingVehiculo ? 'Guardar Cambios' : 'Crear Vehículo'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
