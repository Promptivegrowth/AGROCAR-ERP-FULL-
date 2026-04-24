'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Edit, ToggleLeft, ToggleRight, Loader2, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

const schema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().nullable().optional(),
})
type FormData = z.infer<typeof schema>

export default function TiposClientePage() {
  const supabase = createClient()
  const [tipos, setTipos] = useState<any[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [activo, setActivo] = useState(true)
  const [deleteDialog, setDeleteDialog] = useState<any>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
  })

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: cls }] = await Promise.all([
      (supabase as any).from('tipos_cliente').select('*').order('nombre'),
      (supabase as any).from('clientes').select('tipo_cliente_id'),
    ])
    const map: Record<string, number> = {}
    ;(cls ?? []).forEach((c: any) => {
      if (c.tipo_cliente_id) map[c.tipo_cliente_id] = (map[c.tipo_cliente_id] ?? 0) + 1
    })
    setTipos(data ?? [])
    setCounts(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null); setActivo(true)
    reset({ nombre: '', descripcion: '' })
    setDialogOpen(true)
  }

  const openEdit = (t: any) => {
    setEditing(t); setActivo(!!t.activo)
    reset({ nombre: t.nombre, descripcion: t.descripcion ?? '' })
    setDialogOpen(true)
  }

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    try {
      const payload = { nombre: data.nombre.trim(), descripcion: data.descripcion || null, activo }
      if (editing) {
        const { error } = await ((supabase as any).from('tipos_cliente'))
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editing.id)
        if (error) throw error
        toast.success('Tipo actualizado')
      } else {
        const { error } = await ((supabase as any).from('tipos_cliente')).insert(payload)
        if (error) throw error
        toast.success('Tipo creado', { description: `"${data.nombre}" disponible para asignar a clientes.` })
      }
      setDialogOpen(false); load()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? '' })
    } finally { setSaving(false) }
  }

  const toggleActivo = async (t: any) => {
    const { error } = await ((supabase as any).from('tipos_cliente'))
      .update({ activo: !t.activo, updated_at: new Date().toISOString() })
      .eq('id', t.id)
    if (error) toast.error('Error', { description: error.message })
    else { toast.success(t.activo ? 'Desactivado' : 'Activado'); load() }
  }

  const eliminar = async (t: any) => {
    if ((counts[t.id] ?? 0) > 0) {
      toast.error('No se puede eliminar', { description: `${counts[t.id]} cliente(s) usan este tipo. Reasígnalos primero.` })
      return
    }
    const { error } = await ((supabase as any).from('tipos_cliente')).delete().eq('id', t.id)
    if (error) toast.error('Error', { description: error.message })
    else { toast.success('Tipo eliminado'); setDeleteDialog(null); load() }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Tag className="w-6 h-6" /> Tipos de Cliente
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Categorías configurables de clientes ({tipos.length})</p>
        </div>
        <Button onClick={openCreate} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
          <Plus className="w-4 h-4" /> Nuevo Tipo
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-green-600 animate-spin" /></div>
          ) : tipos.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-gray-400">
              <Tag className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No hay tipos registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Nombre', 'Descripción', 'Clientes', 'Estado', 'Acciones'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tipos.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50/50">
                      <td className="py-3 px-4 font-medium text-gray-900">{t.nombre}</td>
                      <td className="py-3 px-4 text-gray-600 text-xs max-w-[400px]">{t.descripcion ?? '—'}</td>
                      <td className="py-3 px-4 text-xs">
                        <Badge className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200">
                          {counts[t.id] ?? 0}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        {t.activo
                          ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                          : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(t)} className="h-7 w-7 p-0" title="Editar">
                            <Edit className="w-3.5 h-3.5 text-gray-500" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleActivo(t)} className="h-7 w-7 p-0" title={t.activo ? 'Desactivar' : 'Activar'}>
                            {t.activo
                              ? <ToggleRight className="w-4 h-4 text-green-600" />
                              : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteDialog(t)} className="h-7 w-7 p-0" title="Eliminar">
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog crear/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Tipo de Cliente' : 'Nuevo Tipo de Cliente'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>Nombre *</Label>
              <Input {...register('nombre')} placeholder="Ej: Restaurante, Hotel..." className="mt-1" />
              {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea {...register('descripcion')} placeholder="Descripción opcional" className="mt-1" rows={3} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={activo} onCheckedChange={setActivo} />
              <Label>Activo</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? 'Guardar' : 'Crear'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar eliminar */}
      <Dialog open={!!deleteDialog} onOpenChange={(o) => !o && setDeleteDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar tipo</DialogTitle>
          </DialogHeader>
          {deleteDialog && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                ¿Eliminar <strong>{deleteDialog.nombre}</strong>?
              </p>
              {(counts[deleteDialog.id] ?? 0) > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  ⚠ Hay {counts[deleteDialog.id]} cliente(s) usando este tipo. Deben reasignarse antes.
                </div>
              ) : (
                <p className="text-xs text-gray-500">Esta acción no se puede deshacer.</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
                <Button
                  onClick={() => eliminar(deleteDialog)}
                  disabled={(counts[deleteDialog.id] ?? 0) > 0}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Eliminar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
