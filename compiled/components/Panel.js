const { useEffect, useState, useCallback } = React;
function dineroPanel(valor) {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 0 }).format(valor || 0);
}
function fechaLargaPanel(iso) {
  if (!iso) return "";
  return (/* @__PURE__ */ new Date(`${iso}T12:00:00Z`)).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
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
const PLANTILLA_CONFIRMACION_POR_DEFECTO = "Hola {nombre}, tu pedido quedó confirmado ✅\n📅 {fechas}\n💰 Total: {total}\nCualquier duda me avisas. ¡Gracias por tu preferencia!";
function armarMensajeConfirmacion(plantilla, pedido, moneda) {
  const fechas = pedido.dias > 1 ? `${fechaLargaPanel(pedido.fecha_inicio)} al ${fechaLargaPanel(pedido.fecha_fin)} (${pedido.dias} días)` : fechaLargaPanel(pedido.fecha_evento || pedido.fecha_inicio);
  const total = `${dineroPanel(pedido.total)} ${moneda}`;
  const base = plantilla && plantilla.trim() ? plantilla : PLANTILLA_CONFIRMACION_POR_DEFECTO;
  return base.replaceAll("{nombre}", pedido.cliente_nombre || "").replaceAll("{pedido_id}", pedido.id || "").replaceAll("{fechas}", fechas).replaceAll("{total}", total);
}
function mensajeDeErrorReserva(error) {
  const texto = String(error?.message || error || "");
  if (texto.includes("SIN_STOCK")) {
    const nombre = texto.split("SIN_STOCK:")[1]?.split("\n")[0]?.trim();
    return nombre ? `${nombre} no tiene stock suficiente ese día.` : "No hay stock suficiente ese día.";
  }
  if (texto.includes("PERIODO_INVALIDO")) return "Ese día no es válido.";
  if (texto.includes("PEDIDO_VACIO")) return "Elige al menos un artículo.";
  if (texto.includes("PRODUCTO_NO_EXISTE")) return "Uno de los artículos ya no existe.";
  if (texto.includes("NO_AUTORIZADO")) return "No tienes permiso para crear reservas en este negocio.";
  if (texto.includes("RESERVA_NO_EDITABLE")) return "Esta reserva ya no se puede editar. Cancélala y haz otra.";
  if (texto.includes("FECHA_PASADA")) return "No puedes mover la reserva a un día que ya pasó.";
  if (texto.includes("PEDIDO_NO_EXISTE")) return "Esa reserva ya no existe.";
  console.error("[Panel] error de reserva no reconocido:", texto);
  return "No se pudo guardar la reserva. Inténtalo de nuevo.";
}
function cumpleFiltroReserva(estado, filtro) {
  if (filtro === "todas") return true;
  if (filtro === "pendientes") return estado === "pendiente" || estado === "confirmado";
  if (filtro === "completadas") return estado === "entregado" || estado === "devuelto";
  if (filtro === "canceladas") return estado === "cancelado";
  return true;
}
const NOMBRES_MES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre"
];
function diasDelMesPanel(mesStr) {
  const [anio, mes] = mesStr.split("-").map(Number);
  const primerDia = new Date(anio, mes - 1, 1);
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const celdas = [];
  for (let i = 0; i < primerDia.getDay(); i++) celdas.push(null);
  for (let d = 1; d <= ultimoDia; d++) {
    celdas.push(`${mesStr}-${String(d).padStart(2, "0")}`);
  }
  return celdas;
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
function TarjetaReserva({ pedido, moneda, onCambiarEstado, onEliminar, onEditar }) {
  const puedeEliminar = pedido.estado === "entregado" || pedido.estado === "devuelto" || pedido.estado === "cancelado";
  const puedeEditar = pedido.estado === "pendiente" || pedido.estado === "confirmado";
  return /* @__PURE__ */ React.createElement("article", { className: "admin-order admin-card" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: `order-chip ${pedido.estado}` }, ETIQUETA_ESTADO[pedido.estado] || pedido.estado), /* @__PURE__ */ React.createElement("h3", null, pedido.cliente_nombre), pedido.dias > 1 ? /* @__PURE__ */ React.createElement("p", null, pedido.id, " · Reserva anterior: ", fechaLargaPanel(pedido.fecha_inicio), " al ", fechaLargaPanel(pedido.fecha_fin), " · ", pedido.dias, " días") : /* @__PURE__ */ React.createElement("p", null, pedido.id, " · Evento: ", fechaLargaPanel(pedido.fecha_evento || pedido.fecha_inicio)), pedido.dias <= 1 && /* @__PURE__ */ React.createElement("p", null, "Recoge el ", fechaLargaPanel(pedido.fecha_inicio), " después de las 5:00 PM"), pedido.cliente_telefono && /* @__PURE__ */ React.createElement("p", null, "📞 ", /* @__PURE__ */ React.createElement("a", { href: `tel:${pedido.cliente_telefono}` }, pedido.cliente_telefono)), pedido.notas && /* @__PURE__ */ React.createElement("p", null, "📝 ", pedido.notas)), /* @__PURE__ */ React.createElement("ul", null, (pedido.alquiler_pedido_items || []).map((item) => /* @__PURE__ */ React.createElement("li", { key: item.id }, item.cantidad, " × ", item.producto_nombre))), /* @__PURE__ */ React.createElement("div", { className: "order-importes" }, /* @__PURE__ */ React.createElement("strong", null, dineroPanel(pedido.total), " ", moneda), Number(pedido.anticipo) > 0 && /* @__PURE__ */ React.createElement("small", null, "Anticipo: ", dineroPanel(pedido.anticipo), " ", moneda)), /* @__PURE__ */ React.createElement("div", null, pedido.estado === "pendiente" && /* @__PURE__ */ React.createElement("button", { onClick: () => onCambiarEstado(pedido, "confirmado") }, "Confirmar"), pedido.estado === "confirmado" && /* @__PURE__ */ React.createElement("button", { onClick: () => onCambiarEstado(pedido, "entregado") }, "Entregada"), pedido.estado === "entregado" && /* @__PURE__ */ React.createElement("button", { onClick: () => onCambiarEstado(pedido, "devuelto") }, "Devuelta"), puedeEditar && /* @__PURE__ */ React.createElement("button", { className: "secondary", onClick: () => onEditar(pedido) }, "Editar"), pedido.estado !== "cancelado" && pedido.estado !== "devuelto" && /* @__PURE__ */ React.createElement("button", { className: "danger", onClick: () => onCambiarEstado(pedido, "cancelado") }, "Cancelar"), puedeEliminar && /* @__PURE__ */ React.createElement("button", { className: "danger", onClick: () => onEliminar(pedido) }, "Eliminar")));
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
  const [filtroReservas, setFiltroReservas] = useState("todas");
  const [vistaReservas, setVistaReservas] = useState("lista");
  const [mesCalendario, setMesCalendario] = useState(() => {
    const d = /* @__PURE__ */ new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [pedidosMes, setPedidosMes] = useState([]);
  const [diaSeleccionado, setDiaSeleccionado] = useState(null);
  const [creandoReserva, setCreandoReserva] = useState(false);
  const [galeria, setGaleria] = useState([]);
  const [subiendoFotoGaleria, setSubiendoFotoGaleria] = useState(false);
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
        `alquiler_pedidos?negocio_id=eq.${negocio.id}&oculto=eq.false&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,alquiler_pedido_items(id,producto_id,producto_nombre,cantidad)&order=creado_en.desc&limit=200`
      );
      setPedidos(filas);
    } catch (e) {
      console.error("[Panel] error cargando pedidos:", e);
      notificar("No se pudieron cargar las reservas.");
    }
  }, [negocio.id]);
  const cargarPedidosDelMes = useCallback(async () => {
    const [anio, mes] = mesCalendario.split("-").map(Number);
    const desde = `${mesCalendario}-01`;
    const hasta = `${mesCalendario}-${String(new Date(anio, mes, 0).getDate()).padStart(2, "0")}`;
    try {
      const filas = await window.supaGet(
        `alquiler_pedidos?negocio_id=eq.${negocio.id}&oculto=eq.false&fecha_evento=gte.${desde}&fecha_evento=lte.${hasta}&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,alquiler_pedido_items(id,producto_id,producto_nombre,cantidad)&order=fecha_evento.asc`
      );
      setPedidosMes(filas);
    } catch (e) {
      console.error("[Panel] error cargando calendario:", e);
      notificar("No se pudo cargar el calendario.");
    }
  }, [negocio.id, mesCalendario]);
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
  const cargarGaleria = useCallback(async () => {
    try {
      setGaleria(await window.supaGet(
        `alquiler_galeria?negocio_id=eq.${negocio.id}&select=id,imagen_url,descripcion,creado_en&order=creado_en.desc`
      ));
    } catch (e) {
      console.error("[Panel] error cargando galería:", e);
      notificar("No se pudo cargar la galería.");
    }
  }, [negocio.id]);
  useEffect(() => {
    cargarProductos();
    cargarPedidos();
  }, [cargarProductos, cargarPedidos]);
  useEffect(() => {
    if (pestana === "reservas" && vistaReservas === "calendario") cargarPedidosDelMes();
  }, [pestana, vistaReservas, cargarPedidosDelMes]);
  useEffect(() => {
    if (pestana === "ocupacion") cargarOcupacion();
  }, [pestana, cargarOcupacion]);
  useEffect(() => {
    if (pestana === "galeria") cargarGaleria();
  }, [pestana, cargarGaleria]);
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
            anticipo_porciento: Math.min(100, Math.max(0, Math.floor(Number(negocio.anticipo_porciento) || 0))),
            anticipo_redondear: negocio.anticipo_redondear !== false,
            pago_tarjeta: negocio.pago_tarjeta || "",
            pago_telefono: negocio.pago_telefono || "",
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
      } else notificar("No se pudo quitar el artículo.");
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
  async function agregarFotoGaleria(evento) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setSubiendoFotoGaleria(true);
    const subida = await window.subirFotoGaleria(archivo, negocio.id);
    setSubiendoFotoGaleria(false);
    if (!subida) return;
    try {
      const res = await fetch(`${window.SUPABASE_URL}/rest/v1/alquiler_galeria`, {
        method: "POST",
        headers: window.supaHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({ negocio_id: negocio.id, imagen_url: subida.url, descripcion: "" })
      });
      if (!res.ok) throw new Error(await res.text());
      const [creada] = await res.json();
      setGaleria((actual) => [creada, ...actual]);
      notificar("Foto agregada a la galería.");
    } catch (e) {
      console.error("[Panel] error guardando foto de galería:", e);
      notificar("La foto se subió pero no se pudo guardar. Inténtalo de nuevo.");
    }
  }
  async function guardarDescripcionGaleria(foto) {
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/alquiler_galeria?id=eq.${foto.id}`,
        {
          method: "PATCH",
          headers: window.supaHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ descripcion: foto.descripcion })
        }
      );
      notificar(res.ok ? "Descripción guardada." : "No se pudo guardar.");
    } catch (e) {
      console.error("[Panel] error guardando descripción:", e);
      notificar("No se pudo guardar.");
    }
  }
  async function eliminarFotoGaleria(foto) {
    if (!window.confirm("¿Quitar esta foto de la galería?")) return;
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/alquiler_galeria?id=eq.${foto.id}`,
        { method: "DELETE", headers: window.supaHeaders({ Prefer: "return=minimal" }) }
      );
      if (res.ok) {
        setGaleria((actual) => actual.filter((f) => f.id !== foto.id));
        notificar("Foto eliminada.");
      } else notificar("No se pudo eliminar la foto.");
    } catch (e) {
      console.error("[Panel] error eliminando foto de galería:", e);
    }
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
      setPedidosMes((actual) => actual.map((p) => p.id === pedido.id ? { ...p, estado } : p));
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
  async function eliminarReserva(pedido) {
    if (!window.confirm("¿Quitar esta reserva de la lista? No se borra del historial de Ocupación.")) return;
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/alquiler_pedidos?id=eq.${pedido.id}`,
        {
          method: "PATCH",
          headers: window.supaHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ oculto: true, actualizado_en: (/* @__PURE__ */ new Date()).toISOString() })
        }
      );
      if (res.ok) {
        setPedidos((actual) => actual.filter((p) => p.id !== pedido.id));
        setPedidosMes((actual) => actual.filter((p) => p.id !== pedido.id));
        notificar("Reserva quitada de la lista.");
      } else {
        notificar("No se pudo eliminar la reserva.");
      }
    } catch (e) {
      console.error("[Panel] error eliminando reserva:", e);
      notificar("No se pudo eliminar la reserva.");
    }
  }
  function cambiarMesCalendario(delta) {
    const [anio, mes] = mesCalendario.split("-").map(Number);
    const d = new Date(anio, mes - 1 + delta, 1);
    setMesCalendario(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setDiaSeleccionado(null);
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
    setReservaManual({ cliente_nombre: "", cliente_telefono: "", notas: "", fecha_evento: "", items: {} });
  }
  function abrirEdicionReserva(pedido) {
    const items = {};
    (pedido.alquiler_pedido_items || []).forEach((item) => {
      if (item.producto_id) items[item.producto_id] = item.cantidad;
    });
    setReservaManual({
      id: pedido.id,
      cliente_nombre: pedido.cliente_nombre || "",
      cliente_telefono: pedido.cliente_telefono || "",
      notas: pedido.notas || "",
      fecha_evento: pedido.fecha_evento || pedido.fecha_inicio || "",
      items
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  async function guardarReserva(evento) {
    evento.preventDefault();
    if (!reservaManual.cliente_nombre.trim()) {
      notificar("Ponle un nombre a la clienta.");
      return;
    }
    if (!reservaManual.fecha_evento) {
      notificar("Elige el día del evento.");
      return;
    }
    const items = Object.entries(reservaManual.items).map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
    if (!items.length) {
      notificar("Elige al menos un artículo.");
      return;
    }
    const editando = Boolean(reservaManual.id);
    setCreandoReserva(true);
    try {
      if (editando) {
        await window.supaRpc("alquiler_editar_pedido", {
          p_pedido: reservaManual.id,
          p_nombre: reservaManual.cliente_nombre.trim(),
          p_telefono: reservaManual.cliente_telefono.trim(),
          p_notas: reservaManual.notas.trim(),
          p_evento: reservaManual.fecha_evento,
          p_items: items
        });
        notificar(`Reserva ${reservaManual.id} actualizada.`);
      } else {
        const pedido = await window.supaRpc("alquiler_crear_pedido_manual", {
          p_negocio: negocio.id,
          p_nombre: reservaManual.cliente_nombre.trim(),
          p_telefono: reservaManual.cliente_telefono.trim(),
          p_notas: reservaManual.notas.trim(),
          p_evento: reservaManual.fecha_evento,
          p_items: items
        });
        notificar(`Reserva ${pedido.id} creada y confirmada.`);
      }
      setReservaManual(null);
      cargarPedidos();
      if (vistaReservas === "calendario") cargarPedidosDelMes();
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
      className: pestana === "galeria" ? "active" : "",
      onClick: () => setPestana("galeria")
    },
    "Galería"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: pestana === "config" ? "active" : "",
      onClick: () => setPestana("config")
    },
    "Configuración"
  ), /* @__PURE__ */ React.createElement("a", { href: enlaceTienda }, "Ver mi tienda ↗"), /* @__PURE__ */ React.createElement("button", { onClick: compartirTienda }, "Compartir tienda")), /* @__PURE__ */ React.createElement("section", { className: "admin-content" }, aviso && /* @__PURE__ */ React.createElement("p", { className: "admin-notice" }, aviso), pestana === "reservas" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Agenda y disponibilidad"), /* @__PURE__ */ React.createElement("h1", null, "Reservas")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "8px" } }, /* @__PURE__ */ React.createElement("div", { className: "vista-toggle" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: vistaReservas === "lista" ? "active" : "",
      onClick: () => setVistaReservas("lista")
    },
    "Lista"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: vistaReservas === "calendario" ? "active" : "",
      onClick: () => setVistaReservas("calendario")
    },
    "Calendario"
  )), !reservaManual && /* @__PURE__ */ React.createElement("button", { onClick: abrirReservaManual }, "+ Reserva manual"), /* @__PURE__ */ React.createElement("button", { onClick: vistaReservas === "calendario" ? cargarPedidosDelMes : cargarPedidos }, "Actualizar"))), reservaManual && /* @__PURE__ */ React.createElement("form", { className: "admin-card producto-form", onSubmit: guardarReserva }, /* @__PURE__ */ React.createElement("h3", null, reservaManual.id ? `Editar reserva ${reservaManual.id}` : "Reserva manual"), /* @__PURE__ */ React.createElement("p", { className: "producto-form-nota" }, reservaManual.id ? "Corrige lo que haga falta. El total y el anticipo se recalculan solos, y el día nuevo se comprueba contra el stock." : "Para una clienta que acordó todo en persona o por teléfono, sin pasar por la tienda. Queda confirmada de una vez."), /* @__PURE__ */ React.createElement("div", { className: "producto-form-fila" }, /* @__PURE__ */ React.createElement("label", null, "Nombre de la clienta", /* @__PURE__ */ React.createElement(
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
  ))), /* @__PURE__ */ React.createElement("div", { className: "producto-form-fila" }, /* @__PURE__ */ React.createElement("label", null, "Día del evento", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      required: true,
      value: reservaManual.fecha_evento,
      onChange: (e) => setReservaManual({ ...reservaManual, fecha_evento: e.target.value })
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
  )), /* @__PURE__ */ React.createElement("div", { className: "producto-form-acciones" }, /* @__PURE__ */ React.createElement("button", { type: "submit", disabled: creandoReserva }, creandoReserva ? "Guardando…" : reservaManual.id ? "Guardar cambios" : "Crear reserva confirmada"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "apagar", onClick: cancelarReservaManual }, "Cancelar"))), /* @__PURE__ */ React.createElement(TarjetaAvisos, { negocioId: negocio.id }), /* @__PURE__ */ React.createElement("div", { className: "reserva-filtros" }, [
    ["todas", "Todas"],
    ["pendientes", "Pendientes"],
    ["completadas", "Completadas"],
    ["canceladas", "Canceladas"]
  ].map(([valor, etiqueta]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: valor,
      className: filtroReservas === valor ? "active" : "",
      onClick: () => setFiltroReservas(valor)
    },
    etiqueta
  ))), vistaReservas === "lista" ? /* @__PURE__ */ React.createElement("div", { className: "admin-orders" }, !pedidos.filter((p) => cumpleFiltroReserva(p.estado, filtroReservas)).length && /* @__PURE__ */ React.createElement("div", { className: "admin-card empty-orders" }, pedidos.length ? "Ninguna reserva con ese filtro." : "Todavía no hay solicitudes."), pedidos.filter((p) => cumpleFiltroReserva(p.estado, filtroReservas)).map((pedido) => /* @__PURE__ */ React.createElement(
    TarjetaReserva,
    {
      key: pedido.id,
      pedido,
      moneda,
      onCambiarEstado: cambiarEstado,
      onEliminar: eliminarReserva,
      onEditar: abrirEdicionReserva
    }
  ))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "calendario-nav" }, /* @__PURE__ */ React.createElement("button", { onClick: () => cambiarMesCalendario(-1) }, "←"), /* @__PURE__ */ React.createElement("strong", null, NOMBRES_MES[Number(mesCalendario.split("-")[1]) - 1], " ", mesCalendario.split("-")[0]), /* @__PURE__ */ React.createElement("button", { onClick: () => cambiarMesCalendario(1) }, "→")), /* @__PURE__ */ React.createElement("div", { className: "calendario-grid" }, ["D", "L", "M", "M", "J", "V", "S"].map((d, i) => /* @__PURE__ */ React.createElement("span", { className: "calendario-dow", key: i }, d)), diasDelMesPanel(mesCalendario).map((dia, i) => {
    const enEsteDia = dia ? pedidosMes.filter((p) => p.fecha_evento === dia) : [];
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: i,
        className: `calendario-dia${dia ? "" : " vacio"}${diaSeleccionado === dia ? " activo" : ""}`,
        disabled: !dia,
        onClick: () => setDiaSeleccionado(dia)
      },
      dia && /* @__PURE__ */ React.createElement("span", null, Number(dia.split("-")[2])),
      enEsteDia.length > 0 && /* @__PURE__ */ React.createElement("b", null, enEsteDia.length)
    );
  })), diaSeleccionado && /* @__PURE__ */ React.createElement("div", { className: "admin-orders", style: { marginTop: "20px" } }, /* @__PURE__ */ React.createElement("h3", null, fechaLargaPanel(diaSeleccionado)), !pedidosMes.filter((p) => p.fecha_evento === diaSeleccionado).length && /* @__PURE__ */ React.createElement("div", { className: "admin-card empty-orders" }, "No hay reservas ese día."), pedidosMes.filter((p) => p.fecha_evento === diaSeleccionado).map((pedido) => /* @__PURE__ */ React.createElement(
    TarjetaReserva,
    {
      key: pedido.id,
      pedido,
      moneda,
      onCambiarEstado: cambiarEstado,
      onEliminar: eliminarReserva,
      onEditar: abrirEdicionReserva
    }
  ))))), pestana === "productos" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Tu inventario"), /* @__PURE__ */ React.createElement("h1", null, "Artículos")), !productoNuevo && /* @__PURE__ */ React.createElement("button", { onClick: abrirFormularioProducto }, "+ Nuevo artículo")), productoNuevo && /* @__PURE__ */ React.createElement("form", { className: "admin-card producto-form", onSubmit: crearProducto }, /* @__PURE__ */ React.createElement("h3", null, "Nuevo artículo"), /* @__PURE__ */ React.createElement("label", null, "Nombre", /* @__PURE__ */ React.createElement(
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
  )), /* @__PURE__ */ React.createElement("label", null, "Precio por evento", /* @__PURE__ */ React.createElement(
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
      )), /* @__PURE__ */ React.createElement("label", null, "Precio por evento", /* @__PURE__ */ React.createElement(
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
  }))), pestana === "ocupacion" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Qué te está produciendo"), /* @__PURE__ */ React.createElement("h1", null, "Ocupación"))), /* @__PURE__ */ React.createElement("div", { className: "admin-card push-card" }, /* @__PURE__ */ React.createElement("p", null, "Días que estuvo alquilado cada artículo en el período elegido. Lo de arriba es lo que más te produce; lo de abajo, lo que te está ocupando espacio. Cada evento cuenta 2 días: la tarde que se recoge y la mañana que se entrega."), /* @__PURE__ */ React.createElement("div", { className: "dates", style: { maxWidth: "360px" } }, /* @__PURE__ */ React.createElement("label", null, "Desde", /* @__PURE__ */ React.createElement(
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
  )))), /* @__PURE__ */ React.createElement("div", { className: "admin-card ocupacion-tabla" }, !ocupacion.length ? /* @__PURE__ */ React.createElement("p", { className: "ocupacion-vacia" }, "Todavía no hay reservas confirmadas en este período.") : /* @__PURE__ */ React.createElement("div", { className: "ocupacion-scroll" }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Artículo"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Veces"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Días"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Ingreso"))), /* @__PURE__ */ React.createElement("tbody", null, ocupacion.map((fila) => /* @__PURE__ */ React.createElement("tr", { key: fila.producto_id }, /* @__PURE__ */ React.createElement("td", null, fila.producto_nombre), /* @__PURE__ */ React.createElement("td", { className: "num" }, fila.veces_alquilado), /* @__PURE__ */ React.createElement("td", { className: "num" }, fila.dias_alquilado), /* @__PURE__ */ React.createElement("td", { className: "num" }, dineroPanel(fila.ingreso), " ", moneda)))))))), pestana === "galeria" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Tu portafolio"), /* @__PURE__ */ React.createElement("h1", null, "Galería")), /* @__PURE__ */ React.createElement("label", { className: "galeria-add" }, subiendoFotoGaleria ? "Subiendo…" : "+ Agregar foto", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "file",
      accept: "image/*",
      disabled: subiendoFotoGaleria,
      onChange: agregarFotoGaleria
    }
  ))), /* @__PURE__ */ React.createElement("p", { className: "producto-form-nota" }, 'Estas fotos se ven en tu tienda pública, en la sección "Nuestros trabajos" — son la prueba de lo que ya has hecho.'), /* @__PURE__ */ React.createElement("div", { className: "admin-galeria" }, !galeria.length && /* @__PURE__ */ React.createElement("div", { className: "admin-card empty-orders" }, "Todavía no tienes fotos. Pulsa «+ Agregar foto» para empezar."), galeria.map((foto) => /* @__PURE__ */ React.createElement("article", { className: "admin-galeria-item admin-card", key: foto.id }, /* @__PURE__ */ React.createElement("img", { src: foto.imagen_url, alt: "" }), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      placeholder: "Descripción corta (opcional)",
      value: foto.descripcion,
      onChange: (e) => setGaleria((actual) => actual.map((f) => f.id === foto.id ? { ...f, descripcion: e.target.value } : f))
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "admin-galeria-item-acciones" }, /* @__PURE__ */ React.createElement("button", { onClick: () => guardarDescripcionGaleria(foto) }, "Guardar"), /* @__PURE__ */ React.createElement("button", { className: "danger", onClick: () => eliminarFotoGaleria(foto) }, "Eliminar")))))), pestana === "config" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "admin-title" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Personaliza tu tienda"), /* @__PURE__ */ React.createElement("h1", null, "Configuración")), /* @__PURE__ */ React.createElement("button", { onClick: guardarConfiguracion }, "Guardar cambios")), /* @__PURE__ */ React.createElement("div", { className: "admin-card settings-form" }, /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Logo de tu negocio", /* @__PURE__ */ React.createElement("div", { className: "logo-picker" }, negocio.logo_url && /* @__PURE__ */ React.createElement("img", { src: negocio.logo_url, alt: "", className: "logo-preview" }), /* @__PURE__ */ React.createElement("label", { className: "upload" }, subiendoLogo ? "Subiendo…" : negocio.logo_url ? "Cambiar logo" : "Subir logo", /* @__PURE__ */ React.createElement("input", { type: "file", accept: "image/*", disabled: subiendoLogo, onChange: subirLogo })))), /* @__PURE__ */ React.createElement("label", null, "Nombre del negocio", /* @__PURE__ */ React.createElement(
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
  )), Number(negocio.anticipo_porciento) > 0 && !negocio.pago_tarjeta && /* @__PURE__ */ React.createElement("p", { className: "config-warning" }, "Configuraste un anticipo pero no una tarjeta para cobrarlo — tus clientas no sabrán a dónde transferir."), Number(negocio.anticipo_porciento) > 0 && negocio.plantilla_solicitud && !negocio.plantilla_solicitud.includes("{anticipo}") && !negocio.plantilla_solicitud.includes("{tarjeta}") && /* @__PURE__ */ React.createElement("p", { className: "config-warning" }, "Tu mensaje de solicitud personalizado no menciona el anticipo — tus clientas no lo verán en WhatsApp. Agrega ", "{anticipo}", " donde quieras que aparezca."), /* @__PURE__ */ React.createElement("label", null, "Anticipo (%)", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "0",
      max: "100",
      inputMode: "numeric",
      value: negocio.anticipo_porciento ?? 0,
      onChange: (e) => setNegocio({ ...negocio, anticipo_porciento: e.target.value })
    }
  ), /* @__PURE__ */ React.createElement("small", null, "0 = sin anticipo. La clienta ve cuánto paga ahora y cuánto al recoger.")), /* @__PURE__ */ React.createElement("label", { className: "check-linea" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "checkbox",
      checked: negocio.anticipo_redondear !== false,
      onChange: (e) => setNegocio({ ...negocio, anticipo_redondear: e.target.checked })
    }
  ), " ", "Redondear el anticipo a la centena"), /* @__PURE__ */ React.createElement("label", null, "Tarjeta para el anticipo", /* @__PURE__ */ React.createElement(
    "input",
    {
      placeholder: "Ej. 9227 0699 1234 5678",
      inputMode: "numeric",
      value: negocio.pago_tarjeta || "",
      onChange: (e) => setNegocio({ ...negocio, pago_tarjeta: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Teléfono asociado a la tarjeta", /* @__PURE__ */ React.createElement(
    "input",
    {
      placeholder: "Ej. 53842336",
      inputMode: "tel",
      value: negocio.pago_telefono || "",
      onChange: (e) => setNegocio({ ...negocio, pago_telefono: e.target.value })
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
  ), /* @__PURE__ */ React.createElement("small", null, "Variables disponibles: ", "{nombre}", ", ", "{fechas}", " (el día del evento), ", "{items}", ", ", "{total}", ", ", "{anticipo}", ", ", "{tarjeta}", ", ", "{telefono_pago}", ", ", "{telefono}", ", ", "{notas}", ", ", "{pedido_id}", ". ", "{telefono}", ", ", "{notas}", " y ", "{anticipo}", " ya vienen con su propio emoji y desaparecen del todo si el dato no aplica — ponlas en su propia línea. Es el mensaje que le llega a WhatsApp cuando una clienta pide un alquiler desde tu tienda.")), /* @__PURE__ */ React.createElement("label", { className: "wide" }, "Enlace de tu tienda", /* @__PURE__ */ React.createElement(
    "input",
    {
      readOnly: true,
      value: enlaceTiendaCompleto,
      onFocus: (e) => e.target.select()
    }
  )))))));
}
window.Panel = Panel;
