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

const { useEffect, useMemo, useState, useCallback } = React;

function dinero(valor) {
    return new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(valor || 0);
}

// El evento más cercano posible es mañana: si fuera hoy, la recogida
// (la tarde anterior) ya habría pasado.
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
                    `anticipo_porciento,anticipo_redondear,pago_tarjeta,pago_telefono`
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
            p_fin: fechaEvento
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
                        p_negocio: negocio.id, p_inicio: diaAntes(fechaEvento), p_fin: fechaEvento
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
                            <p className="available">● Revisado para el {fechaEvento}</p>
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
                                {filtrados.map((producto) => {
                                    const disp = disponibleDe(producto);
                                    const agotado = hayFecha && disp < 1;
                                    // El catálogo está "en reposo" hasta que se eligen
                                    // fechas: recién ahí tiene sentido decir libre/reservado.
                                    const estado = !hayFecha ? '' : (agotado ? 'agotado' : 'libre');
                                    return (
                                        <article className={`product-card ${estado}`} key={producto.id}>
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
                    <article><b>01</b><span>◫</span><h3>Elige las fechas</h3>
                        <p>Indica los días para comprobar cada artículo.</p></article>
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
                        <p className="drawer-date">◫ Evento: {fechaEvento} · recoges el {inicioRango} después de las 5:00 PM</p>
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
                                    <small>Tu reserva queda confirmada cuando el negocio reciba el anticipo.</small>
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
