'use client'

import { useState, useEffect } from 'react'
import { Plus, Loader2, AlertCircle, CheckCircle, ArrowUpCircle, ArrowDownCircle, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import type { Producto, MovimientoStock } from '@/types'

type TipoAjuste = 'entrada' | 'salida'

interface AjusteConProducto extends MovimientoStock {
  producto_nombre?: string
  producto_codigo?: string
  usuario_nombre?: string
}

const motivosEntrada = [
  'Corrección de inventario',
  'Devolución de cliente',
  'Transferencia entre almacenes',
  'Producción',
  'Otro',
]

const motivosSalida = [
  'Merma / vencimiento',
  'Pérdida o robo',
  'Muestra o degustación',
  'Corrección de inventario',
  'Otro',
]

export default function AjustesInventarioPage() {
  const [ajustes, setAjustes] = useState<AjusteConProducto[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Formulario
  const [productoId, setProductoId] = useState('')
  const [tipo, setTipo] = useState<TipoAjuste>('entrada')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [motivoCustom, setMotivoCustom] = useState('')
  const [notas, setNotas] = useState('')
  // Solo entradas: lo que costó cada unidad (en producción, el costo de producirla).
  const [costoUnitario, setCostoUnitario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [mensajeExito, setMensajeExito] = useState<string | null>(null)
  const [requiereAprobacion, setRequiereAprobacion] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      setUserRole(profile?.role ?? null)

      await Promise.all([cargarAjustes(), cargarProductos()])
      setLoading(false)
    }
    init()
  }, [])

  async function cargarAjustes() {
    const { data } = await supabase
      .from('movimientos_stock')
      .select('*, productos(nombre, descripcion, codigo), profiles!created_by(full_name)')
      .in('tipo', ['ajuste', 'entrada', 'salida'])
      // Solo los ajustes: antes salían también las entradas de compras y las salidas de ventas.
      .eq('referencia_tipo', 'ajuste')
      .order('created_at', { ascending: false })
      .limit(50)

    const mapped = (data ?? []).map((m: any) => ({
      ...m,
      producto_nombre: m.productos?.descripcion?.trim() || m.productos?.nombre || '',
      producto_codigo: m.productos?.codigo ?? '',
      usuario_nombre: m.profiles?.full_name ?? '',
    }))

    setAjustes(mapped)
  }

  async function cargarProductos() {
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, descripcion, codigo, activo')
      .eq('activo', true)
      .order('nombre')

    setProductos((data ?? []) as Producto[])
  }

  // Verificar si requiere autorización (solo admin/gerente pueden hacer ajustes > cierta cantidad sin autorización)
  useEffect(() => {
    const cantNum = parseFloat(cantidad)
    const esRolRestringido = userRole !== 'administrador' && userRole !== 'gerente'
    // La producción del día es grande por naturaleza (cientos de hielos): no se marca.
    setRequiereAprobacion(esRolRestringido && cantNum > 50 && motivo !== 'Producción')
  }, [cantidad, userRole, motivo])

  function resetForm() {
    setProductoId('')
    setTipo('entrada')
    setCantidad('')
    setMotivo('')
    setMotivoCustom('')
    setNotas('')
    setCostoUnitario('')
    setFormError(null)
  }

  async function enviarAjuste() {
    if (!productoId || !cantidad || !motivo) {
      setFormError('Completa todos los campos requeridos')
      return
    }
    if (parseFloat(cantidad) <= 0) {
      setFormError('La cantidad debe ser mayor a 0')
      return
    }

    setEnviando(true)
    setFormError(null)

    try {
      const motivoFinal = motivo === 'Otro' ? (motivoCustom || 'Sin especificar') : motivo
      const notasFinal = [
        notas || '',
        requiereAprobacion ? '[REQUIERE APROBACIÓN ADMIN]' : '',
      ].filter(Boolean).join(' | ')
      const costo = tipo === 'entrada' && costoUnitario.trim() !== '' ? parseFloat(costoUnitario) : null

      // Movimiento y stock juntos, en la base (migración 129). Antes se insertaba
      // solo el movimiento y el stock no cambiaba.
      const { data: res, error } = await (supabase.rpc as any)('registrar_ajuste_inventario', {
        p_producto_id: productoId,
        p_tipo: tipo,
        p_cantidad: Math.abs(parseFloat(cantidad)),
        p_motivo: motivoFinal,
        p_notas: notasFinal || null,
        p_costo_unitario: costo,
      })

      if (error) {
        setFormError('Error al guardar el ajuste: ' + error.message)
        toast.error('Error al registrar ajuste', { description: error.message })
        return
      }

      const stockNuevo = res?.stock != null ? ` · Stock ahora: ${Number(res.stock).toLocaleString('es-PE')}` : ''
      const mensaje = requiereAprobacion
        ? `Ajuste registrado y marcado para revisión del administrador${stockNuevo}`
        : `Ajuste de inventario registrado${stockNuevo}`
      setMensajeExito(mensaje)
      toast.success('Ajuste registrado', { description: mensaje })
      setDialogOpen(false)
      resetForm()
      await cargarAjustes()
    } catch {
      setFormError('Error inesperado al guardar el ajuste')
      toast.error('Error inesperado', { description: 'No se pudo guardar el ajuste.' })
    } finally {
      setEnviando(false)
    }
  }

  const tipoConfig = {
    entrada: { label: 'Entrada', color: 'bg-green-100 text-green-700', icon: ArrowUpCircle },
    salida: { label: 'Salida', color: 'bg-red-100 text-red-700', icon: ArrowDownCircle },
    ajuste: { label: 'Ajuste', color: 'bg-blue-100 text-blue-700', icon: SlidersHorizontal },
    devolucion: { label: 'Devolución', color: 'bg-purple-100 text-purple-700', icon: ArrowDownCircle },
  }

  const puedeCrearAjuste = ['administrador', 'gerente', 'almacenero'].includes(userRole ?? '')
  const motivosDisponibles = tipo === 'entrada' ? motivosEntrada : motivosSalida

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ajustes de Inventario</h1>
          <p className="text-gray-500 text-sm mt-1">
            Registra entradas, salidas y correcciones de stock
          </p>
        </div>
        {puedeCrearAjuste && (
          <Button
            onClick={() => { resetForm(); setDialogOpen(true) }}
            className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold"
          >
            <Plus className="w-4 h-4" />
            Nuevo Ajuste
          </Button>
        )}
      </div>

      {/* Mensaje de éxito */}
      {mensajeExito && (
        <div className="bg-green-50 border border-green-200 text-green-700 flex items-center gap-2 px-4 py-3 rounded-lg">
          <CheckCircle className="w-4 h-4 shrink-0" />
          {mensajeExito}
          <button onClick={() => setMensajeExito(null)} className="ml-auto text-green-500 hover:text-green-700">✕</button>
        </div>
      )}

      {/* Tabla de ajustes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de Ajustes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : ajustes.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <SlidersHorizontal className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Sin ajustes registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ajustes.map((ajuste) => {
                    const config = tipoConfig[ajuste.tipo as keyof typeof tipoConfig] ?? tipoConfig.ajuste
                    const cantidadAbs = Math.abs(ajuste.cantidad)
                    const esSalida = ajuste.cantidad < 0 || ajuste.tipo === 'salida'
                    const requiereAprobacion = ajuste.notas?.includes('[REQUIERE APROBACIÓN ADMIN]') ?? false

                    return (
                      <TableRow key={ajuste.id}>
                        <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                          {formatDate(ajuste.created_at)}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-gray-900 text-sm">{ajuste.producto_nombre}</div>
                          {ajuste.producto_codigo && (
                            <div className="text-xs text-gray-400">{ajuste.producto_codigo}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${config.color}`}>
                            <config.icon className="w-3 h-3" />
                            {config.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-gray-900">
                          {esSalida ? '-' : '+'}{cantidadAbs}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 max-w-[180px] truncate">
                          {ajuste.notas ?? '-'}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {ajuste.usuario_nombre ?? '-'}
                        </TableCell>
                        <TableCell>
                          {requiereAprobacion ? (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                              Pendiente aprobación
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                              Aplicado
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog nuevo ajuste */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo Ajuste de Inventario</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 flex items-center gap-2 px-3 py-2 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}

            {/* Tipo de ajuste */}
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <div className="flex gap-2">
                {(['entrada', 'salida'] as TipoAjuste[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTipo(t); setMotivo('') }}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                      tipo === t
                        ? t === 'entrada'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {t === 'entrada' ? '↑ Entrada' : '↓ Salida'}
                  </button>
                ))}
              </div>
            </div>

            {/* Producto */}
            <div className="space-y-1.5">
              <Label>Producto *</Label>
              <Select value={productoId} onValueChange={setProductoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto..." />
                </SelectTrigger>
                <SelectContent>
                  {productos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {(p as any).descripcion?.trim() || p.nombre} {p.codigo ? `(${p.codigo})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Cantidad */}
            <div className="space-y-1.5">
              <Label>Cantidad *</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              {requiereAprobacion && (
                <p className="text-xs text-amber-700 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Más de 50 unidades: queda marcado para revisión del administrador
                </p>
              )}
            </div>

            {/* Motivo */}
            <div className="space-y-1.5">
              <Label>Motivo *</Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar motivo..." />
                </SelectTrigger>
                <SelectContent>
                  {motivosDisponibles.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {motivo === 'Otro' && (
                <Input
                  placeholder="Especifica el motivo..."
                  value={motivoCustom}
                  onChange={(e) => setMotivoCustom(e.target.value)}
                />
              )}
            </div>

            {/* Costo unitario (solo entradas) */}
            {tipo === 'entrada' && (
              <div className="space-y-1.5" data-costo-ajuste>
                <Label>Costo unitario (opcional)</Label>
                <Input type="number" min="0" step="0.01" placeholder="Vacío = no cambia el costo"
                  value={costoUnitario} onChange={(e) => setCostoUnitario(e.target.value)} />
                <p className="text-[11px] text-gray-500">
                  {motivo === 'Producción'
                    ? 'Lo que cuesta producir una unidad (insumos, envase). Se promedia con el costo actual, como una compra.'
                    : 'Si lo indicas, se promedia con el costo actual. Si lo dejas vacío, el costo no cambia.'}
                </p>
              </div>
            )}

            {/* Notas */}
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <textarea
                placeholder="Observaciones adicionales..."
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" onClick={resetForm}>
                Cancelar
              </Button>
            </DialogClose>
            <Button
              onClick={enviarAjuste}
              disabled={enviando || !productoId || !cantidad || !motivo}
              className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold"
            >
              {enviando ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : requiereAprobacion ? (
                'Enviar para Aprobación'
              ) : (
                'Registrar Ajuste'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
