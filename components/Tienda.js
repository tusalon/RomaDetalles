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

function diasEntre(inicio, fin) {
    if (!inicio || !fin) return 0;
    const ms = new Date(`${fin}T12:00:00Z`) - new Date(`${inicio}T12:00:00Z`);
    return Math.max(0, Math.floor(ms / 86400000) + 1);
}

function dinero(valor) {
    return new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(valor || 0);
}

function hoyISO() {
    // Fecha local, no UTC: en Cuba (UTC-4/-5) usar toISOString() haría que
    // después de las 19:00 el mínimo del calendario saltara al día siguiente.
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

    const [inicio, setInicio] = useState('');
    const [fin, setFin] = useState('');
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

    const dias = diasEntre(inicio, fin);

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
                    `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos`
                );
                if (!negocios.length) {
                    setErrorCarga('No encontramos esta tienda. Revisa el enlace.');
                    setCargando(false);
                    return;
                }
                const neg = negocios[0];
                setNegocio(neg);

                const items = await window.supaGet(
                    `alquiler_productos?negocio_id=eq.${neg.id}&activo=eq.true` +
                    `&select=id,nombre,descripcion,categoria,precio_dia,cantidad,foto_url&order=orden.asc,creado_en.asc`
                );
                setProductos(items);
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
        if (!negocio || !inicio || !fin || fin < inicio) return;
        let vigente = true;
        setComprobando(true);

        window.supaRpc('alquiler_disponibilidad', {
            p_negocio: negocio.id,
            p_inicio: inicio,
            p_fin: fin
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
    }, [negocio, inicio, fin]);

    const categorias = useMemo(
        () => ['Todos', ...new Set(productos.map((p) => p.categoria).filter(Boolean))],
        [productos]
    );

    const filtrados = categoria === 'Todos'
        ? productos
        : productos.filter((p) => p.categoria === categoria);

    const enCarrito = productos.filter((p) => carrito[p.id] > 0);
    const totalArticulos = Object.values(carrito).reduce((s, n) => s + n, 0);
    const totalDiario = productos.reduce(
        (s, p) => s + Number(p.precio_dia) * (carrito[p.id] || 0), 0
    );

    const disponibleDe = useCallback((producto) => {
        if (!dias) return producto.cantidad;
        return disponibilidad[producto.id] ?? producto.cantidad;
    }, [dias, disponibilidad]);

    function agregar(producto) {
        if (!dias) {
            document.getElementById('fechas')?.scrollIntoView({ behavior: 'smooth' });
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

    // ---- Enviar el pedido ---------------------------------------------
    async function enviarPedido(evento) {
        evento.preventDefault();
        if (!nombre.trim()) {
            setAviso('Escribe tu nombre para continuar.');
            return;
        }
        if (dias < (negocio.dias_minimos || 1)) {
            setAviso(`El alquiler mínimo es de ${negocio.dias_minimos} día(s).`);
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
                setAviso(datos.error || 'No se pudo guardar el pedido.');
                // Si algo se agotó mientras decidía, refrescamos los números
                // para que vea el estado real en vez de insistir a ciegas.
                if (res.status === 409) {
                    const filas = await window.supaRpc('alquiler_disponibilidad', {
                        p_negocio: negocio.id, p_inicio: inicio, p_fin: fin
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
                                <strong>Comprueba tu fecha</strong>
                                <small>
                                    {comprobando ? 'Comprobando…'
                                        : dias ? 'Disponibilidad actualizada'
                                        : 'Elige las fechas'}
                                </small>
                            </div>
                        </div>
                        <div className="dates">
                            <label>
                                Desde
                                <input type="date" value={inicio} min={hoyISO()}
                                    onChange={(e) => {
                                        setInicio(e.target.value);
                                        if (fin && fin < e.target.value) setFin(e.target.value);
                                    }} />
                            </label>
                            <label>
                                Hasta
                                <input type="date" value={fin} min={inicio || hoyISO()}
                                    disabled={!inicio}
                                    onChange={(e) => setFin(e.target.value)} />
                            </label>
                        </div>
                        {dias > 0 && (
                            <p className="available">● Revisado · {dias} {dias === 1 ? 'día' : 'días'}</p>
                        )}
                    </div>

                    <div className="hero-buttons">
                        <a className="primary" href="#catalogo">Explorar catálogo →</a>
                        <a className="secondary" href="#como">¿Cómo funciona?</a>
                    </div>
                    <p className="benefits">
                        Reserva por días <i>•</i> Combina productos <i>•</i> Pedido por WhatsApp
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
                        <p>Agrega varios artículos y forma tu combo. El total se calcula según los días seleccionados.</p>
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
                                    const agotado = dias > 0 && disp < 1;
                                    // El catálogo está "en reposo" hasta que se eligen
                                    // fechas: recién ahí tiene sentido decir libre/reservado.
                                    const estado = dias === 0 ? '' : (agotado ? 'agotado' : 'libre');
                                    return (
                                        <article className={`product-card ${estado}`} key={producto.id}>
                                            <div className="product-image">
                                                <img src={producto.foto_url || 'images/producto-arco.png'}
                                                    alt={producto.nombre} loading="lazy" />
                                                {producto.categoria && <span>{producto.categoria}</span>}
                                                {dias > 0 && (
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
                                                        <small>/ día</small>
                                                    </p>
                                                </div>
                                                <p>{producto.descripcion}</p>
                                                <button disabled={agotado} onClick={() => agregar(producto)}>
                                                    {dias
                                                        ? (agotado ? 'No disponible' : 'Agregar al pedido +')
                                                        : 'Elegir fechas'}
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

            <footer className="footer shell">
                <span className="brand"><i>✦</i> {negocio.nombre}</span>
                <p>Decoraciones que convierten un día especial en un gran recuerdo.</p>
                <div style={{ display: 'flex', gap: '18px' }}>
                    {negocio.instagram_url && <a href={negocio.instagram_url} target="_blank" rel="noopener">Instagram</a>}
                    {negocio.facebook_url && <a href={negocio.facebook_url} target="_blank" rel="noopener">Facebook</a>}
                </div>
            </footer>

            {cajonAbierto && (
                <button className="overlay" aria-label="Cerrar" onClick={() => setCajonAbierto(false)} />
            )}
            <aside className={`drawer ${cajonAbierto ? 'open' : ''}`}>
                <div className="drawer-head">
                    <div><small>Tu selección</small><h2>Mi pedido</h2></div>
                    <button onClick={() => setCajonAbierto(false)} aria-label="Cerrar">×</button>
                </div>
                <div className="drawer-content">
                    {dias > 0 && (
                        <p className="drawer-date">◫ {inicio} — {fin} · {dias} {dias === 1 ? 'día' : 'días'}</p>
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
                                        <small>{dinero(producto.precio_dia)} {moneda} / día</small>
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
                                <span>Total estimado</span>
                                <strong>{dinero(totalDiario * dias)} {moneda}</strong>
                            </div>
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
        </main>
    );
}

window.Tienda = Tienda;
