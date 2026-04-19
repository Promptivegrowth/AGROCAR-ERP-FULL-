'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserRole } from '@/types'

const roleRedirects: Record<UserRole, string> = {
  gerente: '/dashboard',
  administrador: '/dashboard',
  facturador: '/facturacion',
  almacenero: '/almacen',
  contador: '/contabilidad',
  vendedor: '/pwa/pedidos',
  repartidor: '/pwa/cobros',
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          setError('Correo o contraseña incorrectos. Verifica tus datos.')
        } else if (authError.message.includes('Email not confirmed')) {
          setError('Tu cuenta no ha sido confirmada. Revisa tu correo.')
        } else {
          setError(authError.message)
        }
        return
      }

      if (!data.user) {
        setError('No se pudo iniciar sesión. Intenta nuevamente.')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, activo')
        .eq('id', data.user.id)
        .single()

      if (profileError || !profile) {
        setError('No se encontró el perfil de usuario. Contacta al administrador.')
        return
      }

      if (!profile.activo) {
        await supabase.auth.signOut()
        setError('Tu cuenta está desactivada. Contacta al administrador.')
        return
      }

      const destination = roleRedirects[profile.role as UserRole] ?? '/dashboard'
      router.push(destination)
    } catch {
      setError('Ocurrió un error inesperado. Intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md px-4">
      {/* Logo y título */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
          <Package className="w-9 h-9 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">AGROCAR ERP</h1>
        <p className="text-sm text-gray-500 mt-1">Sistema ERP Integral · AGROCAR S.R.L.</p>
      </div>

      <Card className="shadow-xl border-0 bg-white">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-800">Iniciar Sesión</CardTitle>
          <CardDescription>Ingresa tus credenciales para acceder al sistema</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                Correo electrónico
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="usuario@agrocar.pe"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="h-11 border-gray-200 focus:border-green-500 focus:ring-green-500"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                Contraseña
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="h-11 pr-11 border-gray-200 focus:border-green-500 focus:ring-green-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <Button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold mt-2 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Iniciando sesión...
                </>
              ) : (
                'Iniciar Sesión'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-gray-400 mt-6">
        AGROCAR S.R.L. · Tacna, Perú · {new Date().getFullYear()}
      </p>
    </div>
  )
}
