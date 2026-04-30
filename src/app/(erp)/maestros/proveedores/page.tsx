'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Edit, ToggleLeft, ToggleRight, Loader2,
  ChevronLeft, ChevronRight, Building2, Eye, Phone, Mail, MapPin, User as UserIcon,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { useSunatReniec } from '@/lib/hooks/use-sunat-reniec'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import UbigeoSelector, { UBIGEO_EMPTY, type UbigeoValue } from '@/components/ubigeo-selector'
import { matchUbigeoFromNombres } from '@/lib/ubigeo/match'

const proveedorSchema = z.object({
  razon_social: z.string().min(2, 'Mínimo 2 caracteres'),
  ruc: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().email('Email inválido').nullable().optional().or(z.literal('')),
  contacto: z.string().nullable().optional(),
  banco: z.string().nullable().optional(),
  cuenta_bancaria: z.string().nullable().optional(),
  cci: z.string().nullable().optional(),
  condiciones_pago: z.string().nullable().optional(),
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
  const debouncedSearch = useDebounce(search, 300)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [editingProveedor, setEditingProveedor] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [activo, setActivo] = useState(true)
  const [ubigeoVal, setUbigeoVal] = useState<UbigeoValue>(UBIGEO_EMPTY)

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<ProveedorFormData>({
    resolver: zodResolver(proveedorSchema) as any,
  })

  const [rucInput, setRucInput] = useState('')
  const { consultarRuc, loading: sunatLoading } = useSunatReniec()

  const autocompletarRuc = async () => {
    const data = await consultarRuc(rucInput.trim())
    if (!data) return
    setValue('razon_social', data.razonSocial, { shouldValidate: true })
    if (data.direccion) setValue('direccion', data.direccion, { shouldValidate: true })
    if (data.departamento || data.provincia || data.distrito) {
      const matched = await matchUbigeoFromNombres({
        departamento: data.departamento,
        provincia: data.provincia,
        distrito: data.distrito,
      })
      if (matched) setUbigeoVal(matched)
    }
  }

  const loadProveedores = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('proveedores')
      .select('id, razon_social, ruc, direccion, telefono, email, contacto, activo, created_at, ubigeo, departamento, provincia, distrito, banco, cuenta_bancaria, cci, condiciones_pago, cliente_id', { count: 'exact' })
      .order('razon_social')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (debouncedSearch) query = query.ilike('razon_social', `%${debouncedSearch}%`)

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar proveedores', { description: error.message })
    setProveedores(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, debouncedSearch])

  useEffect(() => { loadProveedores() }, [loadProveedores])

  const openCreate = () => {
    setEditingProveedor(null)
    setActivo(true)
    setRucInput('')
    setUbigeoVal(UBIGEO_EMPTY)
    reset({ activo: true, razon_social: '', ruc: '', direccion: '', telefono: '', email: '', contacto: '', banco: '', cuenta_bancaria: '', cci: '', condiciones_pago: '' })
    setDialogOpen(true)
  }

  const openEdit = (p: any) => {
    setEditingProveedor(p)
    setActivo(p.activo)
    setRucInput(p.ruc ?? '')
    setUbigeoVal({
      departamento_codigo: p.ubigeo ? p.ubigeo.slice(0, 2) : null,
      departamento: p.departamento ?? null,
      provincia_codigo: p.ubigeo ? p.ubigeo.slice(2, 4) : null,
      provincia: p.provincia ?? null,
      distrito_codigo: p.ubigeo ? p.ubigeo.slice(4, 6) : null,
      distrito: p.distrito ?? null,
      ubigeo: p.ubigeo ?? null,
    })
    reset({
      razon_social: p.razon_social,
      ruc: p.ruc ?? '',
      direccion: p.direccion ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      contacto: p.contacto ?? '',
      banco: p.banco ?? '',
      cuenta_bancaria: p.cuenta_bancaria ?? '',
      cci: p.cci ?? '',
      condiciones_pago: p.condiciones_pago ?? '',
      activo: p.activo,
    })
    setDialogOpen(true)
  }

  const openDetail = (p: any) => { setSelected(p); setDetailOpen(true) }

  const onSubmit = async (data: ProveedorFormData) => {
    setSaving(true)
    try {
      const payload = {
        razon_social: data.razon_social,
        ruc: data.ruc || null,
        direccion: data.direccion || null,
        telefono: data.telefono || null,
        email: data.email || null,
        contacto: data.contacto || null,
        banco: data.banco || null,
        cuenta_bancaria: data.cuenta_bancaria || null,
        cci: data.cci || null,
        condiciones_pago: data.condiciones_pago || null,
        activo,
        ubigeo: ubigeoVal.ubigeo,
        departamento: ubigeoVal.departamento,
        provincia: ubigeoVal.provincia,
        distrito: ubigeoVal.distrito,
      }

      if (editingProveedor) {
        const { error } = await (supabase.from('proveedores') as any)
          .update(payload)
          .eq('id', editingProveedor.id)
        if (error) throw error

        // Sincronización bidireccional: si tiene cliente_id, actualizar el cliente con campos comunes
        if (editingProveedor.cliente_id) {
          await (supabase as any).from('clientes').update({
            razon_social: data.razon_social,
            ruc: data.ruc || null,
            direccion: data.direccion || null,
            telefono: data.telefono || null,
            email: data.email || null,
            contacto: data.contacto || null,
            ubigeo: ubigeoVal.ubigeo,
            departamento: ubigeoVal.departamento,
            provincia: ubigeoVal.provincia,
            distrito: ubigeoVal.distrito,
            updated_at: new Date().toISOString(),
          }).eq('id', editingProveedor.cliente_id)
        }

        toast.success('Proveedor actualizado', {
          description: editingProveedor.cliente_id
            ? `${data.razon_social} guardado (sincronizado con su ficha de cliente).`
            : `${data.razon_social} se guardó correctamente.`,
        })
      } else {
        const { error } = await (supabase.from('proveedores') as any).insert(payload)
        if (error) throw error
        toast.success('Proveedor creado', { description: `${data.razon_social} se registró correctamente.` })
      }

      setDialogOpen(false)
      loadProveedores()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActivo = async (p: any) => {
    const { error } = await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id)
    if (error) {
      toast.error('No se pudo cambiar el estado', { description: error.message })
    } else {
      toast.success(p.activo ? 'Proveedor desactivado' : 'Proveedor activado')
      loadProveedores()
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proveedores</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} proveedores registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 w-full sm:w-auto">
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
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {proveedores.map((p) => (
                  <div key={p.id} className="p-4 hover:bg-gray-50/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{p.razon_social}</p>
                        <p className="text-xs text-gray-500 font-mono">{p.ruc ?? 'Sin RUC'}</p>
                        {p.cliente_id && (
                          <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            👥 También Cliente
                          </span>
                        )}
                        {p.telefono && <p className="text-xs text-gray-500 mt-1">{p.telefono}</p>}
                      </div>
                      {p.activo
                        ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200 shrink-0">Activo</Badge>
                        : <Badge variant="secondary" className="text-xs shrink-0">Inactivo</Badge>}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      <Button variant="outline" size="sm" onClick={() => openDetail(p)} className="h-7 text-xs gap-1">
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(p)} className="h-7 text-xs gap-1">
                        <Edit className="w-3.5 h-3.5" /> Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActivo(p)} className="h-7 text-xs gap-1">
                        {p.activo ? <ToggleRight className="w-3.5 h-3.5 text-green-600" /> : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Vista desktop: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Razón Social', 'RUC', 'Teléfono', 'Email', 'Contacto', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {proveedores.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 max-w-[260px]">
                          <div className="font-medium text-gray-900 truncate">{p.razon_social}</div>
                          {p.cliente_id && (
                            <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                              👥 También Cliente
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-500 font-mono text-xs">{p.ruc ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs">{p.telefono ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs truncate max-w-[200px]">{p.email ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs">{p.contacto ?? '—'}</td>
                        <td className="py-3 px-4">
                          {p.activo
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                            : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openDetail(p)} className="h-7 w-7 p-0" title="Ver detalle">
                              <Eye className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(p)} className="h-7 w-7 p-0" title="Editar">
                              <Edit className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleActivo(p)} className="h-7 w-7 p-0" title={p.activo ? 'Desactivar' : 'Activar'}>
                              {p.activo ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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

      {/* Dialog Crear/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProveedor ? 'Editar Proveedor' : 'Nuevo Proveedor'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>Razón Social *</Label>
              <Input {...register('razon_social')} placeholder="Nombre o razón social" className="mt-1" />
              {errors.razon_social && <p className="text-xs text-red-500 mt-1">{errors.razon_social.message}</p>}
            </div>

            <div>
              <Label>RUC</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={rucInput}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 11)
                    setRucInput(v)
                    setValue('ruc', v)
                  }}
                  placeholder="20xxxxxxxxx"
                  maxLength={11}
                  inputMode="numeric"
                  className="font-mono flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={autocompletarRuc}
                  disabled={sunatLoading || rucInput.length !== 11}
                  className="shrink-0 gap-1 border-[#FBE600] hover:bg-[#FBE600] hover:text-black"
                  title="Consultar SUNAT"
                >
                  {sunatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  SUNAT
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">Ubicación administrativa</Label>
              <div className="mt-1">
                <UbigeoSelector value={ubigeoVal} onChange={setUbigeoVal} layout="columns" showLabels />
              </div>
            </div>

            <div>
              <Label>Dirección</Label>
              <Input {...register('direccion')} placeholder="Dirección del proveedor" className="mt-1" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {/* Datos bancarios */}
            <div className="border-t border-gray-100 pt-3">
              <Label className="text-sm font-semibold text-gray-800">Datos bancarios (opcional)</Label>
              <p className="text-[11px] text-gray-400 mb-2">Para registrar pagos a este proveedor.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Banco</Label>
                  <Input {...register('banco')} placeholder="BCP, Interbank..." className="mt-1 h-9" />
                </div>
                <div>
                  <Label className="text-xs">Cuenta bancaria</Label>
                  <Input {...register('cuenta_bancaria')} placeholder="Nº cuenta corriente" className="mt-1 h-9 font-mono" />
                </div>
                <div>
                  <Label className="text-xs">CCI</Label>
                  <Input {...register('cci')} placeholder="20 dígitos" maxLength={20} className="mt-1 h-9 font-mono" />
                </div>
                <div>
                  <Label className="text-xs">Condiciones de pago</Label>
                  <Input {...register('condiciones_pago')} placeholder="Contado, 30 días..." className="mt-1 h-9" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={activo} onCheckedChange={setActivo} />
              <Label>Activo</Label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingProveedor ? 'Guardar Cambios' : 'Crear Proveedor'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalle del Proveedor</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-green-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{selected.razon_social}</p>
                  <p className="text-xs text-gray-500 font-mono">{selected.ruc ?? 'Sin RUC'}</p>
                </div>
                {selected.activo
                  ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                  : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
              </div>

              <div className="space-y-3 text-sm">
                {(selected.distrito || selected.provincia || selected.departamento) && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Ubicación</p>
                      <p className="text-gray-800">
                        {[selected.distrito, selected.provincia, selected.departamento].filter(Boolean).join(' - ')}
                      </p>
                      {selected.ubigeo && (
                        <p className="text-xs text-gray-400 mt-0.5">Ubigeo {selected.ubigeo}</p>
                      )}
                    </div>
                  </div>
                )}
                {selected.direccion && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Dirección</p>
                      <p className="text-gray-800">{selected.direccion}</p>
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
                    <div>
                      <p className="text-xs text-gray-500">Email</p>
                      <a href={`mailto:${selected.email}`} className="text-green-700 font-medium break-all">{selected.email}</a>
                    </div>
                  </div>
                )}
                {selected.contacto && (
                  <div className="flex items-start gap-3">
                    <UserIcon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Contacto</p>
                      <p className="text-gray-800">{selected.contacto}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                <Button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                  <Edit className="w-4 h-4" /> Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
