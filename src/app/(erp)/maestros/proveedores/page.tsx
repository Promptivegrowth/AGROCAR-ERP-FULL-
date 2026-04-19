'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search, Edit, ToggleLeft, ToggleRight, Loader2, ChevronLeft, ChevronRight, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const proveedorSchema = z.object({
  codigo: z.string().min(1, 'Requerido'),
  razon_social: z.string().min(2, 'Mínimo 2 caracteres'),
  ruc: z.string().nullable().optional(),
  tipo: z.enum(['fabricante', 'distribuidor', 'importador', 'otro']).default('distribuidor'),
  direccion: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().email('Email inválido').nullable().optional().or(z.literal('')),
  contacto: z.string().nullable().optional(),
  credito_dias: z.coerce.number().min(0).default(0),
  activo: z.boolean().default(true),
})

type ProveedorFormData = z.infer<typeof proveedorSchema>

const PAGE_SIZE = 15

export default function ProveedoresPage() {
  const supabase = createClient()

  const [proveedores, setProveedores] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProveedor, setEditingProveedor] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<ProveedorFormData>({
    resolver: zodResolver(proveedorSchema) as any,
  })

  const loadProveedores = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('proveedores')
      .select('id, codigo, razon_social, ruc, tipo, telefono, email, activo, credito_dias', { count: 'exact' })
      .order('razon_social')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) query = query.ilike('razon_social', `%${search}%`)

    const { data, count } = await query
    setProveedores(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search])

  useEffect(() => { loadProveedores() }, [loadProveedores])

  const openCreate = () => {
    setEditingProveedor(null)
    reset({ tipo: 'distribuidor', credito_dias: 0, activo: true })
    setDialogOpen(true)
  }

  const openEdit = (proveedor: any) => {
    setEditingProveedor(proveedor)
    reset({
      codigo: proveedor.codigo,
      razon_social: proveedor.razon_social,
      ruc: proveedor.ruc ?? '',
      tipo: proveedor.tipo ?? 'distribuidor',
      direccion: proveedor.direccion ?? '',
      telefono: proveedor.telefono ?? '',
      email: proveedor.email ?? '',
      contacto: proveedor.contacto ?? '',
      credito_dias: proveedor.credito_dias ?? 0,
      activo: proveedor.activo,
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: ProveedorFormData) => {
    setSaving(true)
    const payload = {
      ...data,
      ruc: data.ruc || null,
      direccion: data.direccion || null,
      email: data.email || null,
      contacto: data.contacto || null,
    }

    if (editingProveedor) {
      await (supabase.from('proveedores') as any).update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingProveedor.id)
    } else {
      await (supabase.from('proveedores') as any).insert({ ...payload, created_at: new Date().toISOString() })
    }

    setSaving(false)
    setDialogOpen(false)
    loadProveedores()
  }

  const toggleActivo = async (proveedor: any) => {
    await supabase.from('proveedores').update({ activo: !proveedor.activo }).eq('id', proveedor.id)
    loadProveedores()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proveedores</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} proveedores registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2">
          <Plus className="w-4 h-4" /> Nuevo Proveedor
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar proveedor..."
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : proveedores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Building2 className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No se encontraron proveedores</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Código', 'Razón Social', 'RUC', 'Tipo', 'Teléfono', 'Crédito', 'Estado', 'Acciones'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {proveedores.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-gray-500">{p.codigo}</td>
                      <td className="py-3 px-4 font-medium text-gray-900 max-w-[220px] truncate">{p.razon_social}</td>
                      <td className="py-3 px-4 text-gray-500 font-mono text-xs">{p.ruc ?? '—'}</td>
                      <td className="py-3 px-4 text-gray-600 capitalize text-xs">{p.tipo ?? '—'}</td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{p.telefono ?? '—'}</td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{p.credito_dias} días</td>
                      <td className="py-3 px-4">
                        {p.activo
                          ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                          : <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                        }
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(p)} className="h-7 w-7 p-0">
                            <Edit className="w-3.5 h-3.5 text-gray-500" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleActivo(p)} className="h-7 w-7 p-0">
                            {p.activo
                              ? <ToggleRight className="w-4 h-4 text-green-600" />
                              : <ToggleLeft className="w-4 h-4 text-gray-400" />
                            }
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">{total} proveedores</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="h-7 w-7 p-0">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-sm text-gray-600 px-2">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} className="h-7 w-7 p-0">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProveedor ? 'Editar Proveedor' : 'Nuevo Proveedor'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Código *</Label>
                <Input {...register('codigo')} placeholder="PROV001" className="mt-1" />
                {errors.codigo && <p className="text-xs text-red-500 mt-1">{errors.codigo.message}</p>}
              </div>
              <div>
                <Label>Tipo</Label>
                <Select defaultValue="distribuidor" onValueChange={(v) => setValue('tipo', v as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fabricante">Fabricante</SelectItem>
                    <SelectItem value="distribuidor">Distribuidor</SelectItem>
                    <SelectItem value="importador">Importador</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Razón Social *</Label>
              <Input {...register('razon_social')} placeholder="Nombre o razón social" className="mt-1" />
              {errors.razon_social && <p className="text-xs text-red-500 mt-1">{errors.razon_social.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>RUC</Label>
                <Input {...register('ruc')} placeholder="20xxxxxxxxx" className="mt-1 font-mono" />
              </div>
              <div>
                <Label>Crédito Días</Label>
                <Input {...register('credito_dias')} type="number" min={0} className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Dirección</Label>
              <Input {...register('direccion')} placeholder="Dirección del proveedor" className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Teléfono</Label>
                <Input {...register('telefono')} placeholder="999 999 999" className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input {...register('email')} type="email" placeholder="correo@proveedor.com" className="mt-1" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
            </div>

            <div>
              <Label>Contacto Principal</Label>
              <Input {...register('contacto')} placeholder="Nombre del contacto" className="mt-1" />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingProveedor ? 'Guardar Cambios' : 'Crear Proveedor'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
