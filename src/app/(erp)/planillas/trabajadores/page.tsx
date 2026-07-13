'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Search, Users, Edit2, UserMinus, UserCheck, Baby } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface Trabajador {
  id: string
  codigo: string
  tipo_doc: string
  numero_doc: string
  nombres: string
  apellido_paterno: string
  apellido_materno: string | null
  cargo: string | null
  area: string | null
  fecha_ingreso: string
  sueldo_base: number
  regimen_pension: 'onp' | 'afp'
  afp_nombre: string | null
  tiene_hijos: boolean
  estado: string
  fecha_cese: string | null
  centro_costo_id: string | null
  telefono: string | null
  cuenta_bancaria: string | null
  banco: string | null
}

interface CentroCosto { id: string; codigo: string; nombre: string }

const AFPS = ['Integra', 'Prima', 'Habitat', 'Profuturo']
const AREAS = ['Administración', 'Ventas', 'Almacén', 'Reparto', 'Gerencia']

const FORM_VACIO = {
  codigo: '', tipo_doc: 'DNI', numero_doc: '', nombres: '',
  apellido_paterno: '', apellido_materno: '',
  cargo: '', area: 'Ventas', centro_costo_id: '',
  fecha_ingreso: hoyLima(), sueldo_base: '',
  regimen_pension: 'onp' as 'onp' | 'afp', afp_nombre: 'Integra',
  tiene_hijos: false, telefono: '',
  cuenta_bancaria: '', banco: 'BCP',
}

export default function TrabajadoresPage() {
  const router = useRouter()
  const supabase = createClient()
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([])
  const [centros, setCentros] = useState<CentroCosto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'activo' | 'cesado' | 'todos'>('activo')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Trabajador | null>(null)
  const [form, setForm] = useState(FORM_VACIO)

  // Cese
  const [ceseOpen, setCeseOpen] = useState(false)
  const [ceseTrab, setCeseTrab] = useState<Trabajador | null>(null)
  const [ceseFecha, setCeseFecha] = useState(hoyLima())
  const [ceseMotivo, setCeseMotivo] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: ts }, { data: ccs }] = await Promise.all([
      (supabase as any).from('trabajadores').select('*').order('codigo'),
      (supabase as any).from('centros_costo').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    ])
    setTrabajadores((ts ?? []) as Trabajador[])
    setCentros((ccs ?? []) as CentroCosto[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = useMemo(() => {
    let r = trabajadores
    if (filtroEstado !== 'todos') r = r.filter((t) => t.estado === filtroEstado)
    const q = busqueda.trim().toLowerCase()
    if (q) {
      r = r.filter((t) =>
        `${t.nombres} ${t.apellido_paterno} ${t.apellido_materno ?? ''}`.toLowerCase().includes(q) ||
        t.numero_doc.includes(q) || t.codigo.toLowerCase().includes(q))
    }
    return r
  }, [trabajadores, busqueda, filtroEstado])

  const abrirNuevo = () => {
    setEditing(null)
    const next = trabajadores.length + 1
    setForm({ ...FORM_VACIO, codigo: `TR-${String(next).padStart(3, '0')}` })
    setOpen(true)
  }

  const abrirEditar = (t: Trabajador) => {
    setEditing(t)
    setForm({
      codigo: t.codigo, tipo_doc: t.tipo_doc, numero_doc: t.numero_doc,
      nombres: t.nombres, apellido_paterno: t.apellido_paterno, apellido_materno: t.apellido_materno ?? '',
      cargo: t.cargo ?? '', area: t.area ?? 'Ventas', centro_costo_id: t.centro_costo_id ?? '',
      fecha_ingreso: t.fecha_ingreso, sueldo_base: t.sueldo_base.toString(),
      regimen_pension: t.regimen_pension, afp_nombre: t.afp_nombre ?? 'Integra',
      tiene_hijos: t.tiene_hijos, telefono: t.telefono ?? '',
      cuenta_bancaria: t.cuenta_bancaria ?? '', banco: t.banco ?? 'BCP',
    })
    setOpen(true)
  }

  const guardar = async () => {
    // Validaciones profesionales
    if (!form.numero_doc.trim()) { toast.error('Número de documento obligatorio'); return }
    if (form.tipo_doc === 'DNI' && !/^\d{8}$/.test(form.numero_doc.trim())) {
      toast.error('DNI inválido', { description: 'Debe tener exactamente 8 dígitos' }); return
    }
    if (!form.nombres.trim() || !form.apellido_paterno.trim()) {
      toast.error('Nombres y apellido paterno obligatorios'); return
    }
    const sueldo = parseFloat(form.sueldo_base)
    if (isNaN(sueldo) || sueldo <= 0) { toast.error('Sueldo inválido'); return }
    if (sueldo < 1130) {
      toast.warning('Sueldo por debajo de la RMV (S/ 1,130)', {
        description: 'Verifica si es tiempo parcial. Se guardará de todos modos.',
      })
    }

    setSaving(true)
    const payload = {
      codigo: form.codigo.trim(),
      tipo_doc: form.tipo_doc,
      numero_doc: form.numero_doc.trim(),
      nombres: form.nombres.trim().toUpperCase(),
      apellido_paterno: form.apellido_paterno.trim().toUpperCase(),
      apellido_materno: form.apellido_materno.trim().toUpperCase() || null,
      cargo: form.cargo.trim() || null,
      area: form.area,
      centro_costo_id: form.centro_costo_id || null,
      fecha_ingreso: form.fecha_ingreso,
      sueldo_base: sueldo,
      regimen_pension: form.regimen_pension,
      afp_nombre: form.regimen_pension === 'afp' ? form.afp_nombre : null,
      tiene_hijos: form.tiene_hijos,
      telefono: form.telefono.trim() || null,
      cuenta_bancaria: form.cuenta_bancaria.trim() || null,
      banco: form.banco || null,
    }
    const { error } = editing
      ? await (supabase as any).from('trabajadores').update(payload).eq('id', editing.id)
      : await (supabase as any).from('trabajadores').insert(payload)
    setSaving(false)
    if (error) {
      const desc = error.message.includes('uniq_trabajador_doc')
        ? 'Ya existe un trabajador con ese documento'
        : error.message
      toast.error('Error al guardar', { description: desc }); return
    }
    toast.success(editing ? 'Trabajador actualizado' : `${form.nombres} registrado`, {
      description: editing ? undefined : 'Ya entra en el cálculo de la próxima planilla.',
    })
    setOpen(false)
    cargar()
  }

  const cesar = async () => {
    if (!ceseTrab) return
    if (ceseMotivo.trim().length < 5) { toast.error('Motivo de cese requerido (mín 5 caracteres)'); return }
    setSaving(true)
    const { error } = await (supabase as any).from('trabajadores')
      .update({ estado: 'cesado', fecha_cese: ceseFecha, motivo_cese: ceseMotivo })
      .eq('id', ceseTrab.id)
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(`${ceseTrab.nombres} cesado`, {
      description: 'Recuerda generar su liquidación de beneficios sociales.',
    })
    setCeseOpen(false)
    cargar()
  }

  const reingresar = async (t: Trabajador) => {
    if (!confirm(`¿Reingresar a ${t.nombres} ${t.apellido_paterno}? Volverá a entrar en las planillas.`)) return
    const { error } = await (supabase as any).from('trabajadores')
      .update({ estado: 'activo', fecha_cese: null, motivo_cese: null, fecha_ingreso: hoyLima() })
      .eq('id', t.id)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Trabajador reingresado', { description: 'Fecha de ingreso actualizada a hoy (nuevo período computable).' })
    cargar()
  }

  const activos = trabajadores.filter((t) => t.estado === 'activo')
  const masaSalarial = activos.reduce((a, t) => a + Number(t.sueldo_base), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-600" />
            Trabajadores
          </h1>
          <p className="text-sm text-gray-500">
            {activos.length} activos · masa salarial {formatCurrency(masaSalarial)}/mes
          </p>
        </div>
        <Button onClick={abrirNuevo} className="bg-blue-600 hover:bg-blue-700 gap-1">
          <Plus className="w-4 h-4" /> Nuevo trabajador
        </Button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, DNI o código..." className="pl-9 h-9" />
        </div>
        <div className="flex gap-1">
          {(['activo', 'cesado', 'todos'] as const).map((e) => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              className={`px-3 py-1.5 text-xs font-semibold rounded capitalize ${
                filtroEstado === e ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}>
              {e === 'todos' ? 'Todos' : `${e}s`}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">{busqueda ? 'Sin coincidencias' : 'Sin trabajadores registrados'}</p>
            {!busqueda && <p className="text-gray-400 text-xs mt-1">Registra al personal para poder calcular planillas.</p>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-20">Código</th>
                <th className="text-left p-2 font-semibold text-gray-600">Trabajador</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Cargo / Área</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Ingreso</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Sueldo</th>
                <th className="text-center p-2 font-semibold text-gray-600 w-24">Pensión</th>
                <th className="text-center p-2 font-semibold text-gray-600 w-20">Estado</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => (
                <tr key={t.id} className={`border-b border-gray-100 hover:bg-gray-50/60 ${t.estado === 'cesado' ? 'opacity-60' : ''}`}>
                  <td className="p-2 font-mono text-xs font-bold">{t.codigo}</td>
                  <td className="p-2">
                    <p className="font-medium flex items-center gap-1">
                      {t.nombres} {t.apellido_paterno} {t.apellido_materno ?? ''}
                      {t.tiene_hijos && <Baby className="w-3 h-3 text-pink-500" aria-label="Con asignación familiar" />}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono">{t.tipo_doc} {t.numero_doc}</p>
                  </td>
                  <td className="p-2 text-xs">
                    <p>{t.cargo ?? '—'}</p>
                    <p className="text-gray-400">{t.area}</p>
                  </td>
                  <td className="p-2 font-mono text-xs">{formatDate(t.fecha_ingreso)}</td>
                  <td className="p-2 text-right font-mono font-semibold">{formatCurrency(t.sueldo_base)}</td>
                  <td className="p-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      t.regimen_pension === 'onp' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {t.regimen_pension === 'onp' ? 'ONP' : `AFP ${t.afp_nombre ?? ''}`}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      t.estado === 'activo' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {t.estado.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => abrirEditar(t)} className="text-gray-500 hover:bg-gray-100 rounded p-1" title="Editar">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {t.estado === 'activo' ? (
                        <button onClick={() => { setCeseTrab(t); setCeseFecha(hoyLima()); setCeseMotivo(''); setCeseOpen(true) }}
                          className="text-red-500 hover:bg-red-50 rounded p-1" title="Cesar trabajador">
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => reingresar(t)} className="text-green-600 hover:bg-green-50 rounded p-1" title="Reingresar">
                          <UserCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Dialog nuevo/editar — organizado en secciones */}
      <Dialog open={open} onOpenChange={(o) => { if (!saving) setOpen(o) }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar trabajador' : 'Nuevo trabajador'}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Sección 1: Identificación */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">1 · Identificación</p>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Código</Label>
                  <Input value={form.codigo} disabled className="mt-1 font-mono bg-gray-50" />
                </div>
                <div>
                  <Label className="text-xs">Tipo doc.</Label>
                  <select value={form.tipo_doc} onChange={(e) => setForm((f) => ({ ...f, tipo_doc: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                    <option value="DNI">DNI</option><option value="CE">CE</option><option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Número documento *</Label>
                  <Input value={form.numero_doc} onChange={(e) => setForm((f) => ({ ...f, numero_doc: e.target.value.replace(/\D/g, '') }))}
                    className="mt-1 font-mono" maxLength={form.tipo_doc === 'DNI' ? 8 : 12} disabled={!!editing} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <Label className="text-xs">Nombres *</Label>
                  <Input value={form.nombres} onChange={(e) => setForm((f) => ({ ...f, nombres: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Apellido paterno *</Label>
                  <Input value={form.apellido_paterno} onChange={(e) => setForm((f) => ({ ...f, apellido_paterno: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Apellido materno</Label>
                  <Input value={form.apellido_materno} onChange={(e) => setForm((f) => ({ ...f, apellido_materno: e.target.value }))} className="mt-1" />
                </div>
              </div>
            </div>

            {/* Sección 2: Datos laborales */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">2 · Datos laborales</p>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Cargo</Label>
                  <Input value={form.cargo} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))}
                    className="mt-1" placeholder="Ej: Repartidor" />
                </div>
                <div>
                  <Label className="text-xs">Área</Label>
                  <select value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                    {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Centro de costo</Label>
                  <select value={form.centro_costo_id} onChange={(e) => setForm((f) => ({ ...f, centro_costo_id: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                    <option value="">— Sin CC —</option>
                    {centros.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Fecha ingreso *</Label>
                  <Input type="date" value={form.fecha_ingreso}
                    onChange={(e) => setForm((f) => ({ ...f, fecha_ingreso: e.target.value }))} className="mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3 items-end">
                <div>
                  <Label className="text-xs">Sueldo base mensual (S/) *</Label>
                  <Input type="number" step="0.01" min="0" value={form.sueldo_base}
                    onChange={(e) => setForm((f) => ({ ...f, sueldo_base: e.target.value }))}
                    className="mt-1 font-mono" placeholder="1130.00" />
                </div>
                <label className="flex items-center gap-2 h-9 cursor-pointer">
                  <input type="checkbox" checked={form.tiene_hijos}
                    onChange={(e) => setForm((f) => ({ ...f, tiene_hijos: e.target.checked }))}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm flex items-center gap-1">
                    <Baby className="w-3.5 h-3.5 text-pink-500" /> Tiene hijos menores
                  </span>
                </label>
                {form.tiene_hijos && (
                  <p className="text-[10px] text-emerald-700 bg-emerald-50 rounded px-2 py-1.5">
                    ✓ Recibirá asignación familiar (10% de RMV = S/ 113.00)
                  </p>
                )}
              </div>
            </div>

            {/* Sección 3: Régimen pensionario */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">3 · Régimen pensionario</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex gap-1">
                  <button type="button" onClick={() => setForm((f) => ({ ...f, regimen_pension: 'onp' }))}
                    className={`flex-1 h-10 text-sm font-semibold rounded-md ${
                      form.regimen_pension === 'onp' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                    ONP (13%)
                  </button>
                  <button type="button" onClick={() => setForm((f) => ({ ...f, regimen_pension: 'afp' }))}
                    className={`flex-1 h-10 text-sm font-semibold rounded-md ${
                      form.regimen_pension === 'afp' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                    AFP (~13.3%)
                  </button>
                </div>
                {form.regimen_pension === 'afp' && (
                  <div>
                    <select value={form.afp_nombre} onChange={(e) => setForm((f) => ({ ...f, afp_nombre: e.target.value }))}
                      className="w-full h-10 px-2 text-sm border border-gray-200 rounded-md bg-white">
                      {AFPS.map((a) => <option key={a} value={a}>AFP {a}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Sección 4: Pago */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">4 · Datos de pago (opcional)</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Teléfono</Label>
                  <Input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} className="mt-1 font-mono" />
                </div>
                <div>
                  <Label className="text-xs">Banco</Label>
                  <select value={form.banco} onChange={(e) => setForm((f) => ({ ...f, banco: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                    <option>BCP</option><option>BBVA</option><option>Interbank</option><option>Scotiabank</option><option>BN</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Cuenta bancaria</Label>
                  <Input value={form.cuenta_bancaria} onChange={(e) => setForm((f) => ({ ...f, cuenta_bancaria: e.target.value }))}
                    className="mt-1 font-mono" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? 'Guardar cambios' : 'Registrar trabajador'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog cese */}
      <Dialog open={ceseOpen} onOpenChange={setCeseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Cesar trabajador</DialogTitle></DialogHeader>
          {ceseTrab && (
            <div className="space-y-3 mt-2">
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                <p className="font-semibold text-red-900">{ceseTrab.nombres} {ceseTrab.apellido_paterno}</p>
                <p className="text-xs text-red-700 mt-0.5">
                  Ingresó el {formatDate(ceseTrab.fecha_ingreso)} · dejará de entrar en planillas
                </p>
              </div>
              <div>
                <Label className="text-xs">Fecha de cese *</Label>
                <Input type="date" value={ceseFecha} onChange={(e) => setCeseFecha(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Motivo *</Label>
                <Input value={ceseMotivo} onChange={(e) => setCeseMotivo(e.target.value)}
                  className="mt-1" placeholder="Ej: renuncia voluntaria, fin de contrato..." />
              </div>
              <p className="text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                ⚠ Recuerda calcular su liquidación: vacaciones truncas, gratificación trunca y CTS trunca.
              </p>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setCeseOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={cesar} disabled={saving} className="bg-red-600 hover:bg-red-700">
                  {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Confirmar cese
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
