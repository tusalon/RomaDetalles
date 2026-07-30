const { useEffect, useMemo, useState, useCallback } = React;
function diasEntre(inicio, fin) {
  if (!inicio || !fin) return 0;
  const ms = /* @__PURE__ */ new Date(`${fin}T12:00:00Z`) - /* @__PURE__ */ new Date(`${inicio}T12:00:00Z`);
  return Math.max(0, Math.floor(ms / 864e5) + 1);
}
function dinero(valor) {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 0 }).format(valor || 0);
}
function hoyISO() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function slugDeLaUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("s") || window.ALQUILER_SLUG_POR_DEFECTO || "";
}
function Tienda() {
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [negocio, setNegocio] = useState(null);
  const [productos, setProductos] = useState([]);
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [categoria, setCategoria] = useState("Todos");
  const [carrito, setCarrito] = useState({});
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const [disponibilidad, setDisponibilidad] = useState({});
  const [comprobando, setComprobando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState("");
  const dias = diasEntre(inicio, fin);
  useEffect(() => {
    const slug = slugDeLaUrl();
    if (!slug) {
      setErrorCarga("Falta indicar la tienda en el enlace.");
      setCargando(false);
      return;
    }
    (async () => {
      try {
        const negocios = await window.supaGet(
          `alquiler_negocios?slug=eq.${encodeURIComponent(slug)}&activo=eq.true&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos`
        );
        if (!negocios.length) {
          setErrorCarga("No encontramos esta tienda. Revisa el enlace.");
          setCargando(false);
          return;
        }
        const neg = negocios[0];
        setNegocio(neg);
        const items = await window.supaGet(
          `alquiler_productos?negocio_id=eq.${neg.id}&activo=eq.true&select=id,nombre,descripcion,categoria,precio_dia,cantidad,foto_url&order=orden.asc,creado_en.asc`
        );
        setProductos(items);
      } catch (e) {
        console.error("[Tienda] error cargando:", e);
        setErrorCarga("No se pudo cargar la tienda. Revisa tu conexión.");
      } finally {
        setCargando(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!negocio || !inicio || !fin || fin < inicio) return;
    let vigente = true;
    setComprobando(true);
    window.supaRpc("alquiler_disponibilidad", {
      p_negocio: negocio.id,
      p_inicio: inicio,
      p_fin: fin
    }).then((filas) => {
      if (!vigente) return;
      const mapa = {};
      filas.forEach((f) => {
        mapa[f.producto_id] = f.disponible;
      });
      setDisponibilidad(mapa);
      setCarrito((actual) => {
        const ajustado = {};
        Object.entries(actual).forEach(([id, cant]) => {
          const tope = mapa[id] ?? 0;
          if (tope > 0) ajustado[id] = Math.min(cant, tope);
        });
        return ajustado;
      });
    }).catch((e) => console.error("[Tienda] error de disponibilidad:", e)).finally(() => {
      if (vigente) setComprobando(false);
    });
    return () => {
      vigente = false;
    };
  }, [negocio, inicio, fin]);
  const categorias = useMemo(
    () => ["Todos", ...new Set(productos.map((p) => p.categoria).filter(Boolean))],
    [productos]
  );
  const filtrados = categoria === "Todos" ? productos : productos.filter((p) => p.categoria === categoria);
  const enCarrito = productos.filter((p) => carrito[p.id] > 0);
  const totalArticulos = Object.values(carrito).reduce((s, n) => s + n, 0);
  const totalDiario = productos.reduce(
    (s, p) => s + Number(p.precio_dia) * (carrito[p.id] || 0),
    0
  );
  const disponibleDe = useCallback((producto) => {
    if (!dias) return producto.cantidad;
    return disponibilidad[producto.id] ?? producto.cantidad;
  }, [dias, disponibilidad]);
  function agregar(producto) {
    if (!dias) {
      document.getElementById("fechas")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setCarrito((actual) => ({
      ...actual,
      [producto.id]: Math.min(disponibleDe(producto), (actual[producto.id] || 0) + 1)
    }));
    setCajonAbierto(true);
  }
  function quitar(producto) {
    setCarrito((actual) => {
      const cant = (actual[producto.id] || 0) - 1;
      const copia = { ...actual };
      if (cant <= 0) delete copia[producto.id];
      else copia[producto.id] = cant;
      return copia;
    });
  }
  async function enviarPedido(evento) {
    evento.preventDefault();
    if (!nombre.trim()) {
      setAviso("Escribe tu nombre para continuar.");
      return;
    }
    if (dias < (negocio.dias_minimos || 1)) {
      setAviso(`El alquiler mínimo es de ${negocio.dias_minimos} día(s).`);
      return;
    }
    setEnviando(true);
    setAviso("Comprobando disponibilidad…");
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/functions/v1/${window.ALQUILER_FUNCION_PEDIDO}`,
        {
          method: "POST",
          headers: window.supaHeaders(),
          body: JSON.stringify({
            slug: negocio.slug,
            cliente_nombre: nombre.trim(),
            cliente_telefono: telefono.trim(),
            notas: notas.trim(),
            fecha_inicio: inicio,
            fecha_fin: fin,
            items: enCarrito.map((p) => ({
              producto_id: p.id,
              cantidad: carrito[p.id]
            }))
          })
        }
      );
      const datos = await res.json();
      if (!res.ok) {
        setAviso(datos.error || "No se pudo guardar el pedido.");
        if (res.status === 409) {
          const filas = await window.supaRpc("alquiler_disponibilidad", {
            p_negocio: negocio.id,
            p_inicio: inicio,
            p_fin: fin
          });
          const mapa = {};
          filas.forEach((f) => {
            mapa[f.producto_id] = f.disponible;
          });
          setDisponibilidad(mapa);
        }
        return;
      }
      if (datos.whatsapp_url) {
        setAviso(`Pedido ${datos.pedido_id} guardado. Abriendo WhatsApp…`);
        window.location.assign(datos.whatsapp_url);
      } else {
        setAviso(
          `Pedido ${datos.pedido_id} guardado. El negocio ya recibió el aviso, te contactará para confirmar.`
        );
        setCarrito({});
      }
    } catch (e) {
      console.error("[Tienda] error enviando pedido:", e);
      setAviso("No se pudo enviar el pedido. Revisa tu conexión.");
    } finally {
      setEnviando(false);
    }
  }
  if (cargando) {
    return /* @__PURE__ */ React.createElement("div", { className: "empty", style: { minHeight: "100dvh", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Cargando la tienda…"));
  }
  if (errorCarga) {
    return /* @__PURE__ */ React.createElement("div", { className: "empty", style: { minHeight: "100dvh", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, errorCarga), /* @__PURE__ */ React.createElement("p", null, "Si crees que es un error, pide el enlace al negocio."));
  }
  const moneda = negocio.moneda || "CUP";
  return /* @__PURE__ */ React.createElement("main", null, /* @__PURE__ */ React.createElement("header", { className: "header" }, /* @__PURE__ */ React.createElement("a", { className: "brand", href: "#inicio" }, /* @__PURE__ */ React.createElement("span", null, "✦"), " ", negocio.nombre), /* @__PURE__ */ React.createElement("nav", null, /* @__PURE__ */ React.createElement("a", { href: "#inicio" }, "Inicio"), /* @__PURE__ */ React.createElement("a", { href: "#catalogo" }, "Catálogo"), /* @__PURE__ */ React.createElement("a", { href: "#como" }, "Cómo funciona")), /* @__PURE__ */ React.createElement("button", { className: "cart-trigger", onClick: () => setCajonAbierto(true) }, "Mi pedido ", /* @__PURE__ */ React.createElement("b", null, totalArticulos))), /* @__PURE__ */ React.createElement("section", { className: "hero shell", id: "inicio" }, /* @__PURE__ */ React.createElement("div", { className: "hero-copy" }, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Decora · celebra · recuerda"), /* @__PURE__ */ React.createElement("h1", null, negocio.titulo_bienvenida), /* @__PURE__ */ React.createElement("p", { className: "intro" }, negocio.texto_bienvenida), /* @__PURE__ */ React.createElement("div", { className: "hero-check", id: "fechas" }, /* @__PURE__ */ React.createElement("div", { className: "date-title" }, /* @__PURE__ */ React.createElement("span", null, "◫"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, "Comprueba tu fecha"), /* @__PURE__ */ React.createElement("small", null, comprobando ? "Comprobando…" : dias ? "Disponibilidad actualizada" : "Elige las fechas"))), /* @__PURE__ */ React.createElement("div", { className: "dates" }, /* @__PURE__ */ React.createElement("label", null, "Desde", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: inicio,
      min: hoyISO(),
      onChange: (e) => {
        setInicio(e.target.value);
        if (fin && fin < e.target.value) setFin(e.target.value);
      }
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Hasta", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: fin,
      min: inicio || hoyISO(),
      disabled: !inicio,
      onChange: (e) => setFin(e.target.value)
    }
  ))), dias > 0 && /* @__PURE__ */ React.createElement("p", { className: "available" }, "● Revisado · ", dias, " ", dias === 1 ? "día" : "días")), /* @__PURE__ */ React.createElement("div", { className: "hero-buttons" }, /* @__PURE__ */ React.createElement("a", { className: "primary", href: "#catalogo" }, "Explorar catálogo →"), /* @__PURE__ */ React.createElement("a", { className: "secondary", href: "#como" }, "¿Cómo funciona?")), /* @__PURE__ */ React.createElement("p", { className: "benefits" }, "Reserva por días ", /* @__PURE__ */ React.createElement("i", null, "•"), " Combina productos ", /* @__PURE__ */ React.createElement("i", null, "•"), " Pedido por WhatsApp")), /* @__PURE__ */ React.createElement("div", { className: "hero-visual" }, /* @__PURE__ */ React.createElement("img", { src: "images/hero-evento.png", alt: "Decoración elegante para eventos" }))), /* @__PURE__ */ React.createElement("section", { className: "catalog", id: "catalogo" }, /* @__PURE__ */ React.createElement("div", { className: "shell" }, /* @__PURE__ */ React.createElement("div", { className: "section-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Tu evento, a tu manera"), /* @__PURE__ */ React.createElement("h2", null, "Combina todo lo que te inspire")), /* @__PURE__ */ React.createElement("p", null, "Agrega varios artículos y forma tu combo. El total se calcula según los días seleccionados.")), !productos.length ? /* @__PURE__ */ React.createElement("div", { className: "empty" }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Catálogo en preparación"), /* @__PURE__ */ React.createElement("p", null, "Este negocio todavía no publicó sus artículos. Vuelve pronto.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, categorias.length > 2 && /* @__PURE__ */ React.createElement("div", { className: "filters" }, categorias.map((item) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: item,
      className: categoria === item ? "active" : "",
      onClick: () => setCategoria(item)
    },
    item
  ))), /* @__PURE__ */ React.createElement("div", { className: "product-grid" }, filtrados.map((producto) => {
    const disp = disponibleDe(producto);
    const agotado = dias > 0 && disp < 1;
    const estado = dias === 0 ? "" : agotado ? "agotado" : "libre";
    return /* @__PURE__ */ React.createElement("article", { className: `product-card ${estado}`, key: producto.id }, /* @__PURE__ */ React.createElement("div", { className: "product-image" }, /* @__PURE__ */ React.createElement(
      "img",
      {
        src: producto.foto_url || "images/producto-arco.png",
        alt: producto.nombre,
        loading: "lazy"
      }
    ), producto.categoria && /* @__PURE__ */ React.createElement("span", null, producto.categoria), dias > 0 && /* @__PURE__ */ React.createElement("b", { className: agotado ? "reserved" : "" }, agotado ? "● Reservado" : `● ${disp} disponible${disp === 1 ? "" : "s"}`)), /* @__PURE__ */ React.createElement("div", { className: "product-body" }, /* @__PURE__ */ React.createElement("div", { className: "product-title" }, /* @__PURE__ */ React.createElement("h3", null, producto.nombre), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, dinero(producto.precio_dia), " ", moneda), /* @__PURE__ */ React.createElement("small", null, "/ día"))), /* @__PURE__ */ React.createElement("p", null, producto.descripcion), /* @__PURE__ */ React.createElement("button", { disabled: agotado, onClick: () => agregar(producto) }, dias ? agotado ? "No disponible" : "Agregar al pedido +" : "Elegir fechas")));
  }))))), /* @__PURE__ */ React.createElement("section", { className: "how shell", id: "como" }, /* @__PURE__ */ React.createElement("div", { className: "center-head" }, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Simple y transparente"), /* @__PURE__ */ React.createElement("h2", null, "Tu decoración lista en tres pasos")), /* @__PURE__ */ React.createElement("div", { className: "steps" }, /* @__PURE__ */ React.createElement("article", null, /* @__PURE__ */ React.createElement("b", null, "01"), /* @__PURE__ */ React.createElement("span", null, "◫"), /* @__PURE__ */ React.createElement("h3", null, "Elige las fechas"), /* @__PURE__ */ React.createElement("p", null, "Indica los días para comprobar cada artículo.")), /* @__PURE__ */ React.createElement("article", null, /* @__PURE__ */ React.createElement("b", null, "02"), /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Crea tu combo"), /* @__PURE__ */ React.createElement("p", null, "Combina productos y mira el total al instante.")), /* @__PURE__ */ React.createElement("article", null, /* @__PURE__ */ React.createElement("b", null, "03"), /* @__PURE__ */ React.createElement("span", null, "◉"), /* @__PURE__ */ React.createElement("h3", null, "Confirma por WhatsApp"), /* @__PURE__ */ React.createElement("p", null, "El negocio recibe el pedido completo y confirma.")))), /* @__PURE__ */ React.createElement("footer", { className: "footer shell" }, /* @__PURE__ */ React.createElement("span", { className: "brand" }, /* @__PURE__ */ React.createElement("i", null, "✦"), " ", negocio.nombre), /* @__PURE__ */ React.createElement("p", null, "Decoraciones que convierten un día especial en un gran recuerdo."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "18px" } }, negocio.instagram_url && /* @__PURE__ */ React.createElement("a", { href: negocio.instagram_url, target: "_blank", rel: "noopener" }, "Instagram"), negocio.facebook_url && /* @__PURE__ */ React.createElement("a", { href: negocio.facebook_url, target: "_blank", rel: "noopener" }, "Facebook"))), cajonAbierto && /* @__PURE__ */ React.createElement("button", { className: "overlay", "aria-label": "Cerrar", onClick: () => setCajonAbierto(false) }), /* @__PURE__ */ React.createElement("aside", { className: `drawer ${cajonAbierto ? "open" : ""}` }, /* @__PURE__ */ React.createElement("div", { className: "drawer-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("small", null, "Tu selección"), /* @__PURE__ */ React.createElement("h2", null, "Mi pedido")), /* @__PURE__ */ React.createElement("button", { onClick: () => setCajonAbierto(false), "aria-label": "Cerrar" }, "×")), /* @__PURE__ */ React.createElement("div", { className: "drawer-content" }, dias > 0 && /* @__PURE__ */ React.createElement("p", { className: "drawer-date" }, "◫ ", inicio, " — ", fin, " · ", dias, " ", dias === 1 ? "día" : "días"), !enCarrito.length ? /* @__PURE__ */ React.createElement("div", { className: "empty" }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Tu combo empieza aquí"), /* @__PURE__ */ React.createElement("p", null, "Agrega los artículos que harán único tu evento.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, enCarrito.map((producto) => /* @__PURE__ */ React.createElement("div", { className: "cart-line", key: producto.id }, /* @__PURE__ */ React.createElement("img", { src: producto.foto_url || "images/producto-arco.png", alt: "" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, producto.nombre), /* @__PURE__ */ React.createElement("small", null, dinero(producto.precio_dia), " ", moneda, " / día")), /* @__PURE__ */ React.createElement("div", { className: "qty" }, /* @__PURE__ */ React.createElement("button", { onClick: () => quitar(producto), "aria-label": "Quitar uno" }, "−"), /* @__PURE__ */ React.createElement("span", null, carrito[producto.id]), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => agregar(producto),
      disabled: carrito[producto.id] >= disponibleDe(producto),
      "aria-label": "Agregar uno"
    },
    "+"
  )))), /* @__PURE__ */ React.createElement("div", { className: "total" }, /* @__PURE__ */ React.createElement("span", null, "Total estimado"), /* @__PURE__ */ React.createElement("strong", null, dinero(totalDiario * dias), " ", moneda)), /* @__PURE__ */ React.createElement("form", { className: "checkout", onSubmit: enviarPedido }, /* @__PURE__ */ React.createElement(
    "input",
    {
      placeholder: "Tu nombre",
      required: true,
      value: nombre,
      onChange: (e) => setNombre(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      placeholder: "Tu teléfono",
      value: telefono,
      inputMode: "tel",
      onChange: (e) => setTelefono(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      placeholder: "Nota opcional",
      value: notas,
      onChange: (e) => setNotas(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement("button", { disabled: enviando || comprobando }, enviando ? "Enviando…" : "Enviar pedido por WhatsApp"), aviso && /* @__PURE__ */ React.createElement("p", { className: "order-status" }, aviso), /* @__PURE__ */ React.createElement("small", null, "La disponibilidad se revisará nuevamente antes de enviar."))))));
}
window.Tienda = Tienda;
