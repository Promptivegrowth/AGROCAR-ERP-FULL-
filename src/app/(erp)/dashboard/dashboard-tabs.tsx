'use client'

import { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LayoutDashboard, Users } from 'lucide-react'
import VendedoresTab from './vendedores-tab'

export default function DashboardTabs({ children }: { children: ReactNode }) {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="bg-gray-100 p-1 rounded-xl">
        <TabsTrigger value="overview" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
          <LayoutDashboard className="w-4 h-4" /> Resumen General
        </TabsTrigger>
        <TabsTrigger value="vendedores" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
          <Users className="w-4 h-4" /> Vendedores
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-4">
        {children}
      </TabsContent>

      <TabsContent value="vendedores" className="mt-4">
        <VendedoresTab />
      </TabsContent>
    </Tabs>
  )
}
