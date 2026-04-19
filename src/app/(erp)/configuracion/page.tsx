'use client'

import { useEffect, useState, useCallback } from 'react'
import { Settings, Plus, Edit, Loader2, CheckCircle } from 'lucide-react'
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
  const [userForm, setUserForm] = useState({ full_name: '', email: '', role: 'vendedor', activo: true })

  const loadData = useCallback(async () => {
    setLoading(true)
    const sb = supabase as any
    const [{ data: u }, { data: s }, { data: p }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, activo').order('full_name'),
      sb.from('series_comprobante').select('*').order('serie'),
      sb.from('parametros_sistema').select('clave, valor'),
    ])
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
    for (const [key, value] of Object.entries(empresa)) {
      await sb.from('parametros_sistema').upsert(
        { clave: `empresa_${key}`, valor: String(value) },
        { onConflict: 'clave' }
      )
    }
    setSaving(false)
    setMsg('Datos de empresa guardados')
    setTimeout(() => setMsg(''), 3000)
  }

  const saveParametros = async () => {
    setSaving(true)
    const sb2 = supabase as any
    for (const [key, value] of Object.entries(parametros)) {
      await sb2.from('parametros_sistema').upsert(
        { clave: key, valor: String(value) },
        { onConflict: 'clave' }
      )
    }
    setSaving(false)
    setMsg('Parámetros guardados correctamente')
    setTimeout(() => setMsg(''), 3000)
  }

  const openEditUser = (user: any) => {
    setEditingUser(user)
    setUserForm({ full_name: user.full_name ?? '', email: user.email, role: user.role, activo: user.activo })
    setUserDialog(true)
  }

  const saveUser = async () => {
    setSaving(true)
    if (editingUser) {
      await supabase.from('profiles').update({
        full_name: userForm.full_name,
        role: userForm.role as any,
        activo: userForm.activo,
        updated_at: new Date().toISOString(),
      }).eq('id', editingUser.id)
    }
    setSaving(false)
    setUserDialog(false)
    loadData()
  }

  const toggleUserActivo = async (user: any) => {
    await supabase.from('profiles').update({ activo: !user.activo, updated_at: new Date().toISOString() }).eq('id', user.id)
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
          {['empresa', 'usuarios', 'series', 'parametros'].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="rounded-lg text-sm capitalize data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              {tab === 'empresa' ? 'Empresa'
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
                <Button onClick={saveEmpresa} disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar Datos
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
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Nombre', 'Email', 'Rol', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {usuarios.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50/50">
                        <td className="py-2.5 px-4 font-medium text-gray-800">{u.full_name ?? '—'}</td>
                        <td className="py-2.5 px-4 text-gray-500 text-xs">{u.email}</td>
                        <td className="py-2.5 px-4">
                          <Badge variant="outline" className="text-xs">{ROLES_LABELS[u.role] ?? u.role}</Badge>
                        </td>
                        <td className="py-2.5 px-4">
                          {u.activo
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                            : <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                          }
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEditUser(u)} className="h-7 w-7 p-0">
                              <Edit className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Switch
                              checked={u.activo}
                              onCheckedChange={() => toggleUserActivo(u)}
                              className="scale-75"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <Button onClick={saveParametros} disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
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
            <DialogTitle>Editar Usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nombre Completo</Label>
              <Input
                value={userForm.full_name}
                onChange={(e) => setUserForm((f) => ({ ...f, full_name: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={editingUser?.email ?? ''} disabled className="mt-1 bg-gray-50" />
            </div>
            <div>
              <Label>Rol</Label>
              <Select value={userForm.role} onValueChange={(v) => setUserForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLES_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={userForm.activo}
                onCheckedChange={(v) => setUserForm((f) => ({ ...f, activo: v }))}
              />
              <Label>Usuario activo</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setUserDialog(false)}>Cancelar</Button>
              <Button onClick={saveUser} disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar Cambios
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
