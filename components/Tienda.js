// components/Tienda.js — Tienda pública de alquiler.
//
// Portado de la versión Next.js (app/storefront.tsx). Diferencias que
// importan:
//   · Los datos vienen de Supabase por slug (?s=nombre-del-negocio), no de
//     un catálogo escrito en el código. Si el negocio no tiene productos,
//     se muestra un estado vacío honesto en vez de inventar 5 artículos.
//   · La disponibilidad la calcula Postgres (rpc alquiler_disponibilidad).
//   · El pedido lo crea la Edge Function crear-pedido-alquiler. La tienda
//     NO puede insertar pedidos con la anon key: no tiene permiso, a
//     propósito, porque los pedidos llevan datos personales de la clienta.
//
// Editar este archivo y luego correr `bash scripts/build-jsx.sh`.

const { useEffect, useMemo, useRef, useState, useCallback } = React;

function dinero(valor) {
    return new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(valor || 0);
}

// "sábado 15 de agosto" en vez de "2026-08-15" — el día del evento es la
// decisión central de todo el flujo, no debería leerse como un ISO crudo.
// Mediodía UTC: la misma ancla que ya usa diaAntes(), así el texto nunca
// se corre un día por el huso horario.
function fechaLarga(iso) {
    if (!iso) return '';
    return new Date(`${iso}T12:00:00Z`)
        .toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

// El evento más cercano posible es mañana: si fuera hoy, la recogida
// (la tarde anterior) ya habría pasado. Fecha local, no UTC: en Cuba
// (UTC-4/-5) usar toISOString() haría que después de las 19:00 esto
// saltara un día más de la cuenta.
function mananaISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Día de recogida: la tarde anterior al evento. El mediodía UTC evita
// que un cambio de horario mueva la fecha un día.
function diaAntes(iso) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// Día de entrega: la mañana siguiente al evento. Cierra la ventana de
// tres días en que el artículo está fuera (se recoge, se usa, se
// entrega), que es la que el servidor guarda y consulta.
function diaDespues(iso) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

// "12 horas", "1 hora", "2 días" — el plazo que el negocio da para ver
// el anticipo, dicho como lo diría una persona.
function horasPlazo(negocio) {
    const horas = Number(negocio?.horas_reserva) || 12;
    if (horas < 24) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
    const dias = Math.round(horas / 24);
    return `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

// "hoy a las 8:30 PM" / "mañana a las 9:00 AM": el momento exacto en que
// vence la reserva, para que la clienta no tenga que calcularlo.
function vencimientoLargo(iso) {
    if (!iso) return '';
    const cuando = new Date(iso);
    const hoy = new Date();
    const mismoDia = cuando.toDateString() === hoy.toDateString();
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);
    const hora = cuando.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
    if (mismoDia) return `hoy a las ${hora}`;
    if (cuando.toDateString() === manana.toDateString()) return `mañana a las ${hora}`;
    return `${cuando.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${hora}`;
}

// Espejo en JS de alquiler_anticipo() en Postgres. La fuente de verdad
// es la de Postgres (se guarda en el pedido); esta solo sirve para
// mostrarle el número a la clienta antes de enviar. Las dos guardas
// tienen que ser iguales en ambas: nunca 0 por redondeo, nunca mayor
// que el total.
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
    return params.get('s') || window.ALQUILER_SLUG_POR_DEFECTO || '';
}

function Tienda() {
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState('');
    const [negocio, setNegocio] = useState(null);
    const [productos, setProductos] = useState([]);
    const [galeria, setGaleria] = useState([]);
    const [fotoAmpliada, setFotoAmpliada] = useState(null);

    const [fechaEvento, setFechaEvento] = useState('');
    const [categoria, setCategoria] = useState('Todos');
    const [carrito, setCarrito] = useState({});
    const [cajonAbierto, setCajonAbierto] = useState(false);
    const [disponibilidad, setDisponibilidad] = useState({});
    const [comprobando, setComprobando] = useState(false);

    const [nombre, setNombre] = useState('');
    const [telefono, setTelefono] = useState('');
    const [notas, setNotas] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [aviso, setAviso] = useState('');

    // ---- Tarjetas que "flotan" al hacer scroll -------------------------
    // Mismo patrón que el resto del ecosistema (HouseofRservasRoma app.js):
    // IntersectionObserver + reveal una sola vez. revealedIdsRef es la
    // fuente de verdad (persiste aunque el className de React se
    // reescriba al cambiar `estado`); revealTick solo fuerza el re-render
    // cuando algo nuevo entra en pantalla.
    const cardObserverRef = useRef(null);
    const revealedIdsRef = useRef(new Set());
    const [, revealTick] = useState(0);

    useEffect(() => {
        if (!('IntersectionObserver' in window)) return;
        cardObserverRef.current = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    revealedIdsRef.current.add(entry.target.dataset.id);
                    cardObserverRef.current.unobserve(entry.target);
                    revealTick((n) => n + 1);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
        return () => cardObserverRef.current && cardObserverRef.current.disconnect();
    }, []);

    const observarTarjeta = useCallback((id) => (el) => {
        if (el && cardObserverRef.current && !revealedIdsRef.current.has(id)) {
            cardObserverRef.current.observe(el);
        }
    }, []);

    const hayFecha = Boolean(fechaEvento);
    // Ventana real de ocupación: recoge la tarde anterior, entrega la
    // mañana siguiente. Es el rango que entiende alquiler_disponibilidad.
    const inicioRango = hayFecha ? diaAntes(fechaEvento) : '';

    // ---- Carga inicial ------------------------------------------------
    useEffect(() => {
        const slug = slugDeLaUrl();
        if (!slug) {
            setErrorCarga('Falta indicar la tienda en el enlace.');
            setCargando(false);
            return;
        }

        (async () => {
            try {
                const negocios = await window.supaGet(
                    `alquiler_negocios?slug=eq.${encodeURIComponent(slug)}&activo=eq.true` +
                    `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,` +
                    `anticipo_porciento,anticipo_redondear,pago_tarjeta,pago_telefono,direccion,horas_reserva`
                );
                if (!negocios.length) {
                    setErrorCarga('No encontramos esta tienda. Revisa el enlace.');
                    setCargando(false);
                    return;
                }
                const neg = negocios[0];
                setNegocio(neg);

                const [items, fotos] = await Promise.all([
                    window.supaGet(
                        `alquiler_productos?negocio_id=eq.${neg.id}&activo=eq.true` +
                        `&select=id,nombre,descripcion,categoria,precio_dia,cantidad,foto_url&order=orden.asc,creado_en.asc`
                    ),
                    window.supaGet(
                        `alquiler_galeria?negocio_id=eq.${neg.id}` +
                        `&select=id,imagen_url,descripcion&order=creado_en.desc`
                    ).catch((e) => {
                        console.warn('[Tienda] galería no disponible:', e);
                        return []; // la galería es un extra: si falla, la tienda sigue vendiendo
                    })
                ]);
                setProductos(items);
                setGaleria(fotos);
            } catch (e) {
                console.error('[Tienda] error cargando:', e);
                setErrorCarga('No se pudo cargar la tienda. Revisa tu conexión.');
            } finally {
                setCargando(false);
            }
        })();
    }, []);

    // ---- Disponibilidad al cambiar fechas -----------------------------
    useEffect(() => {
        if (!negocio || !fechaEvento) return;
        let vigente = true;
        setComprobando(true);

        window.supaRpc('alquiler_disponibilidad', {
            p_negocio: negocio.id,
            p_inicio: diaAntes(fechaEvento),
            p_fin: diaDespues(fechaEvento)
        })
            .then((filas) => {
                if (!vigente) return;
                const mapa = {};
                filas.forEach((f) => { mapa[f.producto_id] = f.disponible; });
                setDisponibilidad(mapa);

                // Si al cambiar las fechas algo del carrito ya no alcanza,
                // lo recortamos en vez de dejar que falle al enviar.
                setCarrito((actual) => {
                    const ajustado = {};
                    Object.entries(actual).forEach(([id, cant]) => {
                        const tope = mapa[id] ?? 0;
                        if (tope > 0) ajustado[id] = Math.min(cant, tope);
                    });
                    return ajustado;
                });
            })
            .catch((e) => console.error('[Tienda] error de disponibilidad:', e))
            .finally(() => { if (vigente) setComprobando(false); });

        return () => { vigente = false; };
    }, [negocio, fechaEvento]);

    const categorias = useMemo(
        () => ['Todos', ...new Set(productos.map((p) => p.categoria).filter(Boolean))],
        [productos]
    );

    const filtrados = categoria === 'Todos'
        ? productos
        : productos.filter((p) => p.categoria === categoria);

    const enCarrito = productos.filter((p) => carrito[p.id] > 0);
    const totalArticulos = Object.values(carrito).reduce((s, n) => s + n, 0);
    // Un evento = un precio. El total ya no se multiplica por días.
    const totalPedido = productos.reduce(
        (s, p) => s + Number(p.precio_dia) * (carrito[p.id] || 0), 0
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
            document.getElementById('fechas')?.scrollIntoView({ behavior: 'smooth' });
            return;
        }
        setCarrito((actual) => ({
            ...actual,
            [producto.id]: Math.min(disponibleDe(producto), (actual[producto.id] || 0) + 1)
        }));
        // A propósito NO abre el cajón: la clienta sigue viendo el catálogo
        // y elige varios artículos seguidos. El cajón se abre solo cuando
        // ella misma pulsa "Continuar" en la barra flotante.
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

    // ---- Enviar el pedido ---------------------------------------------
    async function enviarPedido(evento) {
        evento.preventDefault();
        if (!nombre.trim()) {
            setAviso('Escribe tu nombre para continuar.');
            return;
        }
        if (!fechaEvento) {
            setAviso('Elige el día de tu evento.');
            return;
        }

        setEnviando(true);
        setAviso('Comprobando disponibilidad…');

        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/functions/v1/${window.ALQUILER_FUNCION_PEDIDO}`,
                {
                    method: 'POST',
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
                setAviso(datos.error || 'No se pudo guardar el pedido.');
                // Si algo se agotó mientras decidía, refrescamos los números
                // para que vea el estado real en vez de insistir a ciegas.
                if (res.status === 409) {
                    const filas = await window.supaRpc('alquiler_disponibilidad', {
                        p_negocio: negocio.id, p_inicio: diaAntes(fechaEvento), p_fin: diaDespues(fechaEvento)
                    });
                    const mapa = {};
                    filas.forEach((f) => { mapa[f.producto_id] = f.disponible; });
                    setDisponibilidad(mapa);
                }
                return;
            }

            if (datos.whatsapp_url) {
                setAviso(`Pedido ${datos.pedido_id} guardado. Abriendo WhatsApp…`);
                window.location.assign(datos.whatsapp_url);
            } else {
                setAviso(
                    `Pedido ${datos.pedido_id} guardado. El negocio ya recibió el aviso, ` +
                    'te contactará para confirmar.'
                );
                setCarrito({});
            }
        } catch (e) {
            console.error('[Tienda] error enviando pedido:', e);
            setAviso('No se pudo enviar el pedido. Revisa tu conexión.');
        } finally {
            setEnviando(false);
        }
    }

    // ---- Estados de carga --------------------------------------------
    if (cargando) {
        return <div className="empty" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
            <span>✦</span>
            <h3>Cargando la tienda…</h3>
        </div>;
    }

    if (errorCarga) {
        return <div className="empty" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
            <span>✦</span>
            <h3>{errorCarga}</h3>
            <p>Si crees que es un error, pide el enlace al negocio.</p>
        </div>;
    }

    const moneda = negocio.moneda || 'CUP';

    return (
        <main>
            <header className="header">
                <a className="brand" href="#inicio"><span>✦</span> {negocio.nombre}</a>
                <nav>
                    <a href="#inicio">Inicio</a>
                    <a href="#catalogo">Catálogo</a>
                    <a href="#como">Cómo funciona</a>
                </nav>
                <button className="cart-trigger" onClick={() => setCajonAbierto(true)}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                    </svg>
                    Mi pedido <b>{totalArticulos}</b>
                </button>
            </header>

            <section className="hero shell" id="inicio">
                <div className="hero-copy">
                    <p className="eyebrow">Decora · celebra · recuerda</p>
                    <h1>{negocio.titulo_bienvenida}</h1>
                    <p className="intro">{negocio.texto_bienvenida}</p>

                    {/* El producto real de un alquiler es esta pregunta, no una foto:
                        "¿está libre lo que quiero, en la fecha que quiero?". Por eso
                        va primero, en el flujo normal de la página, no flotando sobre
                        una imagen con márgenes negativos. */}
                    <div className="hero-check" id="fechas">
                        <div className="date-title">
                            <span>◫</span>
                            <div>
                                <strong>¿Qué día es tu evento?</strong>
                                <small>
                                    {comprobando ? 'Comprobando…'
                                        : hayFecha ? 'Disponibilidad actualizada'
                                        : 'Elige la fecha para ver qué está libre'}
                                </small>
                            </div>
                        </div>
                        <div className="dates dates-una">
                            <label>
                                Día del evento
                                <input type="date" value={fechaEvento} min={mananaISO()}
                                    onChange={(e) => setFechaEvento(e.target.value)} />
                            </label>
                        </div>
                        {hayFecha && (
                            <p className="available">● Revisado para el {fechaLarga(fechaEvento)}</p>
                        )}
                        <ul className="condiciones">
                            <li><b>Recoges</b> el día antes de tu evento, después de las 5:00 PM.</li>
                            <li><b>Entregas</b> al día siguiente, antes de las 12:00 del mediodía.</li>
                            <li>Si no entregas a tiempo, se cobra un <b>50% extra</b> del costo del alquiler.</li>
                        </ul>
                    </div>

                    <div className="hero-buttons">
                        <a className="primary" href="#catalogo">Explorar catálogo →</a>
                        <a className="secondary" href="#como">¿Cómo funciona?</a>
                    </div>
                    <p className="benefits">
                        Reserva por evento <i>•</i> Combina productos <i>•</i> Pedido por WhatsApp
                    </p>
                </div>
                <div className="hero-visual">
                    <img src="images/hero-evento.png" alt="Decoración elegante para eventos" />
                </div>
            </section>

            <section className="catalog" id="catalogo">
                <div className="shell">
                    <div className="section-head">
                        <div>
                            <p className="eyebrow">Tu evento, a tu manera</p>
                            <h2>Combina todo lo que te inspire</h2>
                        </div>
                        <p>Agrega varios artículos y forma tu combo. El total es por el día de tu evento.</p>
                    </div>

                    {!productos.length ? (
                        <div className="empty">
                            <span>✦</span>
                            <h3>Catálogo en preparación</h3>
                            <p>Este negocio todavía no publicó sus artículos. Vuelve pronto.</p>
                        </div>
                    ) : (
                        <>
                            {categorias.length > 2 && (
                                <div className="filters">
                                    {categorias.map((item) => (
                                        <button key={item}
                                            className={categoria === item ? 'active' : ''}
                                            onClick={() => setCategoria(item)}>
                                            {item}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="product-grid">
                                {filtrados.map((producto, i) => {
                                    const disp = disponibleDe(producto);
                                    const agotado = hayFecha && disp < 1;
                                    // El catálogo está "en reposo" hasta que se eligen
                                    // fechas: recién ahí tiene sentido decir libre/reservado.
                                    const estado = !hayFecha ? '' : (agotado ? 'agotado' : 'libre');
                                    const visible = revealedIdsRef.current.has(String(producto.id));
                                    return (
                                        <article
                                            className={`product-card reveal ${visible ? 'is-visible' : ''} ${estado}`}
                                            key={producto.id} data-id={producto.id}
                                            ref={observarTarjeta(String(producto.id))}
                                            style={{ '--i': Math.min(i, 10) }}>
                                            <div className="product-image">
                                                <img src={producto.foto_url || 'images/producto-arco.png'}
                                                    alt={producto.nombre} loading="lazy" />
                                                {producto.categoria && <span>{producto.categoria}</span>}
                                                {hayFecha && (
                                                    <b className={agotado ? 'reserved' : ''}>
                                                        {agotado ? '● Reservado'
                                                            : `● ${disp} disponible${disp === 1 ? '' : 's'}`}
                                                    </b>
                                                )}
                                            </div>
                                            <div className="product-body">
                                                <div className="product-title">
                                                    <h3>{producto.nombre}</h3>
                                                    <p>
                                                        <strong>{dinero(producto.precio_dia)} {moneda}</strong>
                                                        <small>por evento</small>
                                                    </p>
                                                </div>
                                                <p>{producto.descripcion}</p>
                                                <button disabled={agotado} onClick={() => agregar(producto)}>
                                                    {hayFecha
                                                        ? (agotado ? 'No disponible' : 'Agregar al pedido +')
                                                        : 'Elegir fecha'}
                                                </button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            </section>

            <section className="how shell" id="como">
                <div className="center-head">
                    <p className="eyebrow">Simple y transparente</p>
                    <h2>Tu decoración lista en tres pasos</h2>
                </div>
                <div className="steps">
                    <article><b>01</b><span>◫</span><h3>Elige tu fecha</h3>
                        <p>Indica el día de tu evento para comprobar cada artículo.</p></article>
                    <article><b>02</b><span>✦</span><h3>Crea tu combo</h3>
                        <p>Combina productos y mira el total al instante.</p></article>
                    <article><b>03</b><span>◉</span><h3>Confirma por WhatsApp</h3>
                        <p>El negocio recibe el pedido completo y confirma.</p></article>
                </div>
            </section>

            {galeria.length > 0 && (
                <section className="galeria-publica shell" id="trabajos">
                    <div className="center-head">
                        <p className="eyebrow">Prueba de lo que hacemos</p>
                        <h2>Nuestros trabajos</h2>
                    </div>
                    <div className="galeria-publica-grid">
                        {galeria.map((foto) => (
                            <button className="galeria-publica-item" key={foto.id}
                                aria-label={foto.descripcion || 'Ver foto del trabajo'}
                                onClick={() => setFotoAmpliada(foto)}>
                                <img src={foto.imagen_url} alt="" loading="lazy" />
                                {foto.descripcion && <span>{foto.descripcion}</span>}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            <footer className="footer shell">
                <span className="brand"><i>✦</i> {negocio.nombre}</span>
                <p>Decoraciones que convierten un día especial en un gran recuerdo.</p>
                <div style={{ display: 'flex', gap: '18px' }}>
                    {negocio.instagram_url && <a href={negocio.instagram_url} target="_blank" rel="noopener">Instagram</a>}
                    {negocio.facebook_url && <a href={negocio.facebook_url} target="_blank" rel="noopener">Facebook</a>}
                </div>
            </footer>

            {totalArticulos > 0 && !cajonAbierto && (
                <button className="continuar-barra" onClick={() => setCajonAbierto(true)}>
                    <span>{totalArticulos} {totalArticulos === 1 ? 'artículo' : 'artículos'} · {dinero(totalPedido)} {moneda}</span>
                    <b>Continuar →</b>
                </button>
            )}

            {cajonAbierto && (
                <button className="overlay" aria-label="Cerrar" onClick={() => setCajonAbierto(false)} />
            )}
            <aside className={`drawer ${cajonAbierto ? 'open' : ''}`}>
                <div className="drawer-head">
                    <div><small>Tu selección</small><h2>Mi pedido</h2></div>
                    <button onClick={() => setCajonAbierto(false)} aria-label="Cerrar">×</button>
                </div>
                <div className="drawer-content">
                    {hayFecha && (
                        <p className="drawer-date">◫ Evento: {fechaLarga(fechaEvento)} · recoges el {fechaLarga(inicioRango)} después de las 5:00 PM</p>
                    )}
                    {!enCarrito.length ? (
                        <div className="empty">
                            <span>✦</span>
                            <h3>Tu combo empieza aquí</h3>
                            <p>Agrega los artículos que harán único tu evento.</p>
                        </div>
                    ) : (
                        <>
                            {enCarrito.map((producto) => (
                                <div className="cart-line" key={producto.id}>
                                    <img src={producto.foto_url || 'images/producto-arco.png'} alt="" />
                                    <div>
                                        <strong>{producto.nombre}</strong>
                                        <small>{dinero(producto.precio_dia)} {moneda}</small>
                                    </div>
                                    <div className="qty">
                                        <button onClick={() => quitar(producto)} aria-label="Quitar uno">−</button>
                                        <span>{carrito[producto.id]}</span>
                                        <button onClick={() => agregar(producto)}
                                            disabled={carrito[producto.id] >= disponibleDe(producto)}
                                            aria-label="Agregar uno">+</button>
                                    </div>
                                </div>
                            ))}
                            <div className="total">
                                <span>Total</span>
                                <strong>{dinero(totalPedido)} {moneda}</strong>
                            </div>
                            {anticipo > 0 && (
                                <div className="anticipo-desglose">
                                    <p>
                                        <span>Anticipo ({negocio.anticipo_porciento}%)</span>
                                        <strong>{dinero(anticipo)} {moneda}</strong>
                                    </p>
                                    <p>
                                        <span>Resto al recoger</span>
                                        <strong>{dinero(totalPedido - anticipo)} {moneda}</strong>
                                    </p>
                                </div>
                            )}
                            {anticipo > 0 && negocio.pago_tarjeta && (
                                <div className="datos-pago">
                                    <strong>Para confirmar tu reserva, transfiere el anticipo a:</strong>
                                    <p>Tarjeta: <b>{negocio.pago_tarjeta}</b></p>
                                    {negocio.pago_telefono && <p>Teléfono: <b>{negocio.pago_telefono}</b></p>}
                                    <small>
                                        Tu reserva queda confirmada cuando el negocio reciba el anticipo.
                                        {' '}Tienes {horasPlazo(negocio)} para pagarlo; pasado ese tiempo
                                        los artículos vuelven a quedar libres para otras clientas.
                                    </small>
                                </div>
                            )}
                            {negocio.direccion && (
                                <div className="datos-recogida">
                                    <strong>Dónde recoger</strong>
                                    <p>{negocio.direccion}</p>
                                    {hayFecha && (
                                        <small>El {fechaLarga(inicioRango)} después de las 5:00 PM.</small>
                                    )}
                                </div>
                            )}
                            <form className="checkout" onSubmit={enviarPedido}>
                                <input placeholder="Tu nombre" required value={nombre}
                                    onChange={(e) => setNombre(e.target.value)} />
                                <input placeholder="Tu teléfono" value={telefono} inputMode="tel"
                                    onChange={(e) => setTelefono(e.target.value)} />
                                <textarea placeholder="Nota opcional" value={notas}
                                    onChange={(e) => setNotas(e.target.value)} />
                                <button disabled={enviando || comprobando}>
                                    {enviando ? 'Enviando…' : 'Enviar pedido por WhatsApp'}
                                </button>
                                {aviso && <p className="order-status">{aviso}</p>}
                                <small>La disponibilidad se revisará nuevamente antes de enviar.</small>
                            </form>
                        </>
                    )}
                </div>
            </aside>

            {fotoAmpliada && (
                <>
                    <button className="overlay" aria-label="Cerrar" onClick={() => setFotoAmpliada(null)} />
                    <div className="lightbox">
                        <button className="lightbox-cerrar" aria-label="Cerrar"
                            onClick={() => setFotoAmpliada(null)}>×</button>
                        <img src={fotoAmpliada.imagen_url} alt={fotoAmpliada.descripcion || ''} />
                        {fotoAmpliada.descripcion && <p>{fotoAmpliada.descripcion}</p>}
                    </div>
                </>
            )}
        </main>
    );
}

window.Tienda = Tienda;

const ETIQUETA_ESTADO_CLIENTE = {
    pendiente: 'Pendiente',
    confirmado: 'Confirmada',
    entregado: 'Entregada',
    devuelto: 'Devuelta',
    cancelado: 'Cancelada'
};

function tokenDeLaUrl() {
    return new URLSearchParams(window.location.search).get('reserva') || '';
}

// Guarda el token en localStorage (hasta los últimos 10) para que
// "Mis reservas" pueda ofrecerlo de nuevo sin que la clienta tenga que
// volver a buscar el enlace de WhatsApp.
function guardarReservaLocal(token) {
    try {
        const clave = 'romadetallesMisReservas';
        const actual = JSON.parse(localStorage.getItem(clave) || '[]');
        if (!actual.includes(token)) {
            actual.push(token);
            localStorage.setItem(clave, JSON.stringify(actual.slice(-10)));
        }
    } catch (e) {
        console.warn('[MiReserva] no se pudo guardar en localStorage:', e);
    }
}

function tokensGuardados() {
    try {
        return JSON.parse(localStorage.getItem('romadetallesMisReservas') || '[]');
    } catch {
        return [];
    }
}

// Archivo .ics mínimo (formato VCALENDAR/VEVENT) — sin librerías. Es lo
// que de verdad deja la cita guardada en el Calendario nativo del
// teléfono (iPhone, Android, Google Calendar la abren directo).
function armarICS(reserva) {
    const fecha = reserva.fecha_evento.replace(/-/g, '');
    const items = (reserva.items || [])
        .map((i) => `${i.cantidad} x ${i.producto_nombre}`)
        .join(', ');
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//RomaDetalles//Reserva//ES',
        'BEGIN:VEVENT',
        `UID:${reserva.pedido_id}@romadetalles`,
        `DTSTART;VALUE=DATE:${fecha}`,
        `SUMMARY:Evento — ${reserva.negocio_nombre}`,
        `DESCRIPTION:${items}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');
}

function descargarICS(reserva) {
    const blob = new Blob([armarICS(reserva)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reserva-${reserva.fecha_evento}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function MiReserva({ token }) {
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [reserva, setReserva] = useState(null);
    const [otrasGuardadas, setOtrasGuardadas] = useState([]);
    const [edicion, setEdicion] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [avisoEdicion, setAvisoEdicion] = useState('');

    const cargar = useCallback(async () => {
        const filas = await window.supaRpc('alquiler_pedido_por_token', { p_token: token });
        if (!filas.length) throw new Error('SIN_RESERVA');
        setReserva(filas[0]);
        return filas[0];
    }, [token]);

    useEffect(() => {
        (async () => {
            try {
                await cargar();
                guardarReservaLocal(token);
            } catch (e) {
                if (String(e.message) === 'SIN_RESERVA') {
                    setError('No encontramos esta reserva. Revisa el enlace.');
                } else {
                    console.error('[MiReserva] error cargando:', e);
                    setError('No se pudo cargar tu reserva. Revisa tu conexión.');
                }
            } finally {
                setCargando(false);
            }
        })();
    }, [token, cargar]);

    // Otras reservas guardadas en este teléfono, para el enlace "Ver
    // mis otras reservas" — se resuelven en paralelo, cada una con su
    // propio RPC (la lista es corta, como mucho 10).
    useEffect(() => {
        const tokens = tokensGuardados().filter((t) => t !== token);
        if (!tokens.length) return;
        let vigente = true;
        Promise.all(
            tokens.map((t) =>
                window.supaRpc('alquiler_pedido_por_token', { p_token: t })
                    .then((filas) => (filas[0] ? { token: t, fecha_evento: filas[0].fecha_evento } : null))
                    .catch(() => null)
            )
        ).then((resultados) => {
            if (vigente) setOtrasGuardadas(resultados.filter(Boolean));
        });
        return () => { vigente = false; };
    }, [token]);

    if (cargando) {
        return (
            <div className="empty" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
                <span>✦</span>
                <h3>Cargando tu reserva…</h3>
            </div>
        );
    }

    if (error || !reserva) {
        return (
            <div className="empty" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
                <span>✦</span>
                <h3>{error || 'No encontramos esta reserva.'}</h3>
            </div>
        );
    }

    const moneda = reserva.moneda || 'CUP';
    const etiqueta = ETIQUETA_ESTADO_CLIENTE[reserva.estado] || reserva.estado;
    // Vencida = sigue pendiente pero ya pasó el plazo del anticipo. El
    // stock ya se liberó (la consulta de disponibilidad la ignora), así
    // que decírselo es más honesto que dejarla creer que está guardada.
    const vencida = reserva.estado === 'pendiente' &&
        reserva.expira_en && new Date(reserva.expira_en) < new Date();

    function solicitarCambio() {
        const numero = (reserva.negocio_whatsapp || '').replace(/\D/g, '');
        const mensaje = `Hola, quiero pedir un cambio en mi reserva del ${fechaLarga(reserva.fecha_evento)}.`;
        window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank');
    }

    // Entregada o devuelta ya no se cambia: eso se habla con el negocio.
    const puedeEditar = reserva.estado === 'pendiente' || reserva.estado === 'confirmado';

    function abrirEdicion() {
        setAvisoEdicion('');
        setEdicion({
            fecha_evento: reserva.fecha_evento || '',
            cliente_telefono: reserva.cliente_telefono || '',
            notas: reserva.notas || ''
        });
    }

    async function guardarEdicion(evento) {
        evento.preventDefault();
        if (!edicion.fecha_evento) {
            setAvisoEdicion('Elige el día de tu evento.');
            return;
        }
        setGuardando(true);
        setAvisoEdicion('');
        try {
            // Vía Edge Function, no RPC directo: ahí es donde se dispara el
            // aviso al dueño. Los artículos no se tocan desde aquí, pero el
            // servidor igual revisa que el día nuevo alcance el stock.
            const res = await fetch(
                `${window.SUPABASE_URL}/functions/v1/${window.ALQUILER_FUNCION_EDITAR}`,
                {
                    method: 'POST',
                    headers: window.supaHeaders(),
                    body: JSON.stringify({
                        token,
                        fecha_evento: edicion.fecha_evento,
                        cliente_telefono: edicion.cliente_telefono.trim(),
                        notas: edicion.notas.trim()
                    })
                }
            );
            const datos = await res.json().catch(() => ({}));
            if (!res.ok) {
                setAvisoEdicion(datos.error || 'No se pudo guardar el cambio. Inténtalo otra vez.');
                return;
            }
            await cargar();
            setEdicion(null);
            setAvisoEdicion('Listo. El negocio va a revisar el cambio y te confirma.');
        } catch (e) {
            // La Edge Function ya devuelve los errores de negocio en
            // castellano; aquí solo cae que no hubo respuesta.
            console.error('[MiReserva] error al guardar:', e);
            setAvisoEdicion('No se pudo guardar el cambio. Revisa tu conexión e inténtalo otra vez.');
        } finally {
            setGuardando(false);
        }
    }

    return (
        <main>
            <header className="header">
                <a className="brand" href="#"><span>✦</span> {reserva.negocio_nombre}</a>
            </header>
            <section className="shell" style={{ paddingBlock: '60px' }}>
                <div className="admin-card" style={{ margin: '0 auto', maxWidth: '480px', padding: '28px' }}>
                    <span className={`order-chip ${reserva.estado}`}>{etiqueta}</span>
                    <h1 style={{ color: 'var(--burgundy)', fontFamily: 'var(--serif)', margin: '14px 0 4px' }}>
                        {fechaLarga(reserva.fecha_evento)}
                    </h1>
                    <p style={{ color: 'var(--muted)' }}>
                        Recoges el {fechaLarga(reserva.fecha_inicio)} después de las 5:00 PM
                    </p>
                    {reserva.estado === 'pendiente' && reserva.expira_en && (
                        vencida ? (
                            <div className="datos-recogida vencida">
                                <strong>Se venció el plazo</strong>
                                <p>
                                    No llegó el anticipo a tiempo, así que los artículos volvieron a
                                    quedar libres. Escríbenos y vemos si todavía se puede.
                                </p>
                            </div>
                        ) : (
                            <div className="datos-recogida">
                                <strong>Falta confirmar el anticipo</strong>
                                <p>Tienes hasta {vencimientoLargo(reserva.expira_en)} para pagarlo.</p>
                                <small>Después de esa hora los artículos vuelven a quedar libres.</small>
                            </div>
                        )
                    )}
                    {reserva.negocio_direccion && (
                        <div className="datos-recogida">
                            <strong>Dónde recoger</strong>
                            <p>{reserva.negocio_direccion}</p>
                        </div>
                    )}
                    <ul>
                        {(reserva.items || []).map((item, i) => (
                            <li key={i}>{item.cantidad} × {item.producto_nombre}</li>
                        ))}
                    </ul>
                    <p><strong>Total: {dinero(reserva.total)} {moneda}</strong></p>
                    {Number(reserva.anticipo) > 0 && (
                        <p>Anticipo: {dinero(reserva.anticipo)} {moneda}</p>
                    )}
                    {edicion ? (
                        <form className="mi-reserva-form" onSubmit={guardarEdicion}>
                            <label>Día del evento
                                <input type="date" required min={mananaISO()}
                                    value={edicion.fecha_evento}
                                    onChange={(e) => setEdicion({ ...edicion, fecha_evento: e.target.value })} />
                            </label>
                            <label>Tu teléfono
                                <input inputMode="tel" value={edicion.cliente_telefono}
                                    onChange={(e) => setEdicion({ ...edicion, cliente_telefono: e.target.value })} />
                            </label>
                            <label>Nota para el negocio
                                <textarea rows="3" value={edicion.notas}
                                    onChange={(e) => setEdicion({ ...edicion, notas: e.target.value })} />
                            </label>
                            <p className="mi-reserva-nota">
                                Para cambiar los artículos, escríbenos por WhatsApp.
                            </p>
                            <div style={{ display: 'grid', gap: '10px' }}>
                                <button className="primary" type="submit" disabled={guardando}>
                                    {guardando ? 'Guardando…' : 'Guardar cambios'}
                                </button>
                                <button className="secondary" type="button" onClick={() => setEdicion(null)}>
                                    Cancelar
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div style={{ display: 'grid', gap: '10px', marginTop: '20px' }}>
                            <button className="primary" onClick={() => descargarICS(reserva)}>
                                Agregar a mi calendario
                            </button>
                            {puedeEditar && (
                                <button className="secondary" onClick={abrirEdicion}>
                                    Editar mi reserva
                                </button>
                            )}
                            <button className="secondary" onClick={solicitarCambio}>
                                Escribir al negocio
                            </button>
                        </div>
                    )}
                    {avisoEdicion && <p className="mi-reserva-aviso">{avisoEdicion}</p>}
                    {otrasGuardadas.length > 0 && (
                        <div className="mis-reservas-otras">
                            <small>Tus otras reservas guardadas:</small>
                            {otrasGuardadas.map((r) => (
                                <a key={r.token} href={`?reserva=${r.token}`}>{fechaLarga(r.fecha_evento)}</a>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}

window.MiReserva = MiReserva;
