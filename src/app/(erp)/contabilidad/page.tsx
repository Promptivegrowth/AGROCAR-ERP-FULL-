'use client'

import Link from 'next/link'
import { Calculator, BookOpen, FileText, BarChart3, Lock, ScrollText, Zap, TrendingUp, Users } from 'lucide-react'

/**
 * Hub del módulo Contabilidad.
 *
 * Plan: PCGE Modificado vigente (Resolución CNC N° 002-2019-EF/30, vigente
 * desde 01/01/2020) + estructura PLE para cumplimiento SIRE/SUNAT.
 *
 * Próximas iteraciones (commits separados):
 * - Asientos automáticos desde ventas/compras/cobros (commit 2)
 * - Libro Mayor por cuenta + Balance de Comprobación (commit 3)
 * - Estado de Resultados + Balance General (commit 3)
 */

const MODULOS = [
  {
    href: '/contabilidad/cuentas',
    title: 'Plan de Cuentas',
    description: 'PCGE Modificado · 142 cuentas precargadas según norma vigente. Agregar subcuentas personalizadas.',
    icon: BookOpen,
    color: 'bg-blue-600',
  },
  {
    href: '/contabilidad/diario',
    title: 'Libro Diario',
    description: 'Asientos contables manuales con validación de cuadre (debe = haber).',
    icon: ScrollText,
    color: 'bg-emerald-600',
  },
  {
    href: '/contabilidad/automaticos',
    title: 'Asientos Automáticos',
    description: 'Genera asientos desde transacciones operativas (ventas, cobros, compras). Quedan en borrador para revisión.',
    icon: Zap,
    color: 'bg-yellow-500',
  },
  {
    href: '/contabilidad/mayor',
    title: 'Libro Mayor',
    description: 'Vista por cuenta · todos sus asientos · saldo acumulado.',
    icon: FileText,
    color: 'bg-purple-600',
  },
  {
    href: '/contabilidad/mayor-auxiliar',
    title: 'Mayores Auxiliares',
    description: 'Movimientos por cliente, proveedor o tercero — anexos SUNAT/PLE.',
    icon: Users,
    color: 'bg-indigo-600',
  },
  {
    href: '/contabilidad/balance',
    title: 'Balance de Comprobación',
    description: 'Sumas y saldos por cuenta · validación general de la contabilidad.',
    icon: BarChart3,
    color: 'bg-amber-600',
  },
  {
    href: '/contabilidad/estado-resultados',
    title: 'Estado de Resultados',
    description: 'Ingresos − Gastos = Utilidad del período. Margen sobre ingresos.',
    icon: TrendingUp,
    color: 'bg-rose-600',
  },
  {
    href: '/contabilidad/periodos',
    title: 'Períodos Contables',
    description: 'Cierre mensual de libros (exigencia SUNAT). Reabrir requiere autorización.',
    icon: Lock,
    color: 'bg-gray-700',
  },
]

export default function ContabilidadHubPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Calculator className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contabilidad</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            PCGE Modificado vigente · Resolución CNC N° 002-2019-EF/30
          </p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
        <strong>Cumplimiento normativo:</strong> Plan basado en PCGE Modificado vigente desde
        01/01/2020. Estructura preparada para PLE (Programa de Libros Electrónicos) y SIRE.
        Soporta detracciones SPOT 4% (carnes) y campos para reporte a SUNAT. El cierre mensual
        sigue las exigencias del Código Tributario y Reglamento de Libros y Registros Contables.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULOS.map((m) => (
          <Link key={m.href} href={m.href}
            className="block bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer">
            <div className={`w-10 h-10 rounded-lg ${m.color} flex items-center justify-center mb-3`}>
              <m.icon className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-bold text-gray-900 text-base mb-1">{m.title}</h3>
            <p className="text-xs text-gray-500 leading-snug">{m.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
