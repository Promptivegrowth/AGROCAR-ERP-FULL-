'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Edit, ToggleLeft, ToggleRight, Loader2, Map } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

const zonaSchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().nullable().optional(),
  activo: z.boolean().default(true),
})

type ZonaFormData = z.infer<typeof zonaSchema>

export default function ZonasPage() {
  const supabase = createClient()

  const [zonas, setZonas] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingZona, setEditingZona] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [activoVal, setActivoVal] = useState(true)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ZonaFormData>({
    resolver: zodResolver(zonaSchema) as any,
    defaultValues: { activo: true },
  })

  const loadZonas = useCallback(async () => {
    setLoading(true)
    const { data, count } = await supabase
      .from('zonas')
      .select('*, profiles(count)', { count: 'exact' })
      .order('nombre')
    setZonas(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [])

  // Carga la cantidad de clientes por zona
  const [clientesPorZona, setClientesPorZona] = useState<Record<string, number>>({})

  const loadClientesPorZona = useCallback(async () => {
    const { data } = await supabase
      .from('clientes')
      .select('zona_id')
      .eq('estado', 'activo')
    const counts: Record<string, number> = {}
    ;(data ?? []).forEach((c: any) => {
      if (c.zona_id) counts[c.zona_id] = (counts[c.zona_id] ?? 0) + 1
    })
    setClientesPorZona(counts)
  }, [])

  useEffect(() => {
    loadZonas()
    loadClientesPorZona()
  }, [loadZonas, loadClientesPorZona])

  const openCreate = () => {
    setEditingZona(null)
    setActivoVal(true)
    reset({ activo: true, nombre: '', descripcion: '' })
    setDialogOpen(true)
  }

  const openEdit = (zona: any) => {
    setEditingZona(zona)
    setActivoVal(zona.activo)
    reset({
      nombre: zona.nombre,
      descripcion: zona.descripcion ?? '',
      activo: zona.activo,
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: ZonaFormData) => {
    setSaving(true)
    const payload = {
      nombre: data.nombre,
      descripcion: data.descripcion || null,
      activo: activoVal,
    }

    if (editingZona) {
      await supabase.from('zonas').update(payload).eq('id', editingZona.id)
    } else {
      await supabase.from('zonas').insert({ ...payload, created_at: new Date().toISOString() })
    }

    setSaving(false)
    setDialogOpen(false)
    loadZonas()
  }

  const toggleActivo = async (zona: any) => {
    await supabase.from('zonas').update({ activo: !zona.activo }).eq('id', zona.id)
    loadZonas()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Zonas de Distribución</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} zonas registradas</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2">
          <Plus className="w-4 h-4" /> Nueva Zona
        </Button>
      </div>

      {/* Cards de zonas */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
        </div>
      ) : zonas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Map className="w-10 h-10 mb-3 text-gray-300" />
          <p className="text-sm">No hay zonas registradas</p>
        </div>
      ) : (
        <>
          {/* Vista tarjetas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {zonas.map((z) => (
              <Card
                key={z.id}
                className={`border shadow-sm transition-all hover:shadow-md ${z.activo ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <Map className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(z)} className="h-7 w-7 p-0">
                        <Edit className="w-3.5 h-3.5 text-gray-400" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActivo(z)} className="h-7 w-7 p-0">
                        {z.activo
                          ? <ToggleRight className="w-4 h-4 text-green-500" />
                          : <ToggleLeft className="w-4 h-4 text-gray-300" />
                        }
                      </Button>
                    </div>
                  </div>
                  <p className="font-bold text-gray-900 mt-3">{z.nombre}</p>
                  {z.descripcion && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{z.descripcion}</p>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-gray-400">
                      {clientesPorZona[z.id] ?? 0} clientes activos
                    </span>
                    {z.activo
                      ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activa</Badge>
                      : <Badge variant="secondary" className="text-xs">Inactiva</Badge>
                    }
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tabla resumen */}
          <Card className="border-gray-200 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Zona', 'Descripción', 'Clientes', 'Creada', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {zonas.map((z) => (
                      <tr key={z.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-semibold text-gray-800">{z.nombre}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs max-w-[200px] truncate">{z.descripcion ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600">{clientesPorZona[z.id] ?? 0}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{z.created_at ? formatDate(z.created_at) : '—'}</td>
                        <td className="py-3 px-4">
                          {z.activo
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activa</Badge>
                            : <Badge variant="secondary" className="text-xs">Inactiva</Badge>
                          }
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(z)} className="h-7 gap-1 text-xs px-2">
                              <Edit className="w-3 h-3" /> Editar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingZona ? 'Editar Zona' : 'Nueva Zona'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>Nombre de la Zona *</Label>
              <Input {...register('nombre')} placeholder="Ej. Zona Norte, Zona Comercial..." className="mt-1" />
              {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
            </div>

            <div>
              <Label>Descripción</Label>
              <Textarea
                {...register('descripcion')}
                placeholder="Descripción del área geográfica o cobertura de la zona..."
                className="mt-1 resize-none"
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={activoVal} onCheckedChange={setActivoVal} />
              <Label>Zona activa</Label>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingZona ? 'Guardar Cambios' : 'Crear Zona'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
