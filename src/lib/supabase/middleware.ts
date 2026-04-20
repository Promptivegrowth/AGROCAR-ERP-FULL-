import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { canAccessErpPath, homeForRole, isPwaRole } from "@/lib/access-control";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public paths that don't require auth
  const publicPaths = ["/login", "/auth/callback", "/boleta", "/comprobante", "/guia-remision", "/api/consulta", "/api/geocode"];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return supabaseResponse;
  }

  // Not authenticated → redirect to login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Role-based access control: obtener rol una vez por request
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, activo")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.activo) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "account_inactive");
    return NextResponse.redirect(url);
  }

  const role = profile.role as string;
  const isPwaPath = pathname.startsWith("/pwa");

  // Vendedores y repartidores: solo PWA. Si intentan entrar al ERP → su home PWA
  if (isPwaRole(role)) {
    if (!isPwaPath && pathname !== "/") {
      const url = request.nextUrl.clone();
      url.pathname = homeForRole(role);
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Roles del ERP: si la ruta es PWA, redirigir al home del rol
  if (isPwaPath) {
    const url = request.nextUrl.clone();
    url.pathname = homeForRole(role);
    return NextResponse.redirect(url);
  }

  // Verificar acceso granular del ERP
  if (pathname !== "/" && !canAccessErpPath(role, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = homeForRole(role);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
