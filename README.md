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

## Reportes de estudiante (automáticos, solo administración)
- Menú **Reportes**: de cada estudiante se suman **todos sus exámenes, sus entrevistas y su coevaluación**. El total (puntos y %) se interpreta con la **rúbrica de tipo reporte** que elijas arriba (o la escala predeterminada).
- Las entrevistas se asignan al estudiante por su nombre (alumno entrevistado, o hijo/a de un padre entrevistado). Los exámenes y la coevaluación, por su correo.
- La administración puede **ajustar la nota a mano** (queda marcada como ajustada, con motivo) y **descargar el informe en PDF**.

## Enviar exámenes a otro profesor
- En **Mis exámenes** → **📤 Enviar exámenes**: elige los exámenes y escribe el correo de otro profesor (debe tener cuenta). Pasan a su cuenta con todos sus intentos y desaparecen de la tuya (RPC `transfer_exams`). La rúbrica vinculada se desvincula, pero el examen conserva sus niveles.

## Rendimiento (≈50 estudiantes a la vez)
- El listado de exámenes ya no descarga las preguntas (con audios pesan MB): usa `n_questions` y la RPC `my_exam_counts`; el examen completo se pide solo al editar, exportar o ver un intento.
- El autoguardado, la verificación del código y el resto de las RPC de estudiante ya no leen el examen completo.
- Se añadieron índices. **Vuelve a ejecutar `supabase/schema.sql` completo** en el SQL Editor para aplicar todo.

## Estructura del código (`js/`)
Módulos ES nativos: no hay paso de compilación; Live Server, Netlify o Cloudflare Pages lo sirven tal cual.
- `main.js`: punto de entrada. Registra las vistas/acciones de cada módulo, conecta los clics y arranca.
- `events.js`: eventos de formularios (`input` / `change`).
- `core/`: `config.js` (cliente Supabase), `state.js` (estado compartido), `router.js` (navegación), `api.js` (consultas y RPC con reintentos), `ui.js` (avisos, confirmaciones), `levels.js`, `util.js`, `run.js` (cierre del examen en curso).
- `features/`: un archivo por área; cada uno exporta sus `views`, `loaders` (datos que cargan) y `acts` (acciones de los botones `data-act`).
  `auth` · `exams` · `rubrics` · `reports` · `results` · `student` · `audio`.
- Para añadir una pantalla nueva: crea el archivo en `features/`, exporta `views` / `loaders` / `acts` y añádelo en la lista de `main.js`.

## Rúbricas por tipo y entrevistas
- **Rúbricas** tiene tres pestañas: *Examen* y *Reporte* (niveles según el porcentaje; cada una se asigna en su editor) y *Entrevista* (criterios con valor máximo).
- **Entrevistas** (menú): eliges una rúbrica de entrevista y llenas la tabla entrevistados × criterios (alumnos o padres de familia). El total se calcula solo y cada nota se guarda al salir de la casilla.
- Requiere volver a ejecutar `supabase/schema.sql` (sección final: columnas `kind`/`criteria` y tabla `interviews`). Las rúbricas existentes quedan como *Examen*, salvo las que solo usan reportes, que pasan a *Reporte*.

## Roles
- **Maestro** (por defecto en toda cuenta nueva): crea sus exámenes y sus rúbricas (solo de tipo examen; las puede usar también en sus reportes); ve solo los resultados de sus propios exámenes.
- **Administración**: además ve todos los exámenes y resultados (con el profesor de cada uno), crea rúbricas de todos los tipos (examen, reporte y entrevista), llena las entrevistas y puede modificar notas a mano (se conserva la nota automática y queda marcada como *editada*).
- Para nombrar a la administración, una sola vez en el SQL Editor de Supabase (nadie puede cambiar su rol desde la app):
  `update public.profiles set role = 'admin' where email = 'correo@colegio.edu';`
- **Estudiante**: para entrar al examen escribe código, nombre y correo. Hay un intento por correo y examen.
- Entrevistas: siempre llevan entrevistado y entrevistador. Alumno: nombre, grado, edad y encargado. Padre/madre: nombre, hijo/a, edad y correo.

## Coevaluación docente (solo administración)
- Menú **Coevaluación**: lista de todos los estudiantes que han presentado algún examen (sin importar cuál). La administración pulsa *Evaluar* y califica ahí mismo, de 1 a 4, los 12 criterios de la rúbrica por defecto: *Comportamiento* (6 criterios, 10 pts) y *Académico* (6 criterios, 10 pts). Puntos de cada sección = suma de niveles ÷ máximo × 10; total sobre 20.
- Una evaluación por estudiante (por su correo); se puede editar o quitar. Hay búsqueda y filtro de pendientes/evaluados. No genera PDF.
- La rúbrica está en `js/core/coeval-rubric.js`.
