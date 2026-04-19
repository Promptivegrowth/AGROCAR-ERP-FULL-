'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Filter, Edit, Eye, ToggleLeft, ToggleRight, Loader2,
  ChevronLeft, ChevronRight, User, MapPin, Phone, Mail, DollarSign,
  Tag, Hash, Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const clienteSchema = z.object({
  codigo: z.string().min(1, 'Requerido'),
  razon_social: z.string().min(2, 'Mínimo 2 caracteres'),
  ruc: z.string().nullable().optional(),
  dni: z.string().nullable().optional(),
  tipo_cliente: z.enum(['consumidor_final', 'tienda']),
  direccion: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().email('Email inválido').nullable().optional().or(z.literal('')),
  contacto: z.string().nullable().optional(),
  credito_dias: z.coerce.number().min(0).default(0),
  credito_limite: z.coerce.number().min(0).default(0),
  latitud: z.coerce.number().nullable().optional(),
  longitud: z.coerce.number().nullable().optional(),
  notas: z.string().nullable().optional(),
})

type ClienteFormData = z.infer<typeof clienteSchema>
type EstadoCliente = 'activo' | 'suspendido' | 'bloqueado'
type TipoCliente = 'consumidor_final' | 'tienda'

const ESTADO_CONFIG: Record<EstadoCliente, { label: string; className: string }> = {
  activo: { label: 'Activo', className: 'bg-green-100 text-green-700 border-green-200' },
  suspendido: { label: 'Suspendido', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  bloqueado: { label: 'Bloqueado', className: 'bg-red-100 text-red-700 border-red-200' },
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
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [editingCliente, setEditingCliente] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  // Estados controlados para selects
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>('tienda')
  const [listaPrecioId, setListaPrecioId] = useState<string>('')
  const [zonaId, setZonaId] = useState<string>('')
  const [vendedorId, setVendedorId] = useState<string>('')
  const [estado, setEstado] = useState<EstadoCliente>('activo')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClienteFormData>({ resolver: zodResolver(clienteSchema) as any })

  const loadMeta = useCallback(async () => {
    const [{ data: z }, { data: l }, { data: v }] = await Promise.all([
      supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('listas_precio').select('id, nombre').order('nombre'),
      supabase.from('profiles').select('id, full_name').eq('role', 'vendedor').order('full_name'),
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
        id, codigo, razon_social, ruc, dni, tipo_cliente, estado,
        credito_limite, credito_dias, direccion, telefono, email, contacto,
        lista_precio_id, zona_id, vendedor_id, latitud, longitud, notas, created_at,
        zonas(id, nombre),
        listas_precio(id, nombre),
        profiles!clientes_vendedor_id_fkey(id, full_name)
      `, { count: 'exact' })
      .order('razon_social')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) query = query.ilike('razon_social', `%${search}%`)
    if (filterEstado !== 'todos') query = query.eq('estado', filterEstado as any)
    if (filterZona !== 'todas') query = query.eq('zona_id', filterZona)

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar clientes', { description: error.message })
    setClientes(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, filterEstado, filterZona])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadClientes() }, [loadClientes])

  const openCreate = () => {
    setEditingCliente(null)
    setTipoCliente('tienda')
    setListaPrecioId('')
    setZonaId('')
    setVendedorId('')
    setEstado('activo')
    reset({
      codigo: '',
      razon_social: '',
      ruc: '',
      dni: '',
      tipo_cliente: 'tienda',
      direccion: '',
      telefono: '',
      email: '',
      contacto: '',
      credito_dias: 0,
      credito_limite: 0,
      latitud: undefined,
      longitud: undefined,
      notas: '',
    })
    setDialogOpen(true)
  }

  const openEdit = (cliente: any) => {
    setEditingCliente(cliente)
    setTipoCliente((cliente.tipo_cliente as TipoCliente) ?? 'tienda')
    setListaPrecioId(cliente.lista_precio_id ?? '')
    setZonaId(cliente.zona_id ?? '')
    setVendedorId(cliente.vendedor_id ?? '')
    setEstado((cliente.estado as EstadoCliente) ?? 'activo')
    reset({
      codigo: cliente.codigo,
      razon_social: cliente.razon_social,
      ruc: cliente.ruc ?? '',
      dni: cliente.dni ?? '',
      tipo_cliente: cliente.tipo_cliente,
      direccion: cliente.direccion ?? '',
      telefono: cliente.telefono ?? '',
      email: cliente.email ?? '',
      contacto: cliente.contacto ?? '',
      credito_dias: cliente.credito_dias ?? 0,
      credito_limite: cliente.credito_limite ?? 0,
      latitud: cliente.latitud ?? undefined,
      longitud: cliente.longitud ?? undefined,
      notas: cliente.notas ?? '',
    })
    setDialogOpen(true)
  }

  const openDetail = (c: any) => { setSelected(c); setDetailOpen(true) }

  const onSubmit = async (data: ClienteFormData) => {
    setSaving(true)
    try {
      const payload = {
        codigo: data.codigo,
        razon_social: data.razon_social,
        ruc: data.ruc || null,
        dni: data.dni || null,
        tipo_cliente: tipoCliente,
        lista_precio_id: listaPrecioId || null,
        zona_id: zonaId || null,
        vendedor_id: vendedorId || null,
        direccion: data.direccion || null,
        telefono: data.telefono || null,
        email: data.email || null,
        contacto: data.contacto || null,
        credito_dias: data.credito_dias ?? 0,
        credito_limite: data.credito_limite ?? 0,
        estado,
        latitud: data.latitud ?? null,
        longitud: data.longitud ?? null,
        notas: data.notas || null,
        updated_at: new Date().toISOString(),
      }

      if (editingCliente) {
        const { error } = await (supabase.from('clientes') as any)
          .update(payload)
          .eq('id', editingCliente.id)
        if (error) throw error
        toast.success('Cliente actualizado', { description: `${data.razon_social} se guardó correctamente.` })
      } else {
        const { error } = await (supabase.from('clientes') as any).insert({
          ...payload,
          created_at: new Date().toISOString(),
        })
        if (error) throw error
        toast.success('Cliente creado', { description: `${data.razon_social} se registró correctamente.` })
      }

      setDialogOpen(false)
      loadClientes()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setSaving(false)
    }
  }

  const toggleEstado = async (cliente: any) => {
    const nuevoEstado: EstadoCliente = cliente.estado === 'activo' ? 'suspendido' : 'activo'
    const { error } = await supabase
      .from('clientes')
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq('id', cliente.id)
    if (error) {
      toast.error('No se pudo cambiar el estado', { description: error.message })
    } else {
      toast.success(nuevoEstado === 'activo' ? 'Cliente activado' : 'Cliente suspendido')
      loadClientes()
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} clientes registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Nuevo Cliente
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
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
              <SelectTrigger className="w-full sm:w-40">
                <Filter className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="suspendido">Suspendido</SelectItem>
                <SelectItem value="bloqueado">Bloqueado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterZona} onValueChange={(v) => { setFilterZona(v); setPage(0) }}>
              <SelectTrigger className="w-full sm:w-44">
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

      {/* Listado */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : clientes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <User className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No se encontraron clientes</p>
            </div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {clientes.map((c) => {
                  const estadoCfg = ESTADO_CONFIG[c.estado as EstadoCliente] ?? ESTADO_CONFIG.activo
                  return (
                    <div key={c.id} className="p-4 hover:bg-gray-50/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{c.razon_social}</p>
                          <p className="text-xs text-gray-500 font-mono">{c.codigo} · {c.ruc ?? c.dni ?? 'Sin doc.'}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <span>{c.tipo_cliente === 'consumidor_final' ? 'Consumidor' : 'Tienda'}</span>
                            {c.listas_precio?.nombre && <span>· Lista {c.listas_precio.nombre}</span>}
                          </div>
                          {c.telefono && <p className="text-xs text-gray-500 mt-1">{c.telefono}</p>}
                        </div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${estadoCfg.className}`}>
                          {estadoCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-3">
                        <Button variant="outline" size="sm" onClick={() => openDetail(c)} className="h-7 text-xs gap-1">
                          <Eye className="w-3.5 h-3.5" /> Ver
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(c)} className="h-7 text-xs gap-1">
                          <Edit className="w-3.5 h-3.5" /> Editar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleEstado(c)} className="h-7 text-xs gap-1">
                          {c.estado === 'activo'
                            ? <ToggleRight className="w-3.5 h-3.5 text-green-600" />
                            : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Vista desktop: tabla */}
              <div className="hidden md:block overflow-x-auto">
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
                      const estadoCfg = ESTADO_CONFIG[c.estado as EstadoCliente] ?? ESTADO_CONFIG.activo
                      return (
                        <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-gray-500">{c.codigo}</td>
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-[200px] truncate">{c.razon_social}</td>
                          <td className="py-3 px-4 text-gray-500 font-mono text-xs">{c.ruc ?? c.dni ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">
                            {c.tipo_cliente === 'consumidor_final' ? 'Consumidor' : 'Tienda'}
                          </td>
                          <td className="py-3 px-4 text-gray-600">{c.listas_precio?.nombre ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{c.zonas?.nombre ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs max-w-[140px] truncate">
                            {c.profiles?.full_name ?? '—'}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${estadoCfg.className}`}>
                              {estadoCfg.label}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openDetail(c)} className="h-7 w-7 p-0" title="Ver detalle">
                                <Eye className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(c)} className="h-7 w-7 p-0" title="Editar">
                                <Edit className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => toggleEstado(c)} className="h-7 w-7 p-0" title={c.estado === 'activo' ? 'Suspender' : 'Activar'}>
                                {c.estado === 'activo'
                                  ? <ToggleRight className="w-4 h-4 text-green-600" />
                                  : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </p>
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

      {/* Dialog Crear/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCliente ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Código *</Label>
                <Input {...register('codigo')} placeholder="CLI001" className="mt-1 font-mono" />
                {errors.codigo && <p className="text-xs text-red-500 mt-1">{errors.codigo.message}</p>}
              </div>
              <div>
                <Label>Razón Social *</Label>
                <Input {...register('razon_social')} placeholder="Nombre o razón social" className="mt-1" />
                {errors.razon_social && <p className="text-xs text-red-500 mt-1">{errors.razon_social.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>RUC</Label>
                <Input {...register('ruc')} placeholder="20xxxxxxxxx" className="mt-1 font-mono" />
              </div>
              <div>
                <Label>DNI</Label>
                <Input {...register('dni')} placeholder="Opcional" className="mt-1 font-mono" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Tipo de Cliente *</Label>
                <Select value={tipoCliente} onValueChange={(v) => setTipoCliente(v as TipoCliente)}>
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
                <Select value={listaPrecioId} onValueChange={setListaPrecioId}>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Zona</Label>
                <Select value={zonaId} onValueChange={setZonaId}>
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
                <Select value={vendedorId} onValueChange={setVendedorId}>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div>
              <Label>Contacto Principal</Label>
              <Input {...register('contacto')} placeholder="Nombre del contacto" className="mt-1" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <Select value={estado} onValueChange={(v) => setEstado(v as EstadoCliente)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activo">Activo</SelectItem>
                    <SelectItem value="suspendido">Suspendido</SelectItem>
                    <SelectItem value="bloqueado">Bloqueado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Latitud</Label>
                <Input {...register('latitud')} type="number" step="any" placeholder="-18.0117" className="mt-1" />
              </div>
              <div>
                <Label>Longitud</Label>
                <Input {...register('longitud')} type="number" step="any" placeholder="-70.2536" className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Notas</Label>
              <Textarea {...register('notas')} placeholder="Observaciones adicionales" className="mt-1" rows={2} />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
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

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Cliente</DialogTitle>
          </DialogHeader>
          {selected && (() => {
            const estadoCfg = ESTADO_CONFIG[selected.estado as EstadoCliente] ?? ESTADO_CONFIG.activo
            const mapsUrl = selected.latitud && selected.longitud
              ? `https://www.google.com/maps?q=${selected.latitud},${selected.longitud}`
              : null
            return (
              <div className="space-y-4 mt-2">
                <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                  <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
                    <Building2 className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 truncate">{selected.razon_social}</p>
                    <p className="text-xs text-gray-500 font-mono">
                      {selected.codigo} · {selected.ruc ?? selected.dni ?? 'Sin documento'}
                    </p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${estadoCfg.className}`}>
                    {estadoCfg.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2">
                    <Tag className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Tipo</p>
                      <p className="text-gray-800">
                        {selected.tipo_cliente === 'consumidor_final' ? 'Consumidor Final' : 'Tienda'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Hash className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Lista de Precio</p>
                      <p className="text-gray-800">{selected.listas_precio?.nombre ? `Lista ${selected.listas_precio.nombre}` : '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Zona</p>
                      <p className="text-gray-800">{selected.zonas?.nombre ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <User className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Vendedor</p>
                      <p className="text-gray-800">{selected.profiles?.full_name ?? '—'}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-sm border-t border-gray-100 pt-3">
                  {selected.direccion && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-500">Dirección</p>
                        <p className="text-gray-800 break-words">{selected.direccion}</p>
                        {mapsUrl && (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-xs text-green-700 font-medium hover:underline"
                          >
                            <MapPin className="w-3 h-3" /> Ver en Google Maps
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {!selected.direccion && mapsUrl && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500">Ubicación</p>
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-700 font-medium hover:underline"
                        >
                          Ver en Google Maps
                        </a>
                      </div>
                    </div>
                  )}
                  {selected.telefono && (
                    <div className="flex items-start gap-3">
                      <Phone className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500">Teléfono</p>
                        <a href={`tel:${selected.telefono}`} className="text-green-700 font-medium">{selected.telefono}</a>
                      </div>
                    </div>
                  )}
                  {selected.email && (
                    <div className="flex items-start gap-3">
                      <Mail className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">Email</p>
                        <a href={`mailto:${selected.email}`} className="text-green-700 font-medium break-all">{selected.email}</a>
                      </div>
                    </div>
                  )}
                  {selected.contacto && (
                    <div className="flex items-start gap-3">
                      <User className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500">Contacto</p>
                        <p className="text-gray-800">{selected.contacto}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-gray-400" />
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Crédito</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Días</p>
                      <p className="text-sm font-semibold text-gray-900">{selected.credito_dias ?? 0}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Límite</p>
                      <p className="text-sm font-semibold text-gray-900">{formatCurrency(selected.credito_limite ?? 0)}</p>
                    </div>
                  </div>
                </div>

                {selected.notas && (
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Notas</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{selected.notas}</p>
                  </div>
                )}

                {selected.created_at && (
                  <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
                    Registrado el {formatDate(selected.created_at)}
                  </p>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-gray-100">
                  <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                  <Button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="bg-green-600 hover:bg-green-700 gap-2">
                    <Edit className="w-4 h-4" /> Editar
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
