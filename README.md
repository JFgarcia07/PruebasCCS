# Exámenes en línea

Frontend estático (HTML/CSS/JS) + Supabase (Auth, Postgres con RLS, funciones RPC).

## Puesta en marcha
1. Crea un proyecto en https://supabase.com.
2. SQL Editor → pega y ejecuta `supabase/schema.sql`.
3. Project Settings → API: copia *Project URL* y *anon key* en `config.js`.
4. (Opcional) Authentication → Providers → Email: desactiva "Confirm email" para que los profesores entren al registrarse.
5. Sirve la carpeta: `python -m http.server 8000` y abre http://localhost:8000
   (la cámara exige `localhost` o HTTPS). Para publicar: Netlify, Vercel, GitHub Pages o Cloudflare Pages.

## Arquitectura y seguridad
- Profesores: Supabase Auth; las políticas RLS limitan cada tabla al dueño del examen.
- Estudiantes: sin cuenta ni acceso a tablas; solo llaman RPC (`student_*`) que nunca devuelven las respuestas correctas.
  La nota se calcula en el servidor al enviar. Cada intento tiene un token secreto para reanudar tras recargar.
- Un intento por nombre normalizado y examen. El tiempo se valida en el servidor (30 s de gracia).
- Cámara: foto cada 30 s (máx. 60) y alertas por cambio de pestaña, pérdida de foco, copiar/pegar o cámara cortada.
  Es disuasorio, no infalible.
# PruebasCCS

## Reportes de estudiante
- Menú **Reportes** (profesor): crea el reporte de *un* estudiante (título, grado, período, nota máxima, lista opcional de cursos y rúbrica opcional) y copia el enlace `#/reporte/CÓDIGO`.
- Los demás docentes abren el enlace sin cuenta, eligen su curso y dejan la nota de la unidad y un comentario (RPC `report_*`). Un curso solo lo puede corregir el navegador que lo registró (token secreto).
- **Resultados** (botón en esa pantalla o en el reporte): tabla con todo lo registrado, promedio, cursos pendientes y **descarga en PDF** (jsPDF desde cdnjs).
- Si cambias de proyecto Supabase, vuelve a ejecutar `supabase/schema.sql` (la sección de reportes es idempotente).
