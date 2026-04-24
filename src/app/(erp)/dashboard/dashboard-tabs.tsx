'use client'

import { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LayoutDashboard, Users, Target, TrendingUp, CreditCard } from 'lucide-react'
import VendedoresTab from './vendedores-tab'
import CuotasTab from './cuotas-tab'
import VentasTab from './ventas-tab'
import CobranzasTab from './cobranzas-tab'

export default function DashboardTabs({ children }: { children: ReactNode }) {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="bg-gray-100 p-1 rounded-xl flex-wrap h-auto">
        <TabsTrigger value="overview" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
          <LayoutDashboard className="w-4 h-4" /> Resumen General
        </TabsTrigger>
        <TabsTrigger value="vendedores" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
          <Users className="w-4 h-4" /> Vendedores
        </TabsTrigger>
        <TabsTrigger value="cuotas" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
          <Target className="w-4 h-4" /> Cuotas
        </TabsTrigger>
        <TabsTrigger value="ventas" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
          <TrendingUp className="w-4 h-4" /> Ventas
        </TabsTrigger>
        <TabsTrigger value="cobranzas" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
          <CreditCard className="w-4 h-4" /> Cobranzas
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-4">{children}</TabsContent>
      <TabsContent value="vendedores" className="mt-4"><VendedoresTab /></TabsContent>
      <TabsContent value="cuotas" className="mt-4"><CuotasTab /></TabsContent>
      <TabsContent value="ventas" className="mt-4"><VentasTab /></TabsContent>
      <TabsContent value="cobranzas" className="mt-4"><CobranzasTab /></TabsContent>
    </Tabs>
  )
}
