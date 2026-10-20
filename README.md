# 🎓 Sistema de Registro de Calificaciones • SIS224

Aplicativo web moderno para la gestión académica y registro de calificaciones de estudiantes, con cálculo automático de promedios, evaluación de condición aprobatoria y persistencia en base de datos en tiempo real mediante **Supabase**.

---

## 🚀 Características Principales

- **Registro de Datos del Estudiante**: Código único institucional, nombres, apellidos y asignatura.
- **Evaluación de 3 Calificaciones**: Validación estricta en escala vigesimal (rango obligatorio de `0.0` a `20.0`).
- **Cálculo Reactivo en Tiempo Real**:
  $$\text{Promedio} = \frac{\text{Nota}_1 + \text{Nota}_2 + \text{Nota}_3}{3}$$
- **Condición Académica Automatizada**:
  - **`✓ APROBADO`**: Si el promedio final es mayor o igual a **11** ($\ge 11.00$).
  - **`✕ DESAPROBADO`**: Si el promedio final es menor a **11** ($< 11.00$).
- **Visualizador Escalar Dinámico**: Barra de progreso con indicador de corte aprobatorio en la nota 11.
- **Panel Estadístico (KPIs)**: Muestra el total de estudiantes, % de aprobados, % de desaprobados y promedio general del curso.
- **Tabla con Operaciones CRUD**: Búsqueda en tiempo real por código o nombre, filtros por condición, edición y eliminación de registros.
- **Persistencia en la Nube con Supabase**: Sincronización directa con PostgreSQL y Row Level Security (RLS).

---

## 🛠️ Tecnologías Utilizadas

- **Frontend**: HTML5, Vanilla JavaScript (ES Modules), Vanilla CSS3 (Diseño Glassmorphic Dark UI).
- **Herramienta de Construcción**: [Vite](https://vite.dev/).
- **Base de Datos y Backend**: [Supabase](https://supabase.com/) (PostgreSQL + RLS).
- **Tipografía**: Google Fonts (*Outfit* y *JetBrains Mono*).

---

## 🗄️ Esquema de Base de Datos (Supabase SQL)

Ejecuta este script en el **SQL Editor** de tu proyecto en Supabase:

```sql
-- 1. Crear tabla de estudiantes y notas
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

-- 2. Habilitar Row Level Security (RLS)
alter table public.estudiantes enable row level security;

-- 3. Políticas de acceso público para desarrollo
create policy "Permitir lectura general" on public.estudiantes for select using (true);
create policy "Permitir insercion general" on public.estudiantes for insert with check (true);
create policy "Permitir actualizacion general" on public.estudiantes for update using (true);
create policy "Permitir eliminacion general" on public.estudiantes for delete using (true);
```

---

## 💻 Instalación y Ejecución Local

1. **Clonar el repositorio**:
   ```bash
   git clone https://github.com/ANTHONYCT-PROGRAMER/LENGUAJES-DE-PROGRAMACION.git
   ```

2. **Instalar dependencias**:
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**:
   Copia el archivo `.env.example` a `.env` y añade tus credenciales de Supabase:
   ```env
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_ANON_KEY=tu-anon-public-key
   ```

4. **Iniciar servidor de desarrollo**:
   ```bash
   npm run dev
   ```

5. Abrir en el navegador: `http://localhost:5173/`.
