const { useEffect, useState, useCallback } = React;
function dineroPanel(valor) {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 0 }).format(valor || 0);
}
const ETIQUETA_ESTADO = {
  pendiente: "Pendiente",
  confirmado: "Confirmada",
  entregado: "Entregada",
  devuelto: "Devuelta",
  cancelado: "Cancelada"
};
function primerDiaDelMes() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function hoyPanel() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const PRODUCTO_VACIO = { nombre: "", descripcion: "", categoria: "Decoración", precio_dia: "", cantidad: 1 };
function armarMensajeConfirmacion(plantilla, pedido, moneda) {
  const fechas = `${pedido.fecha_inicio} al ${pedido.fecha_fin} (${pedido.dias} ${pedido.dias === 1 ? "día" : "días"})`;
  const total = `${dineroPanel(pedido.total)} ${moneda}`;
  return (plantilla || "").replaceAll("{nombre}", pedido.cliente_nombre || "").replaceAll("{pedido_id}", pedido.id || "").replaceAll("{fechas}", fechas).replaceAll("{total}", total);
}
function mensajeDeErrorReserva(error) {
  const texto = String(error?.message || error || "");
  if (texto.includes("SIN_STOCK")) {
    const nombre = texto.split("SIN_STOCK:")[1]?.split("\n")[0]?.trim();
    return nombre ? `${nombre} no tiene stock suficiente en esas fechas.` : "No hay stock suficiente en esas fechas.";
  }
  if (texto.includes("PERIODO_INVALIDO")) return "El período de fechas no es válido.";
  if (texto.includes("PEDIDO_VACIO")) return "Elige al menos un artículo.";
  if (texto.includes("PRODUCTO_NO_EXISTE")) return "Uno de los artículos ya no existe.";
  if (texto.includes("NO_AUTORIZADO")) return "No tienes permiso para crear reservas en este negocio.";
  console.error("[Panel] error de reserva no reconocido:", texto);
  return "No se pudo crear la reserva. Inténtalo de nuevo.";
}
function TarjetaAvisos({ negocioId }) {
  const [activos, setActivos] = useState(false);
  const [estado, setEstado] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const refrescar = useCallback(async () => {
    setEstado(window.RomaDetallesPush.estadoPush());
    setActivos(await window.RomaDetallesPush.avisosActivos());
  }, []);
  useEffect(() => {
    refrescar();
    window.addEventListener("romadetalles-push-cambio", refrescar);
    return () => window.removeEventListener("romadetalles-push-cambio", refrescar);
  }, [refrescar]);
  async function activar() {
    setOcupado(true);
    setMensaje("");
    const r = await window.RomaDetallesPush.activarAvisos(negocioId);
    if (!r.ok) setMensaje(r.mensaje);
    else setMensaje("Avisos activados en este dispositivo.");
    await refrescar();
    setOcupado(false);
  }
  async function desactivar() {
    setOcupado(true);
    setMensaje("");
    await window.RomaDetallesPush.desactivarAvisos(negocioId);
    await refrescar();
    setOcupado(false);
  }
  if (estado === "instalar_primero") {
    return /* @__PURE__ */ React.createElement("div", { className: "admin-card push-card" }, /* @__PURE__ */ React.createElement("h3", null, "Avisos de pedidos nuevos"), /* @__PURE__ */ React.createElement("p", null, "En iPhone los avisos funcionan solo con la app instalada. Pulsa ", /* @__PURE__ */ React.createElement("strong", null, "Compartir → Añadir a pantalla de inicio"), ", ábrela desde el ícono y aquí podrás activarlos."));
  }
  if (estado === "no_soportado") {
    return /* @__PURE__ */ React.createElement("div", { className: "admin-card push-card" }, /* @__PURE__ */ React.createElement("h3", null, "Avisos de pedidos nuevos"), /* @__PURE__ */ React.createElement("p", null, "Este navegador no puede recibir avisos. Los pedidos siguen apareciendo en la pestaña Reservas."));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "admin-card push-card" }, /* @__PURE__ */ React.createElement("h3", null, "Avisos de pedidos nuevos"), /* @__PURE__ */ React.createElement("span", { className: `push-estado ${activos ? "on" : "off"}` }, "● ", activos ? "Activados en este dispositivo" : "Desactivados"), /* @__PURE__ */ React.createElement("p", null, "Con los avisos activados te llega una notificación en cuanto una clienta envía un pedido, sin tener que abrir el panel a revisar."), activos ? /* @__PURE__ */ React.createElement("button", { className: "apagar", onClick: desactivar, disabled: ocupado }, "Desactivar") : /* @__PURE__ */ React.createElement("button", { onClick: activar, disabled: ocupado }, ocupado ? "Activando…" : "Activar avisos"), mensaje && /* @__PURE__ */ React.createElement("p", { className: "order-status" }, mensaje));
}
function Panel({ negocioInicial, email }) {
  const [pestana, setPestana] = useState("reservas");
  const [negocio, setNegocio] = useState(negocioInicial);
  const [productos, setProductos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [ocupacion, setOcupacion] = useState([]);
  const [rango, setRango] = useState({ desde: primerDiaDelMes(), hasta: hoyPanel() });
  const [aviso, setAviso] = useState("");
  const [subiendo, setSubiendo] = useState(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [productoNuevo, setProductoNuevo] = useState(null);
  const [creandoProducto, setCreandoProducto] = useState(false);
  const [reservaManual, setReservaManual] = useState(null);
  const [creandoReserva, setCreandoReserva] = useState(false);
  const moneda = negocio.moneda || "CUP";
  function notificar(texto) {
    setAviso(texto);
    setTimeout(() => setAviso(""), 4e3);
  }
  const cargarProductos = useCallback(async () => {
    try {
      setProductos(await window.supaGet(
        `alquiler_productos?negocio_id=eq.${negocio.id}&select=id,nombre,descripcion,categoria,precio_dia,cantidad,fuera_de_servicio,foto_url,activo,orden&order=orden.asc,creado_en.asc`
      ));
    } catch (e) {
      console.error("[Panel] error cargando productos:", e);
      notificar("No se pudieron cargar los artículos.");
    }
  }, [negocio.id]);
  const cargarPedidos = useCallback(async () => {
    try {
      const filas = await window.supaGet(
        `alquiler_pedidos?negocio_id=eq.${negocio.id}&select=id,cliente_nombre,cliente_telefono,fecha_inicio,fecha_fin,dias,total,estado,notas,creado_en,alquiler_pedido_items(id,producto_nombre,cantidad)&order=creado_en.desc&limit=200`
      );
      setPedidos(filas);
    } catch (e) {
      console.error("[Panel] error cargando pedidos:", e);
      notificar("No se pudieron cargar las reservas.");
    }
  }, [negocio.id]);
  const cargarOcupacion = useCallback(async () => {
    try {
      setOcupacion(await window.supaRpc("alquiler_ocupacion", {
        p_negocio: negocio.id,
        p_desde: rango.desde,
        p_hasta: rango.hasta
      }));
    } catch (e) {
      console.error("[Panel] error cargando ocupación:", e);
      notificar("No se pudo calcular la ocupación.");
    }
  }, [negocio.id, rango.desde, rango.hasta]);
  useEffect(() => {
    cargarProductos();
    cargarPedidos();
  }, [cargarProductos, cargarPedidos]);
  useEffect(() => {
    if (pestana === "ocupacion") cargarOcupacion();
  }, [pestana, cargarOcupacion]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("pedido")) {
      setPestana("reservas");
    }
  }, []);
  async function guardarConfiguracion() {
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/alquiler_negocios?id=eq.${negocio.id}`,
        {
          method: "PATCH",
          headers: window.supaHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            nombre: negocio.nombre,
            titulo_bienvenida: negocio.titulo_bienvenida,
            texto_bienvenida: negocio.texto_bienvenida,
            whatsapp: negocio.whatsapp,
            moneda: negocio.moneda,
            instagram_url: negocio.instagram_url,
            facebook_url: negocio.facebook_url,
            logo_url: negocio.logo_url || "",
            plantilla_confirmacion: negocio.plantilla_confirmacion || "",
            plantilla_compartir: negocio.plantilla_compartir || "",
            plantilla_solicitud: negocio.plantilla_solicitud || "",
            dias_minimos: Math.max(1, Number(negocio.dias_minimos) || 1),
            actualizado_en: (/* @__PURE__ */ new Date()).toISOString()
          })
        }
      );
      notificar(res.ok ? "Configuración guardada." : "No se pudo guardar.");
    } catch (e) {
      console.error("[Panel] error guardando configuración:", e);
      notificar("No se pudo guardar.");
    }
  }
  async function subirLogo(evento) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setSubiendoLogo(true);
    const subida = await window.subirLogoNegocio(archivo, negocio.id);
    setSubiendoLogo(false);
    if (!subida) return;
    setNegocio((actual) => ({ ...actual, logo_url: subida.url }));
    await fetch(`${window.SUPABASE_URL}/rest/v1/alquiler_negocios?id=eq.${negocio.id}`, {
      method: "PATCH",
      headers: window.supaHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ logo_url: subida.url, actualizado_en: (/* @__PURE__ */ new Date()).toISOString() })
    });
    notificar("Logo actualizado.");
  }
  function abrirFormularioProducto() {
    setProductoNuevo({ ...PRODUCTO_VACIO });
  }
  function cancelarFormularioProducto() {
    setProductoNuevo(null);
  }
  async function crearProducto(evento) {
    evento.preventDefault();
    if (!productoNuevo.nombre.trim()) {
      notificar("Ponle un nombre al artículo.");
      return;
    }
    setCreandoProducto(true);
    try {
      const res = await fetch(`${window.SUPABASE_URL}/rest/v1/alquiler_productos`, {
        method: "POST",
        headers: window.supaHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({
          negocio_id: negocio.id,
          nombre: productoNuevo.nombre.trim(),
          descripcion: productoNuevo.descripcion.trim(),
          categoria: productoNuevo.categoria.trim() || "Decoración",
          precio_dia: Math.max(0, Number(productoNuevo.precio_dia) || 0),
          cantidad: Math.max(0, Math.floor(Number(productoNuevo.cantidad) || 0)),
          foto_url: "",
          activo: true,
          orden: productos.length
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const [creado] = await res.json();
      setProductos((actual) => [...actual, creado]);
      setProductoNuevo(null);
      notificar(`${creado.nombre} creado. Ya puedes agregarle una foto.`);
    } catch (e) {
      console.error("[Panel] error creando artículo:", e);
      notificar("No se pudo crear el artículo.");
    } finally {
      setCreandoProducto(false);
    }
  }
  async function guardarProducto(producto) {
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/alquiler_productos?id=eq.${producto.id}`,
        {
          method: "PATCH",
          headers: window.supaHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            categoria: producto.categoria,
            precio_dia: Math.max(0, Number(producto.precio_dia) || 0),
            cantidad: Math.max(0, Math.floor(Number(producto.cantidad) || 0)),
            fuera_de_servicio: Math.max(0, Math.floor(Number(producto.fuera_de_servicio) || 0)),
            foto_url: producto.foto_url,
            activo: producto.activo,
            actualizado_en: (/* @__PURE__ */ new Date()).toISOString()
          })
        }
      );
      notificar(res.ok ? `${producto.nombre} guardado.` : "No se pudo guardar.");
    } catch (e) {
      console.error("[Panel] error guardando artículo:", e);
      notificar("No se pudo guardar.");
    }
  }
  async function ocultarProducto(producto) {
    if (!window.confirm(`¿Quitar "${producto.nombre}" del catálogo? Las reservas anteriores se conservan.`)) return;
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/alquiler_productos?id=eq.${producto.id}`,
        {
          method: "PATCH",
          headers: window.supaHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ activo: false, actualizado_en: (/* @__PURE__ */ new Date()).toISOString() })
        }
      );
      if (res.ok) {
        setProductos((actual) => actual.map((p) => p.id === producto.id ? { ...p, activo: false } : p));
        notificar("Artículo oculto en la tienda.");
      }
    } catch (e) {
      console.error("[Panel] error ocultando artículo:", e);
    }
  }
  async function subirFoto(evento, producto) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setSubiendo(producto.id);
    const subida = await window.subirFotoProducto(archivo, producto.id);
    setSubiendo(null);
    if (!subida) return;
    setProductos((actual) => actual.map((p) => p.id === producto.id ? { ...p, foto_url: subida.url } : p));
    await guardarProducto({ ...producto, foto_url: subida.url });
  }
  async function cambiarEstado(pedido, estado) {
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/alquiler_pedidos?id=eq.${pedido.id}`,
        {
          method: "PATCH",
          headers: window.supaHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ estado, actualizado_en: (/* @__PURE__ */ new Date()).toISOString() })
        }
      );
      if (!res.ok) {
        notificar("No se pudo actualizar la reserva.");
        return;
      }
      setPedidos((actual) => actual.map((p) => p.id === pedido.id ? { ...p, estado } : p));
      notificar(`Reserva ${ETIQUETA_ESTADO[estado].toLowerCase()}.`);
      if (estado === "confirmado" && pedido.cliente_telefono) {
        const numero = pedido.cliente_telefono.replace(/\D/g, "");
        if (numero) {
          const mensaje = armarMensajeConfirmacion(negocio.plantilla_confirmacion, pedido, moneda);
          window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, "_blank");
        }
      }
    } catch (e) {
      console.error("[Panel] error cambiando estado:", e);
      notificar("No se pudo actualizar la reserva.");
    }
  }
  async function salir() {
    await window.AlquilerAuth.salir();
    window.location.replace("admin-login.html");
  }
  const enlaceTienda = `index.html?s=${encodeURIComponent(negocio.slug)}`;
  const enlaceTiendaCompleto = `${window.location.origin}${window.location.pathname.replace(/admin\.html$/, "")}index.html?s=${negocio.slug}`;
  async function compartirTienda() {
    const mensaje = (negocio.plantilla_compartir || "¡Mira mi tienda! {enlace}").replaceAll("{nombre}", negocio.nombre || "").replaceAll("{enlace}", enlaceTiendaCompleto);
    if (navigator.share) {
      try {
        await navigator.share({ text: mensaje });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
        console.warn("[Panel] navigator.share falló, usando respaldo:", e);
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, "_blank");
  }
  function abrirReservaManual() {
    setReservaManual({ cliente_nombre: "", cliente_telefono: "", notas: "", fecha_inicio: "", fecha_fin: "", items: {} });
  }
  function cancelarReservaManual() {
    setReservaManual(null);
  }
  function cambiarCantidadReserva(productoId, cantidad) {
    setReservaManual((actual) => {
      const items = { ...actual.items };
      if (cantidad <= 0) delete items[productoId];
      else items[productoId] = cantidad;
      return { ...actual, items };
    });
  }
  async function crearReservaManual(evento) {
    evento.preventDefault();
    if (!reservaManual.cliente_nombre.trim()) {
      notificar("Ponle un nombre a la clienta.");
      return;
    }
    if (!reservaManual.fecha_inicio || !reservaManual.fecha_fin) {
      notificar("Elige las fechas del alquiler.");
      return;
    }
    const items = Object.entries(reservaManual.items).map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
    if (!items.length) {
      notificar("Elige al menos un artículo.");
      return;
    }
    setCreandoReserva(true);
    try {
      const pedido = await window.supaRpc("alquiler_crear_pedido_manual", {
        p_negocio: negocio.id,
        p_nombre: reservaManual.cliente_nombre.trim(),
        p_telefono: reservaManual.cliente_telefono.trim(),
        p_notas: reservaManual.notas.trim(),
        p_inicio: reservaManual.fecha_inicio,
        p_fin: reservaManual.fecha_fin,
        p_items: items
      });
      setReservaManual(null);
      notificar(`Reserva ${pedido.id} creada y confirmada.`);
      cargarPedidos();
    } catch (e) {
      notificar(mensajeDeErrorReserva(e));
    } finally {
      setCreandoReserva(false);
    }
  }
  return /* @__PURE__ */ React.createElement("main", { className: "admin" }, /* @__PURE__ */ React.createElement("header", { className: "admin-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("a", { className: "brand", href: enlaceTienda }, negocio.logo_url ? /* @__PURE__ */ React.createElement("img", { src: negocio.logo_url, alt: "", className: "brand-logo" }) : /* @__PURE__ */ React.createElement("span", null, "✦"), " ", negocio.nombre), /* @__PURE__ */ React.createElement("p", null, "Panel del negocio")), /* @__PURE__ */ React.createElement("div", { className: "admin-user" }, /* @__PURE__ */ React.createElement("span", null, email), /* @__PURE__ */ React.createElement("a", { href: "#", onClick: (e) => {
    e.preventDefault();
    salir();
  } }, "Salir"))), /* @__PURE__ */ React.createElement("div", { className: "admin-shell" }, /* @__PURE__ */ React.createElement("aside", { className: "admin-nav" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: pestana === "reservas" ? "active" : "",
      onClick: () => setPestana("reservas")
    },
    "Reservas"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: pestana === "productos" ? "active" : "",
      onClick: () => setPestana("productos")
    },
    "Artículos"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: pestana === "ocupacion" ? "active" : "",
      onClick: () => setPestana("ocupacion")
    },
    "Ocupación"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: pestana === "config" ? "active" : "",
      onClick: () => setPestana("config")
    },
    "Configuración"
  ), /* @__PURE__ */ React.createElement("a", { href: enlaceTienda }, "Ver mi tienda ↗"), /* @__PURE__ */ React.createElement("button", { onClick: compartirTienda }, "Compartir tienda")), /* @__PURE__ */ React.createElement("section", { className: "admin-content" }, aviso && /* @__PURE__ */ React.createElement("p", { className: "admin-notice" }, aviso), pestana === "reservas" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Agenda y disponibilidad"), /* @__PURE__ */ React.createElement("h1", null, "Reservas")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "8px" } }, !reservaManual && /* @__PURE__ */ React.createElement("button", { onClick: abrirReservaManual }, "+ Reserva manual"), /* @__PURE__ */ React.createElement("button", { onClick: cargarPedidos }, "Actualizar"))), reservaManual && /* @__PURE__ */ React.createElement("form", { className: "admin-card producto-form", onSubmit: crearReservaManual }, /* @__PURE__ */ React.createElement("h3", null, "Reserva manual"), /* @__PURE__ */ React.createElement("p", { className: "producto-form-nota" }, "Para una clienta que acordó todo en persona o por teléfono, sin pasar por la tienda. Queda confirmada de una vez."), /* @__PURE__ */ React.createElement("div", { className: "producto-form-fila" }, /* @__PURE__ */ React.createElement("label", null, "Nombre de la clienta", /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      required: true,
      value: reservaManual.cliente_nombre,
      onChange: (e) => setReservaManual({ ...reservaManual, cliente_nombre: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Teléfono (opcional)", /* @__PURE__ */ React.createElement(
    "input",
    {
      inputMode: "tel",
      value: reservaManual.cliente_telefono,
      onChange: (e) => setReservaManual({ ...reservaManual, cliente_telefono: e.target.value })
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "producto-form-fila" }, /* @__PURE__ */ React.createElement("label", null, "Desde", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      required: true,
      value: reservaManual.fecha_inicio,
      onChange: (e) => setReservaManual({ ...reservaManual, fecha_inicio: e.target.value, fecha_fin: reservaManual.fecha_fin && reservaManual.fecha_fin < e.target.value ? e.target.value : reservaManual.fecha_fin })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Hasta", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      required: true,
      min: reservaManual.fecha_inicio,
      value: reservaManual.fecha_fin,
      onChange: (e) => setReservaManual({ ...reservaManual, fecha_fin: e.target.value })
    }
  ))), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Artículos", /* @__PURE__ */ React.createElement("div", { className: "reserva-manual-items" }, !productos.filter((p) => p.activo).length && /* @__PURE__ */ React.createElement("p", { className: "producto-form-nota" }, "No hay artículos activos en el catálogo."), productos.filter((p) => p.activo).map((producto) => /* @__PURE__ */ React.createElement("div", { className: "reserva-manual-item", key: producto.id }, /* @__PURE__ */ React.createElement("span", null, producto.nombre), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "0",
      inputMode: "numeric",
      placeholder: "0",
      value: reservaManual.items[producto.id] || "",
      onChange: (e) => cambiarCantidadReserva(producto.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))
    }
  ))))), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Nota (opcional)", /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: reservaManual.notas,
      onChange: (e) => setReservaManual({ ...reservaManual, notas: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "producto-form-acciones" }, /* @__PURE__ */ React.createElement("button", { type: "submit", disabled: creandoReserva }, creandoReserva ? "Creando…" : "Crear reserva confirmada"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "apagar", onClick: cancelarReservaManual }, "Cancelar"))), /* @__PURE__ */ React.createElement(TarjetaAvisos, { negocioId: negocio.id }), /* @__PURE__ */ React.createElement("div", { className: "admin-orders" }, !pedidos.length && /* @__PURE__ */ React.createElement("div", { className: "admin-card empty-orders" }, "Todavía no hay solicitudes."), pedidos.map((pedido) => /* @__PURE__ */ React.createElement("article", { className: "admin-order admin-card", key: pedido.id }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: `order-chip ${pedido.estado}` }, ETIQUETA_ESTADO[pedido.estado] || pedido.estado), /* @__PURE__ */ React.createElement("h3", null, pedido.cliente_nombre), /* @__PURE__ */ React.createElement("p", null, pedido.id, " · ", pedido.fecha_inicio, " al ", pedido.fecha_fin, " · ", pedido.dias, " ", pedido.dias === 1 ? "día" : "días"), pedido.cliente_telefono && /* @__PURE__ */ React.createElement("p", null, "📞 ", /* @__PURE__ */ React.createElement("a", { href: `tel:${pedido.cliente_telefono}` }, pedido.cliente_telefono)), pedido.notas && /* @__PURE__ */ React.createElement("p", null, "📝 ", pedido.notas)), /* @__PURE__ */ React.createElement("ul", null, (pedido.alquiler_pedido_items || []).map((item) => /* @__PURE__ */ React.createElement("li", { key: item.id }, item.cantidad, " × ", item.producto_nombre))), /* @__PURE__ */ React.createElement("strong", null, dineroPanel(pedido.total), " ", moneda), /* @__PURE__ */ React.createElement("div", null, pedido.estado === "pendiente" && /* @__PURE__ */ React.createElement("button", { onClick: () => cambiarEstado(pedido, "confirmado") }, "Confirmar"), pedido.estado === "confirmado" && /* @__PURE__ */ React.createElement("button", { onClick: () => cambiarEstado(pedido, "entregado") }, "Entregada"), pedido.estado === "entregado" && /* @__PURE__ */ React.createElement("button", { onClick: () => cambiarEstado(pedido, "devuelto") }, "Devuelta"), pedido.estado !== "cancelado" && pedido.estado !== "devuelto" && /* @__PURE__ */ React.createElement("button", { className: "danger", onClick: () => cambiarEstado(pedido, "cancelado") }, "Cancelar")))))), pestana === "productos" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Tu inventario"), /* @__PURE__ */ React.createElement("h1", null, "Artículos")), !productoNuevo && /* @__PURE__ */ React.createElement("button", { onClick: abrirFormularioProducto }, "+ Nuevo artículo")), productoNuevo && /* @__PURE__ */ React.createElement("form", { className: "admin-card producto-form", onSubmit: crearProducto }, /* @__PURE__ */ React.createElement("h3", null, "Nuevo artículo"), /* @__PURE__ */ React.createElement("label", null, "Nombre", /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      required: true,
      value: productoNuevo.nombre,
      onChange: (e) => setProductoNuevo({ ...productoNuevo, nombre: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Descripción", /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: productoNuevo.descripcion,
      onChange: (e) => setProductoNuevo({ ...productoNuevo, descripcion: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "producto-form-fila" }, /* @__PURE__ */ React.createElement("label", null, "Categoría", /* @__PURE__ */ React.createElement(
    "input",
    {
      value: productoNuevo.categoria,
      onChange: (e) => setProductoNuevo({ ...productoNuevo, categoria: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Precio por día", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "0",
      inputMode: "numeric",
      value: productoNuevo.precio_dia,
      onChange: (e) => setProductoNuevo({ ...productoNuevo, precio_dia: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Cantidad", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "0",
      inputMode: "numeric",
      value: productoNuevo.cantidad,
      onChange: (e) => setProductoNuevo({ ...productoNuevo, cantidad: e.target.value })
    }
  ))), /* @__PURE__ */ React.createElement("p", { className: "producto-form-nota" }, "La foto se agrega después de crear el artículo."), /* @__PURE__ */ React.createElement("div", { className: "producto-form-acciones" }, /* @__PURE__ */ React.createElement("button", { type: "submit", disabled: creandoProducto }, creandoProducto ? "Creando…" : "Crear artículo"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "apagar", onClick: cancelarFormularioProducto }, "Cancelar"))), /* @__PURE__ */ React.createElement("div", { className: "admin-products" }, !productos.length && !productoNuevo && /* @__PURE__ */ React.createElement("div", { className: "admin-card empty-orders" }, "Todavía no tienes artículos. Pulsa «Nuevo artículo» para empezar."), productos.map((producto) => {
    const disponibleAhora = Math.max(0, (producto.cantidad || 0) - (producto.fuera_de_servicio || 0));
    return /* @__PURE__ */ React.createElement(
      "article",
      {
        className: "admin-product admin-card",
        key: producto.id,
        style: producto.activo ? void 0 : { opacity: 0.6 }
      },
      /* @__PURE__ */ React.createElement("img", { src: producto.foto_url || "images/producto-arco.png", alt: "" }),
      /* @__PURE__ */ React.createElement("div", { className: "product-fields" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          value: producto.nombre,
          onChange: (e) => setProductos((p) => p.map((x) => x.id === producto.id ? { ...x, nombre: e.target.value } : x))
        }
      ), /* @__PURE__ */ React.createElement(
        "textarea",
        {
          placeholder: "Descripción corta",
          value: producto.descripcion,
          onChange: (e) => setProductos((p) => p.map((x) => x.id === producto.id ? { ...x, descripcion: e.target.value } : x))
        }
      ), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", null, "Categoría", /* @__PURE__ */ React.createElement(
        "input",
        {
          value: producto.categoria,
          onChange: (e) => setProductos((p) => p.map((x) => x.id === producto.id ? { ...x, categoria: e.target.value } : x))
        }
      )), /* @__PURE__ */ React.createElement("label", null, "Precio por día", /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "number",
          min: "0",
          inputMode: "numeric",
          value: producto.precio_dia,
          onChange: (e) => setProductos((p) => p.map((x) => x.id === producto.id ? { ...x, precio_dia: e.target.value } : x))
        }
      )), /* @__PURE__ */ React.createElement("label", null, "Cantidad total", /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "number",
          min: "0",
          inputMode: "numeric",
          value: producto.cantidad,
          onChange: (e) => setProductos((p) => p.map((x) => x.id === producto.id ? { ...x, cantidad: e.target.value } : x))
        }
      )), /* @__PURE__ */ React.createElement("label", null, "Fuera de servicio", /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "number",
          min: "0",
          inputMode: "numeric",
          value: producto.fuera_de_servicio || 0,
          onChange: (e) => setProductos((p) => p.map((x) => x.id === producto.id ? { ...x, fuera_de_servicio: e.target.value } : x))
        }
      ))), /* @__PURE__ */ React.createElement("p", { className: "producto-disponible-ahora" }, "● ", disponibleAhora, " de ", producto.cantidad || 0, " disponibles ahora", producto.fuera_de_servicio > 0 && ` (${producto.fuera_de_servicio} fuera de servicio)`), /* @__PURE__ */ React.createElement("label", { className: "upload" }, subiendo === producto.id ? "Subiendo foto…" : "Cambiar foto", /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "file",
          accept: "image/*",
          disabled: subiendo === producto.id,
          onChange: (e) => subirFoto(e, producto)
        }
      ))),
      /* @__PURE__ */ React.createElement("div", { className: "product-admin-actions" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "checkbox",
          checked: producto.activo,
          onChange: (e) => setProductos((p) => p.map((x) => x.id === producto.id ? { ...x, activo: e.target.checked } : x))
        }
      ), " ", "Visible"), /* @__PURE__ */ React.createElement("button", { onClick: () => guardarProducto(producto) }, "Guardar"), /* @__PURE__ */ React.createElement("button", { className: "danger", onClick: () => ocultarProducto(producto) }, "Quitar"))
    );
  }))), pestana === "ocupacion" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Qué te está produciendo"), /* @__PURE__ */ React.createElement("h1", null, "Ocupación"))), /* @__PURE__ */ React.createElement("div", { className: "admin-card push-card" }, /* @__PURE__ */ React.createElement("p", null, "Días que estuvo alquilado cada artículo en el período elegido. Lo de arriba es lo que más te produce; lo de abajo, lo que te está ocupando espacio."), /* @__PURE__ */ React.createElement("div", { className: "dates", style: { maxWidth: "360px" } }, /* @__PURE__ */ React.createElement("label", null, "Desde", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: rango.desde,
      onChange: (e) => setRango({ ...rango, desde: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Hasta", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: rango.hasta,
      min: rango.desde,
      onChange: (e) => setRango({ ...rango, hasta: e.target.value })
    }
  )))), /* @__PURE__ */ React.createElement("div", { className: "admin-card ocupacion-tabla" }, !ocupacion.length ? /* @__PURE__ */ React.createElement("p", { className: "ocupacion-vacia" }, "Todavía no hay reservas confirmadas en este período.") : /* @__PURE__ */ React.createElement("div", { className: "ocupacion-scroll" }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Artículo"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Veces"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Días"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Ingreso"))), /* @__PURE__ */ React.createElement("tbody", null, ocupacion.map((fila) => /* @__PURE__ */ React.createElement("tr", { key: fila.producto_id }, /* @__PURE__ */ React.createElement("td", null, fila.producto_nombre), /* @__PURE__ */ React.createElement("td", { className: "num" }, fila.veces_alquilado), /* @__PURE__ */ React.createElement("td", { className: "num" }, fila.dias_alquilado), /* @__PURE__ */ React.createElement("td", { className: "num" }, dineroPanel(fila.ingreso), " ", moneda)))))))), pestana === "config" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Personaliza tu tienda"), /* @__PURE__ */ React.createElement("h1", null, "Configuración")), /* @__PURE__ */ React.createElement("button", { onClick: guardarConfiguracion }, "Guardar cambios")), /* @__PURE__ */ React.createElement("div", { className: "admin-card settings-form" }, /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Logo de tu negocio", /* @__PURE__ */ React.createElement("div", { className: "logo-picker" }, negocio.logo_url && /* @__PURE__ */ React.createElement("img", { src: negocio.logo_url, alt: "", className: "logo-preview" }), /* @__PURE__ */ React.createElement("label", { className: "upload" }, subiendoLogo ? "Subiendo…" : negocio.logo_url ? "Cambiar logo" : "Subir logo", /* @__PURE__ */ React.createElement("input", { type: "file", accept: "image/*", disabled: subiendoLogo, onChange: subirLogo })))), /* @__PURE__ */ React.createElement("label", null, "Nombre del negocio", /* @__PURE__ */ React.createElement(
    "input",
    {
      value: negocio.nombre,
      onChange: (e) => setNegocio({ ...negocio, nombre: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "WhatsApp del negocio", /* @__PURE__ */ React.createElement(
    "input",
    {
      placeholder: "Ej. 5351234567",
      inputMode: "tel",
      value: negocio.whatsapp,
      onChange: (e) => setNegocio({ ...negocio, whatsapp: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Título de bienvenida", /* @__PURE__ */ React.createElement(
    "input",
    {
      value: negocio.titulo_bienvenida,
      onChange: (e) => setNegocio({ ...negocio, titulo_bienvenida: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Moneda", /* @__PURE__ */ React.createElement(
    "input",
    {
      value: negocio.moneda,
      onChange: (e) => setNegocio({ ...negocio, moneda: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Mensaje de bienvenida", /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: negocio.texto_bienvenida,
      onChange: (e) => setNegocio({ ...negocio, texto_bienvenida: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Mínimo de días por alquiler", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "1",
      inputMode: "numeric",
      value: negocio.dias_minimos,
      onChange: (e) => setNegocio({ ...negocio, dias_minimos: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Instagram", /* @__PURE__ */ React.createElement(
    "input",
    {
      placeholder: "https://instagram.com/...",
      value: negocio.instagram_url,
      onChange: (e) => setNegocio({ ...negocio, instagram_url: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Facebook", /* @__PURE__ */ React.createElement(
    "input",
    {
      placeholder: "https://facebook.com/...",
      value: negocio.facebook_url,
      onChange: (e) => setNegocio({ ...negocio, facebook_url: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Mensaje de confirmación (a la clienta)", /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: negocio.plantilla_confirmacion || "",
      onChange: (e) => setNegocio({ ...negocio, plantilla_confirmacion: e.target.value })
    }
  ), /* @__PURE__ */ React.createElement("small", null, "Variables disponibles: ", "{nombre}", ", ", "{pedido_id}", ", ", "{fechas}", ", ", "{total}", ". Se abre por WhatsApp al confirmar una reserva.")), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Mensaje para compartir tu tienda", /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: negocio.plantilla_compartir || "",
      onChange: (e) => setNegocio({ ...negocio, plantilla_compartir: e.target.value })
    }
  ), /* @__PURE__ */ React.createElement("small", null, "Variables disponibles: ", "{nombre}", ", ", "{enlace}", '. Se usa en el botón "Compartir tienda".')), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Mensaje de solicitud (de la clienta a ti)", /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: negocio.plantilla_solicitud || "",
      onChange: (e) => setNegocio({ ...negocio, plantilla_solicitud: e.target.value })
    }
  ), /* @__PURE__ */ React.createElement("small", null, "Variables disponibles: ", "{nombre}", ", ", "{fechas}", ", ", "{items}", ", ", "{total}", ", ", "{telefono}", ", ", "{notas}", ", ", "{pedido_id}", ". Es el mensaje que le llega a WhatsApp cuando una clienta pide un alquiler desde tu tienda.")), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Enlace de tu tienda", /* @__PURE__ */ React.createElement(
    "input",
    {
      readOnly: true,
      value: enlaceTiendaCompleto,
      onFocus: (e) => e.target.select()
    }
  )))))));
}
window.Panel = Panel;
