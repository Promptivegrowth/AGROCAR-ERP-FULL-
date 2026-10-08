-- Asignar o cambiar el repartidor de un despacho ya consolidado.
--
-- Daniel, 07/10/2026: al armar los carros de la tarde, el D-20261007-6766
-- (Z7K-755) se consolidó sin repartidor y no había forma de asignárselo
-- después: el selector existe solo antes de consolidar. Sin repartidor, nadie ve
-- ese reparto en su celular (pwa_mi_reparto busca por despachos.repartidor_id).
--
-- Se puede mientras el despacho esté en preparación o en ruta. Queda anotado en
-- las notas del despacho quién lo cambió y desde quién.
--
-- Y la lista de repartidores sale de una función: los permisos de profiles no
-- dejan al facturador (que también consolida) ver a otros usuarios, y el
-- selector le salía vacío. Igual que vendedores_activos (migración 126).

BEGIN;

CREATE OR REPLACE FUNCTION public.repartidores_activos()
 RETURNS TABLE(id uuid, nombre text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, COALESCE(NULLIF(TRIM(p.full_name), ''), p.email)::text
    FROM profiles p
   WHERE p.role::text IN ('repartidor', 'chofer') AND p.activo
     AND EXISTS (SELECT 1 FROM profiles yo WHERE yo.id = auth.uid() AND yo.activo
                 AND yo.role::text IN ('administrador', 'gerente', 'facturador', 'almacenero', 'caja', 'contador'))
   ORDER BY 2
$function$;
GRANT EXECUTE ON FUNCTION public.repartidores_activos() TO authenticated;

CREATE OR REPLACE FUNCTION public.asignar_repartidor_despacho(p_despacho_id uuid, p_repartidor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_quien RECORD;
  v_d RECORD;
  v_nuevo RECORD;
  v_antes TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT full_name, role::text AS role INTO v_quien FROM profiles WHERE id = v_user AND activo;
  IF v_quien.role IS NULL OR v_quien.role NOT IN ('administrador', 'gerente', 'facturador', 'almacenero') THEN
    RAISE EXCEPTION 'Solo administración, gerencia, facturación o almacén pueden asignar el repartidor';
  END IF;

  SELECT id, numero, estado::text AS estado, repartidor_id INTO v_d FROM despachos WHERE id = p_despacho_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El despacho no existe'; END IF;
  IF v_d.estado NOT IN ('preparacion', 'en_ruta') THEN
    RAISE EXCEPTION 'El despacho % ya está %: no se cambia el repartidor', v_d.numero, v_d.estado;
  END IF;

  SELECT id, full_name, activo, role::text AS role INTO v_nuevo FROM profiles WHERE id = p_repartidor_id;
  IF NOT FOUND OR v_nuevo.role NOT IN ('repartidor', 'chofer') THEN RAISE EXCEPTION 'El repartidor elegido no existe'; END IF;
  IF NOT COALESCE(v_nuevo.activo, false) THEN RAISE EXCEPTION '% está desactivado', v_nuevo.full_name; END IF;
  IF v_d.repartidor_id IS NOT DISTINCT FROM p_repartidor_id THEN
    RETURN jsonb_build_object('ok', true, 'despacho', v_d.numero, 'sin_cambios', true);
  END IF;

  SELECT full_name INTO v_antes FROM profiles WHERE id = v_d.repartidor_id;
  UPDATE despachos
     SET repartidor_id = p_repartidor_id,
         notas = TRIM(BOTH ' ·' FROM COALESCE(notas, '') || ' · Repartidor '
                 || CASE WHEN v_antes IS NULL THEN 'asignado' ELSE 'cambiado (antes ' || v_antes || ')' END
                 || ' por ' || COALESCE(v_quien.full_name, '?') || ' el '
                 || to_char(NOW() AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI'))
   WHERE id = p_despacho_id;

  RETURN jsonb_build_object('ok', true, 'despacho', v_d.numero, 'antes', v_antes, 'ahora', v_nuevo.full_name);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.asignar_repartidor_despacho(uuid, uuid) TO authenticated;

COMMIT;
