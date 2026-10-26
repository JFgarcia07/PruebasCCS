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

create or replace function public.student_start(p_code text, p_name text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e public.exams; a public.attempts; ord jsonb; r record;
begin
  select * into e from public.exams where code = upper(btrim(p_code));
  if not found then raise exception 'Código no encontrado'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Escribe tu nombre'; end if;

  select * into a from public.attempts where exam_id = e.id and name_key = public._norm(p_name);
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
    insert into public.attempts (exam_id, student_name, name_key, q_order)
      values (e.id, btrim(p_name), public._norm(p_name), coalesce(ord, '[]')) returning * into a;
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
  if (select count(*) from public.shots where attempt_id = a.id) >= 60 then return; end if;
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
revoke all on function public.student_exam_info(text), public.student_start(text, text, uuid),
  public.student_save(uuid, uuid, jsonb), public.student_flag(uuid, uuid, text),
  public.student_shot(uuid, uuid, text), public.student_submit(uuid, uuid, jsonb) from public;
grant execute on function public.student_exam_info(text), public.student_start(text, text, uuid),
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
