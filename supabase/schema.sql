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
declare e public.exams;
begin
  select * into e from public.exams where code = upper(btrim(p_code));
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
declare a public.attempts; e public.exams;
begin
  a := public._attempt(p_attempt, p_token);
  select * into e from public.exams where id = a.exam_id;
  if a.ended_at is not null then raise exception 'El examen ya fue enviado'; end if;
  if now() > a.started_at + make_interval(mins => e.minutes) + interval '30 seconds' then
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
