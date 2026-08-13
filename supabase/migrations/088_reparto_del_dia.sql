-- ─────────────────────────────────────────────────────────────────────────────
-- 088: Reparto del día para el repartidor
--
-- Daniel: "el repartidor solo tiene que tener acceso al reparto del día y
-- venta directa, cobranza y activar cliente y condición de venta crédito o
-- contado".
--
-- El reparto del día no existía en el aplicativo, y tampoco había forma de
-- construirlo: los despachos se asignan a `conductor_id`, que apunta al
-- maestro de conductores (DNI, licencia, vencimientos) y no tiene ninguna
-- relación con los usuarios del sistema. Nada conectaba un despacho con la
-- cuenta de Walter o de Víctor.
--
-- Se agrega `repartidor_id` apuntando directo al usuario. Se deja
-- `conductor_id` como está: en AGROCAR el chofer y quien entrega y cobra no
-- son necesariamente la misma persona, y el maestro de conductores sigue
-- sirviendo para la hoja de ruta y los datos de licencia.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE despachos
  ADD COLUMN IF NOT EXISTS repartidor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_despachos_repartidor
  ON despachos (repartidor_id, fecha_despacho);

COMMENT ON COLUMN despachos.repartidor_id IS
  'Usuario que sale a repartir y cobrar. Es quien ve este despacho en su celular.';

-- ── Lo que le toca entregar hoy al repartidor autenticado
CREATE OR REPLACE FUNCTION pwa_mi_reparto(p_fecha DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_fecha DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  WITH mis_despachos AS (
    SELECT d.id, d.numero, d.estado::text AS estado, d.orden_entrega,
           v.placa, c.nombre_completo AS conductor
    FROM despachos d
    LEFT JOIN vehiculos v ON v.id = d.vehiculo_id
    LEFT JOIN conductores c ON c.id = d.conductor_id
    WHERE d.fecha_despacho = v_fecha AND d.repartidor_id = v_uid
  ),
  entregas AS (
    SELECT
      di.id,
      di.despacho_id,
      di.estado::text AS estado,
      di.notas_entrega,
      pe.numero AS pedido,
      COALESCE(pe.tipo_pago::text, 'credito') AS condicion,
      pe.total,
      COALESCE(cl.razon_social, pe.cliente_externo_nombre, '—') AS cliente,
      cl.direccion,
      cl.telefono,
      z.nombre AS zona,
      -- Lo ya cobrado en la entrega
      (COALESCE(di.cobro_efectivo, 0) + COALESCE(di.cobro_yape, 0)
       + COALESCE(di.cobro_plin, 0) + COALESCE(di.cobro_transferencia, 0)) AS cobrado,
      c.serie, c.numero AS comp_numero, c.tipo::text AS comp_tipo
    FROM despachos_items di
    JOIN mis_despachos md ON md.id = di.despacho_id
    JOIN pedidos pe ON pe.id = di.pedido_id
    LEFT JOIN clientes cl ON cl.id = pe.cliente_id
    LEFT JOIN zonas z ON z.id = cl.zona_id
    LEFT JOIN comprobantes c ON c.id = di.comprobante_id
  )
  SELECT jsonb_build_object(
    'fecha', v_fecha,
    'despachos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'numero', numero, 'estado', estado,
        'placa', placa, 'conductor', conductor
      ) ORDER BY numero) FROM mis_despachos
    ), '[]'::jsonb),
    'entregas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'pedido', pedido, 'cliente', cliente,
        'direccion', direccion, 'telefono', telefono, 'zona', zona,
        'condicion', condicion,
        'total', ROUND(total, 2), 'cobrado', ROUND(cobrado, 2),
        'estado', estado, 'notas', notas_entrega,
        'comprobante', CASE WHEN serie IS NOT NULL
          THEN serie || '-' || comp_numero ELSE NULL END,
        'comp_tipo', comp_tipo
      ) ORDER BY cliente) FROM entregas
    ), '[]'::jsonb),
    'resumen', jsonb_build_object(
      'entregas',   (SELECT COUNT(*) FROM entregas),
      'monto',      (SELECT COALESCE(ROUND(SUM(total), 2), 0) FROM entregas),
      'cobrado',    (SELECT COALESCE(ROUND(SUM(cobrado), 2), 0) FROM entregas),
      'contado',    (SELECT COUNT(*) FROM entregas WHERE condicion = 'contado'),
      'credito',    (SELECT COUNT(*) FROM entregas WHERE condicion <> 'contado'),
      'pendientes', (SELECT COUNT(*) FROM entregas WHERE estado <> 'entregado')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION pwa_mi_reparto TO authenticated;

COMMENT ON FUNCTION pwa_mi_reparto IS
  'Entregas del día del repartidor autenticado, con su condición de venta y lo ya cobrado.';
