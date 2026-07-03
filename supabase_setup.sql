-- 1. Crear tabla para Sugerencias de Empleados
CREATE TABLE public.sugerencias_empleados (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    folio TEXT NOT NULL,
    nombre TEXT NOT NULL,
    departamento TEXT NOT NULL,
    sugerencia TEXT NOT NULL,
    estado TEXT DEFAULT 'NUEVA'::text NOT NULL
);

-- Desactivar Row Level Security para permitir inserción y lectura pública (modo panel público)
ALTER TABLE public.sugerencias_empleados DISABLE ROW LEVEL SECURITY;

-- 2. Crear tabla para Gestión de Correos
CREATE TABLE public.gestion_correos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    folio TEXT NOT NULL,
    tipo TEXT NOT NULL, -- 'ALTA' o 'BAJA'
    nombre TEXT NOT NULL,
    departamento TEXT NOT NULL,
    correo_sugerido TEXT NOT NULL,
    contrasena TEXT,
    justificacion TEXT NOT NULL,
    estado TEXT DEFAULT 'PENDIENTE'::text NOT NULL
);

-- Desactivar Row Level Security para permitir inserción y lectura pública
ALTER TABLE public.gestion_correos DISABLE ROW LEVEL SECURITY;
