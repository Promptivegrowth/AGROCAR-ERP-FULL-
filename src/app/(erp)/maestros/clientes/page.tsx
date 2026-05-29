'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Filter, Edit, Eye, ToggleLeft, ToggleRight, Loader2,
  ChevronLeft, ChevronRight, User, MapPin, Phone, Mail, DollarSign,
  Tag, Hash, Building2, Crosshair, X, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { useSunatReniec } from '@/lib/hooks/use-sunat-reniec'
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
import { Switch } from '@/components/ui/switch'
import LeafletMap from '@/components/maps/leaflet-map'
import UbigeoSelector, { UBIGEO_EMPTY, type UbigeoValue } from '@/components/ubigeo-selector'
import { matchUbigeoFromNombres } from '@/lib/ubigeo/match'
import { tipoComprobanteSugerido, getIdentificadorLabel } from '@/lib/cliente-utils'
import DiasVisitaSelector from '@/components/dias-visita-selector'
import { labelDias } from '@/lib/dias-visita'

const clienteSchema = z.object({
  razon_social: z.string().min(2, 'Mínimo 2 caracteres'),
  ruc: z.string().nullable().optional(),
  dni: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  telefono: z.string()
    .regex(/^9\d{8}$/, 'Debe ser celular peruano de 9 dígitos empezando por 9')
    .or(z.literal(''))
    .nullable()
    .optional(),
  email: z.string().email('Email inválido').nullable().optional().or(z.literal('')),
  contacto: z.string().nullable().optional(),
  credito_dias: z.coerce.number().min(0).default(0),
  credito_limite: z.coerce.number().min(0).default(0),
  latitud: z.coerce.number().nullable().optional(),
  longitud: z.coerce.number().nullable().optional(),
  notas: z.string().nullable().optional(),
}).refine((data) => {
  const ruc = (data.ruc ?? '').trim()
  const dni = (data.dni ?? '').trim()
  return ruc.length > 0 || dni.length > 0
}, { message: 'Debe ingresar RUC o DNI', path: ['ruc'] })

type ClienteFormData = z.infer<typeof clienteSchema>
type EstadoCliente = 'activo' | 'suspendido' | 'bloqueado'
type TipoComprobantePref = 'factura' | 'boleta' | 'nota_pedido_interna'

type DireccionExtra = {
  id?: string
  nombre: string
  direccion: string
  ubigeo_value: UbigeoValue  // Se guarda el objeto completo para evitar pérdida de estado al seleccionar parcial
  latitud: number | null
  longitud: number | null
  es_principal: boolean
  zona_id?: string | null  // Override opcional; si null hereda clientes.zona_id
}

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
  const debouncedSearch = useDebounce(search, 300)
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
  const [tiposCliente, setTiposCliente] = useState<any[]>([])
  const [tipoClienteId, setTipoClienteId] = useState<string>('')
  const [tipoComprobantePref, setTipoComprobantePref] = useState<TipoComprobantePref>('boleta')

  // Direcciones adicionales (además de la principal que va en el form)
  const [direccionesExtra, setDireccionesExtra] = useState<DireccionExtra[]>([])
  const [direccionDialog, setDireccionDialog] = useState<{ index: number | null; data: DireccionExtra } | null>(null)

  // Cliente también proveedor
  const [esProveedor, setEsProveedor] = useState(false)
  const [datosProveedor, setDatosProveedor] = useState({ banco: '', cuenta_bancaria: '', cci: '', condiciones_pago: '' })

  // Días de visita programados
  const [diasVisita, setDiasVisita] = useState<string[]>([])
  const [listaPrecioId, setListaPrecioId] = useState<string>('')
  const [zonaId, setZonaId] = useState<string>('')
  const [vendedorId, setVendedorId] = useState<string>('')
  const [estado, setEstado] = useState<EstadoCliente>('activo')
  const [picked, setPicked] = useState<[number, number] | null>(null)
  const [locLoading, setLocLoading] = useState(false)
  const [ubigeoVal, setUbigeoVal] = useState<UbigeoValue>(UBIGEO_EMPTY)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ClienteFormData>({ resolver: zodResolver(clienteSchema) as any })

  // Estado local para los inputs RUC/DNI (sincronizado con register) — así los
  // botones de consulta reaccionan inmediatamente al tipeo sin depender de watch.
  const [rucInput, setRucInput] = useState('')
  const [dniInput, setDniInput] = useState('')

  const { consultarRuc, consultarDni, geocodificar, loading: sunatLoading } = useSunatReniec()

  const autocompletarRuc = async () => {
    const data = await consultarRuc(rucInput.trim())
    if (!data) return
    setValue('razon_social', data.razonSocial, { shouldValidate: true })
    if (data.direccion) setValue('direccion', data.direccion, { shouldValidate: true })
    // Por defecto "Tienda" si existe el tipo
    const tienda = tiposCliente.find((t: any) => t.nombre === 'Tienda')
    if (tienda) setTipoClienteId(tienda.id)
    // Auto-seleccionar factura porque el cliente tiene RUC
    setTipoComprobantePref('factura')
    // Auto-seleccionar zona si hay match con el distrito
    if (data.distrito) {
      const match = zonas.find((z: any) =>
        (z.nombre ?? '').toLowerCase().includes(data.distrito!.toLowerCase()),
      )
      if (match) setZonaId(match.id)
    }
    // Matching automático de ubigeo desde nombres SUNAT
    if (data.departamento || data.provincia || data.distrito) {
      const matched = await matchUbigeoFromNombres({
        departamento: data.departamento,
        provincia: data.provincia,
        distrito: data.distrito,
      })
      if (matched) setUbigeoVal(matched)
    }
    // Geocodificar en el mapa
    const geo = await geocodificar({
      direccion: data.direccion,
      distrito: data.distrito,
      provincia: data.provincia,
      departamento: data.departamento,
    })
    if (geo) {
      setPicked([geo.lat, geo.lng])
      toast.success('Ubicación estimada en el mapa', {
        description: `Confianza ${geo.confianza}. Ajusta manualmente si es necesario.`,
      })
    }
  }

  const autocompletarDni = async () => {
    const data = await consultarDni(dniInput.trim())
    if (!data) return
    setValue('razon_social', data.nombreCompleto, { shouldValidate: true })
    setValue('contacto', data.nombreCompleto, { shouldValidate: true })
    const cf = tiposCliente.find((t: any) => t.nombre === 'Consumidor Final')
    if (cf) setTipoClienteId(cf.id)
    // Solo DNI → boleta obligatoria
    setTipoComprobantePref('boleta')
  }

  const loadMeta = useCallback(async () => {
    const [{ data: z }, { data: l }, { data: v }, { data: tc }] = await Promise.all([
      supabase.from('zonas').select('id, nombre, dias_visita').eq('activo', true).order('nombre'),
      supabase.from('listas_precio').select('id, nombre').order('nombre'),
      supabase.from('profiles').select('id, full_name').eq('role', 'vendedor').order('full_name'),
      (supabase as any).from('tipos_cliente').select('id, nombre').eq('activo', true).order('nombre'),
    ])
    setZonas(z ?? [])
    setListas(l ?? [])
    setVendedores(v ?? [])
    setTiposCliente(tc ?? [])
  }, [])

  const loadClientes = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('clientes')
      .select(`
        id, razon_social, ruc, dni, tipo_cliente_id, tipo_comprobante_preferido, estado,
        credito_limite, credito_dias, direccion, telefono, email, contacto,
        lista_precio_id, zona_id, vendedor_id, latitud, longitud, notas, created_at,
        ubigeo, departamento, provincia, distrito, dias_visita,
        zonas(id, nombre),
        listas_precio(id, nombre),
        tipos_cliente(id, nombre),
        profiles!clientes_vendedor_id_fkey(id, full_name)
      `, { count: 'exact' })
      .order('razon_social')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (debouncedSearch) {
      // Buscar en razón social, RUC o DNI (RUC/DNI son el "código" del cliente)
      query = query.or(
        `razon_social.ilike.%${debouncedSearch}%,ruc.ilike.%${debouncedSearch}%,dni.ilike.%${debouncedSearch}%`,
      )
    }
    if (filterEstado !== 'todos') query = query.eq('estado', filterEstado as any)
    if (filterZona !== 'todas') query = query.eq('zona_id', filterZona)

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar clientes', { description: error.message })

    // Cargar cuáles también son proveedor (cliente_id IS NOT NULL en proveedores)
    const idsClientes = (data ?? []).map((c: any) => c.id)
    let provedoresSet = new Set<string>()
    if (idsClientes.length > 0) {
      const { data: provs } = await (supabase as any)
        .from('proveedores')
        .select('cliente_id')
        .in('cliente_id', idsClientes)
      provedoresSet = new Set((provs ?? []).map((p: any) => p.cliente_id))
    }

    setClientes((data ?? []).map((c: any) => ({ ...c, es_tambien_proveedor: provedoresSet.has(c.id) })))
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, debouncedSearch, filterEstado, filterZona])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadClientes() }, [loadClientes])

  const openCreate = () => {
    setEditingCliente(null)
    const tipoDefault = tiposCliente.find((t: any) => t.nombre === 'Tienda') ?? tiposCliente[0]
    setTipoClienteId(tipoDefault?.id ?? '')
    setTipoComprobantePref('boleta')
    setListaPrecioId('')
    setZonaId('')
    setVendedorId('')
    setEstado('activo')
    setPicked(null)
    setRucInput('')
    setDniInput('')
    setUbigeoVal(UBIGEO_EMPTY)
    setDireccionesExtra([])
    setEsProveedor(false)
    setDatosProveedor({ banco: '', cuenta_bancaria: '', cci: '', condiciones_pago: '' })
    setDiasVisita([])
    reset({
      razon_social: '',
      ruc: '',
      dni: '',
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

  const usarMiUbicacion = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no soportada por el navegador')
      return
    }
    setLocLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPicked([pos.coords.latitude, pos.coords.longitude])
        toast.success('Ubicación capturada', {
          description: `±${Math.round(pos.coords.accuracy)}m de precisión`,
        })
        setLocLoading(false)
      },
      (err) => {
        toast.error('No se pudo obtener la ubicación', { description: err.message })
        setLocLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const openEdit = async (cliente: any) => {
    setEditingCliente(cliente)
    setTipoClienteId(cliente.tipo_cliente_id ?? tiposCliente[0]?.id ?? '')
    setTipoComprobantePref((cliente.tipo_comprobante_preferido as TipoComprobantePref) ?? tipoComprobanteSugerido(cliente))
    setDiasVisita(Array.isArray(cliente.dias_visita) ? cliente.dias_visita : [])

    // Cargar direcciones extra (todas las no principales)
    const { data: dirs } = await (supabase as any)
      .from('cliente_direcciones')
      .select('*')
      .eq('cliente_id', cliente.id)
      .eq('es_principal', false)
      .eq('activo', true)
      .order('created_at')
    setDireccionesExtra((dirs ?? []).map((d: any) => ({
      id: d.id, nombre: d.nombre, direccion: d.direccion ?? '',
      ubigeo_value: {
        departamento_codigo: d.ubigeo ? d.ubigeo.slice(0, 2) : null,
        departamento: d.departamento,
        provincia_codigo: d.ubigeo ? d.ubigeo.slice(2, 4) : null,
        provincia: d.provincia,
        distrito_codigo: d.ubigeo ? d.ubigeo.slice(4, 6) : null,
        distrito: d.distrito,
        ubigeo: d.ubigeo,
      },
      latitud: d.latitud, longitud: d.longitud, es_principal: false,
      zona_id: d.zona_id ?? null,
    })))

    // Cargar datos de proveedor si existe
    const { data: prov } = await (supabase as any)
      .from('proveedores')
      .select('*')
      .eq('cliente_id', cliente.id)
      .maybeSingle()
    if (prov) {
      setEsProveedor(true)
      setDatosProveedor({
        banco: prov.banco ?? '',
        cuenta_bancaria: prov.cuenta_bancaria ?? '',
        cci: prov.cci ?? '',
        condiciones_pago: prov.condiciones_pago ?? '',
      })
    } else {
      setEsProveedor(false)
      setDatosProveedor({ banco: '', cuenta_bancaria: '', cci: '', condiciones_pago: '' })
    }
    setListaPrecioId(cliente.lista_precio_id ?? '')
    setZonaId(cliente.zona_id ?? '')
    setVendedorId(cliente.vendedor_id ?? '')
    setEstado((cliente.estado as EstadoCliente) ?? 'activo')
    setRucInput(cliente.ruc ?? '')
    setDniInput(cliente.dni ?? '')
    setPicked(
      cliente.latitud != null && cliente.longitud != null
        ? [Number(cliente.latitud), Number(cliente.longitud)]
        : null,
    )
    setUbigeoVal({
      departamento_codigo: cliente.ubigeo ? cliente.ubigeo.slice(0, 2) : null,
      departamento: cliente.departamento ?? null,
      provincia_codigo: cliente.ubigeo ? cliente.ubigeo.slice(2, 4) : null,
      provincia: cliente.provincia ?? null,
      distrito_codigo: cliente.ubigeo ? cliente.ubigeo.slice(4, 6) : null,
      distrito: cliente.distrito ?? null,
      ubigeo: cliente.ubigeo ?? null,
    })
    reset({
      razon_social: cliente.razon_social,
      ruc: cliente.ruc ?? '',
      dni: cliente.dni ?? '',
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

  const openDetail = async (c: any) => {
    setSelected({ ...c, direcciones_extra: [] })
    setDetailOpen(true)
    // Cargar direcciones adicionales
    const { data: dirs } = await (supabase as any)
      .from('cliente_direcciones')
      .select('id, nombre, direccion, ubigeo, departamento, provincia, distrito, latitud, longitud')
      .eq('cliente_id', c.id)
      .eq('es_principal', false)
      .eq('activo', true)
      .order('created_at')
    setSelected((prev: any) => prev?.id === c.id ? { ...prev, direcciones_extra: dirs ?? [] } : prev)
  }

  const onSubmit = async (data: ClienteFormData) => {
    if (!tipoClienteId) {
      toast.error('Selecciona un tipo de cliente')
      return
    }
    setSaving(true)
    try {
      // Enforce SUNAT rule: factura requiere RUC
      const rucVal = (data.ruc ?? '').trim()
      const dniVal = (data.dni ?? '').trim()
      let tcp: TipoComprobantePref = tipoComprobantePref
      if (!rucVal && tcp === 'factura') {
        tcp = 'boleta'
        setTipoComprobantePref('boleta')
      }
      const payload: any = {
        razon_social: data.razon_social,
        ruc: rucVal || null,
        dni: dniVal || null,
        tipo_cliente_id: tipoClienteId,
        tipo_comprobante_preferido: tcp,
        dias_visita: diasVisita,
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
        latitud: picked ? picked[0] : null,
        longitud: picked ? picked[1] : null,
        notas: data.notas || null,
        ubigeo: ubigeoVal.ubigeo,
        departamento: ubigeoVal.departamento,
        provincia: ubigeoVal.provincia,
        distrito: ubigeoVal.distrito,
        updated_at: new Date().toISOString(),
      }

      let clienteId: string | null = editingCliente?.id ?? null
      if (editingCliente) {
        const { error } = await (supabase.from('clientes') as any)
          .update(payload)
          .eq('id', editingCliente.id)
        if (error) throw error
      } else {
        const { data: inserted, error } = await (supabase.from('clientes') as any).insert({
          ...payload,
          created_at: new Date().toISOString(),
        }).select('id').single()
        if (error) throw error
        clienteId = inserted.id
      }

      if (!clienteId) throw new Error('No se pudo obtener el ID del cliente')

      // Sincronizar dirección principal en cliente_direcciones
      const { data: principalExistente } = await (supabase as any)
        .from('cliente_direcciones')
        .select('id')
        .eq('cliente_id', clienteId)
        .eq('es_principal', true)
        .maybeSingle()
      const principalData = {
        cliente_id: clienteId,
        nombre: 'Principal',
        direccion: data.direccion || null,
        ubigeo: ubigeoVal.ubigeo,
        departamento: ubigeoVal.departamento,
        provincia: ubigeoVal.provincia,
        distrito: ubigeoVal.distrito,
        latitud: picked ? picked[0] : null,
        longitud: picked ? picked[1] : null,
        es_principal: true,
        activo: true,
      }
      if (principalExistente) {
        await (supabase as any).from('cliente_direcciones').update(principalData).eq('id', principalExistente.id)
      } else {
        await (supabase as any).from('cliente_direcciones').insert(principalData)
      }

      // Direcciones extra: eliminar todas las no principales y reinsertar
      await (supabase as any)
        .from('cliente_direcciones')
        .delete()
        .eq('cliente_id', clienteId)
        .eq('es_principal', false)
      if (direccionesExtra.length > 0) {
        const inserts = direccionesExtra.map((d) => ({
          cliente_id: clienteId,
          nombre: d.nombre,
          direccion: d.direccion,
          ubigeo: d.ubigeo_value.ubigeo,
          departamento: d.ubigeo_value.departamento,
          provincia: d.ubigeo_value.provincia,
          distrito: d.ubigeo_value.distrito,
          latitud: d.latitud,
          longitud: d.longitud,
          es_principal: false,
          activo: true,
          zona_id: d.zona_id ?? null,
        }))
        await (supabase as any).from('cliente_direcciones').insert(inserts)
      }

      // Sincronizar proveedor si es_proveedor marcado
      const { data: proveedorExistente } = await (supabase as any)
        .from('proveedores')
        .select('id')
        .eq('cliente_id', clienteId)
        .maybeSingle()
      if (esProveedor) {
        const provPayload = {
          cliente_id: clienteId,
          razon_social: data.razon_social,
          ruc: rucVal || null,
          direccion: data.direccion || null,
          telefono: data.telefono || null,
          email: data.email || null,
          contacto: data.contacto || null,
          banco: datosProveedor.banco || null,
          cuenta_bancaria: datosProveedor.cuenta_bancaria || null,
          cci: datosProveedor.cci || null,
          condiciones_pago: datosProveedor.condiciones_pago || null,
          activo: true,
          ubigeo: ubigeoVal.ubigeo,
          departamento: ubigeoVal.departamento,
          provincia: ubigeoVal.provincia,
          distrito: ubigeoVal.distrito,
        }
        if (proveedorExistente) {
          await (supabase as any).from('proveedores').update(provPayload).eq('id', proveedorExistente.id)
        } else {
          await (supabase as any).from('proveedores').insert(provPayload)
        }
      } else if (proveedorExistente) {
        // Si se desmarca, eliminar el proveedor (cascade OK porque no hay compras con este proveedor_id en la demo)
        await (supabase as any).from('proveedores').delete().eq('id', proveedorExistente.id)
      }

      toast.success(editingCliente ? 'Cliente actualizado' : 'Cliente creado', {
        description: `${data.razon_social} se guardó correctamente${esProveedor ? ' (también como proveedor)' : ''}.`,
      })

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
        <Button onClick={openCreate} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 w-full sm:w-auto">
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
                placeholder="Buscar por razón social, RUC o DNI..."
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
                          <p className="text-xs text-gray-500 font-mono">{getIdentificadorLabel(c)}</p>
                          {c.es_tambien_proveedor && (
                            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                              🏢 También Proveedor
                            </span>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <span>{c.tipos_cliente?.nombre ?? '—'}</span>
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
                      {['RUC / DNI', 'Razón Social', 'Comprobante', 'Tipo', 'Lista', 'Zona', 'Vendedor', 'Estado', 'Acciones'].map((h) => (
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
                          <td className="py-3 px-4 font-mono text-xs text-gray-500">
                            {c.ruc ? <span><span className="text-gray-400">RUC</span> {c.ruc}</span> : c.dni ? <span><span className="text-gray-400">DNI</span> {c.dni}</span> : '—'}
                          </td>
                          <td className="py-3 px-4 max-w-[240px]">
                            <div className="font-medium text-gray-900 truncate">{c.razon_social}</div>
                            {c.es_tambien_proveedor && (
                              <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                                🏢 También Proveedor
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.tipo_comprobante_preferido === 'factura' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                              {c.tipo_comprobante_preferido === 'factura' ? 'Factura' : 'Boleta'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-600 text-xs">
                            {c.tipos_cliente?.nombre ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-gray-600">{c.listas_precio?.nombre ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{c.zonas?.nombre ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs max-w-[160px] truncate">
                            {c.profiles?.full_name ?? '—'}
                            {c.dias_visita && c.dias_visita.length > 0 && (
                              <div className="text-[10px] text-blue-600 mt-0.5">📅 {labelDias(c.dias_visita)}</div>
                            )}
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
            <div>
              <Label>Razón Social *</Label>
              <Input {...register('razon_social')} placeholder="Nombre o razón social" className="mt-1" />
              {errors.razon_social && <p className="text-xs text-red-500 mt-1">{errors.razon_social.message}</p>}
              <p className="text-[11px] text-gray-400 mt-1">
                El identificador del cliente será su RUC o DNI. Al menos uno es obligatorio.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>RUC</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={rucInput}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 11)
                      setRucInput(v)
                      setValue('ruc', v)
                      // Auto-preseleccionar según regla SUNAT
                      if (v.length >= 11) setTipoComprobantePref('factura')
                      else if (v.length === 0 && dniInput.length > 0) setTipoComprobantePref('boleta')
                    }}
                    placeholder="10/20xxxxxxxxx"
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
                <Label>DNI</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={dniInput}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 8)
                      setDniInput(v)
                      setValue('dni', v)
                      // Si no hay RUC y hay DNI → boleta obligatoria
                      if (v.length === 8 && rucInput.length === 0) setTipoComprobantePref('boleta')
                    }}
                    placeholder="Si no tiene RUC"
                    maxLength={8}
                    inputMode="numeric"
                    className="font-mono flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={autocompletarDni}
                    disabled={sunatLoading || dniInput.length !== 8}
                    className="shrink-0 gap-1 border-[#FBE600] hover:bg-[#FBE600] hover:text-black"
                    title="Consultar RENIEC"
                  >
                    {sunatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    RENIEC
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Tipo de Cliente *</Label>
                <Select value={tipoClienteId} onValueChange={setTipoClienteId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar tipo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tiposCliente.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400 mt-1">
                  <a href="/maestros/tipos-cliente" className="text-green-700 hover:underline">Gestionar tipos →</a>
                </p>
              </div>
              <div>
                <Label>Comprobante Preferido *</Label>
                <Select
                  value={tipoComprobantePref}
                  onValueChange={(v) => setTipoComprobantePref(v as TipoComprobantePref)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="factura" disabled={rucInput.length !== 11}>
                      Factura {rucInput.length !== 11 && '(requiere RUC)'}
                    </SelectItem>
                    <SelectItem value="boleta">Boleta</SelectItem>
                    <SelectItem value="nota_pedido_interna">Documento Interno</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Se usará al emitir comprobantes en PWA y facturación.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <Select value={zonaId} onValueChange={(v) => {
                  setZonaId(v)
                  // Si el cliente NO tiene días propios, autocompletar con los de la zona
                  if (diasVisita.length === 0) {
                    const z = zonas.find((zz) => zz.id === v)
                    if (z?.dias_visita?.length) setDiasVisita(z.dias_visita)
                  }
                }}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar zona..." />
                  </SelectTrigger>
                  <SelectContent>
                    {zonas.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.nombre}
                        {z.dias_visita?.length > 0 && (
                          <span className="ml-2 text-[10px] text-gray-400">· {labelDias(z.dias_visita)}</span>
                        )}
                      </SelectItem>
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

            {(() => {
              const zonaSel = zonas.find((zz) => zz.id === zonaId)
              const diasZona: string[] = zonaSel?.dias_visita ?? []
              const heredando = diasVisita.length === 0 && diasZona.length > 0
              const personalizados = diasVisita.length > 0 && JSON.stringify([...diasVisita].sort()) !== JSON.stringify([...diasZona].sort())
              return (
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between mb-1">
                    <Label>Días de visita</Label>
                    {heredando && (
                      <span className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                        📅 Heredados de la zona ({labelDias(diasZona)})
                      </span>
                    )}
                    {personalizados && (
                      <button type="button" onClick={() => setDiasVisita([])} className="text-[11px] text-blue-600 hover:underline">
                        Restaurar de zona
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mb-2">
                    Si no eliges nada, el cliente hereda los días de su zona. Selecciona para personalizar.
                  </p>
                  <DiasVisitaSelector value={diasVisita.length > 0 ? diasVisita : diasZona} onChange={setDiasVisita} />
                </div>
              )
            })()}

            <div>
              <Label className="text-xs font-semibold text-gray-700">Ubicación administrativa</Label>
              <div className="mt-1">
                <UbigeoSelector value={ubigeoVal} onChange={setUbigeoVal} layout="columns" showLabels />
              </div>
            </div>

            <div>
              <Label>Dirección</Label>
              <Input {...register('direccion')} placeholder="Dirección completa" className="mt-1" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Celular (WhatsApp)</Label>
                <Input
                  {...register('telefono')}
                  placeholder="9XXXXXXXX"
                  maxLength={9}
                  inputMode="numeric"
                  className="mt-1 font-mono"
                />
                {errors.telefono ? (
                  <p className="text-xs text-red-500 mt-1">{errors.telefono.message as string}</p>
                ) : (
                  <p className="text-[11px] text-gray-400 mt-1">9 dígitos · se usa para enviar boletas por WhatsApp</p>
                )}
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

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-green-600" /> Ubicación en el mapa
                </Label>
                <div className="flex items-center gap-2">
                  {picked && (
                    <button
                      type="button"
                      onClick={() => setPicked(null)}
                      className="text-xs text-red-600 hover:underline flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Quitar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={usarMiUbicacion}
                    disabled={locLoading}
                    className="text-xs text-green-700 hover:underline flex items-center gap-1 disabled:opacity-50"
                  >
                    {locLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />}
                    Usar mi ubicación
                  </button>
                </div>
              </div>
              <LeafletMap
                height="260px"
                pickable
                pickedPosition={picked}
                onPick={(lat, lng) => setPicked([lat, lng])}
                fitBounds={!!picked}
              />
              <p className="text-xs text-gray-500 mt-1.5">
                {picked
                  ? <>Coordenadas: <span className="font-mono">{picked[0].toFixed(5)}, {picked[1].toFixed(5)}</span></>
                  : 'Haz clic en el mapa o usa tu GPS para fijar la ubicación del cliente.'}
              </p>
            </div>

            {/* Direcciones adicionales */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label>Direcciones adicionales</Label>
                  <p className="text-[11px] text-gray-400">Sucursales, almacenes u otros puntos de entrega del cliente.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDireccionDialog({ index: null, data: {
                    nombre: '', direccion: '',
                    ubigeo_value: UBIGEO_EMPTY,
                    latitud: null, longitud: null, es_principal: false,
                    zona_id: null,
                  }})}
                  className="gap-1 text-xs h-8"
                >
                  <Plus className="w-3.5 h-3.5" /> Agregar dirección
                </Button>
              </div>
              {direccionesExtra.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3 bg-gray-50 rounded-lg">Sin direcciones adicionales</p>
              ) : (
                <div className="space-y-2">
                  {direccionesExtra.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{d.nombre}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {d.ubigeo_value.distrito && <span className="font-medium">{d.ubigeo_value.distrito} · </span>}
                          {d.direccion}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                          onClick={() => setDireccionDialog({ index: i, data: { ...d } })}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600"
                          onClick={() => setDireccionesExtra((prev) => prev.filter((_, idx) => idx !== i))}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Toggle cliente-proveedor */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-500" /> También es Proveedor
                  </Label>
                  <p className="text-[11px] text-gray-400">Registra al cliente también como proveedor para comprarle.</p>
                </div>
                <Switch checked={esProveedor} onCheckedChange={setEsProveedor} />
              </div>
              {esProveedor && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <div>
                    <Label className="text-xs">Banco</Label>
                    <Input
                      value={datosProveedor.banco}
                      onChange={(e) => setDatosProveedor({ ...datosProveedor, banco: e.target.value })}
                      placeholder="BCP, Interbank..."
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Cuenta bancaria</Label>
                    <Input
                      value={datosProveedor.cuenta_bancaria}
                      onChange={(e) => setDatosProveedor({ ...datosProveedor, cuenta_bancaria: e.target.value })}
                      placeholder="Nº cuenta corriente"
                      className="mt-1 h-9 font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">CCI</Label>
                    <Input
                      value={datosProveedor.cci}
                      onChange={(e) => setDatosProveedor({ ...datosProveedor, cci: e.target.value })}
                      placeholder="20 dígitos"
                      className="mt-1 h-9 font-mono"
                      maxLength={20}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Condiciones de pago</Label>
                    <Input
                      value={datosProveedor.condiciones_pago}
                      onChange={(e) => setDatosProveedor({ ...datosProveedor, condiciones_pago: e.target.value })}
                      placeholder="Contado, 30 días..."
                      className="mt-1 h-9"
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label>Notas</Label>
              <Textarea {...register('notas')} placeholder="Observaciones adicionales" className="mt-1" rows={2} />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingCliente ? 'Guardar Cambios' : 'Crear Cliente'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog agregar/editar dirección extra */}
      <Dialog open={!!direccionDialog} onOpenChange={(o) => !o && setDireccionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{direccionDialog?.index != null ? 'Editar dirección' : 'Nueva dirección'}</DialogTitle>
          </DialogHeader>
          {direccionDialog && (
            <div className="space-y-3 mt-2">
              <div>
                <Label>Nombre *</Label>
                <Input
                  value={direccionDialog.data.nombre}
                  onChange={(e) => setDireccionDialog({ ...direccionDialog, data: { ...direccionDialog.data, nombre: e.target.value } })}
                  placeholder="Ej: Sucursal Norte, Almacén Central..."
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Dirección *</Label>
                <Input
                  value={direccionDialog.data.direccion}
                  onChange={(e) => setDireccionDialog({ ...direccionDialog, data: { ...direccionDialog.data, direccion: e.target.value } })}
                  placeholder="Calle, número, referencia"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Ubigeo</Label>
                <UbigeoSelector
                  value={direccionDialog.data.ubigeo_value}
                  onChange={(v) => setDireccionDialog({
                    ...direccionDialog,
                    data: { ...direccionDialog.data, ubigeo_value: v },
                  })}
                  layout="stacked"
                />
              </div>
              <div>
                <Label>Zona (opcional)</Label>
                <Select
                  value={direccionDialog.data.zona_id ?? '__hereda__'}
                  onValueChange={(v) => setDireccionDialog({
                    ...direccionDialog,
                    data: { ...direccionDialog.data, zona_id: v === '__hereda__' ? null : v },
                  })}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__hereda__">📍 Hereda del cliente</SelectItem>
                    {zonas.map((z) => (
                      <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Útil si esta sucursal está en otra zona distinta a la del cliente principal.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setDireccionDialog(null)}>Cancelar</Button>
                <Button
                  type="button"
                  onClick={() => {
                    const d = direccionDialog.data
                    if (!d.nombre.trim() || !d.direccion.trim()) {
                      toast.error('Nombre y dirección son obligatorios')
                      return
                    }
                    setDireccionesExtra((prev) => {
                      if (direccionDialog.index != null) {
                        const next = [...prev]
                        next[direccionDialog.index] = d
                        return next
                      }
                      return [...prev, d]
                    })
                    setDireccionDialog(null)
                  }}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold"
                >
                  {direccionDialog.index != null ? 'Guardar' : 'Agregar'}
                </Button>
              </div>
            </div>
          )}
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
                      {getIdentificadorLabel(selected)}
                      {selected.tipo_comprobante_preferido && (
                        <span className="ml-2 text-blue-600">
                          · Emite {selected.tipo_comprobante_preferido === 'factura' ? 'Factura' : 'Boleta'}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${estadoCfg.className}`}>
                    {estadoCfg.label}
                  </span>
                </div>

                {selected.latitud != null && selected.longitud != null && (
                  <div>
                    <LeafletMap
                      height="200px"
                      markers={[{
                        id: 'c',
                        lat: Number(selected.latitud),
                        lng: Number(selected.longitud),
                        label: selected.razon_social,
                        description: selected.direccion ?? undefined,
                      }]}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2">
                    <Tag className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Tipo</p>
                      <p className="text-gray-800">
                        {selected.tipos_cliente?.nombre ?? '—'}
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
                      {selected.dias_visita && selected.dias_visita.length > 0 && (
                        <p className="text-[11px] text-blue-600 mt-0.5">📅 {labelDias(selected.dias_visita)}</p>
                      )}
                    </div>
                  </div>
                </div>

                {(selected.distrito || selected.provincia || selected.departamento) && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Ubicación administrativa</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-[11px] text-gray-500">Departamento</p>
                        <p className="text-gray-800 text-sm">{selected.departamento ?? '—'}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-[11px] text-gray-500">Provincia</p>
                        <p className="text-gray-800 text-sm">{selected.provincia ?? '—'}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-[11px] text-gray-500">Distrito</p>
                        <p className="text-gray-800 text-sm">{selected.distrito ?? '—'}</p>
                      </div>
                    </div>
                    {selected.ubigeo && (
                      <p className="text-xs text-gray-400 mt-2">Ubigeo {selected.ubigeo}</p>
                    )}
                  </div>
                )}

                <div className="space-y-3 text-sm border-t border-gray-100 pt-3">
                  {selected.direccion && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-500">
                          Dirección principal
                          {selected.direcciones_extra && selected.direcciones_extra.length > 0 && (
                            <span className="ml-2 text-blue-600">+ {selected.direcciones_extra.length} adicional{selected.direcciones_extra.length === 1 ? '' : 'es'}</span>
                          )}
                        </p>
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

                  {/* Direcciones adicionales */}
                  {selected.direcciones_extra && selected.direcciones_extra.length > 0 && (
                    <div className="space-y-2 pl-7">
                      <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Direcciones adicionales</p>
                      {selected.direcciones_extra.map((d: any) => {
                        const dMaps = d.latitud != null && d.longitud != null
                          ? `https://www.google.com/maps?q=${d.latitud},${d.longitud}`
                          : null
                        return (
                          <div key={d.id} className="bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                            <div className="flex items-start gap-2">
                              <MapPin className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-blue-900">{d.nombre}</p>
                                <p className="text-xs text-gray-700 break-words mt-0.5">{d.direccion}</p>
                                {(d.distrito || d.provincia || d.departamento) && (
                                  <p className="text-[10px] text-gray-500 mt-0.5">
                                    {[d.distrito, d.provincia, d.departamento].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                                {dMaps && (
                                  <a href={dMaps} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 mt-1 text-[11px] text-green-700 font-medium hover:underline">
                                    <MapPin className="w-2.5 h-2.5" /> Ver en Google Maps
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
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
                  <Button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
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
