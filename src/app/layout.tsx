import type { Metadata, Viewport } from "next"
import { Inter, Great_Vibes } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import ServiceWorkerRegister from "@/components/sw-register"

const inter = Inter({ subsets: ["latin"] })
// Fuente script para el slogan "Pasión hecha a mano" — similar al logo de AGROCAR
const greatVibes = Great_Vibes({ subsets: ["latin"], weight: "400", variable: "--font-slogan", display: "swap" })

export const metadata: Metadata = {
  title: "AGROCAR ERP",
  description: "Sistema ERP Integral - AGROCAR S.R.L.",
  manifest: "/manifest.json",
}

export const viewport: Viewport = {
  themeColor: "#FBE600",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={greatVibes.variable}>
      <body className={inter.className}>
        {children}
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
