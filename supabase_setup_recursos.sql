-- SQL Script para crear la tabla de Solicitudes de Recursos y Capacitaciones en Supabase
-- Ejecuta este script en el editor SQL de tu consola de Supabase.

CREATE TABLE IF NOT EXISTS public.solicitudes_recursos (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folio text UNIQUE NOT NULL,
    nombre_colaborador text NOT NULL,
    correo_colaborador text NOT NULL,
    puesto text NOT NULL,
    departamento text NOT NULL,
    tipo_recurso text NOT NULL,
    nombre_recurso text NOT NULL,
    costo_estimado numeric DEFAULT 0 NOT NULL,
    enlace_referencia text,
    justificacion text NOT NULL,
    beneficio_empresa text NOT NULL,
    estado text DEFAULT 'ENVIADA' NOT NULL, -- ENVIADA, EN_REVISION, EN_CONTABILIDAD, VERIFICACION_DISPOSITIVO, COMPLETADO, RECHAZADO
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Habilitar seguridad
ALTER TABLE public.solicitudes_recursos ENABLE ROW LEVEL SECURITY;

-- Crear políticas de acceso público
CREATE POLICY "Permitir lectura de recursos" ON public.solicitudes_recursos
    FOR SELECT USING (true);

CREATE POLICY "Permitir insercion de recursos" ON public.solicitudes_recursos
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Permitir modificacion de recursos" ON public.solicitudes_recursos
    FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Permitir eliminacion de recursos" ON public.solicitudes_recursos
    FOR DELETE USING (true);
