-- =====================================================================
-- RomaDetalles — el día límite de entrega/recogida se puede compartir
-- =====================================================================
-- Cambia la regla de choque de reservas: hasta ahora, si un evento
-- entregaba el mismo día en que otro recogía, el sistema contaba el
-- día completo como ocupado por los dos y bloqueaba el segundo. Eso
-- era deliberado (ver sql/11, "Es el comportamiento pedido"), pero el
-- negocio decidió el 2026-08-18 que sí quiere compartir ese día:
--
--   Evento el 31 → [30 recoge, 31 usa, 1 entrega]
--   Evento el 2  → [1 recoge, 2 usa, 3 entrega]
--
-- El 1 es entrega de uno y recogida del otro. A partir de ahora NO
-- choca. Si comparten 2 días o más, se sigue bloqueando igual que
-- antes — solo se afloja el borde de un solo día.
--
-- RIESGO ASUMIDO A PROPÓSITO: si el negocio se atrasa devolviendo o
-- alistando el artículo ese día límite, dos eventos podrían
-- necesitarlo al mismo tiempo real. El sistema ya no lo evita; queda
-- en la logística del negocio.
--
-- Toca las 4 funciones que comparten esta regla — deben cambiar juntas
-- o quedarían inconsistentes entre sí (una bloquearía lo que otra
-- permite):
--   1. alquiler_disponibilidad      (lo que ve tienda y panel)
--   2. alquiler_crear_pedido        (alta pública)
--   3. alquiler_crear_pedido_manual (alta desde el panel)
--   4. alquiler_editar_pedido       (edición de una reserva)
--
-- Ninguna cambia de firma: no hace falta redesplegar Edge Functions.
-- Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Disponibilidad
-- ---------------------------------------------------------------------
create or replace function alquiler_disponibilidad(
  p_negocio uuid,
  p_inicio  date,
  p_fin     date
)
returns table (
  producto_id uuid,
  cantidad    int,
  reservado   int,
  disponible  int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.cantidad,
    coalesce(r.reservado, 0)::int,
    greatest(0, p.cantidad - p.fuera_de_servicio - coalesce(r.reservado, 0))::int
  from alquiler_productos p
  left join (
    select i.producto_id, sum(i.cantidad) as reservado
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where ped.negocio_id = p_negocio
      -- Estricto en vez de inclusive: un día compartido en el borde
      -- (entrega de uno = recogida del otro) ya no cuenta como choque.
      and ped.fecha_inicio < p_fin
      and ped.fecha_fin    > p_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      )
    group by i.producto_id
  ) r on r.producto_id = p.id
  where p.negocio_id = p_negocio
    and p.activo = true
  order by p.orden, p.creado_en;
$$;

-- ---------------------------------------------------------------------
-- 2. Crear pedido (público, vía Edge Function)
-- ---------------------------------------------------------------------
create or replace function alquiler_crear_pedido(
  p_negocio  uuid,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_evento   date,
  p_items    jsonb
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio   alquiler_negocios;
  v_inicio    date;
  v_fin       date;
  v_total     numeric(12,2) := 0;
  v_pedido_id text;
  v_pedido    alquiler_pedidos;
  v_item      jsonb;
  v_prod      alquiler_productos;
  v_pedida    int;
  v_disp      int;
begin
  select * into v_negocio
  from alquiler_negocios
  where id = p_negocio and activo = true;

  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  v_inicio := p_evento - 1;
  v_fin    := p_evento + 1;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_evento, fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_evento, v_inicio, v_fin, 1, 0, 'pendiente', coalesce(p_notas, ''),
    now() + make_interval(hours => v_negocio.horas_reserva)
  )
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = p_negocio
      and activo = true;

    if not found then
      raise exception 'PRODUCTO_NO_EXISTE';
    end if;

    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> v_pedido_id
      and ped.negocio_id = p_negocio
      and ped.fecha_inicio < v_fin
      and ped.fecha_fin    > v_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_pedida > v_disp then
      raise exception 'SIN_STOCK:%', v_prod.nombre;
    end if;

    insert into alquiler_pedido_items
      (pedido_id, producto_id, producto_nombre, precio_dia, cantidad)
    values
      (v_pedido_id, v_prod.id, v_prod.nombre, v_prod.precio_dia, v_pedida);

    v_total := v_total + (v_prod.precio_dia * v_pedida);
  end loop;

  update alquiler_pedidos
     set total = v_total,
         anticipo = alquiler_anticipo(
           v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
         ),
         actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Reserva manual (admin, ya confirmada)
-- ---------------------------------------------------------------------
create or replace function alquiler_crear_pedido_manual(
  p_negocio  uuid,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_evento   date,
  p_items    jsonb
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio   alquiler_negocios;
  v_inicio    date;
  v_fin       date;
  v_total     numeric(12,2) := 0;
  v_pedido_id text;
  v_pedido    alquiler_pedidos;
  v_item      jsonb;
  v_prod      alquiler_productos;
  v_pedida    int;
  v_disp      int;
begin
  if not alquiler_es_admin(p_negocio) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select * into v_negocio from alquiler_negocios where id = p_negocio;
  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  v_inicio := p_evento - 1;
  v_fin    := p_evento + 1;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_evento, fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_evento, v_inicio, v_fin, 1, 0, 'confirmado', coalesce(p_notas, ''),
    now()
  )
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = p_negocio;

    if not found then
      raise exception 'PRODUCTO_NO_EXISTE';
    end if;

    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> v_pedido_id
      and ped.negocio_id = p_negocio
      and ped.fecha_inicio < v_fin
      and ped.fecha_fin    > v_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_pedida > v_disp then
      raise exception 'SIN_STOCK:%', v_prod.nombre;
    end if;

    insert into alquiler_pedido_items
      (pedido_id, producto_id, producto_nombre, precio_dia, cantidad)
    values
      (v_pedido_id, v_prod.id, v_prod.nombre, v_prod.precio_dia, v_pedida);

    v_total := v_total + (v_prod.precio_dia * v_pedida);
  end loop;

  update alquiler_pedidos
     set total = v_total,
         anticipo = alquiler_anticipo(
           v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
         ),
         actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Editar pedido
-- ---------------------------------------------------------------------
create or replace function alquiler_editar_pedido(
  p_pedido   text,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_evento   date,
  p_items    jsonb default null,
  p_token    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido   alquiler_pedidos;
  v_negocio  alquiler_negocios;
  v_es_admin boolean;
  v_items    jsonb;
  v_previos  jsonb;
  v_inicio   date;
  v_fin      date;
  v_total    numeric(12,2) := 0;
  v_item     jsonb;
  v_prod     alquiler_productos;
  v_pedida   int;
  v_disp     int;
  v_precio   numeric(12,2);
begin
  select * into v_pedido from alquiler_pedidos where id = p_pedido;
  if not found then
    raise exception 'PEDIDO_NO_EXISTE';
  end if;

  v_es_admin := alquiler_es_admin(v_pedido.negocio_id);
  if not v_es_admin
     and (p_token is null or p_token = '' or p_token <> v_pedido.token_acceso) then
    raise exception 'NO_AUTORIZADO';
  end if;

  if not v_es_admin then
    p_nombre := null;
    p_items  := null;
  end if;

  if v_pedido.estado not in ('pendiente', 'confirmado') then
    raise exception 'RESERVA_NO_EDITABLE';
  end if;

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  if p_evento <> v_pedido.fecha_evento and p_evento < current_date then
    raise exception 'FECHA_PASADA';
  end if;

  select * into v_negocio from alquiler_negocios where id = v_pedido.negocio_id;

  perform pg_advisory_xact_lock(hashtextextended(v_pedido.negocio_id::text, 0));

  v_items := coalesce(
    p_items,
    (
      select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad))
      from alquiler_pedido_items where pedido_id = p_pedido
    )
  );

  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  select jsonb_object_agg(producto_id::text, precio_dia) into v_previos
  from alquiler_pedido_items where pedido_id = p_pedido;

  v_inicio := p_evento - 1;
  v_fin    := p_evento + 1;

  delete from alquiler_pedido_items where pedido_id = p_pedido;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = v_pedido.negocio_id;

    if not found then
      raise exception 'PRODUCTO_NO_EXISTE';
    end if;

    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> p_pedido
      and ped.negocio_id = v_pedido.negocio_id
      and ped.fecha_inicio < v_fin
      and ped.fecha_fin    > v_inicio
      and (
        ped.estado in ('confirmado', 'entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_pedida > v_disp then
      raise exception 'SIN_STOCK:%', v_prod.nombre;
    end if;

    v_precio := coalesce((v_previos->>v_prod.id::text)::numeric, v_prod.precio_dia);

    insert into alquiler_pedido_items
      (pedido_id, producto_id, producto_nombre, precio_dia, cantidad)
    values
      (p_pedido, v_prod.id, v_prod.nombre, v_precio, v_pedida);

    v_total := v_total + (v_precio * v_pedida);
  end loop;

  update alquiler_pedidos
     set cliente_nombre   = coalesce(nullif(trim(p_nombre), ''), cliente_nombre),
         cliente_telefono = coalesce(p_telefono, cliente_telefono),
         notas            = coalesce(p_notas, notas),
         fecha_evento     = p_evento,
         fecha_inicio     = v_inicio,
         fecha_fin        = v_fin,
         dias             = 1,
         total            = v_total,
         anticipo         = alquiler_anticipo(
                              v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
                            ),
         estado           = case when v_es_admin then estado else 'pendiente' end,
         expira_en        = case
                              when v_es_admin then expira_en
                              else now() + make_interval(hours => v_negocio.horas_reserva)
                            end,
         actualizado_en   = now()
   where id = p_pedido;
end;
$$;
