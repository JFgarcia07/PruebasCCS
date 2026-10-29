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
- Cámara: foto cada 10 min (máx. 30) y alertas por cambio de pestaña, pérdida de foco, copiar/pegar o cámara cortada.
  Es disuasorio, no infalible.
# PruebasCCS

## Reportes de estudiante (automáticos, solo administración)
- Menú **Reportes**: de cada estudiante se suman **todos sus exámenes, sus entrevistas y su coevaluación**. El total (puntos y %) se interpreta con la **rúbrica de tipo reporte** que elijas arriba (o la escala predeterminada).
- Las entrevistas se asignan al estudiante por su nombre (alumno entrevistado, o hijo/a de un padre entrevistado). Los exámenes y la coevaluación, por su correo.
- En el informe de cada estudiante, **Excluir entrevistas** permite no contar las entrevistas reales y ponerlas **todas en cero** o **todas en puntaje completo** (30 puntos).
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

## Rúbricas
- **Rúbricas** (menú) tiene dos tipos, ambos con niveles según el porcentaje: *Examen* (mensaje que ve el estudiante) y *Reporte* (interpreta el total del informe de Reportes; la crea la administración). El maestro solo crea las de examen.
- Las rúbricas de **entrevista** ya no se crean: son las dos del colegio (a padres de familia y al estudiante, 15 puntos cada una) y viven en `js/core/interview-rubrics.js`.

## Roles
- **Maestro** (por defecto en toda cuenta nueva): crea sus exámenes y sus rúbricas (solo de tipo examen; las puede usar también en sus reportes); ve solo los resultados de sus propios exámenes.
- **Administración**: además ve todos los exámenes y resultados (con el profesor de cada uno), crea rúbricas de todos los tipos (examen, reporte y entrevista), llena las entrevistas y puede modificar notas a mano (se conserva la nota automática y queda marcada como *editada*).
- Para nombrar a la administración, una sola vez en el SQL Editor de Supabase (nadie puede cambiar su rol desde la app):
  `update public.profiles set role = 'admin' where email = 'correo@colegio.edu';`
- **Estudiante**: para entrar al examen escribe código, nombre y correo. Hay un intento por correo y examen.
- Entrevistas: siempre llevan entrevistado y entrevistador. Alumno: nombre, grado, edad y encargado. Padre/madre: nombre, hijo/a, edad y correo.

## Entrevistas y coevaluación (solo administración)
- **Entrevistas**: proceso de admisión, con las dos rúbricas fijas (5 criterios de 0 a 3 puntos, total 15). La administración abre una entrevista nueva (al estudiante o a padres), llena los datos (entrevistado, estudiante, grado, edad, encargado o correo, fecha, entrevistador), marca el nivel de cada criterio y el total se calcula solo. El grado se elige de una lista (7th a 11th) y se pueden anotar padre, madre y encargado (hasta 3).
- **Coevaluación**: lista de todos los estudiantes que han presentado algún examen. La administración escribe a mano el **porcentaje** de *Comportamiento* y de *Académico* (por ejemplo 80) y el sistema lo divide entre 10: puntos sobre 10 cada uno, total sobre 20.
