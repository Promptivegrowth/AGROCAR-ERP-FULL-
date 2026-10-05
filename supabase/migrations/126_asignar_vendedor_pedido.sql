-- Asignar o cambiar el vendedor de un pedido ya guardado.
--
-- Daniel, 05/10/2026: los pedidos que se cargan en la oficina quedan sin
-- vendedor ("—") y no había forma de asignárselo después. El vendedor cuenta
-- para sus cuotas, sus reportes y su comisión, así que tiene que poder
-- corregirse.
--
-- Se permite en cualquier estado salvo cancelado: las ventas de oficina pasan
-- a entregado apenas se emiten, y justo esas son las que quedan sin vendedor.
-- Lo que no se toca es un pedido cuya fecha cae en una liquidación de
-- comisiones ya aprobada o pagada del vendedor anterior o del nuevo: moverlo
-- descuadraría una comisión que ya se pagó.
--
-- Queda anotado en las notas del pedido quién lo cambió y desde qué vendedor.

CREATE OR REPLACE FUNCTION public.asignar_vendedor_pedido(p_pedido_id uuid, p_vendedor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_quien RECORD;
  v_p RECORD;
  v_nuevo RECORD;
  v_antes TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT full_name, role::text AS role INTO v_quien FROM profiles WHERE id = v_user;
  IF NOT FOUND OR v_quien.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o facturación pueden asignar el vendedor de un pedido';
  END IF;

  SELECT id, numero, estado::text AS estado, vendedor_id, fecha_pedido INTO v_p
    FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no existe'; END IF;
  IF v_p.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El pedido % está cancelado', v_p.numero;
  END IF;

  SELECT id, full_name, activo INTO v_nuevo FROM profiles WHERE id = p_vendedor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El vendedor elegido no existe'; END IF;
  IF NOT COALESCE(v_nuevo.activo, false) THEN
    RAISE EXCEPTION '% está desactivado', v_nuevo.full_name;
  END IF;
  IF v_p.vendedor_id IS NOT DISTINCT FROM p_vendedor_id THEN
    RETURN jsonb_build_object('ok', true, 'pedido', v_p.numero, 'sin_cambios', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM liquidaciones_comision l
     WHERE l.vendedor_id IN (v_p.vendedor_id, p_vendedor_id)
       AND v_p.fecha_pedido BETWEEN l.periodo_inicio AND l.periodo_fin
       AND (l.fecha_aprobacion IS NOT NULL OR COALESCE(l.monto_pagado, 0) > 0)
  ) THEN
    RAISE EXCEPTION 'El pedido % cae en una liquidación de comisiones ya aprobada o pagada: cambiar el vendedor la descuadraría',
      v_p.numero;
  END IF;

  SELECT full_name INTO v_antes FROM profiles WHERE id = v_p.vendedor_id;
  UPDATE pedidos
     SET vendedor_id = p_vendedor_id,
         notas = TRIM(BOTH ' ·' FROM COALESCE(notas, '') || ' · Vendedor '
                 || CASE WHEN v_antes IS NULL THEN 'asignado' ELSE 'cambiado (antes ' || v_antes || ')' END
                 || ' por ' || COALESCE(v_quien.full_name, '?') || ' el ' || to_char(NOW() AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI')),
         updated_at = NOW()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true, 'pedido', v_p.numero, 'antes', v_antes, 'ahora', v_nuevo.full_name);
END;
$function$;

COMMENT ON FUNCTION public.asignar_vendedor_pedido IS
  'Asigna o cambia el vendedor de un pedido (no cancelado, fuera de liquidaciones de comisión aprobadas o pagadas).';

GRANT EXECUTE ON FUNCTION public.asignar_vendedor_pedido(uuid, uuid) TO authenticated;

-- La lista de vendedores para elegir. Los permisos de profiles no dejan al
-- facturador ver a otros usuarios, así que tanto el pedido nuevo como la
-- asignación posterior le mostraban la lista vacía. Esto devuelve solo id y
-- nombre de los vendedores activos, sin abrir el resto de profiles.
CREATE OR REPLACE FUNCTION public.vendedores_activos()
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name::text
    FROM profiles p
   WHERE p.role::text = 'vendedor' AND p.activo
     AND EXISTS (SELECT 1 FROM profiles yo WHERE yo.id = auth.uid()
                 AND yo.activo AND yo.role::text IN ('administrador', 'gerente', 'facturador', 'caja', 'contador'))
   ORDER BY p.full_name
$function$;

GRANT EXECUTE ON FUNCTION public.vendedores_activos() TO authenticated;
