'use client'

import { useEffect, useState, useMemo, useCallback, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Search, Users, Building2, UserCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'

type Tipo = 'cliente' | 'proveedor' | 'tercero'

const TABS: { key: Tipo; label: string; icon: any; color: string; ruta: string }[] = [
  { key: 'cliente', label: 'Clientes', icon: Users, color: 'text-blue-600', ruta: '/contabilidad/mayor-auxiliar/cliente' },
  { key: 'proveedor', label: 'Proveedores', icon: Building2, color: 'text-amber-600', ruta: '/contabilidad/mayor-auxiliar/proveedor' },
  { key: 'tercero', label: 'Terceros', icon: UserCircle2, color: 'text-purple-600', ruta: '/contabilidad/mayor-auxiliar/tercero' },
]

interface Entidad {
  id: string
  nombre: string
  doc: string | null
  saldo?: number
}

function MayorAuxHubInner() {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createClient()
  const [tipo, setTipo] = useState<Tipo>((params.get('tipo') as Tipo) || 'cliente')
  const [entidades, setEntidades] = useState<Entidad[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    if (tipo === 'cliente') {
      const { data } = await (supabase as any).from('clientes')
        .select('id, razon_social, ruc, dni')
        .eq('estado', 'activo')
        .order('razon_social')
      setEntidades(((data ?? []) as any[]).map((c) => ({
        id: c.id, nombre: c.razon_social, doc: c.ruc ?? c.dni ?? null,
      })))
    } else if (tipo === 'proveedor') {
      const { data } = await (supabase as any).from('proveedores')
        .select('id, razon_social, ruc')
        .eq('activo', true)
        .order('razon_social')
      setEntidades(((data ?? []) as any[]).map((p) => ({
        id: p.id, nombre: p.razon_social, doc: p.ruc,
      })))
    } else {
      const { data } = await (supabase as any).from('terceros')
        .select('id, nombres, apellidos, numero_doc, tipo_doc')
        .eq('activo', true)
        .order('nombres')
      setEntidades(((data ?? []) as any[]).map((t) => ({
        id: t.id,
        nombre: `${t.nombres} ${t.apellidos ?? ''}`.trim(),
        doc: `${t.tipo_doc} ${t.numero_doc}`,
      })))
    }
    setLoading(false)
  }, [supabase, tipo])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return entidades
    return entidades.filter((e) =>
      e.nombre.toLowerCase().includes(q) || (e.doc ?? '').toLowerCase().includes(q))
  }, [entidades, busqueda])

  const tabActual = TABS.find((t) => t.key === tipo)!

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mayores Auxiliares</h1>
          <p className="text-sm text-gray-500 mt-0.5">Movimientos contables por cliente, proveedor o tercero</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => {
          const activo = t.key === tipo
          return (
            <button key={t.key} onClick={() => setTipo(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activo
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <t.icon className={`w-4 h-4 ${activo ? '' : t.color}`} />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder={`Buscar ${tabActual.label.toLowerCase()}...`}
            className="pl-9"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : filtrados.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Sin resultados</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-600">Nombre</th>
                  <th className="text-left p-2 font-semibold text-gray-600 w-40">Documento</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-32">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((e) => (
                  <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="p-2 font-medium">{e.nombre}</td>
                    <td className="p-2 font-mono text-xs text-gray-600">{e.doc ?? '—'}</td>
                    <td className="p-2 text-right">
                      <Link href={`${tabActual.ruta}/${e.id}`}
                        className="text-xs px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded">
                        Ver mayor →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MayorAuxiliarHub() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <MayorAuxHubInner />
    </Suspense>
  )
}
