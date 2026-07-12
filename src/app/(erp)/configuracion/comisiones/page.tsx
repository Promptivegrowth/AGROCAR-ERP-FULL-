'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import { Loader2, Save, Plus, Trash2, Info, Percent, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRouter } from 'next/navigation'

interface Familia { id: string; nombre: string }
interface Vendedor { id: string; full_name: string }
interface Regla {
  id: string
  vendedor_id: string | null
  familia_id: string | null
  porcentaje: number | null
  monto_fijo: number | null
  objetivo_mensual: number | null
  activo: boolean
  // joineadas
  vendedor_nombre?: string
  familia_nombre?: string
}
interface CicloLiquidacion {
  ciclo: 'mensual' | 'quincenal' | 'personalizado'
  dia: string
  base_calculo: 'venta_bruta' | 'venta_cobrada'
}

/**
 * Configuración de comisiones por familia de producto.
 *
 * Prioridad de aplicación al calcular:
 *  1. Regla específica para (vendedor, familia)
 *  2. Regla del vendedor sin familia (global personal)
 *  3. Regla por familia sin vendedor (default de familia)
 *  4. Regla global sin vendedor ni familia (último recurso)
 *
 * Esta página tiene 2 tabs:
 *  - Por familia (defaults): tasas que aplican a TODOS los vendedores
 *  - Por vendedor (overrides): tasas específicas para un vendedor
 */
export default function ConfigComisionesPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [familias, setFamilias] = useState<Familia[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [reglas, setReglas] = useState<Regla[]>([])
  const [ciclo, setCiclo] = useState<CicloLiquidacion>({ ciclo: 'mensual', dia: 'fin_mes', base_calculo: 'venta_bruta' })
  const [proxLiq, setProxLiq] = useState<string | null>(null)

  // Form para nueva regla de override por vendedor
  const [newVendedorId, setNewVendedorId] = useState<string>('')
  const [newFamiliaId, setNewFamiliaId] = useState<string>('todas')
  const [newPorcentaje, setNewPorcentaje] = useState<string>('')

  const cargar = useCallback(async () => {
    setLoading(true)
    const [famRes, vendRes, regRes, cfgRes, proxRes] = await Promise.all([
      (supabase as any).from('familias').select('id, nombre').eq('activo', true).order('nombre'),
      (supabase as any).from('profiles').select('id, full_name').eq('role', 'vendedor').eq('activo', true).order('full_name'),
      (supabase as any).from('comisiones_reglas')
        .select(`
          id, vendedor_id, familia_id, porcentaje, monto_fijo, objetivo_mensual, activo,
          profiles:profiles!comisiones_reglas_vendedor_id_fkey(full_name),
          familias(nombre)
        `)
        .eq('activo', true),
      (supabase as any).from('configuracion').select('clave, valor').in('clave', [
        'comisiones.ciclo_liquidacion', 'comisiones.dia_liquidacion', 'comisiones.base_calculo',
      ]),
      (supabase.rpc as any)('proxima_liquidacion_comisiones'),
    ])
    setFamilias((famRes.data ?? []) as Familia[])
    setVendedores((vendRes.data ?? []) as Vendedor[])
    const rs: Regla[] = (regRes.data ?? []).map((r: any) => ({
      id: r.id,
      vendedor_id: r.vendedor_id,
      familia_id: r.familia_id,
      porcentaje: r.porcentaje !== null ? Number(r.porcentaje) : null,
      monto_fijo: r.monto_fijo !== null ? Number(r.monto_fijo) : null,
      objetivo_mensual: r.objetivo_mensual !== null ? Number(r.objetivo_mensual) : null,
      activo: r.activo,
      vendedor_nombre: r.profiles?.full_name ?? null,
      familia_nombre: r.familias?.nombre ?? null,
    }))
    setReglas(rs)
    // Carga ciclo de liquidación
    const cfgMap = new Map<string, string>()
    ;((cfgRes.data ?? []) as any[]).forEach((c) => cfgMap.set(c.clave, c.valor))
    setCiclo({
      ciclo: (cfgMap.get('comisiones.ciclo_liquidacion') as any) ?? 'mensual',
      dia: cfgMap.get('comisiones.dia_liquidacion') ?? 'fin_mes',
      base_calculo: (cfgMap.get('comisiones.base_calculo') as any) ?? 'venta_bruta',
    })
    setProxLiq(proxRes.data ?? null)
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  // Defaults por familia: una regla por cada familia (vendedor_id NULL)
  const reglasDefault = reglas.filter((r) => r.vendedor_id === null)
  const reglasOverride = reglas.filter((r) => r.vendedor_id !== null)

  // Mapa familia → regla default actual
  const defaultPorFamilia = new Map<string | null, Regla>()
  reglasDefault.forEach((r) => defaultPorFamilia.set(r.familia_id, r))

  async function guardarDefault(familiaId: string | null, porcentajeStr: string, objetivoStr: string) {
    const porcentaje = parseFloat(porcentajeStr)
    if (isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      toast.error('Porcentaje inválido', { description: 'Ingresa un número entre 0 y 100.' })
      return
    }
    // Objetivo es opcional (referencia)
    const objetivo_mensual = objetivoStr.trim() === '' ? null : parseFloat(objetivoStr)
    if (objetivo_mensual !== null && (isNaN(objetivo_mensual) || objetivo_mensual < 0)) {
      toast.error('Objetivo mensual inválido')
      return
    }
    setSaving(true)
    const existente = defaultPorFamilia.get(familiaId)
    if (existente) {
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .update({ porcentaje, monto_fijo: null, objetivo_mensual })
        .eq('id', existente.id)
      if (error) {
        toast.error('No se pudo actualizar', { description: error.message })
        setSaving(false); return
      }
    } else {
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .insert({ vendedor_id: null, familia_id: familiaId, porcentaje, monto_fijo: null, objetivo_mensual, activo: true })
      if (error) {
        toast.error('No se pudo crear', { description: error.message })
        setSaving(false); return
      }
    }
    toast.success('Comisión guardada')
    setSaving(false)
    cargar()
  }

  async function guardarCiclo(nuevo: CicloLiquidacion) {
    setSaving(true)
    const entries = [
      { clave: 'comisiones.ciclo_liquidacion', valor: nuevo.ciclo },
      { clave: 'comisiones.dia_liquidacion', valor: nuevo.dia },
      { clave: 'comisiones.base_calculo', valor: nuevo.base_calculo },
    ]
    for (const e of entries) {
      await (supabase as any).from('configuracion').upsert(e, { onConflict: 'clave' })
    }
    toast.success('Ciclo de liquidación actualizado')
    setSaving(false)
    cargar()
  }

  async function eliminarRegla(reglaId: string) {
    if (!confirm('¿Eliminar esta regla de comisión?')) return
    const { error } = await (supabase as any)
      .from('comisiones_reglas')
      .delete()
      .eq('id', reglaId)
    if (error) {
      toast.error('No se pudo eliminar', { description: error.message })
      return
    }
    toast.success('Regla eliminada')
    cargar()
  }

  async function agregarOverride() {
    if (!newVendedorId) {
      toast.error('Selecciona un vendedor')
      return
    }
    const porcentaje = parseFloat(newPorcentaje)
    if (isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      toast.error('Porcentaje inválido', { description: 'Entre 0 y 100' })
      return
    }
    const familiaId = newFamiliaId === 'todas' ? null : newFamiliaId
    setSaving(true)
    // Si ya existe override para (vendedor, familia), actualizamos
    const existente = reglasOverride.find((r) =>
      r.vendedor_id === newVendedorId && r.familia_id === familiaId,
    )
    if (existente) {
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .update({ porcentaje, monto_fijo: null })
        .eq('id', existente.id)
      if (error) {
        toast.error('Error', { description: error.message })
        setSaving(false); return
      }
    } else {
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .insert({ vendedor_id: newVendedorId, familia_id: familiaId, porcentaje, monto_fijo: null, activo: true })
      if (error) {
        toast.error('Error', { description: error.message })
        setSaving(false); return
      }
    }
    toast.success('Override guardado')
    setNewVendedorId('')
    setNewFamiliaId('todas')
    setNewPorcentaje('')
    setSaving(false)
    cargar()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Percent className="w-6 h-6 text-blue-600" />
            Comisiones por Familia
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Configura el porcentaje de comisión que se aplica a cada familia de productos
          </p>
        </div>
      </div>

      {/* Aviso explicando prioridad */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Cómo se aplica la comisión:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Si el vendedor tiene una regla específica para esa familia → se usa esa</li>
            <li>Si no, se busca la regla global del vendedor (sin familia)</li>
            <li>Si no, se aplica el default de la familia (configurado abajo)</li>
            <li>Si no hay ninguna, esa venta NO genera comisión</li>
          </ol>
          <p className="mt-2"><strong>Objetivo mensual:</strong> es solo referencia visual — no bloquea el pago.</p>
        </div>
      </div>

      {/* Ciclo de liquidación */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ciclo de liquidación</CardTitle>
          <p className="text-xs text-gray-500">Cuándo y cómo se pagan las comisiones acumuladas.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Frecuencia</Label>
              <Select
                value={ciclo.ciclo}
                onValueChange={(v) => guardarCiclo({ ...ciclo, ciclo: v as any })}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensual">Mensual</SelectItem>
                  <SelectItem value="quincenal">Quincenal (15 y fin de mes)</SelectItem>
                  <SelectItem value="personalizado">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ciclo.ciclo !== 'quincenal' && (
              <div>
                <Label className="text-xs">Día de liquidación</Label>
                <Select
                  value={ciclo.dia}
                  onValueChange={(v) => guardarCiclo({ ...ciclo, dia: v })}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="fin_mes">Último día del mes</SelectItem>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>Día {d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Base de cálculo</Label>
              <Select
                value={ciclo.base_calculo}
                onValueChange={(v) => guardarCiclo({ ...ciclo, base_calculo: v as any })}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="venta_bruta">Venta bruta (subtotal sin IGV)</SelectItem>
                  <SelectItem value="venta_cobrada" disabled>Venta cobrada (próximamente)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs">
              <p className="font-semibold text-emerald-900">Próxima liquidación</p>
              <p className="text-emerald-700 font-mono mt-0.5">
                {proxLiq ? new Date(proxLiq + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'long' }) : '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="defaults">
        <TabsList>
          <TabsTrigger value="defaults">Por familia (defaults)</TabsTrigger>
          <TabsTrigger value="overrides">Por vendedor (overrides)</TabsTrigger>
        </TabsList>

        {/* DEFAULTS POR FAMILIA */}
        <TabsContent value="defaults" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comisión default por familia</CardTitle>
              <p className="text-xs text-gray-500">
                Aplica a todos los vendedores que no tengan un override específico.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr>
                    <th className="text-left p-3 font-semibold text-gray-600">Familia</th>
                    <th className="text-right p-3 font-semibold text-gray-600 w-32">% Comisión</th>
                    <th className="text-right p-3 font-semibold text-gray-600 w-40">Objetivo mensual (S/) <span className="text-[10px] font-normal text-gray-400 block">(referencia)</span></th>
                    <th className="text-center p-3 font-semibold text-gray-600 w-20">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <FamiliaDefaultRow
                    familia={{ id: null, nombre: '🌐 Default global (cualquier familia)' }}
                    reglaActual={defaultPorFamilia.get(null) ?? null}
                    onSave={(p, o) => guardarDefault(null, p, o)}
                    onDelete={(id) => eliminarRegla(id)}
                    saving={saving}
                  />
                  {familias.map((f) => (
                    <FamiliaDefaultRow
                      key={f.id}
                      familia={f}
                      reglaActual={defaultPorFamilia.get(f.id) ?? null}
                      onSave={(p, o) => guardarDefault(f.id, p, o)}
                      onDelete={(id) => eliminarRegla(id)}
                      saving={saving}
                    />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OVERRIDES POR VENDEDOR */}
        <TabsContent value="overrides" className="mt-4 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agregar override</CardTitle>
              <p className="text-xs text-gray-500">
                Para un vendedor específico, sobreescribe el default. Útil para
                vendedores estrella o casos especiales.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div>
                  <Label className="text-xs">Vendedor *</Label>
                  <Select value={newVendedorId} onValueChange={setNewVendedorId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                    <SelectContent>
                      {vendedores.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Familia</Label>
                  <Select value={newFamiliaId} onValueChange={setNewFamiliaId}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas (global del vendedor)</SelectItem>
                      {familias.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Porcentaje (%)</Label>
                  <Input type="number" step="0.01" min="0" max="100"
                    value={newPorcentaje} onChange={(e) => setNewPorcentaje(e.target.value)}
                    placeholder="Ej: 5.5" className="h-9" />
                </div>
                <Button onClick={agregarOverride} disabled={saving || !newVendedorId || !newPorcentaje}
                  className="h-9 gap-1 bg-blue-600 hover:bg-blue-700">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Agregar
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overrides actuales ({reglasOverride.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {reglasOverride.length === 0 ? (
                <p className="text-center py-6 text-gray-400 text-sm">
                  Sin overrides. Todos los vendedores usan los defaults por familia.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-y border-gray-200">
                    <tr>
                      <th className="text-left p-2 font-semibold text-gray-600">Vendedor</th>
                      <th className="text-left p-2 font-semibold text-gray-600">Familia</th>
                      <th className="text-right p-2 font-semibold text-gray-600 w-28">Porcentaje</th>
                      <th className="text-center p-2 font-semibold text-gray-600 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reglasOverride.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="p-2 font-medium">{r.vendedor_nombre ?? '—'}</td>
                        <td className="p-2 text-gray-700">{r.familia_nombre ?? '🌐 Todas las familias'}</td>
                        <td className="p-2 text-right font-mono font-semibold">{r.porcentaje?.toFixed(2)}%</td>
                        <td className="p-2 text-center">
                          <button onClick={() => eliminarRegla(r.id)}
                            className="text-red-600 hover:bg-red-50 rounded p-1" title="Eliminar override">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FamiliaDefaultRow({
  familia, reglaActual, onSave, onDelete, saving,
}: {
  familia: { id: string | null; nombre: string }
  reglaActual: Regla | null
  onSave: (porcentaje: string, objetivo: string) => void
  onDelete: (reglaId: string) => void
  saving: boolean
}) {
  const [editPct, setEditPct] = useState<string>(reglaActual?.porcentaje?.toString() ?? '')
  const [editObj, setEditObj] = useState<string>(reglaActual?.objetivo_mensual?.toString() ?? '')
  useEffect(() => {
    setEditPct(reglaActual?.porcentaje?.toString() ?? '')
    setEditObj(reglaActual?.objetivo_mensual?.toString() ?? '')
  }, [reglaActual?.porcentaje, reglaActual?.objetivo_mensual])

  const sinCambio = editPct === (reglaActual?.porcentaje?.toString() ?? '')
    && editObj === (reglaActual?.objetivo_mensual?.toString() ?? '')

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/40">
      <td className="p-3">
        <p className="font-medium text-gray-900">{familia.nombre}</p>
      </td>
      <td className="p-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Input
            type="number" step="0.01" min="0" max="100"
            value={editPct}
            onChange={(e) => setEditPct(e.target.value)}
            placeholder="—"
            className="w-20 h-8 text-right font-mono text-sm"
          />
          <span className="text-xs text-gray-500">%</span>
        </div>
      </td>
      <td className="p-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs text-gray-500">S/</span>
          <Input
            type="number" step="0.01" min="0"
            value={editObj}
            onChange={(e) => setEditObj(e.target.value)}
            placeholder="opcional"
            className="w-28 h-8 text-right font-mono text-sm"
          />
        </div>
      </td>
      <td className="p-3 text-center">
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => onSave(editPct, editObj)}
            disabled={saving || sinCambio || editPct === ''}
            className="text-blue-600 hover:bg-blue-50 disabled:text-gray-300 disabled:hover:bg-transparent rounded p-1"
            title={sinCambio ? 'Sin cambios' : 'Guardar'}
          >
            <Save className="w-3.5 h-3.5" />
          </button>
          {reglaActual && (
            <button
              onClick={() => onDelete(reglaActual.id)}
              className="text-red-600 hover:bg-red-50 rounded p-1"
              title="Eliminar regla"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
