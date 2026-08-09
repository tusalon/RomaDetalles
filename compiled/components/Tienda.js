const { useEffect, useMemo, useRef, useState, useCallback } = React;
function dinero(valor) {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 0 }).format(valor || 0);
}
function fechaLarga(iso) {
  if (!iso) return "";
  return (/* @__PURE__ */ new Date(`${iso}T12:00:00Z`)).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}
function mananaISO() {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function diaAntes(iso) {
  const d = /* @__PURE__ */ new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function calcularAnticipo(total, porciento, redondear) {
  const pct = Number(porciento) || 0;
  if (pct <= 0 || total <= 0) return 0;
  const bruto = total * pct / 100;
  const exacto = Math.round(bruto * 100) / 100;
  if (redondear === false) return Math.min(total, exacto);
  const redondeado = Math.round(bruto / 100) * 100;
  return Math.min(total, redondeado === 0 ? exacto : redondeado);
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
  const [galeria, setGaleria] = useState([]);
  const [fotoAmpliada, setFotoAmpliada] = useState(null);
  const [fechaEvento, setFechaEvento] = useState("");
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
  const cardObserverRef = useRef(null);
  const revealedIdsRef = useRef(/* @__PURE__ */ new Set());
  const [, revealTick] = useState(0);
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    cardObserverRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          revealedIdsRef.current.add(entry.target.dataset.id);
          cardObserverRef.current.unobserve(entry.target);
          revealTick((n) => n + 1);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });
    return () => cardObserverRef.current && cardObserverRef.current.disconnect();
  }, []);
  const observarTarjeta = useCallback((id) => (el) => {
    if (el && cardObserverRef.current && !revealedIdsRef.current.has(id)) {
      cardObserverRef.current.observe(el);
    }
  }, []);
  const hayFecha = Boolean(fechaEvento);
  const inicioRango = hayFecha ? diaAntes(fechaEvento) : "";
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
          `alquiler_negocios?slug=eq.${encodeURIComponent(slug)}&activo=eq.true&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,anticipo_porciento,anticipo_redondear,pago_tarjeta,pago_telefono`
        );
        if (!negocios.length) {
          setErrorCarga("No encontramos esta tienda. Revisa el enlace.");
          setCargando(false);
          return;
        }
        const neg = negocios[0];
        setNegocio(neg);
        const [items, fotos] = await Promise.all([
          window.supaGet(
            `alquiler_productos?negocio_id=eq.${neg.id}&activo=eq.true&select=id,nombre,descripcion,categoria,precio_dia,cantidad,foto_url&order=orden.asc,creado_en.asc`
          ),
          window.supaGet(
            `alquiler_galeria?negocio_id=eq.${neg.id}&select=id,imagen_url,descripcion&order=creado_en.desc`
          ).catch((e) => {
            console.warn("[Tienda] galería no disponible:", e);
            return [];
          })
        ]);
        setProductos(items);
        setGaleria(fotos);
      } catch (e) {
        console.error("[Tienda] error cargando:", e);
        setErrorCarga("No se pudo cargar la tienda. Revisa tu conexión.");
      } finally {
        setCargando(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!negocio || !fechaEvento) return;
    let vigente = true;
    setComprobando(true);
    window.supaRpc("alquiler_disponibilidad", {
      p_negocio: negocio.id,
      p_inicio: diaAntes(fechaEvento),
      p_fin: fechaEvento
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
  }, [negocio, fechaEvento]);
  const categorias = useMemo(
    () => ["Todos", ...new Set(productos.map((p) => p.categoria).filter(Boolean))],
    [productos]
  );
  const filtrados = categoria === "Todos" ? productos : productos.filter((p) => p.categoria === categoria);
  const enCarrito = productos.filter((p) => carrito[p.id] > 0);
  const totalArticulos = Object.values(carrito).reduce((s, n) => s + n, 0);
  const totalPedido = productos.reduce(
    (s, p) => s + Number(p.precio_dia) * (carrito[p.id] || 0),
    0
  );
  const anticipo = calcularAnticipo(
    totalPedido,
    negocio?.anticipo_porciento,
    negocio?.anticipo_redondear
  );
  const disponibleDe = useCallback((producto) => {
    if (!hayFecha) return producto.cantidad;
    return disponibilidad[producto.id] ?? producto.cantidad;
  }, [hayFecha, disponibilidad]);
  function agregar(producto) {
    if (!hayFecha) {
      document.getElementById("fechas")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setCarrito((actual) => ({
      ...actual,
      [producto.id]: Math.min(disponibleDe(producto), (actual[producto.id] || 0) + 1)
    }));
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
    if (!fechaEvento) {
      setAviso("Elige el día de tu evento.");
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
            fecha_evento: fechaEvento,
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
            p_inicio: diaAntes(fechaEvento),
            p_fin: fechaEvento
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
  return /* @__PURE__ */ React.createElement("main", null, /* @__PURE__ */ React.createElement("header", { className: "header" }, /* @__PURE__ */ React.createElement("a", { className: "brand", href: "#inicio" }, /* @__PURE__ */ React.createElement("span", null, "✦"), " ", negocio.nombre), /* @__PURE__ */ React.createElement("nav", null, /* @__PURE__ */ React.createElement("a", { href: "#inicio" }, "Inicio"), /* @__PURE__ */ React.createElement("a", { href: "#catalogo" }, "Catálogo"), /* @__PURE__ */ React.createElement("a", { href: "#como" }, "Cómo funciona")), /* @__PURE__ */ React.createElement("button", { className: "cart-trigger", onClick: () => setCajonAbierto(true) }, /* @__PURE__ */ React.createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: "18",
      height: "18",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    },
    /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "21", r: "1" }),
    /* @__PURE__ */ React.createElement("circle", { cx: "20", cy: "21", r: "1" }),
    /* @__PURE__ */ React.createElement("path", { d: "M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" })
  ), "Mi pedido ", /* @__PURE__ */ React.createElement("b", null, totalArticulos))), /* @__PURE__ */ React.createElement("section", { className: "hero shell", id: "inicio" }, /* @__PURE__ */ React.createElement("div", { className: "hero-copy" }, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Decora · celebra · recuerda"), /* @__PURE__ */ React.createElement("h1", null, negocio.titulo_bienvenida), /* @__PURE__ */ React.createElement("p", { className: "intro" }, negocio.texto_bienvenida), /* @__PURE__ */ React.createElement("div", { className: "hero-check", id: "fechas" }, /* @__PURE__ */ React.createElement("div", { className: "date-title" }, /* @__PURE__ */ React.createElement("span", null, "◫"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, "¿Qué día es tu evento?"), /* @__PURE__ */ React.createElement("small", null, comprobando ? "Comprobando…" : hayFecha ? "Disponibilidad actualizada" : "Elige la fecha para ver qué está libre"))), /* @__PURE__ */ React.createElement("div", { className: "dates dates-una" }, /* @__PURE__ */ React.createElement("label", null, "Día del evento", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: fechaEvento,
      min: mananaISO(),
      onChange: (e) => setFechaEvento(e.target.value)
    }
  ))), hayFecha && /* @__PURE__ */ React.createElement("p", { className: "available" }, "● Revisado para el ", fechaLarga(fechaEvento)), /* @__PURE__ */ React.createElement("ul", { className: "condiciones" }, /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("b", null, "Recoges"), " el día antes de tu evento, después de las 5:00 PM."), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("b", null, "Entregas"), " al día siguiente, antes de las 12:00 del mediodía."), /* @__PURE__ */ React.createElement("li", null, "Si no entregas a tiempo, se cobra un ", /* @__PURE__ */ React.createElement("b", null, "50% extra"), " del costo del alquiler."))), /* @__PURE__ */ React.createElement("div", { className: "hero-buttons" }, /* @__PURE__ */ React.createElement("a", { className: "primary", href: "#catalogo" }, "Explorar catálogo →"), /* @__PURE__ */ React.createElement("a", { className: "secondary", href: "#como" }, "¿Cómo funciona?")), /* @__PURE__ */ React.createElement("p", { className: "benefits" }, "Reserva por evento ", /* @__PURE__ */ React.createElement("i", null, "•"), " Combina productos ", /* @__PURE__ */ React.createElement("i", null, "•"), " Pedido por WhatsApp")), /* @__PURE__ */ React.createElement("div", { className: "hero-visual" }, /* @__PURE__ */ React.createElement("img", { src: "images/hero-evento.png", alt: "Decoración elegante para eventos" }))), /* @__PURE__ */ React.createElement("section", { className: "catalog", id: "catalogo" }, /* @__PURE__ */ React.createElement("div", { className: "shell" }, /* @__PURE__ */ React.createElement("div", { className: "section-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Tu evento, a tu manera"), /* @__PURE__ */ React.createElement("h2", null, "Combina todo lo que te inspire")), /* @__PURE__ */ React.createElement("p", null, "Agrega varios artículos y forma tu combo. El total es por el día de tu evento.")), !productos.length ? /* @__PURE__ */ React.createElement("div", { className: "empty" }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Catálogo en preparación"), /* @__PURE__ */ React.createElement("p", null, "Este negocio todavía no publicó sus artículos. Vuelve pronto.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, categorias.length > 2 && /* @__PURE__ */ React.createElement("div", { className: "filters" }, categorias.map((item) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: item,
      className: categoria === item ? "active" : "",
      onClick: () => setCategoria(item)
    },
    item
  ))), /* @__PURE__ */ React.createElement("div", { className: "product-grid" }, filtrados.map((producto, i) => {
    const disp = disponibleDe(producto);
    const agotado = hayFecha && disp < 1;
    const estado = !hayFecha ? "" : agotado ? "agotado" : "libre";
    const visible = revealedIdsRef.current.has(String(producto.id));
    return /* @__PURE__ */ React.createElement(
      "article",
      {
        className: `product-card reveal ${visible ? "is-visible" : ""} ${estado}`,
        key: producto.id,
        "data-id": producto.id,
        ref: observarTarjeta(String(producto.id)),
        style: { "--i": Math.min(i, 10) }
      },
      /* @__PURE__ */ React.createElement("div", { className: "product-image" }, /* @__PURE__ */ React.createElement(
        "img",
        {
          src: producto.foto_url || "images/producto-arco.png",
          alt: producto.nombre,
          loading: "lazy"
        }
      ), producto.categoria && /* @__PURE__ */ React.createElement("span", null, producto.categoria), hayFecha && /* @__PURE__ */ React.createElement("b", { className: agotado ? "reserved" : "" }, agotado ? "● Reservado" : `● ${disp} disponible${disp === 1 ? "" : "s"}`)),
      /* @__PURE__ */ React.createElement("div", { className: "product-body" }, /* @__PURE__ */ React.createElement("div", { className: "product-title" }, /* @__PURE__ */ React.createElement("h3", null, producto.nombre), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, dinero(producto.precio_dia), " ", moneda), /* @__PURE__ */ React.createElement("small", null, "por evento"))), /* @__PURE__ */ React.createElement("p", null, producto.descripcion), /* @__PURE__ */ React.createElement("button", { disabled: agotado, onClick: () => agregar(producto) }, hayFecha ? agotado ? "No disponible" : "Agregar al pedido +" : "Elegir fecha"))
    );
  }))))), /* @__PURE__ */ React.createElement("section", { className: "how shell", id: "como" }, /* @__PURE__ */ React.createElement("div", { className: "center-head" }, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Simple y transparente"), /* @__PURE__ */ React.createElement("h2", null, "Tu decoración lista en tres pasos")), /* @__PURE__ */ React.createElement("div", { className: "steps" }, /* @__PURE__ */ React.createElement("article", null, /* @__PURE__ */ React.createElement("b", null, "01"), /* @__PURE__ */ React.createElement("span", null, "◫"), /* @__PURE__ */ React.createElement("h3", null, "Elige tu fecha"), /* @__PURE__ */ React.createElement("p", null, "Indica el día de tu evento para comprobar cada artículo.")), /* @__PURE__ */ React.createElement("article", null, /* @__PURE__ */ React.createElement("b", null, "02"), /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Crea tu combo"), /* @__PURE__ */ React.createElement("p", null, "Combina productos y mira el total al instante.")), /* @__PURE__ */ React.createElement("article", null, /* @__PURE__ */ React.createElement("b", null, "03"), /* @__PURE__ */ React.createElement("span", null, "◉"), /* @__PURE__ */ React.createElement("h3", null, "Confirma por WhatsApp"), /* @__PURE__ */ React.createElement("p", null, "El negocio recibe el pedido completo y confirma.")))), galeria.length > 0 && /* @__PURE__ */ React.createElement("section", { className: "galeria-publica shell", id: "trabajos" }, /* @__PURE__ */ React.createElement("div", { className: "center-head" }, /* @__PURE__ */ React.createElement("p", { className: "eyebrow" }, "Prueba de lo que hacemos"), /* @__PURE__ */ React.createElement("h2", null, "Nuestros trabajos")), /* @__PURE__ */ React.createElement("div", { className: "galeria-publica-grid" }, galeria.map((foto) => /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "galeria-publica-item",
      key: foto.id,
      "aria-label": foto.descripcion || "Ver foto del trabajo",
      onClick: () => setFotoAmpliada(foto)
    },
    /* @__PURE__ */ React.createElement("img", { src: foto.imagen_url, alt: "", loading: "lazy" }),
    foto.descripcion && /* @__PURE__ */ React.createElement("span", null, foto.descripcion)
  )))), /* @__PURE__ */ React.createElement("footer", { className: "footer shell" }, /* @__PURE__ */ React.createElement("span", { className: "brand" }, /* @__PURE__ */ React.createElement("i", null, "✦"), " ", negocio.nombre), /* @__PURE__ */ React.createElement("p", null, "Decoraciones que convierten un día especial en un gran recuerdo."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "18px" } }, negocio.instagram_url && /* @__PURE__ */ React.createElement("a", { href: negocio.instagram_url, target: "_blank", rel: "noopener" }, "Instagram"), negocio.facebook_url && /* @__PURE__ */ React.createElement("a", { href: negocio.facebook_url, target: "_blank", rel: "noopener" }, "Facebook"))), totalArticulos > 0 && !cajonAbierto && /* @__PURE__ */ React.createElement("button", { className: "continuar-barra", onClick: () => setCajonAbierto(true) }, /* @__PURE__ */ React.createElement("span", null, totalArticulos, " ", totalArticulos === 1 ? "artículo" : "artículos", " · ", dinero(totalPedido), " ", moneda), /* @__PURE__ */ React.createElement("b", null, "Continuar →")), cajonAbierto && /* @__PURE__ */ React.createElement("button", { className: "overlay", "aria-label": "Cerrar", onClick: () => setCajonAbierto(false) }), /* @__PURE__ */ React.createElement("aside", { className: `drawer ${cajonAbierto ? "open" : ""}` }, /* @__PURE__ */ React.createElement("div", { className: "drawer-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("small", null, "Tu selección"), /* @__PURE__ */ React.createElement("h2", null, "Mi pedido")), /* @__PURE__ */ React.createElement("button", { onClick: () => setCajonAbierto(false), "aria-label": "Cerrar" }, "×")), /* @__PURE__ */ React.createElement("div", { className: "drawer-content" }, hayFecha && /* @__PURE__ */ React.createElement("p", { className: "drawer-date" }, "◫ Evento: ", fechaLarga(fechaEvento), " · recoges el ", fechaLarga(inicioRango), " después de las 5:00 PM"), !enCarrito.length ? /* @__PURE__ */ React.createElement("div", { className: "empty" }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Tu combo empieza aquí"), /* @__PURE__ */ React.createElement("p", null, "Agrega los artículos que harán único tu evento.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, enCarrito.map((producto) => /* @__PURE__ */ React.createElement("div", { className: "cart-line", key: producto.id }, /* @__PURE__ */ React.createElement("img", { src: producto.foto_url || "images/producto-arco.png", alt: "" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, producto.nombre), /* @__PURE__ */ React.createElement("small", null, dinero(producto.precio_dia), " ", moneda)), /* @__PURE__ */ React.createElement("div", { className: "qty" }, /* @__PURE__ */ React.createElement("button", { onClick: () => quitar(producto), "aria-label": "Quitar uno" }, "−"), /* @__PURE__ */ React.createElement("span", null, carrito[producto.id]), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => agregar(producto),
      disabled: carrito[producto.id] >= disponibleDe(producto),
      "aria-label": "Agregar uno"
    },
    "+"
  )))), /* @__PURE__ */ React.createElement("div", { className: "total" }, /* @__PURE__ */ React.createElement("span", null, "Total"), /* @__PURE__ */ React.createElement("strong", null, dinero(totalPedido), " ", moneda)), anticipo > 0 && /* @__PURE__ */ React.createElement("div", { className: "anticipo-desglose" }, /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("span", null, "Anticipo (", negocio.anticipo_porciento, "%)"), /* @__PURE__ */ React.createElement("strong", null, dinero(anticipo), " ", moneda)), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("span", null, "Resto al recoger"), /* @__PURE__ */ React.createElement("strong", null, dinero(totalPedido - anticipo), " ", moneda))), anticipo > 0 && negocio.pago_tarjeta && /* @__PURE__ */ React.createElement("div", { className: "datos-pago" }, /* @__PURE__ */ React.createElement("strong", null, "Para confirmar tu reserva, transfiere el anticipo a:"), /* @__PURE__ */ React.createElement("p", null, "Tarjeta: ", /* @__PURE__ */ React.createElement("b", null, negocio.pago_tarjeta)), negocio.pago_telefono && /* @__PURE__ */ React.createElement("p", null, "Teléfono: ", /* @__PURE__ */ React.createElement("b", null, negocio.pago_telefono)), /* @__PURE__ */ React.createElement("small", null, "Tu reserva queda confirmada cuando el negocio reciba el anticipo.")), /* @__PURE__ */ React.createElement("form", { className: "checkout", onSubmit: enviarPedido }, /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement("button", { disabled: enviando || comprobando }, enviando ? "Enviando…" : "Enviar pedido por WhatsApp"), aviso && /* @__PURE__ */ React.createElement("p", { className: "order-status" }, aviso), /* @__PURE__ */ React.createElement("small", null, "La disponibilidad se revisará nuevamente antes de enviar."))))), fotoAmpliada && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: "overlay", "aria-label": "Cerrar", onClick: () => setFotoAmpliada(null) }), /* @__PURE__ */ React.createElement("div", { className: "lightbox" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "lightbox-cerrar",
      "aria-label": "Cerrar",
      onClick: () => setFotoAmpliada(null)
    },
    "×"
  ), /* @__PURE__ */ React.createElement("img", { src: fotoAmpliada.imagen_url, alt: fotoAmpliada.descripcion || "" }), fotoAmpliada.descripcion && /* @__PURE__ */ React.createElement("p", null, fotoAmpliada.descripcion))));
}
window.Tienda = Tienda;
const ETIQUETA_ESTADO_CLIENTE = {
  pendiente: "Pendiente",
  confirmado: "Confirmada",
  entregado: "Entregada",
  devuelto: "Devuelta",
  cancelado: "Cancelada"
};
function tokenDeLaUrl() {
  return new URLSearchParams(window.location.search).get("reserva") || "";
}
function guardarReservaLocal(token) {
  try {
    const clave = "romadetallesMisReservas";
    const actual = JSON.parse(localStorage.getItem(clave) || "[]");
    if (!actual.includes(token)) {
      actual.push(token);
      localStorage.setItem(clave, JSON.stringify(actual.slice(-10)));
    }
  } catch (e) {
    console.warn("[MiReserva] no se pudo guardar en localStorage:", e);
  }
}
function tokensGuardados() {
  try {
    return JSON.parse(localStorage.getItem("romadetallesMisReservas") || "[]");
  } catch {
    return [];
  }
}
function armarICS(reserva) {
  const fecha = reserva.fecha_evento.replace(/-/g, "");
  const items = (reserva.items || []).map((i) => `${i.cantidad} x ${i.producto_nombre}`).join(", ");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RomaDetalles//Reserva//ES",
    "BEGIN:VEVENT",
    `UID:${reserva.pedido_id}@romadetalles`,
    `DTSTART;VALUE=DATE:${fecha}`,
    `SUMMARY:Evento — ${reserva.negocio_nombre}`,
    `DESCRIPTION:${items}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}
function descargarICS(reserva) {
  const blob = new Blob([armarICS(reserva)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reserva-${reserva.fecha_evento}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function mensajeErrorEdicion(error) {
  const texto = String(error?.message || error || "");
  if (texto.includes("SIN_STOCK")) {
    const nombre = texto.split("SIN_STOCK:")[1]?.split("\n")[0]?.trim();
    return nombre ? `Ese día ya no queda ${nombre} disponible. Prueba con otra fecha.` : "Ese día ya no queda disponible todo lo que reservaste. Prueba con otra fecha.";
  }
  if (texto.includes("RESERVA_NO_EDITABLE")) return "Esta reserva ya no se puede cambiar. Escríbenos y lo vemos.";
  if (texto.includes("FECHA_PASADA")) return "Elige un día que todavía no haya pasado.";
  if (texto.includes("PERIODO_INVALIDO")) return "Elige el día de tu evento.";
  console.error("[MiReserva] error al guardar:", texto);
  return "No se pudo guardar el cambio. Revisa tu conexión e inténtalo otra vez.";
}
function MiReserva({ token }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [reserva, setReserva] = useState(null);
  const [otrasGuardadas, setOtrasGuardadas] = useState([]);
  const [edicion, setEdicion] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [avisoEdicion, setAvisoEdicion] = useState("");
  const cargar = useCallback(async () => {
    const filas = await window.supaRpc("alquiler_pedido_por_token", { p_token: token });
    if (!filas.length) throw new Error("SIN_RESERVA");
    setReserva(filas[0]);
    return filas[0];
  }, [token]);
  useEffect(() => {
    (async () => {
      try {
        await cargar();
        guardarReservaLocal(token);
      } catch (e) {
        if (String(e.message) === "SIN_RESERVA") {
          setError("No encontramos esta reserva. Revisa el enlace.");
        } else {
          console.error("[MiReserva] error cargando:", e);
          setError("No se pudo cargar tu reserva. Revisa tu conexión.");
        }
      } finally {
        setCargando(false);
      }
    })();
  }, [token, cargar]);
  useEffect(() => {
    const tokens = tokensGuardados().filter((t) => t !== token);
    if (!tokens.length) return;
    let vigente = true;
    Promise.all(
      tokens.map(
        (t) => window.supaRpc("alquiler_pedido_por_token", { p_token: t }).then((filas) => filas[0] ? { token: t, fecha_evento: filas[0].fecha_evento } : null).catch(() => null)
      )
    ).then((resultados) => {
      if (vigente) setOtrasGuardadas(resultados.filter(Boolean));
    });
    return () => {
      vigente = false;
    };
  }, [token]);
  if (cargando) {
    return /* @__PURE__ */ React.createElement("div", { className: "empty", style: { minHeight: "100dvh", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, "Cargando tu reserva…"));
  }
  if (error || !reserva) {
    return /* @__PURE__ */ React.createElement("div", { className: "empty", style: { minHeight: "100dvh", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", null, "✦"), /* @__PURE__ */ React.createElement("h3", null, error || "No encontramos esta reserva."));
  }
  const moneda = reserva.moneda || "CUP";
  const etiqueta = ETIQUETA_ESTADO_CLIENTE[reserva.estado] || reserva.estado;
  function solicitarCambio() {
    const numero = (reserva.negocio_whatsapp || "").replace(/\D/g, "");
    const mensaje = `Hola, quiero pedir un cambio en mi reserva del ${fechaLarga(reserva.fecha_evento)}.`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, "_blank");
  }
  const puedeEditar = reserva.estado === "pendiente" || reserva.estado === "confirmado";
  function abrirEdicion() {
    setAvisoEdicion("");
    setEdicion({
      fecha_evento: reserva.fecha_evento || "",
      cliente_telefono: reserva.cliente_telefono || "",
      notas: reserva.notas || ""
    });
  }
  async function guardarEdicion(evento) {
    evento.preventDefault();
    if (!edicion.fecha_evento) {
      setAvisoEdicion("Elige el día de tu evento.");
      return;
    }
    setGuardando(true);
    setAvisoEdicion("");
    try {
      await window.supaRpc("alquiler_editar_pedido", {
        p_pedido: reserva.pedido_id,
        p_nombre: null,
        p_telefono: edicion.cliente_telefono.trim(),
        p_notas: edicion.notas.trim(),
        p_evento: edicion.fecha_evento,
        p_items: null,
        p_token: token
      });
      await cargar();
      setEdicion(null);
      setAvisoEdicion("Listo. El negocio va a revisar el cambio y te confirma.");
    } catch (e) {
      setAvisoEdicion(mensajeErrorEdicion(e));
    } finally {
      setGuardando(false);
    }
  }
  return /* @__PURE__ */ React.createElement("main", null, /* @__PURE__ */ React.createElement("header", { className: "header" }, /* @__PURE__ */ React.createElement("a", { className: "brand", href: "#" }, /* @__PURE__ */ React.createElement("span", null, "✦"), " ", reserva.negocio_nombre)), /* @__PURE__ */ React.createElement("section", { className: "shell", style: { paddingBlock: "60px" } }, /* @__PURE__ */ React.createElement("div", { className: "admin-card", style: { margin: "0 auto", maxWidth: "480px", padding: "28px" } }, /* @__PURE__ */ React.createElement("span", { className: `order-chip ${reserva.estado}` }, etiqueta), /* @__PURE__ */ React.createElement("h1", { style: { color: "var(--burgundy)", fontFamily: "var(--serif)", margin: "14px 0 4px" } }, fechaLarga(reserva.fecha_evento)), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)" } }, "Recoges el ", fechaLarga(reserva.fecha_inicio), " después de las 5:00 PM"), /* @__PURE__ */ React.createElement("ul", null, (reserva.items || []).map((item, i) => /* @__PURE__ */ React.createElement("li", { key: i }, item.cantidad, " × ", item.producto_nombre))), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, "Total: ", dinero(reserva.total), " ", moneda)), Number(reserva.anticipo) > 0 && /* @__PURE__ */ React.createElement("p", null, "Anticipo: ", dinero(reserva.anticipo), " ", moneda), edicion ? /* @__PURE__ */ React.createElement("form", { className: "mi-reserva-form", onSubmit: guardarEdicion }, /* @__PURE__ */ React.createElement("label", null, "Día del evento", /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      required: true,
      min: mananaISO(),
      value: edicion.fecha_evento,
      onChange: (e) => setEdicion({ ...edicion, fecha_evento: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Tu teléfono", /* @__PURE__ */ React.createElement(
    "input",
    {
      inputMode: "tel",
      value: edicion.cliente_telefono,
      onChange: (e) => setEdicion({ ...edicion, cliente_telefono: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("label", null, "Nota para el negocio", /* @__PURE__ */ React.createElement(
    "textarea",
    {
      rows: "3",
      value: edicion.notas,
      onChange: (e) => setEdicion({ ...edicion, notas: e.target.value })
    }
  )), /* @__PURE__ */ React.createElement("p", { className: "mi-reserva-nota" }, "Para cambiar los artículos, escríbenos por WhatsApp."), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: "10px" } }, /* @__PURE__ */ React.createElement("button", { className: "primary", type: "submit", disabled: guardando }, guardando ? "Guardando…" : "Guardar cambios"), /* @__PURE__ */ React.createElement("button", { className: "secondary", type: "button", onClick: () => setEdicion(null) }, "Cancelar"))) : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: "10px", marginTop: "20px" } }, /* @__PURE__ */ React.createElement("button", { className: "primary", onClick: () => descargarICS(reserva) }, "Agregar a mi calendario"), puedeEditar && /* @__PURE__ */ React.createElement("button", { className: "secondary", onClick: abrirEdicion }, "Editar mi reserva"), /* @__PURE__ */ React.createElement("button", { className: "secondary", onClick: solicitarCambio }, "Escribir al negocio")), avisoEdicion && /* @__PURE__ */ React.createElement("p", { className: "mi-reserva-aviso" }, avisoEdicion), otrasGuardadas.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "mis-reservas-otras" }, /* @__PURE__ */ React.createElement("small", null, "Tus otras reservas guardadas:"), otrasGuardadas.map((r) => /* @__PURE__ */ React.createElement("a", { key: r.token, href: `?reserva=${r.token}` }, fechaLarga(r.fecha_evento)))))));
}
window.MiReserva = MiReserva;
