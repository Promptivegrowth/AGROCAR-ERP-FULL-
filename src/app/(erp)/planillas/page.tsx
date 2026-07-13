'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Users, Calculator, Settings2, CalendarClock, Loader2, ChevronRight, Wallet, Gift } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

export default function PlanillasHub() {
  const supabase = createClient()
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ count: activos }, { data: ultimaPlanilla }, { data: params }] = await Promise.all([
      (supabase as any).from('trabajadores').select('id', { count: 'exact', head: true }).eq('estado', 'activo'),
      (supabase as any).from('planillas').select('*').order('anio', { ascending: false }).order('mes', { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from('parametros_planilla').select('clave, valor').eq('anio', new Date().getFullYear()),
    ])
    const paramMap = new Map<string, number>()
    ;((params ?? []) as any[]).forEach((p) => paramMap.set(p.clave, Number(p.valor)))
    setStats({
      activos: activos ?? 0,
      ultimaPlanilla,
      uit: paramMap.get('uit'),
      rmv: paramMap.get('rmv'),
    })
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const MODULOS = [
    {
      href: '/planillas/trabajadores',
      title: 'Trabajadores',
      description: 'Alta, cese y reingreso · contratos · régimen ONP/AFP · asignación familiar.',
      icon: Users,
      color: 'bg-blue-600',
    },
    {
      href: '/planillas/calculo',
      title: 'Planilla Mensual',
      description: 'Calcula sueldos, horas extras, aportes y descuentos · cierre inmutable con asiento automático.',
      icon: Calculator,
      color: 'bg-emerald-600',
    },
    {
      href: '/planillas/beneficios',
      title: 'Beneficios Sociales',
      description: 'Provisiones mensuales CTS/gratificación/vacaciones · goce vacacional · liquidación de cese.',
      icon: Gift,
      color: 'bg-pink-600',
    },
    {
      href: '/planillas/conceptos',
      title: 'Conceptos Remunerativos',
      description: 'Ingresos, descuentos y aportes · cada uno con su cuenta contable y afectaciones.',
      icon: Settings2,
      color: 'bg-purple-600',
    },
    {
      href: '/planillas/parametros',
      title: 'Parámetros del Año',
      description: 'UIT, RMV, tasas EsSalud/ONP · actualizables cada año sin tocar código.',
      icon: CalendarClock,
      color: 'bg-amber-600',
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Wallet className="w-8 h-8 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Planillas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Remuneraciones según normativa laboral peruana · D.L. 728 régimen general
          </p>
        </div>
      </div>

      {/* Estado rápido */}
      {loading ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500 uppercase font-semibold">Trabajadores activos</p>
            <p className="text-2xl font-bold">{stats.activos}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500 uppercase font-semibold">Última planilla</p>
            {stats.ultimaPlanilla ? (
              <>
                <p className="text-sm font-bold">{MESES[stats.ultimaPlanilla.mes - 1]} {stats.ultimaPlanilla.anio}</p>
                <p className="text-[10px] text-gray-400 capitalize">{stats.ultimaPlanilla.estado} · {formatCurrency(stats.ultimaPlanilla.total_neto)}</p>
              </>
            ) : <p className="text-sm text-gray-400">—</p>}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-[10px] text-blue-700 uppercase font-semibold">UIT {new Date().getFullYear()}</p>
            <p className="text-2xl font-bold text-blue-900">{stats.uit ? formatCurrency(stats.uit) : '⚠ falta'}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-[10px] text-emerald-700 uppercase font-semibold">RMV vigente</p>
            <p className="text-2xl font-bold text-emerald-900">{stats.rmv ? formatCurrency(stats.rmv) : '⚠ falta'}</p>
          </div>
        </div>
      )}

      {/* Flujo sugerido */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex items-center gap-2 flex-wrap">
        <strong>Flujo mensual:</strong>
        <span className="inline-flex items-center gap-1">1. Registrar trabajadores <ChevronRight className="w-3 h-3" /></span>
        <span className="inline-flex items-center gap-1">2. Ingresar horas extras <ChevronRight className="w-3 h-3" /></span>
        <span className="inline-flex items-center gap-1">3. Calcular planilla <ChevronRight className="w-3 h-3" /></span>
        <span className="inline-flex items-center gap-1">4. Revisar y cerrar <ChevronRight className="w-3 h-3" /></span>
        <span>5. El asiento contable se genera solo</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MODULOS.map((m) => (
          <Link key={m.href} href={m.href}
            className="block bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-emerald-300 transition-all">
            <div className={`w-10 h-10 rounded-lg ${m.color} flex items-center justify-center mb-3`}>
              <m.icon className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-bold text-gray-900">{m.title}</h3>
            <p className="text-xs text-gray-500 mt-1 leading-snug">{m.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
