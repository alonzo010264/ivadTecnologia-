-- SQL Script para crear la tabla de Control de Gastos en Supabase
-- Puedes ejecutar esta sentencia directamente en el editor SQL (SQL Editor) de tu consola de Supabase.

-- 1. Crear la tabla de gastos
CREATE TABLE IF NOT EXISTS public.control_gastos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    fecha DATE NOT NULL,
    monto NUMERIC(12, 2) NOT NULL CHECK (monto >= 0),
    categoria TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    proveedor TEXT,
    metodo_pago TEXT NOT NULL,
    notas TEXT
);

-- 2. Habilitar la seguridad a nivel de filas (Row Level Security - RLS) si es requerido
-- ALTER TABLE public.control_gastos ENABLE ROW LEVEL SECURITY;

-- 3. Crear políticas de acceso público si el RLS está habilitado
-- (Esto permite leer, insertar y borrar registros desde el cliente web)
CREATE POLICY "Permitir lectura pública de gastos" ON public.control_gastos
    FOR SELECT USING (true);

CREATE POLICY "Permitir inserción pública de gastos" ON public.control_gastos
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Permitir eliminación pública de gastos" ON public.control_gastos
    FOR DELETE USING (true);
