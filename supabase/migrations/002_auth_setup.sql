-- =============================================================================
-- AGROCAR ERP - Setup de usuarios iniciales
-- Empresa: AGROCAR SRL - Distribuidora de embutidos - Perú
-- Migración: 002_auth_setup.sql
--
-- IMPORTANTE: Ejecutar DESPUÉS de 001_schema.sql
--
-- Usuarios creados:
--   admin@agrocar.pe        / Admin2024!      → administrador
--   gerente@agrocar.pe      / Gerente2024!    → gerente
--   facturador@agrocar.pe   / Factura2024!    → facturador
--   almacen@agrocar.pe      / Almacen2024!    → almacenero
--   contador@agrocar.pe     / Contad2024!     → contador
--   vendedor1@agrocar.pe    / Vend2024!       → vendedor
--   repartidor1@agrocar.pe  / Repart2024!     → repartidor
--
-- NOTA DE SEGURIDAD: Este archivo contiene credenciales de prueba.
-- Cambiar las contraseñas INMEDIATAMENTE en producción.
-- En producción, usar Supabase Auth Dashboard o la API de Admin para crear usuarios.
-- =============================================================================

BEGIN;

-- =============================================================================
-- FUNCIÓN HELPER: crear usuario en auth.users con hash de contraseña
-- compatible con el formato bcrypt de Supabase Auth (GoTrue)
-- =============================================================================

-- NOTA TÉCNICA: Supabase usa GoTrue internamente para manejar auth.users.
-- La forma correcta de pre-crear usuarios en una migración es insertando
-- directamente en auth.users con el hash bcrypt de la contraseña.
-- Los hashes a continuación son bcrypt del texto plano indicado.
--
-- Para regenerar hashes en PostgreSQL:
--   SELECT crypt('MiPassword123!', gen_salt('bf', 10));
-- Requiere la extensión pgcrypto.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- INSERCIÓN DE USUARIOS EN auth.users
-- =============================================================================

-- Los UUIDs son fijos para facilitar referencias en seeds posteriores.
-- En producción, dejar que Supabase los genere automáticamente.

DO $$
DECLARE
  v_admin_id         UUID := 'a0000001-0000-0000-0000-000000000001';
  v_gerente_id       UUID := 'a0000002-0000-0000-0000-000000000002';
  v_facturador_id    UUID := 'a0000003-0000-0000-0000-000000000003';
  v_almacen_id       UUID := 'a0000004-0000-0000-0000-000000000004';
  v_contador_id      UUID := 'a0000005-0000-0000-0000-000000000005';
  v_vendedor1_id     UUID := 'a0000006-0000-0000-0000-000000000006';
  v_repartidor1_id   UUID := 'a0000007-0000-0000-0000-000000000007';
  v_confirmed_at     TIMESTAMPTZ := NOW();
  v_now              TIMESTAMPTZ := NOW();
BEGIN

  -- ──────────────────────────────────────────────────────────────────────────
  -- 1. ADMINISTRADOR  admin@agrocar.pe / Admin2024!
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    raw_app_meta_data,
    role,
    aud,
    created_at,
    updated_at,
    confirmation_token,
    email_change_token_new,
    recovery_token
  ) VALUES (
    v_admin_id,
    '00000000-0000-0000-0000-000000000000',
    'admin@agrocar.pe',
    crypt('Admin2024!', gen_salt('bf', 10)),
    v_confirmed_at,
    jsonb_build_object(
      'full_name', 'Administrador AGROCAR',
      'role',      'administrador'
    ),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated',
    'authenticated',
    v_now,
    v_now,
    '',
    '',
    ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at         = v_now;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 2. GERENTE  gerente@agrocar.pe / Gerente2024!
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token
  ) VALUES (
    v_gerente_id,
    '00000000-0000-0000-0000-000000000000',
    'gerente@agrocar.pe',
    crypt('Gerente2024!', gen_salt('bf', 10)),
    v_confirmed_at,
    jsonb_build_object('full_name', 'Gerente General', 'role', 'gerente'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', v_now, v_now, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at         = v_now;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 3. FACTURADOR  facturador@agrocar.pe / Factura2024!
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token
  ) VALUES (
    v_facturador_id,
    '00000000-0000-0000-0000-000000000000',
    'facturador@agrocar.pe',
    crypt('Factura2024!', gen_salt('bf', 10)),
    v_confirmed_at,
    jsonb_build_object('full_name', 'Facturador Principal', 'role', 'facturador'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', v_now, v_now, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at         = v_now;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 4. ALMACENERO  almacen@agrocar.pe / Almacen2024!
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token
  ) VALUES (
    v_almacen_id,
    '00000000-0000-0000-0000-000000000000',
    'almacen@agrocar.pe',
    crypt('Almacen2024!', gen_salt('bf', 10)),
    v_confirmed_at,
    jsonb_build_object('full_name', 'Jefe de Almacén', 'role', 'almacenero'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', v_now, v_now, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at         = v_now;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 5. CONTADOR  contador@agrocar.pe / Contad2024!
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token
  ) VALUES (
    v_contador_id,
    '00000000-0000-0000-0000-000000000000',
    'contador@agrocar.pe',
    crypt('Contad2024!', gen_salt('bf', 10)),
    v_confirmed_at,
    jsonb_build_object('full_name', 'Contador AGROCAR', 'role', 'contador'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', v_now, v_now, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at         = v_now;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 6. VENDEDOR 1  vendedor1@agrocar.pe / Vend2024!
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token
  ) VALUES (
    v_vendedor1_id,
    '00000000-0000-0000-0000-000000000000',
    'vendedor1@agrocar.pe',
    crypt('Vend2024!', gen_salt('bf', 10)),
    v_confirmed_at,
    jsonb_build_object('full_name', 'Vendedor Zona 1', 'role', 'vendedor'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', v_now, v_now, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at         = v_now;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 7. REPARTIDOR 1  repartidor1@agrocar.pe / Repart2024!
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token
  ) VALUES (
    v_repartidor1_id,
    '00000000-0000-0000-0000-000000000000',
    'repartidor1@agrocar.pe',
    crypt('Repart2024!', gen_salt('bf', 10)),
    v_confirmed_at,
    jsonb_build_object('full_name', 'Repartidor 1', 'role', 'repartidor'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', v_now, v_now, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at         = v_now;

  RAISE NOTICE 'Usuarios de auth creados correctamente.';
END $$;

-- =============================================================================
-- UPSERT DE PERFILES
-- El trigger handle_new_user debería crear los perfiles automáticamente
-- al insertar en auth.users. Este bloque es un seguro explícito.
-- =============================================================================

DO $$
DECLARE
  v_zona1_id UUID;
BEGIN
  -- Obtener el ID de la Zona 1 para asignar al vendedor
  SELECT id INTO v_zona1_id FROM zonas WHERE nombre = 'Zona 1' LIMIT 1;

  -- ── Administrador ─────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, role, activo)
  VALUES (
    'a0000001-0000-0000-0000-000000000001',
    'admin@agrocar.pe',
    'Administrador AGROCAR',
    'administrador',
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    activo     = EXCLUDED.activo,
    updated_at = NOW();

  -- ── Gerente ───────────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, role, activo)
  VALUES (
    'a0000002-0000-0000-0000-000000000002',
    'gerente@agrocar.pe',
    'Gerente General',
    'gerente',
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    activo     = EXCLUDED.activo,
    updated_at = NOW();

  -- ── Facturador ────────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, role, activo)
  VALUES (
    'a0000003-0000-0000-0000-000000000003',
    'facturador@agrocar.pe',
    'Facturador Principal',
    'facturador',
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    activo     = EXCLUDED.activo,
    updated_at = NOW();

  -- ── Almacenero ────────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, role, activo)
  VALUES (
    'a0000004-0000-0000-0000-000000000004',
    'almacen@agrocar.pe',
    'Jefe de Almacén',
    'almacenero',
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    activo     = EXCLUDED.activo,
    updated_at = NOW();

  -- ── Contador ──────────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, role, activo)
  VALUES (
    'a0000005-0000-0000-0000-000000000005',
    'contador@agrocar.pe',
    'Contador AGROCAR',
    'contador',
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    activo     = EXCLUDED.activo,
    updated_at = NOW();

  -- ── Vendedor 1 ────────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, role, zona_id, activo)
  VALUES (
    'a0000006-0000-0000-0000-000000000006',
    'vendedor1@agrocar.pe',
    'Vendedor Zona 1',
    'vendedor',
    v_zona1_id,
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    zona_id    = EXCLUDED.zona_id,
    activo     = EXCLUDED.activo,
    updated_at = NOW();

  -- ── Repartidor 1 ──────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, role, zona_id, activo)
  VALUES (
    'a0000007-0000-0000-0000-000000000007',
    'repartidor1@agrocar.pe',
    'Repartidor 1',
    'repartidor',
    v_zona1_id,
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    zona_id    = EXCLUDED.zona_id,
    activo     = EXCLUDED.activo,
    updated_at = NOW();

  RAISE NOTICE 'Perfiles de usuario creados/actualizados correctamente.';
END $$;

-- =============================================================================
-- VERIFICACIÓN FINAL
-- =============================================================================

DO $$
DECLARE
  v_count_auth    INTEGER;
  v_count_profiles INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count_auth
  FROM auth.users
  WHERE email LIKE '%@agrocar.pe';

  SELECT COUNT(*) INTO v_count_profiles
  FROM public.profiles
  WHERE email LIKE '%@agrocar.pe';

  RAISE NOTICE '================================================';
  RAISE NOTICE 'AGROCAR ERP - Setup de usuarios completado';
  RAISE NOTICE 'Usuarios en auth.users: %', v_count_auth;
  RAISE NOTICE 'Perfiles en profiles:   %', v_count_profiles;
  RAISE NOTICE '================================================';
  RAISE NOTICE 'CREDENCIALES DE ACCESO (SOLO PARA DESARROLLO):';
  RAISE NOTICE '  admin@agrocar.pe       / Admin2024!     → administrador';
  RAISE NOTICE '  gerente@agrocar.pe     / Gerente2024!   → gerente';
  RAISE NOTICE '  facturador@agrocar.pe  / Factura2024!   → facturador';
  RAISE NOTICE '  almacen@agrocar.pe     / Almacen2024!   → almacenero';
  RAISE NOTICE '  contador@agrocar.pe    / Contad2024!    → contador';
  RAISE NOTICE '  vendedor1@agrocar.pe   / Vend2024!      → vendedor';
  RAISE NOTICE '  repartidor1@agrocar.pe / Repart2024!    → repartidor';
  RAISE NOTICE '================================================';
  RAISE WARNING 'CAMBIAR TODAS LAS CONTRASEÑAS ANTES DE PASAR A PRODUCCION';
END $$;

COMMIT;

-- =============================================================================
-- INSTRUCCIONES ALTERNATIVAS PARA PRODUCCIÓN
-- =============================================================================
-- En producción, usar la API de Supabase Admin para crear usuarios:
--
-- curl -X POST 'https://<project>.supabase.co/auth/v1/admin/users' \
--   -H 'apikey: <service_role_key>' \
--   -H 'Authorization: Bearer <service_role_key>' \
--   -H 'Content-Type: application/json' \
--   -d '{
--     "email": "admin@agrocar.pe",
--     "password": "CONTRASEÑA_SEGURA",
--     "email_confirm": true,
--     "user_metadata": {
--       "full_name": "Administrador AGROCAR",
--       "role": "administrador"
--     }
--   }'
--
-- O usar el Dashboard de Supabase > Authentication > Users > Invite User
-- =============================================================================
