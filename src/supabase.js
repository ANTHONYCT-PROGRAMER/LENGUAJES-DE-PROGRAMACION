import { createClient } from '@supabase/supabase-js';

// Claves de almacenamiento local para pruebas rápidas
const STORAGE_URL_KEY = 'sb_project_url';
const STORAGE_ANON_KEY = 'sb_project_anon_key';
const LOCAL_ESTUDIANTES_KEY = 'local_estudiantes_data';

// Datos iniciales de demostración si aún no hay conexión a Supabase
const INITIAL_DEMO_DATA = [
  {
    id: 'demo-1',
    codigo: 'SIS-2024-001',
    nombres: 'Carlos Andrés',
    apellidos: 'Mendoza Quispe',
    curso: 'Lenguajes de Programación',
    nota1: 15.0,
    nota2: 17.5,
    nota3: 14.0,
    promedio: 15.5,
    condicion: 'APROBADO',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'demo-2',
    codigo: 'SIS-2024-002',
    nombres: 'Valeria Sofía',
    apellidos: 'García Paredes',
    curso: 'Lenguajes de Programación',
    nota1: 9.0,
    nota2: 10.0,
    nota3: 11.5,
    promedio: 10.17,
    condicion: 'DESAPROBADO',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'demo-3',
    codigo: 'SIS-2024-003',
    nombres: 'Anthony Joel',
    apellidos: 'Condori Ticona',
    curso: 'Lenguajes de Programación',
    nota1: 18.0,
    nota2: 19.0,
    nota3: 17.5,
    promedio: 18.17,
    condicion: 'APROBADO',
    created_at: new Date().toISOString(),
  }
];

export const SQL_SETUP_SCRIPT = `-- 1. CREAR TABLA DE ESTUDIANTES Y CALIFICACIONES
create table if not exists public.estudiantes (
  id uuid default gen_random_uuid() primary key,
  codigo text not null unique,
  nombres text not null,
  apellidos text not null,
  curso text default 'Lenguajes de Programación',
  nota1 numeric(4,2) not null check (nota1 >= 0 and nota1 <= 20),
  nota2 numeric(4,2) not null check (nota2 >= 0 and nota2 <= 20),
  nota3 numeric(4,2) not null check (nota3 >= 0 and nota3 <= 20),
  promedio numeric(4,2) not null check (promedio >= 0 and promedio <= 20),
  condicion text not null check (condicion in ('APROBADO', 'DESAPROBADO')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. HABILITAR SEGURIDAD POR FILAS (RLS)
alter table public.estudiantes enable row level security;

-- 3. POLÍTICAS DE ACCESO PARA DESARROLLO (CRUD COMPLETO)
drop policy if exists "Permitir lectura general" on public.estudiantes;
create policy "Permitir lectura general" on public.estudiantes for select using (true);

drop policy if exists "Permitir insercion general" on public.estudiantes;
create policy "Permitir insercion general" on public.estudiantes for insert with check (true);

drop policy if exists "Permitir actualizacion general" on public.estudiantes;
create policy "Permitir actualizacion general" on public.estudiantes for update using (true);

drop policy if exists "Permitir eliminacion general" on public.estudiantes;
create policy "Permitir eliminacion general" on public.estudiantes for delete using (true);`;

/**
 * Obtiene credenciales activas
 */
export function getActiveCredentials() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

  const localUrl = localStorage.getItem(STORAGE_URL_KEY)?.trim();
  const localKey = localStorage.getItem(STORAGE_ANON_KEY)?.trim();

  const url = envUrl || localUrl || '';
  const key = envKey || localKey || '';
  const source = envUrl ? 'env' : localUrl ? 'localStorage' : 'none';

  return { url, key, source };
}

export function saveLocalCredentials(url, key) {
  if (url) localStorage.setItem(STORAGE_URL_KEY, url.trim());
  if (key) localStorage.setItem(STORAGE_ANON_KEY, key.trim());
}

export function clearLocalCredentials() {
  localStorage.removeItem(STORAGE_URL_KEY);
  localStorage.removeItem(STORAGE_ANON_KEY);
}

let cachedClient = null;
let lastUsedConfig = { url: '', key: '' };

/**
 * Instancia del cliente Supabase
 */
export function getSupabase() {
  const { url, key } = getActiveCredentials();
  if (!url || !key) return null;

  if (cachedClient && lastUsedConfig.url === url && lastUsedConfig.key === key) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, key);
    lastUsedConfig = { url, key };
    return cachedClient;
  } catch (error) {
    console.error('Error al inicializar cliente Supabase:', error);
    return null;
  }
}

/**
 * Prueba la conexión con el servidor Supabase
 */
export async function testSupabaseConnection() {
  const { url, key, source } = getActiveCredentials();
  if (!url || !key) {
    return {
      connected: false,
      status: 'unconfigured',
      message: 'Supabase no configurado. Operando en modo local.',
      source,
      latency: 0,
    };
  }

  const startTime = performance.now();
  const client = getSupabase();
  if (!client) {
    return {
      connected: false,
      status: 'error',
      message: 'No se pudo instanciar el cliente con las credenciales dadas.',
      source,
      latency: 0,
    };
  }

  try {
    // Intentar consultar tabla o health check
    const { data, error } = await client.from('estudiantes').select('id').limit(1);
    const latency = Math.round(performance.now() - startTime);

    if (error) {
      if (error.code === '42P01') {
        // La tabla no existe aún en Postgres
        return {
          connected: true,
          tableExists: false,
          status: 'table_missing',
          message: 'Conectado a Supabase, pero la tabla "estudiantes" aún no existe en tu base de datos.',
          source,
          latency,
        };
      }
      return {
        connected: false,
        status: 'error',
        message: `Error de Supabase: ${error.message}`,
        source,
        latency,
      };
    }

    return {
      connected: true,
      tableExists: true,
      status: 'ready',
      message: '¡Conexión y tabla verificadas en Supabase!',
      source,
      latency,
    };
  } catch (err) {
    const latency = Math.round(performance.now() - startTime);
    return {
      connected: false,
      status: 'network_error',
      message: `Error de red: ${err.message}`,
      source,
      latency,
    };
  }
}

/**
 * Helper para gestión de almacenamiento local de respaldo
 */
function getLocalEstudiantes() {
  const stored = localStorage.getItem(LOCAL_ESTUDIANTES_KEY);
  if (!stored) {
    localStorage.setItem(LOCAL_ESTUDIANTES_KEY, JSON.stringify(INITIAL_DEMO_DATA));
    return [...INITIAL_DEMO_DATA];
  }
  try {
    return JSON.parse(stored);
  } catch {
    return [...INITIAL_DEMO_DATA];
  }
}

function saveLocalEstudiantes(list) {
  localStorage.setItem(LOCAL_ESTUDIANTES_KEY, JSON.stringify(list));
}

// ============================================================================
// SERVICIOS CRUD DE ESTUDIANTES
// ============================================================================

/**
 * Obtiene todos los estudiantes registrados
 */
export async function getEstudiantes() {
  const client = getSupabase();

  if (client) {
    try {
      const { data, error } = await client
        .from('estudiantes')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        return { success: true, source: 'supabase', data };
      }
      console.warn('Fallback a almacenamiento local:', error?.message);
    } catch (err) {
      console.warn('Error al consultar Supabase, usando local:', err);
    }
  }

  // Fallback local
  return {
    success: true,
    source: 'local',
    data: getLocalEstudiantes(),
  };
}

/**
 * Registra un nuevo estudiante
 */
export async function createEstudiante(estudianteData) {
  const client = getSupabase();

  if (client) {
    try {
      const { data, error } = await client
        .from('estudiantes')
        .insert([estudianteData])
        .select()
        .single();

      if (!error && data) {
        return { success: true, source: 'supabase', data };
      }
      if (error) {
        throw new Error(error.message);
      }
    } catch (err) {
      // Si fue error de clave duplicada en Supabase
      if (err.message?.includes('duplicate key') || err.message?.includes('estudiantes_codigo_key')) {
        throw new Error(`El código "${estudianteData.codigo}" ya pertenece a otro estudiante en Supabase.`);
      }
      throw err;
    }
  }

  // Almacenamiento local si no hay Supabase
  const current = getLocalEstudiantes();
  const exists = current.some(e => e.codigo.trim().toUpperCase() === estudianteData.codigo.trim().toUpperCase());
  if (exists) {
    throw new Error(`El código "${estudianteData.codigo}" ya está registrado.`);
  }

  const newRecord = {
    ...estudianteData,
    id: 'local-' + Date.now(),
    created_at: new Date().toISOString(),
  };
  current.unshift(newRecord);
  saveLocalEstudiantes(current);

  return { success: true, source: 'local', data: newRecord };
}

/**
 * Actualiza los datos y notas de un estudiante
 */
export async function updateEstudiante(id, estudianteData) {
  const client = getSupabase();

  if (client) {
    try {
      const { data, error } = await client
        .from('estudiantes')
        .update({
          ...estudianteData,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (!error && data) {
        return { success: true, source: 'supabase', data };
      }
      if (error) throw new Error(error.message);
    } catch (err) {
      throw err;
    }
  }

  // Modo local
  const current = getLocalEstudiantes();
  const index = current.findIndex(e => e.id === id);
  if (index === -1) {
    throw new Error('Estudiante no encontrado para actualizar.');
  }

  current[index] = {
    ...current[index],
    ...estudianteData,
    updated_at: new Date().toISOString()
  };
  saveLocalEstudiantes(current);

  return { success: true, source: 'local', data: current[index] };
}

/**
 * Elimina un estudiante por su ID
 */
export async function deleteEstudiante(id) {
  const client = getSupabase();

  if (client) {
    try {
      const { error } = await client
        .from('estudiantes')
        .delete()
        .eq('id', id);

      if (error) throw new Error(error.message);
      return { success: true, source: 'supabase' };
    } catch (err) {
      throw err;
    }
  }

  // Modo local
  let current = getLocalEstudiantes();
  current = current.filter(e => e.id !== id);
  saveLocalEstudiantes(current);

  return { success: true, source: 'local' };
}
