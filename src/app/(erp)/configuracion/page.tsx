'use client'

import { useEffect, useState, useCallback } from 'react'
import { Settings, Plus, Edit, Loader2, CheckCircle, KeyRound, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ROLES_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LeafletMap from '@/components/maps/leaflet-map'
import { Warehouse, Crosshair } from 'lucide-react'

const SERIES_INICIALES = [
  { serie: 'F001', tipo: 'factura', descripcion: 'Facturas electrónicas' },
  { serie: 'B001', tipo: 'boleta', descripcion: 'Boletas de venta electrónicas' },
  { serie: 'T001', tipo: 'nota_pedido_interna', descripcion: 'Documentos internos' },
]

export default function ConfiguracionPage() {
  const supabase = createClient()

  const [usuarios, setUsuarios] = useState<any[]>([])
  const [series, setSeries] = useState<any[]>([])
  const [parametros, setParametros] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const [empresa, setEmpresa] = useState({
    razon_social: 'AGROCAR SRL',
    ruc: '20532768516',
    direccion: 'Av. Bolognesi 1234, Tacna',
    telefono: '052 123456',
    email: 'info@agrocarsrl.com',
    representante: 'Gerente General',
  })

  const [userDialog, setUserDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    role: 'vendedor',
    activo: true,
    codigo: '',
    dni: '',
    telefono: '',
    zona_id: '',
    password: '',
  })
  const [resetPwdDialog, setResetPwdDialog] = useState<any>(null)
  const [resetPwd, setResetPwd] = useState('')
  const [deleteUserDialog, setDeleteUserDialog] = useState<any>(null)
  const [zonas, setZonas] = useState<any[]>([])

  // Almacén (punto de partida para optimización de rutas)
  const [almacen, setAlmacen] = useState({
    nombre: 'AGROCAR - Almacén Central',
    direccion: '',
    lat: -18.01465,
    lng: -70.25362,
  })
  const [savingAlmacen, setSavingAlmacen] = useState(false)
  const [pickingAlmacen, setPickingAlmacen] = useState<[number, number] | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const sb = supabase as any
    const [{ data: u }, { data: s }, { data: p }, { data: conf }, { data: zs }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, activo, codigo, dni, telefono, zona_id, zonas(nombre)').order('full_name'),
      sb.from('series_comprobante').select('*').order('serie'),
      sb.from('parametros_sistema').select('clave, valor'),
      sb.from('configuracion').select('clave, valor').in('clave', ['almacen_nombre', 'almacen_direccion', 'almacen_lat', 'almacen_lng']),
      sb.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
    ])
    setZonas(zs ?? [])

    // Cargar almacén desde tabla configuracion
    const confMap: Record<string, string> = {}
    ;(conf ?? []).forEach((c: any) => { confMap[c.clave] = c.valor })
    const lat = parseFloat(confMap.almacen_lat ?? '-18.01465')
    const lng = parseFloat(confMap.almacen_lng ?? '-70.25362')
    setAlmacen({
      nombre: confMap.almacen_nombre ?? 'AGROCAR - Almacén Central',
      direccion: confMap.almacen_direccion ?? '',
      lat: isNaN(lat) ? -18.01465 : lat,
      lng: isNaN(lng) ? -70.25362 : lng,
    })
    setPickingAlmacen([isNaN(lat) ? -18.01465 : lat, isNaN(lng) ? -70.25362 : lng])
    setUsuarios(u ?? [])
    setSeries(s && s.length > 0 ? s : SERIES_INICIALES.map((s, i) => ({ ...s, id: i, correlativo_actual: 0 })))

    const paramMap: Record<string, string> = {}
    ;(p ?? []).forEach((pr: any) => { paramMap[pr.clave] = pr.valor })
    setParametros({
      gps_radio: paramMap.gps_radio ?? '50',
      pedido_minimo: paramMap.pedido_minimo ?? '30',
      descuento_maximo: paramMap.descuento_maximo ?? '2.5',
      dias_vencimiento_alerta: paramMap.dias_vencimiento_alerta ?? '30',
      ...paramMap,
    })
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const saveEmpresa = async () => {
    setSaving(true)
    // Guardar en tabla de configuración o parametros_sistema
    const sb = supabase as any
    let errorOcurrido: string | null = null
    for (const [key, value] of Object.entries(empresa)) {
      const { error } = await sb.from('parametros_sistema').upsert(
        { clave: `empresa_${key}`, valor: String(value) },
        { onConflict: 'clave' }
      )
      if (error && !errorOcurrido) errorOcurrido = error.message
    }
    setSaving(false)
    if (errorOcurrido) {
      toast.error('Error al guardar empresa', { description: errorOcurrido })
    } else {
      setMsg('Datos de empresa guardados')
      toast.success('Datos de empresa guardados', { description: 'Los cambios se aplicaron correctamente.' })
      setTimeout(() => setMsg(''), 3000)
    }
  }

  const saveAlmacen = async () => {
    setSavingAlmacen(true)
    const sb = supabase as any
    const lat = pickingAlmacen ? pickingAlmacen[0] : almacen.lat
    const lng = pickingAlmacen ? pickingAlmacen[1] : almacen.lng
    const entries: Array<[string, string]> = [
      ['almacen_nombre', almacen.nombre],
      ['almacen_direccion', almacen.direccion],
      ['almacen_lat', String(lat)],
      ['almacen_lng', String(lng)],
    ]
    let err: string | null = null
    for (const [clave, valor] of entries) {
      const { error } = await sb.from('configuracion').upsert(
        { clave, valor, updated_at: new Date().toISOString() },
        { onConflict: 'clave' },
      )
      if (error && !err) err = error.message
    }
    setSavingAlmacen(false)
    if (err) {
      toast.error('No se pudo guardar el almacén', { description: err })
    } else {
      setAlmacen((prev) => ({ ...prev, lat, lng }))
      toast.success('Almacén guardado', { description: 'Se usará como punto de partida en la optimización de rutas.' })
    }
  }

  const usarMiUbicacionAlmacen = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no soportada')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPickingAlmacen([pos.coords.latitude, pos.coords.longitude])
        toast.success('Ubicación capturada', { description: 'Recuerda presionar Guardar.' })
      },
      (err) => toast.error('Error GPS', { description: err.message }),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const saveParametros = async () => {
    setSaving(true)
    const sb2 = supabase as any
    let errorOcurrido: string | null = null
    for (const [key, value] of Object.entries(parametros)) {
      const { error } = await sb2.from('parametros_sistema').upsert(
        { clave: key, valor: String(value) },
        { onConflict: 'clave' }
      )
      if (error && !errorOcurrido) errorOcurrido = error.message
    }
    setSaving(false)
    if (errorOcurrido) {
      toast.error('Error al guardar parámetros', { description: errorOcurrido })
    } else {
      setMsg('Parámetros guardados correctamente')
      toast.success('Parámetros actualizados', { description: 'La configuración del sistema se actualizó.' })
      setTimeout(() => setMsg(''), 3000)
    }
  }

  const openCreateUser = () => {
    setEditingUser(null)
    setUserForm({
      full_name: '',
      email: '',
      role: 'vendedor',
      activo: true,
      codigo: '',
      dni: '',
      telefono: '',
      zona_id: '',
      password: '',
    })
    setUserDialog(true)
  }

  const openEditUser = (user: any) => {
    setEditingUser(user)
    setUserForm({
      full_name: user.full_name ?? '',
      email: user.email,
      role: user.role,
      activo: user.activo,
      codigo: user.codigo ?? '',
      dni: user.dni ?? '',
      telefono: user.telefono ?? '',
      zona_id: user.zona_id ?? '',
      password: '',
    })
    setUserDialog(true)
  }

  const saveUser = async () => {
    setSaving(true)
    try {
      if (editingUser) {
        const { error } = await (supabase.from('profiles') as any).update({
          full_name: userForm.full_name,
          role: userForm.role as any,
          activo: userForm.activo,
          codigo: userForm.codigo?.trim() || null,
          dni: userForm.dni?.trim() || null,
          telefono: userForm.telefono?.trim() || null,
          zona_id: userForm.zona_id || null,
          updated_at: new Date().toISOString(),
        }).eq('id', editingUser.id)
        if (error) throw error
        toast.success('Usuario actualizado', {
          description: `${userForm.full_name || editingUser.email} guardado correctamente.`,
        })
      } else {
        // Crear nuevo
        if (!userForm.email || !userForm.password || !userForm.full_name) {
          toast.error('Email, password y nombre son obligatorios')
          setSaving(false)
          return
        }
        if (userForm.password.length < 6) {
          toast.error('Password debe tener al menos 6 caracteres')
          setSaving(false)
          return
        }
        const res = await fetch('/api/usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: userForm.email,
            password: userForm.password,
            full_name: userForm.full_name,
            role: userForm.role,
            codigo: userForm.codigo,
            dni: userForm.dni,
            telefono: userForm.telefono,
            zona_id: userForm.zona_id || null,
            activo: userForm.activo,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'No se pudo crear el usuario')
        toast.success('Usuario creado', {
          description: `${userForm.full_name} (${userForm.email}) ya puede iniciar sesión.`,
        })
      }
      setUserDialog(false)
      loadData()
    } catch (err: any) {
      toast.error('Error al guardar usuario', { description: err?.message ?? 'Error desconocido' })
    } finally {
      setSaving(false)
    }
  }

  const resetPassword = async () => {
    if (!resetPwdDialog) return
    if (resetPwd.length < 6) {
      toast.error('Password debe tener al menos 6 caracteres')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/usuarios/${resetPwdDialog.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPwd }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo resetear')
      toast.success('Password actualizada', {
        description: `${resetPwdDialog.full_name ?? resetPwdDialog.email}.`,
      })
      setResetPwdDialog(null)
      setResetPwd('')
    } catch (err: any) {
      toast.error('Error', { description: err?.message ?? '' })
    } finally { setSaving(false) }
  }

  const eliminarUsuario = async () => {
    if (!deleteUserDialog) return
    setSaving(true)
    try {
      const res = await fetch(`/api/usuarios/${deleteUserDialog.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo eliminar')
      toast.success('Usuario eliminado', { description: deleteUserDialog.full_name ?? deleteUserDialog.email })
      setDeleteUserDialog(null)
      loadData()
    } catch (err: any) {
      toast.error('Error', { description: err?.message ?? '' })
    } finally { setSaving(false) }
  }

  const toggleUserActivo = async (user: any) => {
    const { error } = await supabase.from('profiles').update({
      activo: !user.activo,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id)
    if (error) {
      toast.error('Error al cambiar estado', { description: error.message })
    } else {
      toast.success(!user.activo ? 'Usuario activado' : 'Usuario desactivado', {
        description: user.full_name ?? user.email,
      })
    }
    loadData()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuración del Sistema</h1>
        <p className="text-sm text-gray-500 mt-0.5">Empresa, usuarios, series y parámetros</p>
      </div>

      {msg && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
          <p className="text-sm font-medium text-green-800">{msg}</p>
        </div>
      )}

      <Tabs defaultValue="empresa">
        <TabsList className="bg-gray-100 p-1 rounded-xl">
          {['empresa', 'almacen', 'usuarios', 'series', 'parametros'].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="rounded-lg text-sm capitalize data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              {tab === 'empresa' ? 'Empresa'
                : tab === 'almacen' ? 'Almacén'
                : tab === 'usuarios' ? 'Usuarios'
                : tab === 'series' ? 'Series'
                : 'Parámetros'}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* EMPRESA */}
        <TabsContent value="empresa" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Datos de AGROCAR SRL</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Razón Social</Label>
                  <Input
                    value={empresa.razon_social}
                    onChange={(e) => setEmpresa((p) => ({ ...p, razon_social: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>RUC</Label>
                  <Input
                    value={empresa.ruc}
                    onChange={(e) => setEmpresa((p) => ({ ...p, ruc: e.target.value }))}
                    className="mt-1 font-mono"
                  />
                </div>
              </div>
              <div>
                <Label>Dirección</Label>
                <Input
                  value={empresa.direccion}
                  onChange={(e) => setEmpresa((p) => ({ ...p, direccion: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Teléfono</Label>
                  <Input
                    value={empresa.telefono}
                    onChange={(e) => setEmpresa((p) => ({ ...p, telefono: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    value={empresa.email}
                    onChange={(e) => setEmpresa((p) => ({ ...p, email: e.target.value }))}
                    className="mt-1"
                    type="email"
                  />
                </div>
              </div>
              <div>
                <Label>Representante Legal</Label>
                <Input
                  value={empresa.representante}
                  onChange={(e) => setEmpresa((p) => ({ ...p, representante: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="pt-2">
                <Button onClick={saveEmpresa} disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar Datos
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ALMACÉN */}
        <TabsContent value="almacen" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-green-600" />
                Almacén Central
              </CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                Punto de partida para la optimización de rutas de despacho. Se usa en la hoja de ruta
                para ordenar los pedidos por cercanía desde aquí.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Nombre del Almacén</Label>
                  <Input
                    value={almacen.nombre}
                    onChange={(e) => setAlmacen((p) => ({ ...p, nombre: e.target.value }))}
                    placeholder="AGROCAR - Almacén Central"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Dirección</Label>
                  <Input
                    value={almacen.direccion}
                    onChange={(e) => setAlmacen((p) => ({ ...p, direccion: e.target.value }))}
                    placeholder="Av. ..."
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label>Ubicación en el mapa</Label>
                  <button
                    type="button"
                    onClick={usarMiUbicacionAlmacen}
                    className="text-xs text-green-700 hover:underline flex items-center gap-1"
                  >
                    <Crosshair className="w-3 h-3" /> Usar mi ubicación
                  </button>
                </div>
                <LeafletMap
                  height="320px"
                  pickable
                  pickedPosition={pickingAlmacen}
                  onPick={(lat, lng) => setPickingAlmacen([lat, lng])}
                  fitBounds={!!pickingAlmacen}
                />
                <p className="text-[11px] text-gray-500 mt-1.5">
                  {pickingAlmacen
                    ? <>Coordenadas: <span className="font-mono">{pickingAlmacen[0].toFixed(5)}, {pickingAlmacen[1].toFixed(5)}</span></>
                    : 'Haz clic en el mapa o usa tu GPS para fijar la ubicación del almacén.'}
                </p>
              </div>

              <div className="pt-2">
                <Button
                  onClick={saveAlmacen}
                  disabled={savingAlmacen}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {savingAlmacen && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar ubicación del almacén
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* USUARIOS */}
        <TabsContent value="usuarios" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-800">
                Usuarios del Sistema ({usuarios.length})
              </CardTitle>
              <Button onClick={openCreateUser} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 h-8">
                <Plus className="w-4 h-4" /> Nuevo Usuario
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['Código', 'Nombre', 'Email', 'DNI', 'Teléfono', 'Zona', 'Rol', 'Estado', 'Acciones'].map((h) => (
                          <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {usuarios.map((u) => (
                        <tr key={u.id} className="hover:bg-gray-50/50">
                          <td className="py-2.5 px-3 font-mono text-xs text-gray-800">{u.codigo ?? '—'}</td>
                          <td className="py-2.5 px-3 font-medium text-gray-800">{u.full_name ?? '—'}</td>
                          <td className="py-2.5 px-3 text-gray-500 text-xs">{u.email}</td>
                          <td className="py-2.5 px-3 text-gray-600 text-xs font-mono">{u.dni ?? '—'}</td>
                          <td className="py-2.5 px-3 text-gray-600 text-xs">{u.telefono ?? '—'}</td>
                          <td className="py-2.5 px-3 text-gray-600 text-xs">{u.zonas?.nombre ?? '—'}</td>
                          <td className="py-2.5 px-3">
                            <Badge variant="outline" className="text-xs">{ROLES_LABELS[u.role] ?? u.role}</Badge>
                          </td>
                          <td className="py-2.5 px-3">
                            {u.activo
                              ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                              : <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                            }
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openEditUser(u)} className="h-7 w-7 p-0" title="Editar">
                                <Edit className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setResetPwdDialog(u); setResetPwd('') }} className="h-7 w-7 p-0" title="Resetear password">
                                <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleteUserDialog(u)} className="h-7 w-7 p-0" title="Eliminar">
                                <Trash2 className="w-3.5 h-3.5 text-red-600" />
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
        </TabsContent>

        {/* SERIES */}
        <TabsContent value="series" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Series de Facturación</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Serie', 'Tipo', 'Descripción', 'Correlativo Actual'].map((h) => (
                      <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {series.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="py-3 px-4 font-mono font-bold text-gray-800">{s.serie}</td>
                      <td className="py-3 px-4 capitalize text-gray-600 text-xs">{s.tipo}</td>
                      <td className="py-3 px-4 text-gray-600">{s.descripcion}</td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-gray-800 font-semibold">
                          {String(s.correlativo_actual ?? 0).padStart(8, '0')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PARÁMETROS */}
        <TabsContent value="parametros" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Parámetros del Sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <Label>Radio GPS para check-in (metros)</Label>
                  <p className="text-xs text-gray-400">Distancia máxima para validar la ubicación del vendedor</p>
                  <Input
                    type="number"
                    value={parametros.gps_radio ?? '50'}
                    onChange={(e) => setParametros((p) => ({ ...p, gps_radio: e.target.value }))}
                    className="mt-1 w-32"
                    min={10}
                    max={500}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Pedido mínimo (S/)</Label>
                  <p className="text-xs text-gray-400">Monto mínimo para aceptar un pedido en la app</p>
                  <Input
                    type="number"
                    value={parametros.pedido_minimo ?? '30'}
                    onChange={(e) => setParametros((p) => ({ ...p, pedido_minimo: e.target.value }))}
                    className="mt-1 w-32"
                    min={0}
                    step="0.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Descuento máximo (%)</Label>
                  <p className="text-xs text-gray-400">Descuento máximo que puede aplicar un vendedor</p>
                  <Input
                    type="number"
                    value={parametros.descuento_maximo ?? '2.5'}
                    onChange={(e) => setParametros((p) => ({ ...p, descuento_maximo: e.target.value }))}
                    className="mt-1 w-32"
                    min={0}
                    max={100}
                    step="0.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Alerta vencimiento de crédito (días)</Label>
                  <p className="text-xs text-gray-400">Días antes del vencimiento para alertar</p>
                  <Input
                    type="number"
                    value={parametros.dias_vencimiento_alerta ?? '30'}
                    onChange={(e) => setParametros((p) => ({ ...p, dias_vencimiento_alerta: e.target.value }))}
                    className="mt-1 w-32"
                    min={1}
                    max={90}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <Button onClick={saveParametros} disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar Parámetros
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog editar usuario */}
      <Dialog open={userDialog} onOpenChange={setUserDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nombre Completo *</Label>
              <Input
                value={userForm.full_name}
                onChange={(e) => setUserForm((f) => ({ ...f, full_name: e.target.value }))}
                className="mt-1"
                placeholder="Nombre y apellidos"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Email {!editingUser && '*'}</Label>
                {editingUser ? (
                  <Input value={editingUser.email ?? ''} disabled className="mt-1 bg-gray-50" />
                ) : (
                  <Input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="usuario@agrocar.pe"
                    className="mt-1"
                  />
                )}
              </div>
              <div>
                <Label>Rol *</Label>
                <Select value={userForm.role} onValueChange={(v) => setUserForm((f) => ({ ...f, role: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLES_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!editingUser && (
              <div>
                <Label>Password * (mínimo 6 caracteres)</Label>
                <Input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Password inicial"
                  className="mt-1 font-mono"
                  minLength={6}
                />
                <p className="text-[11px] text-gray-400 mt-1">El usuario podrá cambiarla luego desde su perfil.</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Código (opcional)</Label>
                <Input
                  value={userForm.codigo}
                  onChange={(e) => setUserForm((f) => ({ ...f, codigo: e.target.value.toUpperCase().slice(0, 6) }))}
                  placeholder="001"
                  maxLength={6}
                  className="mt-1 font-mono h-9"
                />
              </div>
              <div>
                <Label className="text-xs">DNI</Label>
                <Input
                  value={userForm.dni}
                  onChange={(e) => setUserForm((f) => ({ ...f, dni: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                  placeholder="12345678"
                  maxLength={8}
                  inputMode="numeric"
                  className="mt-1 font-mono h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Teléfono</Label>
                <Input
                  value={userForm.telefono}
                  onChange={(e) => setUserForm((f) => ({ ...f, telefono: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
                  placeholder="987654321"
                  maxLength={9}
                  inputMode="numeric"
                  className="mt-1 font-mono h-9"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Zona asignada (vendedores/repartidores)</Label>
              <Select value={userForm.zona_id || 'ninguna'} onValueChange={(v) => setUserForm((f) => ({ ...f, zona_id: v === 'ninguna' ? '' : v }))}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sin zona asignada" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguna">Sin zona asignada</SelectItem>
                  {zonas.map((z) => <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400 mt-1">Solo aplica a vendedores y repartidores.</p>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
              <Switch
                checked={userForm.activo}
                onCheckedChange={(v) => setUserForm((f) => ({ ...f, activo: v }))}
              />
              <Label>Usuario activo</Label>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setUserDialog(false)}>Cancelar</Button>
              <Button onClick={saveUser} disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetPwdDialog} onOpenChange={(o) => !o && setResetPwdDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resetear password</DialogTitle>
          </DialogHeader>
          {resetPwdDialog && (
            <div className="space-y-3 mt-2">
              <p className="text-sm text-gray-600">
                Asigna una nueva password para <strong>{resetPwdDialog.full_name ?? resetPwdDialog.email}</strong>.
              </p>
              <div>
                <Label>Nueva password (mín. 6)</Label>
                <Input
                  type="password"
                  value={resetPwd}
                  onChange={(e) => setResetPwd(e.target.value)}
                  className="mt-1 font-mono"
                  minLength={6}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setResetPwdDialog(null)}>Cancelar</Button>
                <Button onClick={resetPassword} disabled={saving || resetPwd.length < 6} className="bg-amber-600 hover:bg-amber-700 text-white gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <KeyRound className="w-4 h-4" /> Resetear
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Eliminar usuario */}
      <Dialog open={!!deleteUserDialog} onOpenChange={(o) => !o && setDeleteUserDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar usuario</DialogTitle>
          </DialogHeader>
          {deleteUserDialog && (
            <div className="space-y-3 mt-2">
              <p className="text-sm text-gray-700">
                ¿Eliminar a <strong>{deleteUserDialog.full_name ?? deleteUserDialog.email}</strong>?
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                ⚠ Esta acción es permanente. Si el usuario tiene pedidos, comprobantes o cobros
                registrados, no podrá ser eliminado y deberás desactivarlo en su lugar.
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDeleteUserDialog(null)}>Cancelar</Button>
                <Button onClick={eliminarUsuario} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Trash2 className="w-4 h-4" /> Eliminar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
