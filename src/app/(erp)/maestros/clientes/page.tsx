'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  Search,
  Filter,
  Edit,
  ToggleLeft,
  ToggleRight,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const clienteSchema = z.object({
  codigo: z.string().min(1, 'Requerido'),
  razon_social: z.string().min(2, 'Mínimo 2 caracteres'),
  ruc: z.string().nullable().optional(),
  dni: z.string().nullable().optional(),
  tipo_cliente: z.enum(['consumidor_final', 'tienda']),
  lista_precio_id: z.string().nullable().optional(),
  zona_id: z.string().nullable().optional(),
  vendedor_id: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().email('Email inválido').nullable().optional().or(z.literal('')),
  credito_dias: z.coerce.number().min(0).default(0),
  credito_limite: z.coerce.number().min(0).default(0),
  estado: z.enum(['activo', 'inactivo', 'deudor', 'de_baja']).default('activo'),
  notas: z.string().nullable().optional(),
})

type ClienteFormData = z.infer<typeof clienteSchema>

const ESTADO_CONFIG = {
  activo: { label: 'Activo', className: 'bg-green-100 text-green-700 border-green-200' },
  inactivo: { label: 'Inactivo', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  deudor: { label: 'Deudor', className: 'bg-red-100 text-red-700 border-red-200' },
  de_baja: { label: 'De baja', className: 'bg-slate-100 text-slate-500 border-slate-200' },
}

const PAGE_SIZE = 15

export default function ClientesPage() {
  const supabase = createClient()

  const [clientes, setClientes] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEstado, setFilterEstado] = useState('todos')
  const [filterZona, setFilterZona] = useState('todas')
  const [zonas, setZonas] = useState<any[]>([])
  const [listas, setListas] = useState<any[]>([])
  const [vendedores, setVendedores] = useState<any[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCliente, setEditingCliente] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ClienteFormData>({ resolver: zodResolver(clienteSchema) as any })

  const loadMeta = useCallback(async () => {
    const [{ data: z }, { data: l }, { data: v }] = await Promise.all([
      supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('listas_precio').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('profiles').select('id, full_name').eq('activo', true).in('role', ['vendedor', 'gerente', 'administrador']).order('full_name'),
    ])
    setZonas(z ?? [])
    setListas(l ?? [])
    setVendedores(v ?? [])
  }, [])

  const loadClientes = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('clientes')
      .select(`
        id, codigo, razon_social, ruc, dni, tipo_cliente, estado, credito_limite, credito_dias,
        zonas(nombre),
        listas_precio(nombre),
        profiles!clientes_vendedor_id_fkey(full_name)
      `, { count: 'exact' })
      .order('razon_social')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) query = query.ilike('razon_social', `%${search}%`)
    if (filterEstado !== 'todos') query = query.eq('estado', filterEstado as any)
    if (filterZona !== 'todas') query = query.eq('zona_id', filterZona)

    const { data, count } = await query
    setClientes(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, filterEstado, filterZona])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadClientes() }, [loadClientes])

  const openCreate = () => {
    setEditingCliente(null)
    reset({
      tipo_cliente: 'tienda',
      estado: 'activo',
      credito_dias: 0,
      credito_limite: 0,
    })
    setDialogOpen(true)
  }

  const openEdit = (cliente: any) => {
    setEditingCliente(cliente)
    reset({
      codigo: cliente.codigo,
      razon_social: cliente.razon_social,
      ruc: cliente.ruc ?? '',
      dni: cliente.dni ?? '',
      tipo_cliente: cliente.tipo_cliente,
      lista_precio_id: cliente.lista_precio_id ?? '',
      zona_id: cliente.zona_id ?? '',
      vendedor_id: cliente.vendedor_id ?? '',
      direccion: cliente.direccion ?? '',
      telefono: cliente.telefono ?? '',
      email: cliente.email ?? '',
      credito_dias: cliente.credito_dias,
      credito_limite: cliente.credito_limite,
      estado: cliente.estado as 'activo' | 'inactivo' | 'deudor' | 'de_baja',
      notas: cliente.notas ?? '',
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: ClienteFormData) => {
    setSaving(true)
    const payload = {
      ...data,
      ruc: data.ruc || null,
      dni: data.dni || null,
      lista_precio_id: data.lista_precio_id || null,
      zona_id: data.zona_id || null,
      vendedor_id: data.vendedor_id || null,
      email: data.email || null,
      updated_at: new Date().toISOString(),
    }

    if (editingCliente) {
      await supabase.from('clientes').update(payload).eq('id', editingCliente.id)
    } else {
      await supabase.from('clientes').insert({ ...payload, created_at: new Date().toISOString() })
    }

    setSaving(false)
    setDialogOpen(false)
    loadClientes()
  }

  const toggleEstado = async (cliente: any) => {
    const nuevoEstado = cliente.estado === 'activo' ? 'inactivo' : 'activo'
    await supabase.from('clientes').update({ estado: nuevoEstado, updated_at: new Date().toISOString() }).eq('id', cliente.id)
    loadClientes()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} clientes registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2">
          <Plus className="w-4 h-4" /> Nuevo Cliente
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar por razón social..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              />
            </div>
            <Select value={filterEstado} onValueChange={(v) => { setFilterEstado(v); setPage(0) }}>
              <SelectTrigger className="w-36">
                <Filter className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="inactivo">Inactivo</SelectItem>
                <SelectItem value="deudor">Deudor</SelectItem>
                <SelectItem value="de_baja">De baja</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterZona} onValueChange={(v) => { setFilterZona(v); setPage(0) }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Zona" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las zonas</SelectItem>
                {zonas.map((z) => (
                  <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : clientes.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No se encontraron clientes</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Código', 'Razón Social', 'RUC/DNI', 'Tipo', 'Lista', 'Zona', 'Vendedor', 'Estado', 'Acciones'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {clientes.map((c) => {
                    const estadoCfg = ESTADO_CONFIG[c.estado as keyof typeof ESTADO_CONFIG] ?? ESTADO_CONFIG.inactivo
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-gray-500">{c.codigo}</td>
                        <td className="py-3 px-4 font-medium text-gray-900 max-w-[200px] truncate">{c.razon_social}</td>
                        <td className="py-3 px-4 text-gray-500 font-mono text-xs">{c.ruc ?? c.dni ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 capitalize text-xs">
                          {c.tipo_cliente === 'consumidor_final' ? 'Consumidor' : 'Tienda'}
                        </td>
                        <td className="py-3 px-4 text-gray-600">{c.listas_precio?.nombre ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs">{c.zonas?.nombre ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs max-w-[120px] truncate">
                          {c.profiles?.full_name ?? '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${estadoCfg.className}`}>
                            {estadoCfg.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(c)}
                              className="h-7 w-7 p-0"
                            >
                              <Edit className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleEstado(c)}
                              className="h-7 w-7 p-0"
                            >
                              {c.estado === 'activo'
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

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-sm text-gray-600 px-2">{page + 1} / {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Crear/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCliente ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Código *</Label>
                <Input {...register('codigo')} placeholder="CLI001" className="mt-1" />
                {errors.codigo && <p className="text-xs text-red-500 mt-1">{errors.codigo.message}</p>}
              </div>
              <div>
                <Label>Razón Social *</Label>
                <Input {...register('razon_social')} placeholder="Nombre o razón social" className="mt-1" />
                {errors.razon_social && <p className="text-xs text-red-500 mt-1">{errors.razon_social.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>RUC</Label>
                <Input {...register('ruc')} placeholder="20xxxxxxxxx" className="mt-1" />
              </div>
              <div>
                <Label>DNI</Label>
                <Input {...register('dni')} placeholder="Opcional" className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo de Cliente *</Label>
                <Select defaultValue="tienda" onValueChange={(v) => setValue('tipo_cliente', v as 'consumidor_final' | 'tienda')}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tienda">Tienda</SelectItem>
                    <SelectItem value="consumidor_final">Consumidor Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Lista de Precio</Label>
                <Select onValueChange={(v) => setValue('lista_precio_id', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {listas.map((l) => (
                      <SelectItem key={l.id} value={l.id}>Lista {l.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Zona</Label>
                <Select onValueChange={(v) => setValue('zona_id', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar zona..." />
                  </SelectTrigger>
                  <SelectContent>
                    {zonas.map((z) => (
                      <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vendedor Asignado</Label>
                <Select onValueChange={(v) => setValue('vendedor_id', v)}>
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
            </div>

            <div>
              <Label>Dirección</Label>
              <Input {...register('direccion')} placeholder="Dirección completa" className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Teléfono</Label>
                <Input {...register('telefono')} placeholder="999 999 999" className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input {...register('email')} type="email" placeholder="correo@ejemplo.com" className="mt-1" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Crédito Días</Label>
                <Input {...register('credito_dias')} type="number" min={0} className="mt-1" />
              </div>
              <div>
                <Label>Límite Crédito (S/)</Label>
                <Input {...register('credito_limite')} type="number" min={0} step="0.01" className="mt-1" />
              </div>
              <div>
                <Label>Estado</Label>
                <Select defaultValue="activo" onValueChange={(v) => setValue('estado', v as 'activo' | 'inactivo' | 'deudor' | 'de_baja')}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activo">Activo</SelectItem>
                    <SelectItem value="inactivo">Inactivo</SelectItem>
                    <SelectItem value="deudor">Deudor</SelectItem>
                    <SelectItem value="de_baja">De baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Notas</Label>
              <Input {...register('notas')} placeholder="Observaciones adicionales" className="mt-1" />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingCliente ? 'Guardar Cambios' : 'Crear Cliente'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
