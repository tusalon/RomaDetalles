-- =====================================================================
-- RomaDetalles — editar una reserva ya creada
-- =====================================================================
-- Hasta ahora una reserva era inmutable: si el dato salía mal, había que
-- cancelarla y hacer otra. Esta función la deja corregir, con las mismas
-- reglas de stock y de dinero que rigen al crearla.
--
-- Una sola función para los dos que pueden editar, porque la lógica
-- (revisar stock, recalcular total y anticipo) es idéntica:
--   · la dueña, autenticada — se identifica con alquiler_es_admin()
--   · la clienta, sin cuenta — se identifica con el token de su enlace
--
-- Idempotente.
-- =====================================================================

create or replace function alquiler_editar_pedido(
  p_pedido   text,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_evento   date,
  p_items    jsonb default null,   -- null = no tocar los artículos
  p_token    text default null     -- lo manda la clienta; la dueña no lo necesita
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

  -- Quién puede editar: la dueña del negocio, o quien traiga el token
  -- secreto de esta reserva (el enlace que recibió la clienta). Nadie
  -- más. Para anon, alquiler_es_admin() da false y solo queda el token.
  v_es_admin := alquiler_es_admin(v_pedido.negocio_id);
  if not v_es_admin
     and (p_token is null or p_token = '' or p_token <> v_pedido.token_acceso) then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- Desde el enlace de la clienta solo se corrigen día, teléfono y nota.
  -- El nombre es como el negocio identifica la reserva, y dejar cambiar
  -- los artículos permitiría que un enlace reenviado acapare stock 24h
  -- sin que el negocio haya aceptado nada. La interfaz ya manda ambos en
  -- null; aquí se hace valer, porque la interfaz no es una garantía.
  if not v_es_admin then
    p_nombre := null;
    p_items  := null;
  end if;

  -- Una vez que los artículos salieron o se devolvieron, editar la
  -- reserva ya no describiría lo que pasó: eso se arregla cancelando.
  if v_pedido.estado not in ('pendiente', 'confirmado') then
    raise exception 'RESERVA_NO_EDITABLE';
  end if;

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  -- Mover una reserva al pasado no tiene sentido. Dejarla en la fecha
  -- que ya tenía sí, aunque esa fecha ya pasó: así se puede corregir el
  -- teléfono de una reserva vieja sin tener que moverla de día.
  if p_evento <> v_pedido.fecha_evento and p_evento < current_date then
    raise exception 'FECHA_PASADA';
  end if;

  select * into v_negocio from alquiler_negocios where id = v_pedido.negocio_id;

  -- Mismo candado que al crear: dos ediciones simultáneas no pueden
  -- pasar las dos el chequeo de stock y dejar el catálogo sobrevendido.
  perform pg_advisory_xact_lock(hashtextextended(v_pedido.negocio_id::text, 0));

  -- Sin artículos nuevos, se revalidan los que ya tenía: cambiar de día
  -- exige comprobar que ese día también alcanza el stock.
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

  -- Precios ya cotizados. Un artículo que ya estaba en la reserva
  -- conserva el precio con el que se pidió: corregir un teléfono no
  -- puede recotizar el pedido porque el negocio subió precios después.
  select jsonb_object_agg(producto_id::text, precio_dia) into v_previos
  from alquiler_pedido_items where pedido_id = p_pedido;

  v_inicio := p_evento - 1;
  v_fin    := p_evento;

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

    -- Idéntico al de crear, incluida la exclusión de sí mismo: una
    -- reserva no compite consigo misma por su propio stock.
    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> p_pedido
      and ped.negocio_id = v_pedido.negocio_id
      and ped.fecha_inicio <= v_fin
      and ped.fecha_fin    >= v_inicio
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
         -- Las reservas viejas de varios días guardaban dias = 3, 4…
         -- Al editarlas pasan al modelo actual (un evento = un día), o
         -- quedarían con dias = 3 y un rango de dos: un dato mentiroso.
         dias             = 1,
         total            = v_total,
         anticipo         = alquiler_anticipo(
                              v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
                            ),
         -- Si edita la clienta, el trato vuelve a estar sobre la mesa:
         -- pasa a pendiente para que el negocio lo reconfirme, y se le
         -- extiende la retención para que nadie le quite el stock
         -- mientras espera esa respuesta. Si edita la dueña, el estado
         -- es cosa suya y no se toca.
         estado           = case when v_es_admin then estado else 'pendiente' end,
         expira_en        = case when v_es_admin then expira_en else now() + interval '24 hours' end,
         actualizado_en   = now()
   where id = p_pedido;
end;
$$;

-- anon la necesita para la clienta con su token; authenticated para la
-- dueña desde el panel. La autorización real vive dentro de la función.
grant execute on function alquiler_editar_pedido(text,text,text,text,date,jsonb,text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- La reserva por token ahora devuelve también teléfono y nota
-- ---------------------------------------------------------------------
-- Son datos que la propia clienta escribió: sin ellos no puede ver qué
-- va a corregir. Sigue sin devolver token_acceso, que es lo que hay que
-- proteger. Postgres no deja cambiar el tipo de retorno con CREATE OR
-- REPLACE, así que se suelta primero (y se reotorga el grant).
drop function if exists alquiler_pedido_por_token(text);

create or replace function alquiler_pedido_por_token(p_token text)
returns table (
  pedido_id        text,
  fecha_evento     date,
  fecha_inicio     date,
  fecha_fin        date,
  dias             int,
  total            numeric,
  anticipo         numeric,
  estado           text,
  cliente_telefono text,
  notas            text,
  moneda           text,
  negocio_nombre   text,
  negocio_whatsapp text,
  items            jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.fecha_evento,
    p.fecha_inicio,
    p.fecha_fin,
    p.dias,
    p.total,
    p.anticipo,
    p.estado,
    p.cliente_telefono,
    p.notas,
    n.moneda,
    n.nombre,
    n.whatsapp,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'producto_nombre', i.producto_nombre,
            'cantidad', i.cantidad,
            'precio_dia', i.precio_dia
          )
          order by i.id
        )
        from alquiler_pedido_items i
        where i.pedido_id = p.id
      ),
      '[]'::jsonb
    )
  from alquiler_pedidos p
  join alquiler_negocios n on n.id = p.negocio_id
  where p.token_acceso = p_token;
$$;

grant execute on function alquiler_pedido_por_token(text)
  to anon, authenticated, service_role;
