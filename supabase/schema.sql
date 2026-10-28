-- Esquema de Supabase para la app de exámenes.
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query → Run.
--
-- Seguridad:
--  * Profesores: Supabase Auth + RLS (cada profesor solo ve sus exámenes/intentos).
--  * Estudiantes: NO tienen acceso directo a las tablas. Solo llaman funciones RPC que
--    nunca devuelven las respuestas correctas, y la nota se calcula aquí en el servidor.

create extension if not exists unaccent with schema extensions;

create table if not exists public.exams (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  code        text not null unique,
  minutes     int  not null check (minutes > 0),
  camera      boolean not null default true,
  shuffle     boolean not null default false,
  show_score  boolean not null default true,
  questions   jsonb not null default '[]',   -- [{id,type:'mc'|'text',text,options,correct,answers,points}]
  created_at  timestamptz not null default now()
);

-- Rúbricas: mensajes que se muestran según el porcentaje obtenido.
--  levels = [{min, name, cls:'ok'|'warn'|'bad'|'', text}], de mayor a menor 'min'.
create table if not exists public.rubrics (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  levels      jsonb not null default '[]',
  created_at  timestamptz not null default now()
);
-- El examen guarda una copia de los niveles (levels) para que el estudiante la reciba sin acceder a las tablas.
-- levels null = escala predeterminada de la app.
alter table public.exams add column if not exists rubric_id uuid references public.rubrics(id) on delete set null;
alter table public.exams add column if not exists levels jsonb;

create table if not exists public.attempts (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid not null references public.exams(id) on delete cascade,
  student_name text not null,
  name_key     text not null,                 -- nombre normalizado: un intento por nombre
  token        uuid not null default gen_random_uuid(),  -- secreto del estudiante para reanudar
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  q_order      jsonb not null,
  answers      jsonb not null default '{}',
  score        numeric,
  max_score    numeric,
  flags        jsonb not null default '[]',
  unique (exam_id, name_key)
);

create table if not exists public.shots (
  id         bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  taken_at   timestamptz not null default now(),
  img        text not null
);
create index if not exists shots_attempt_idx on public.shots(attempt_id);

alter table public.rubrics  enable row level security;
alter table public.exams    enable row level security;
alter table public.attempts enable row level security;
alter table public.shots    enable row level security;

drop policy if exists rubrics_owner on public.rubrics;
create policy rubrics_owner on public.rubrics for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists exams_owner on public.exams;
create policy exams_owner on public.exams for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists attempts_owner_select on public.attempts;
create policy attempts_owner_select on public.attempts for select to authenticated
  using (exists (select 1 from public.exams e where e.id = exam_id and e.owner = auth.uid()));
drop policy if exists attempts_owner_delete on public.attempts;
create policy attempts_owner_delete on public.attempts for delete to authenticated
  using (exists (select 1 from public.exams e where e.id = exam_id and e.owner = auth.uid()));

drop policy if exists shots_owner_select on public.shots;
create policy shots_owner_select on public.shots for select to authenticated
  using (exists (select 1 from public.attempts a join public.exams e on e.id = a.exam_id
                 where a.id = attempt_id and e.owner = auth.uid()));

-- ---------- Helpers internos ----------
create or replace function public._norm(t text) returns text
language sql stable set search_path = public, extensions as $$
  select lower(unaccent(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')))
$$;

create or replace function public._grade(p_questions jsonb, p_answers jsonb, out score numeric, out max_score numeric)
language plpgsql stable set search_path = public, extensions as $$
declare q jsonb; a jsonb; ok boolean; pts numeric;
begin
  score := 0; max_score := 0;
  for q in select * from jsonb_array_elements(p_questions) loop
    pts := coalesce((q->>'points')::numeric, 1);
    max_score := max_score + pts;
    a := p_answers -> (q->>'id');
    ok := false;
    if a is not null and jsonb_typeof(a) <> 'null' then
      if q->>'type' = 'mc' then
        ok := case when jsonb_typeof(a) = 'number'
                   then (a #>> '{}')::numeric = (q->>'correct')::numeric else false end;
      else
        ok := exists (select 1 from jsonb_array_elements_text(q->'answers') x
                      where public._norm(x) = public._norm(a #>> '{}'));
      end if;
    end if;
    if ok then score := score + pts; end if;
  end loop;
end $$;

create or replace function public._attempt(p_attempt uuid, p_token uuid) returns public.attempts
language plpgsql security definer set search_path = public as $$
declare a public.attempts;
begin
  select * into a from public.attempts where id = p_attempt and token = p_token;
  if not found then raise exception 'Intento no válido'; end if;
  return a;
end $$;

-- ---------- API para estudiantes (anon) ----------
create or replace function public.student_exam_info(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select title, minutes, camera into e from public.exams where code = upper(btrim(p_code));
  if not found then raise exception 'Código no encontrado'; end if;
  return jsonb_build_object('title', e.title, 'minutes', e.minutes, 'camera', e.camera);
end $$;

-- La firma cambió (ahora pide el correo): se elimina la anterior para que nadie la use.
drop function if exists public.student_start(text, text, uuid);
create or replace function public.student_start(p_code text, p_name text, p_email text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e public.exams; a public.attempts; ord jsonb; r record; ek text;
begin
  select * into e from public.exams where code = upper(btrim(p_code));
  if not found then raise exception 'Código no encontrado'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Escribe tu nombre'; end if;
  ek := lower(btrim(coalesce(p_email, '')));
  if length(ek) > 200 or ek !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo electrónico válido'; end if;

  -- Un intento por correo y examen (la identidad del estudiante es su correo).
  select * into a from public.attempts where exam_id = e.id and email_key = ek;
  if found then
    if a.ended_at is not null or p_token is distinct from a.token then
      raise exception 'Ya presentaste este examen';
    end if;
    if now() > a.started_at + make_interval(mins => e.minutes) + interval '30 seconds' then
      select * into r from public._grade(e.questions, a.answers);
      update public.attempts set ended_at = now(), score = r.score, max_score = r.max_score where id = a.id;
      return jsonb_build_object('expired', true);  -- (un raise revertiría el UPDATE)
    end if;
    update public.attempts
       set flags = flags || jsonb_build_array(jsonb_build_object('t', (extract(epoch from now())*1000)::bigint, 'msg', 'Reanudó el examen (recarga o reingreso)'))
     where id = a.id returning * into a;
  else
    select jsonb_agg(q->>'id' order by case when e.shuffle then random() else n end)
      into ord from jsonb_array_elements(e.questions) with ordinality t(q, n);
    insert into public.attempts (exam_id, student_name, name_key, email, email_key, q_order)
      values (e.id, left(btrim(p_name), 150), public._norm(p_name), left(btrim(p_email), 200), ek, coalesce(ord, '[]')) returning * into a;
  end if;

  return jsonb_build_object(
    'attempt_id', a.id, 'token', a.token, 'started_at', a.started_at, 'now', now(),
    'minutes', e.minutes, 'title', e.title, 'camera', e.camera, 'show_score', e.show_score,
    'order', a.q_order, 'answers', a.answers,
    'questions', (select coalesce(jsonb_agg(q - 'correct' - 'answers'), '[]') from jsonb_array_elements(e.questions) q));
end $$;

create or replace function public.student_save(p_attempt uuid, p_token uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a public.attempts; mins int;
begin
  a := public._attempt(p_attempt, p_token);
  select minutes into mins from public.exams where id = a.exam_id;   -- solo la duración: el examen completo pesa MB
  if a.ended_at is not null then raise exception 'El examen ya fue enviado'; end if;
  if now() > a.started_at + make_interval(mins => mins) + interval '30 seconds' then
    raise exception 'Tiempo agotado';
  end if;
  update public.attempts set answers = coalesce(p_answers, '{}') where id = a.id;
end $$;

create or replace function public.student_flag(p_attempt uuid, p_token uuid, p_msg text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.attempts;
begin
  a := public._attempt(p_attempt, p_token);
  if a.ended_at is not null or jsonb_array_length(a.flags) >= 200 then return; end if;
  update public.attempts
     set flags = flags || jsonb_build_array(jsonb_build_object('t', (extract(epoch from now())*1000)::bigint, 'msg', left(p_msg, 200)))
   where id = a.id;
end $$;

create or replace function public.student_shot(p_attempt uuid, p_token uuid, p_img text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.attempts;
begin
  a := public._attempt(p_attempt, p_token);
  if a.ended_at is not null or length(p_img) > 80000 then return; end if;
  if (select count(*) from public.shots where attempt_id = a.id) >= 30 then return; end if;
  insert into public.shots (attempt_id, img) values (a.id, p_img);
end $$;

create or replace function public.student_submit(p_attempt uuid, p_token uuid, p_answers jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.attempts; e public.exams; r record;
begin
  a := public._attempt(p_attempt, p_token);
  select * into e from public.exams where id = a.exam_id;
  if a.ended_at is null then
    if p_answers is not null and now() <= a.started_at + make_interval(mins => e.minutes) + interval '30 seconds' then
      a.answers := p_answers;
    end if;
    select * into r from public._grade(e.questions, a.answers);
    update public.attempts set answers = a.answers, ended_at = now(), score = r.score, max_score = r.max_score
     where id = a.id returning * into a;
  end if;
  return jsonb_build_object('show', e.show_score,
    'score', case when e.show_score then a.score end,
    'max',   case when e.show_score then a.max_score end,
    'levels', case when e.show_score then e.levels end);
end $$;

-- ---------- Permisos ----------
revoke all on function public._norm(text), public._grade(jsonb, jsonb), public._attempt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.student_exam_info(text), public.student_start(text, text, text, uuid),
  public.student_save(uuid, uuid, jsonb), public.student_flag(uuid, uuid, text),
  public.student_shot(uuid, uuid, text), public.student_submit(uuid, uuid, jsonb) from public;
grant execute on function public.student_exam_info(text), public.student_start(text, text, text, uuid),
  public.student_save(uuid, uuid, jsonb), public.student_flag(uuid, uuid, text),
  public.student_shot(uuid, uuid, text), public.student_submit(uuid, uuid, jsonb) to anon, authenticated;


-- =====================================================================
-- REPORTES DE ESTUDIANTE
-- Un profesor crea el reporte de UN estudiante y comparte el enlace. Cada docente que lo recibe
-- elige su curso y deja la nota de la unidad y un comentario (sin cuenta, vía RPC).
-- Ejecutar esta sección es seguro aunque ya hayas corrido lo anterior.
-- =====================================================================
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null,
  student_name text not null,
  grade_level  text not null default '',
  period       text not null default '',
  code         text not null unique,
  max_score    numeric not null default 100 check (max_score > 0),
  courses      jsonb not null default '[]',   -- lista de cursos a elegir; vacía = el docente escribe el curso
  rubric_id    uuid references public.rubrics(id) on delete set null,
  levels       jsonb,                         -- copia de la rúbrica (null = sin rúbrica)
  created_at   timestamptz not null default now()
);

create table if not exists public.report_entries (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports(id) on delete cascade,
  course       text not null,
  course_key   text not null,                 -- curso normalizado: un registro por curso
  teacher_name text not null,
  score        numeric not null,
  comment      text not null default '',
  token        uuid not null default gen_random_uuid(),  -- secreto del docente para corregir su registro
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (report_id, course_key)
);

alter table public.reports        enable row level security;
alter table public.report_entries enable row level security;

drop policy if exists reports_owner on public.reports;
create policy reports_owner on public.reports for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists report_entries_owner_select on public.report_entries;
create policy report_entries_owner_select on public.report_entries for select to authenticated
  using (exists (select 1 from public.reports r where r.id = report_id and r.owner = auth.uid()));
drop policy if exists report_entries_owner_delete on public.report_entries;
create policy report_entries_owner_delete on public.report_entries for delete to authenticated
  using (exists (select 1 from public.reports r where r.id = report_id and r.owner = auth.uid()));

create or replace function public.report_info(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.reports;
begin
  select * into r from public.reports where code = upper(btrim(p_code));
  if not found then raise exception 'Reporte no encontrado'; end if;
  return jsonb_build_object('title', r.title, 'student_name', r.student_name, 'grade_level', r.grade_level,
    'period', r.period, 'max_score', r.max_score, 'courses', r.courses,
    'filled', (select coalesce(jsonb_agg(course), '[]') from public.report_entries where report_id = r.id));
end $$;

create or replace function public.report_submit(p_code text, p_course text, p_teacher text, p_score numeric,
                                                p_comment text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r public.reports; en public.report_entries; c text; k text; listed text;
begin
  select * into r from public.reports where code = upper(btrim(p_code));
  if not found then raise exception 'Reporte no encontrado'; end if;
  c := left(btrim(coalesce(p_course, '')), 100);
  if c = '' then raise exception 'Selecciona el curso'; end if;
  if btrim(coalesce(p_teacher, '')) = '' then raise exception 'Escribe tu nombre'; end if;
  if jsonb_array_length(r.courses) > 0 then
    select x into listed from jsonb_array_elements_text(r.courses) x where public._norm(x) = public._norm(c) limit 1;
    if listed is null then raise exception 'Curso no válido para este reporte'; end if;
    c := listed;
  end if;
  if p_score is null or p_score < 0 or p_score > r.max_score then
    raise exception 'La nota debe estar entre 0 y %', r.max_score;
  end if;
  k := public._norm(c);

  select * into en from public.report_entries where report_id = r.id and course_key = k;
  if found then
    if p_token is distinct from en.token then raise exception 'Ese curso ya fue registrado por otro docente'; end if;
    update public.report_entries
       set teacher_name = left(btrim(p_teacher), 120), score = p_score, comment = left(coalesce(p_comment, ''), 2000), updated_at = now()
     where id = en.id returning * into en;
  else
    if (select count(*) from public.report_entries where report_id = r.id) >= 100 then
      raise exception 'Este reporte ya alcanzó el máximo de registros';
    end if;
    insert into public.report_entries (report_id, course, course_key, teacher_name, score, comment)
      values (r.id, c, k, left(btrim(p_teacher), 120), p_score, left(coalesce(p_comment, ''), 2000))
      returning * into en;
  end if;
  return jsonb_build_object('token', en.token, 'course', en.course);
end $$;

create or replace function public.report_my_entry(p_code text, p_course text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r public.reports; en public.report_entries;
begin
  select * into r from public.reports where code = upper(btrim(p_code));
  if not found then return null; end if;
  select * into en from public.report_entries
   where report_id = r.id and course_key = public._norm(p_course) and token = p_token;
  if not found then return null; end if;
  return jsonb_build_object('teacher', en.teacher_name, 'score', en.score, 'comment', en.comment);
end $$;

revoke all on function public.report_info(text), public.report_submit(text, text, text, numeric, text, uuid),
  public.report_my_entry(text, text, uuid) from public;
grant execute on function public.report_info(text), public.report_submit(text, text, text, numeric, text, uuid),
  public.report_my_entry(text, text, uuid) to anon, authenticated;


-- =====================================================================
-- RENDIMIENTO Y TRANSFERENCIA DE EXÁMENES
-- Ejecutar esta sección es seguro aunque ya hayas corrido lo anterior.
-- =====================================================================

-- Número de preguntas guardado aparte: el listado de exámenes ya no descarga las preguntas
-- (con audios incrustados pueden pesar varios MB por examen).
alter table public.exams add column if not exists n_questions int not null default 0;

create or replace function public._exam_count() returns trigger language plpgsql as $$
begin new.n_questions := jsonb_array_length(new.questions); return new; end $$;
drop trigger if exists exams_count on public.exams;
create trigger exams_count before insert or update of questions on public.exams
  for each row execute function public._exam_count();
update public.exams set n_questions = jsonb_array_length(questions) where n_questions = 0;

create index if not exists exams_owner_idx on public.exams(owner, created_at desc);
create index if not exists attempts_started_idx on public.attempts(exam_id, started_at desc);
create index if not exists reports_owner_idx on public.reports(owner, created_at desc);
create index if not exists report_entries_report_idx on public.report_entries(report_id);

-- Conteo de intentos por examen en el servidor (en vez de bajar todos los intentos).
create or replace function public.my_exam_counts() returns table(exam_id uuid, n bigint)
language sql stable security invoker set search_path = public as $$
  select a.exam_id, count(*) from public.attempts a group by a.exam_id
$$;
revoke all on function public.my_exam_counts() from public, anon;
grant execute on function public.my_exam_counts() to authenticated;

-- Pasa exámenes (con sus intentos y fotos) a otro profesor registrado, por correo.
-- Los exámenes dejan de aparecer en la cuenta de origen. La rúbrica vinculada se desvincula
-- (pertenece al profesor original), pero el examen conserva una copia de sus niveles.
create or replace function public.transfer_exams(p_ids uuid[], p_email text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); target uuid; n int;
begin
  if me is null then raise exception 'Inicia sesión primero'; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Elige al menos un examen'; end if;
  select id into target from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if target is null then raise exception 'No hay ninguna cuenta registrada con ese correo. Pídele que cree su cuenta primero.'; end if;
  if target = me then raise exception 'Ese correo es el de tu propia cuenta'; end if;
  update public.exams set owner = target, rubric_id = null where id = any(p_ids) and owner = me;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No se encontró ningún examen tuyo para enviar'; end if;
  return jsonb_build_object('sent', n);
end $$;
revoke all on function public.transfer_exams(uuid[], text) from public, anon;
grant execute on function public.transfer_exams(uuid[], text) to authenticated;


-- ---------- Audios en Storage (CDN) y limpieza de fotos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audios', 'audios', true, 10485760,
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/aac','audio/mp4','audio/x-m4a','audio/webm'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists audios_upload on storage.objects;
create policy audios_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists audios_delete on storage.objects;
create policy audios_delete on storage.objects for delete to authenticated
  using (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);

-- Borra las fotos de cámara con más de p_days días de los exámenes del profesor (conserva notas y alertas).
create or replace function public.purge_old_shots(p_days int default 60) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  delete from public.shots s using public.attempts a, public.exams e
   where s.attempt_id = a.id and a.exam_id = e.id and e.owner = auth.uid()
     and s.taken_at < now() - make_interval(days => greatest(p_days, 7));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_old_shots(int) from public, anon;
grant execute on function public.purge_old_shots(int) to authenticated;


-- =====================================================================
-- RÚBRICAS POR TIPO (examen / reporte / entrevista) Y ENTREVISTAS
-- Ejecutar esta sección es seguro aunque ya hayas corrido lo anterior.
-- =====================================================================
alter table public.rubrics add column if not exists kind text not null default 'exam';
alter table public.rubrics drop constraint if exists rubrics_kind_check;
alter table public.rubrics add constraint rubrics_kind_check check (kind in ('exam', 'report', 'interview'));
-- Rúbrica de entrevista: criterios con valor máximo: [{id, name, description, max}]
alter table public.rubrics add column if not exists criteria jsonb not null default '[]';

-- Las rúbricas que hoy usan solo reportes pasan a ser de tipo reporte (las demás quedan como examen).
update public.rubrics set kind = 'report'
 where kind = 'exam'
   and id in (select rubric_id from public.reports where rubric_id is not null)
   and id not in (select rubric_id from public.exams where rubric_id is not null);

-- Entrevistas: una fila por entrevistado; scores = { criterioId: nota }
create table if not exists public.interviews (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rubric_id    uuid not null references public.rubrics(id) on delete cascade,
  subject_name text not null,
  subject_type text not null default 'alumno' check (subject_type in ('alumno', 'padre')),
  scores       jsonb not null default '{}',
  notes        text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists interviews_rubric_idx on public.interviews(rubric_id, created_at);
create index if not exists rubrics_owner_kind_idx on public.rubrics(owner, kind);
alter table public.interviews enable row level security;
drop policy if exists interviews_owner on public.interviews;
create policy interviews_owner on public.interviews for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());


-- =====================================================================
-- ROLES (ADMIN / MAESTRO), CORREO DEL ESTUDIANTE, ENTREVISTAS DE LA ADMINISTRACIÓN Y NOTAS A MANO
-- Ejecutar esta sección es seguro aunque ya hayas corrido lo anterior.
--
-- IMPORTANTE: después de ejecutarla, nombra a la administración (una vez, por correo):
--   update public.profiles set role = 'admin' where email = 'correo.de.la.administracion@colegio.edu';
-- Todas las demás cuentas son 'teacher' (maestro) por defecto.
-- =====================================================================

-- Perfiles: un rol por cuenta. Nadie puede cambiar su propio rol desde la app (no hay política de escritura).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  name       text not null default '',
  role       text not null default 'teacher' check (role in ('admin', 'teacher')),
  created_at timestamptz not null default now()
);
insert into public.profiles (id, email) select id, coalesce(email, '') from auth.users on conflict (id) do nothing;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, '')) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());

-- Exámenes: cada maestro ve y edita los suyos; la administración los ve todos (solo lectura).
drop policy if exists exams_owner on public.exams;
drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams for select to authenticated using (owner = auth.uid() or public.is_admin());
drop policy if exists exams_insert on public.exams;
create policy exams_insert on public.exams for insert to authenticated with check (owner = auth.uid());
drop policy if exists exams_update on public.exams;
create policy exams_update on public.exams for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists exams_delete on public.exams;
create policy exams_delete on public.exams for delete to authenticated using (owner = auth.uid());

-- Intentos y fotos: el dueño del examen y la administración.
drop policy if exists attempts_owner_select on public.attempts;
create policy attempts_owner_select on public.attempts for select to authenticated
  using (public.is_admin() or exists (select 1 from public.exams e where e.id = exam_id and e.owner = auth.uid()));
drop policy if exists shots_owner_select on public.shots;
create policy shots_owner_select on public.shots for select to authenticated
  using (public.is_admin() or exists (select 1 from public.attempts a join public.exams e on e.id = a.exam_id
                 where a.id = attempt_id and e.owner = auth.uid()));

-- Rúbricas: el maestro crea solo las de examen; la administración crea las de todos los tipos (y ve todas las de entrevista).
drop policy if exists rubrics_owner on public.rubrics;
drop policy if exists rubrics_select on public.rubrics;
create policy rubrics_select on public.rubrics for select to authenticated
  using (owner = auth.uid() or (kind = 'interview' and public.is_admin()));
drop policy if exists rubrics_insert on public.rubrics;
create policy rubrics_insert on public.rubrics for insert to authenticated
  with check (owner = auth.uid() and (kind = 'exam' or public.is_admin()));
drop policy if exists rubrics_update on public.rubrics;
create policy rubrics_update on public.rubrics for update to authenticated
  using (owner = auth.uid() or (kind = 'interview' and public.is_admin()))
  with check ((owner = auth.uid() or public.is_admin()) and (kind = 'exam' or public.is_admin()));
drop policy if exists rubrics_delete on public.rubrics;
create policy rubrics_delete on public.rubrics for delete to authenticated
  using (owner = auth.uid() or (kind = 'interview' and public.is_admin()));

-- Estudiante: correo del intento (un intento por correo y examen). Los intentos antiguos quedan sin correo.
alter table public.attempts add column if not exists email text;
alter table public.attempts add column if not exists email_key text;
alter table public.attempts drop constraint if exists attempts_exam_id_name_key_key;
create unique index if not exists attempts_exam_email_uq on public.attempts(exam_id, email_key) where email_key is not null;

-- Notas modificadas a mano por la administración (se conserva la nota automática original).
alter table public.attempts add column if not exists score_auto numeric;
alter table public.attempts add column if not exists score_edited_by uuid references auth.users(id) on delete set null;
alter table public.attempts add column if not exists score_edited_at timestamptz;

create or replace function public.admin_set_score(p_attempt uuid, p_score numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.attempts;
begin
  if not public.is_admin() then raise exception 'Solo la administración puede modificar notas'; end if;
  select * into a from public.attempts where id = p_attempt;
  if not found then raise exception 'Intento no encontrado'; end if;
  if a.ended_at is null then raise exception 'El examen sigue en curso'; end if;
  if p_score is null or p_score < 0 or p_score > coalesce(a.max_score, 0) then
    raise exception 'La nota debe estar entre 0 y %', coalesce(a.max_score, 0);
  end if;
  update public.attempts set score_auto = coalesce(score_auto, score), score = p_score,
         score_edited_by = auth.uid(), score_edited_at = now() where id = a.id;
  return jsonb_build_object('score', p_score);
end $$;
revoke all on function public.admin_set_score(uuid, numeric) from public, anon;
grant execute on function public.admin_set_score(uuid, numeric) to authenticated;

-- Entrevistas: solo la administración. Alumno: nombre, grado, edad, encargado. Padre: nombre, hijo/a, edad, correo.
-- Siempre: entrevistado (subject_name) y entrevistador.
alter table public.interviews add column if not exists interviewer text not null default '';
alter table public.interviews add column if not exists grade text;
alter table public.interviews add column if not exists age int;
alter table public.interviews add column if not exists guardian text;
alter table public.interviews add column if not exists child_name text;
alter table public.interviews add column if not exists email text;
drop policy if exists interviews_owner on public.interviews;
drop policy if exists interviews_admin on public.interviews;
create policy interviews_admin on public.interviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- =====================================================================
-- COEVALUACIÓN DOCENTE (solo la administración la crea y la ve; los docentes responden sin cuenta, vía RPC)
-- Misma mecánica que los reportes de estudiante. La rúbrica (criterios x niveles) se guarda copiada en cada coevaluación.
-- Ejecutar esta sección es seguro aunque ya hayas corrido lo anterior.
-- =====================================================================
create table if not exists public.coevals (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null,
  student_name text not null,
  grade_level  text not null default '',
  period       text not null default '',
  code         text not null unique,
  courses      jsonb not null default '[]',
  rubric       jsonb not null,   -- {levels:[{v,name}], sections:[{id,name,points,criteria:[{id,name,desc:{4,3,2,1}}]}]}
  created_at   timestamptz not null default now()
);
create table if not exists public.coeval_entries (
  id           uuid primary key default gen_random_uuid(),
  coeval_id    uuid not null references public.coevals(id) on delete cascade,
  course       text not null,
  course_key   text not null,
  teacher_name text not null,
  scores       jsonb not null,   -- { "A.respeto": 4, ... }
  comment      text not null default '',
  token        uuid not null default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (coeval_id, course_key)
);
create index if not exists coevals_created_idx on public.coevals(created_at desc);
-- Se crean desde Resultados: una coevaluación por intento de examen (se conserva aunque se borre el intento).
alter table public.coevals add column if not exists attempt_id uuid references public.attempts(id) on delete set null;
alter table public.coevals add column if not exists student_email text;
alter table public.coevals add column if not exists exam_title text;
create unique index if not exists coevals_attempt_uq on public.coevals(attempt_id) where attempt_id is not null;

alter table public.coevals enable row level security;
alter table public.coeval_entries enable row level security;
drop policy if exists coevals_admin on public.coevals;
create policy coevals_admin on public.coevals for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists coeval_entries_admin_select on public.coeval_entries;
create policy coeval_entries_admin_select on public.coeval_entries for select to authenticated using (public.is_admin());
drop policy if exists coeval_entries_admin_delete on public.coeval_entries;
create policy coeval_entries_admin_delete on public.coeval_entries for delete to authenticated using (public.is_admin());

create or replace function public.coeval_info(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.coevals;
begin
  select * into c from public.coevals where code = upper(btrim(p_code));
  if not found then raise exception 'Coevaluación no encontrada'; end if;
  return jsonb_build_object('title', c.title, 'student_name', c.student_name, 'grade_level', c.grade_level,
    'period', c.period, 'courses', c.courses, 'rubric', c.rubric, 'exam_title', coalesce(c.exam_title, ''),
    'filled', (select coalesce(jsonb_agg(course), '[]') from public.coeval_entries where coeval_id = c.id));
end $$;

create or replace function public.coeval_submit(p_code text, p_course text, p_teacher text, p_scores jsonb,
                                                p_comment text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c public.coevals; en public.coeval_entries; cn text; k text; listed text;
        sec jsonb; cr jsonb; key text; v text; top int; clean jsonb := '{}';
begin
  select * into c from public.coevals where code = upper(btrim(p_code));
  if not found then raise exception 'Coevaluación no encontrada'; end if;
  cn := left(btrim(coalesce(p_course, '')), 100);
  if cn = '' then raise exception 'Selecciona el curso'; end if;
  if btrim(coalesce(p_teacher, '')) = '' then raise exception 'Escribe tu nombre'; end if;
  if jsonb_array_length(c.courses) > 0 then
    select x into listed from jsonb_array_elements_text(c.courses) x where public._norm(x) = public._norm(cn) limit 1;
    if listed is null then raise exception 'Curso no válido para esta coevaluación'; end if;
    cn := listed;
  end if;
  -- cada criterio de la rúbrica debe traer un nivel válido; lo demás se descarta
  select max((l->>'v')::int) into top from jsonb_array_elements(c.rubric->'levels') l;
  for sec in select * from jsonb_array_elements(c.rubric->'sections') loop
    for cr in select * from jsonb_array_elements(sec->'criteria') loop
      key := (sec->>'id') || '.' || (cr->>'id');
      v := p_scores ->> key;
      if v is null or v !~ '^[0-9]+$' or v::int < 1 or v::int > top then
        raise exception 'Falta calificar el criterio: %', cr->>'name';
      end if;
      clean := clean || jsonb_build_object(key, v::int);
    end loop;
  end loop;
  k := public._norm(cn);

  select * into en from public.coeval_entries where coeval_id = c.id and course_key = k;
  if found then
    if p_token is distinct from en.token then raise exception 'Ese curso ya fue registrado por otro docente'; end if;
    update public.coeval_entries
       set teacher_name = left(btrim(p_teacher), 120), scores = clean, comment = left(coalesce(p_comment, ''), 2000), updated_at = now()
     where id = en.id returning * into en;
  else
    if (select count(*) from public.coeval_entries where coeval_id = c.id) >= 100 then
      raise exception 'Esta coevaluación ya alcanzó el máximo de registros';
    end if;
    insert into public.coeval_entries (coeval_id, course, course_key, teacher_name, scores, comment)
      values (c.id, cn, k, left(btrim(p_teacher), 120), clean, left(coalesce(p_comment, ''), 2000))
      returning * into en;
  end if;
  return jsonb_build_object('token', en.token, 'course', en.course);
end $$;

create or replace function public.coeval_my_entry(p_code text, p_course text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c public.coevals; en public.coeval_entries;
begin
  select * into c from public.coevals where code = upper(btrim(p_code));
  if not found then return null; end if;
  select * into en from public.coeval_entries
   where coeval_id = c.id and course_key = public._norm(p_course) and token = p_token;
  if not found then return null; end if;
  return jsonb_build_object('teacher', en.teacher_name, 'scores', en.scores, 'comment', en.comment);
end $$;

revoke all on function public.coeval_info(text), public.coeval_submit(text, text, text, jsonb, text, uuid),
  public.coeval_my_entry(text, text, uuid) from public;
grant execute on function public.coeval_info(text), public.coeval_submit(text, text, text, jsonb, text, uuid),
  public.coeval_my_entry(text, text, uuid) to anon, authenticated;
