-- ─────────────────────────────────────────────────────────────────────────────
-- 059: Comisiones — objetivo mensual como referencia + ciclo de liquidación
--
-- Cambios acordados con Daniel:
-- - Comisión sobre venta BRUTA (subtotal sin IGV) — se mantiene
-- - Objetivo mensual es solo REFERENCIA visual (no umbral bloqueante)
-- - Ciclo de liquidación configurable: mensual / quincenal / personalizado
-- ─────────────────────────────────────────────────────────────────────────────

-- La columna objetivo_mensual ya existe en comisiones_reglas (migración 051).
-- Aquí solo aseguramos los defaults del ciclo de liquidación en `configuracion`.

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('comisiones.ciclo_liquidacion', 'mensual',
   'Frecuencia de liquidación de comisiones: mensual, quincenal, personalizado'),
  ('comisiones.dia_liquidacion', '30',
   'Día del mes en que se liquida (1-31, o "fin_mes"). Para quincenal se ignora — usa 15 y fin de mes.'),
  ('comisiones.base_calculo', 'venta_bruta',
   'Base para calcular comisión: venta_bruta (subtotal sin IGV) o venta_cobrada')
ON CONFLICT (clave) DO NOTHING;

-- Vista útil para el reporte: próxima fecha de liquidación
CREATE OR REPLACE FUNCTION proxima_liquidacion_comisiones()
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ciclo TEXT;
  v_dia TEXT;
  v_hoy DATE := CURRENT_DATE;
  v_dia_num INT;
BEGIN
  SELECT valor INTO v_ciclo FROM configuracion WHERE clave = 'comisiones.ciclo_liquidacion';
  SELECT valor INTO v_dia FROM configuracion WHERE clave = 'comisiones.dia_liquidacion';

  IF v_ciclo = 'mensual' THEN
    -- Próximo fin de mes o día configurado
    IF v_dia = 'fin_mes' OR v_dia IS NULL THEN
      RETURN (date_trunc('month', v_hoy) + INTERVAL '1 month - 1 day')::date;
    ELSE
      v_dia_num := LEAST(v_dia::int, EXTRACT(DAY FROM (date_trunc('month', v_hoy) + INTERVAL '1 month - 1 day'))::int);
      IF v_hoy < make_date(EXTRACT(YEAR FROM v_hoy)::int, EXTRACT(MONTH FROM v_hoy)::int, v_dia_num) THEN
        RETURN make_date(EXTRACT(YEAR FROM v_hoy)::int, EXTRACT(MONTH FROM v_hoy)::int, v_dia_num);
      ELSE
        RETURN make_date(
          EXTRACT(YEAR FROM v_hoy + INTERVAL '1 month')::int,
          EXTRACT(MONTH FROM v_hoy + INTERVAL '1 month')::int,
          v_dia_num);
      END IF;
    END IF;
  ELSIF v_ciclo = 'quincenal' THEN
    -- 15 y fin de mes
    IF EXTRACT(DAY FROM v_hoy) < 15 THEN
      RETURN make_date(EXTRACT(YEAR FROM v_hoy)::int, EXTRACT(MONTH FROM v_hoy)::int, 15);
    ELSE
      RETURN (date_trunc('month', v_hoy) + INTERVAL '1 month - 1 day')::date;
    END IF;
  ELSE
    -- Personalizado: usa dia_liquidacion como día fijo
    v_dia_num := COALESCE(v_dia::int, 30);
    IF v_hoy < make_date(EXTRACT(YEAR FROM v_hoy)::int, EXTRACT(MONTH FROM v_hoy)::int, v_dia_num) THEN
      RETURN make_date(EXTRACT(YEAR FROM v_hoy)::int, EXTRACT(MONTH FROM v_hoy)::int, v_dia_num);
    ELSE
      RETURN make_date(
        EXTRACT(YEAR FROM v_hoy + INTERVAL '1 month')::int,
        EXTRACT(MONTH FROM v_hoy + INTERVAL '1 month')::int,
        v_dia_num);
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION proxima_liquidacion_comisiones TO authenticated;
