// components/Panel.js — Panel del negocio de alquiler.
//
// Portado de app/admin/admin-client.tsx con diferencias que importan:
//   · El acceso es Supabase Auth de verdad. En la versión anterior cualquier
//     cuenta de ChatGPT que entrara a /admin podía cambiar precios y cancelar
//     reservas: `requireAdminApi()` solo comprobaba que hubiera sesión, no de
//     quién. Ahora las policies de RLS filtran por auth.uid().
//   · Pestaña de Ocupación: cuántos días estuvo alquilado cada artículo y
//     cuánto ingresó. Es el número que le dice al dueño qué comprar más.
//   · Tarjeta de avisos push, para enterarse de un pedido sin depender de que
//     la clienta pulse enviar en WhatsApp.
//   · Alta de artículo por formulario: "+ Nuevo artículo" abre una tarjeta
//     vacía para llenar (sin foto, sin insertar nada) y solo al Guardar se
//     crea la fila real. La foto se agrega después, igual que al editar.
//   · Logo del negocio y plantilla de mensaje de confirmación editables.
//   · Al confirmar una reserva, se abre un wa.me hacia la CLIENTA con el
//     mensaje de confirmación ya armado (la clienta, no el negocio: por
//     eso usa pedido.cliente_telefono, no negocio.whatsapp).
//   · "Fuera de servicio": unidades de un artículo que el dueño bloquea a
//     mano (reparación, prestado fuera del sistema) sin pasar por un
//     pedido con fechas; restan de lo disponible igual que una reserva.
//
// Editar este archivo y luego correr `bash scripts/build-jsx.sh`.

const { useEffect, useState, useCallback } = React;

function dineroPanel(valor) {
    return new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(valor || 0);
}

const ETIQUETA_ESTADO = {
    pendiente: 'Pendiente',
    confirmado: 'Confirmada',
    entregado: 'Entregada',
    devuelto: 'Devuelta',
    cancelado: 'Cancelada'
};

function primerDiaDelMes() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoyPanel() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PRODUCTO_VACIO = { nombre: '', descripcion: '', categoria: 'Decoración', precio_dia: '', cantidad: 1 };

// Rellena la plantilla de confirmación con los datos reales del pedido.
// Variables soportadas: {nombre} {pedido_id} {fechas} {total}
function armarMensajeConfirmacion(plantilla, pedido, moneda) {
    const fechas = `${pedido.fecha_inicio} al ${pedido.fecha_fin} (${pedido.dias} ${pedido.dias === 1 ? 'día' : 'días'})`;
    const total = `${dineroPanel(pedido.total)} ${moneda}`;
    return (plantilla || '')
        .replaceAll('{nombre}', pedido.cliente_nombre || '')
        .replaceAll('{pedido_id}', pedido.id || '')
        .replaceAll('{fechas}', fechas)
        .replaceAll('{total}', total);
}

// Traduce el error crudo de Postgres (que llega como "42501: {...}" o
// "409: ...SIN_STOCK:Nombre...") a algo que el admin entienda, igual que
// hace la Edge Function crear-pedido-alquiler para la clienta.
function mensajeDeErrorReserva(error) {
    const texto = String(error?.message || error || '');
    if (texto.includes('SIN_STOCK')) {
        const nombre = texto.split('SIN_STOCK:')[1]?.split('\n')[0]?.trim();
        return nombre ? `${nombre} no tiene stock suficiente en esas fechas.` : 'No hay stock suficiente en esas fechas.';
    }
    if (texto.includes('PERIODO_INVALIDO')) return 'El período de fechas no es válido.';
    if (texto.includes('PEDIDO_VACIO')) return 'Elige al menos un artículo.';
    if (texto.includes('PRODUCTO_NO_EXISTE')) return 'Uno de los artículos ya no existe.';
    if (texto.includes('NO_AUTORIZADO')) return 'No tienes permiso para crear reservas en este negocio.';
    console.error('[Panel] error de reserva no reconocido:', texto);
    return 'No se pudo crear la reserva. Inténtalo de nuevo.';
}

// ---------------------------------------------------------------------
// Tarjeta de avisos push
// ---------------------------------------------------------------------
function TarjetaAvisos({ negocioId }) {
    const [activos, setActivos] = useState(false);
    const [estado, setEstado] = useState('');
    const [mensaje, setMensaje] = useState('');
    const [ocupado, setOcupado] = useState(false);

    const refrescar = useCallback(async () => {
        setEstado(window.RomaDetallesPush.estadoPush());
        setActivos(await window.RomaDetallesPush.avisosActivos());
    }, []);

    useEffect(() => {
        refrescar();
        window.addEventListener('romadetalles-push-cambio', refrescar);
        return () => window.removeEventListener('romadetalles-push-cambio', refrescar);
    }, [refrescar]);

    async function activar() {
        setOcupado(true);
        setMensaje('');
        const r = await window.RomaDetallesPush.activarAvisos(negocioId);
        if (!r.ok) setMensaje(r.mensaje);
        else setMensaje('Avisos activados en este dispositivo.');
        await refrescar();
        setOcupado(false);
    }

    async function desactivar() {
        setOcupado(true);
        setMensaje('');
        await window.RomaDetallesPush.desactivarAvisos(negocioId);
        await refrescar();
        setOcupado(false);
    }

    // En iPhone sin instalar, decir la verdad en vez de ofrecer un botón que
    // no va a funcionar. Safari solo permite push en PWA instalada.
    if (estado === 'instalar_primero') {
        return (
            <div className="admin-card push-card">
                <h3>Avisos de pedidos nuevos</h3>
                <p>
                    En iPhone los avisos funcionan solo con la app instalada.
                    Pulsa <strong>Compartir → Añadir a pantalla de inicio</strong>,
                    ábrela desde el ícono y aquí podrás activarlos.
                </p>
            </div>
        );
    }

    if (estado === 'no_soportado') {
        return (
            <div className="admin-card push-card">
                <h3>Avisos de pedidos nuevos</h3>
                <p>Este navegador no puede recibir avisos. Los pedidos siguen
                   apareciendo en la pestaña Reservas.</p>
            </div>
        );
    }

    return (
        <div className="admin-card push-card">
            <h3>Avisos de pedidos nuevos</h3>
            <span className={`push-estado ${activos ? 'on' : 'off'}`}>
                ● {activos ? 'Activados en este dispositivo' : 'Desactivados'}
            </span>
            <p>
                Con los avisos activados te llega una notificación en cuanto una
                clienta envía un pedido, sin tener que abrir el panel a revisar.
            </p>
            {activos ? (
                <button className="apagar" onClick={desactivar} disabled={ocupado}>
                    Desactivar
                </button>
            ) : (
                <button onClick={activar} disabled={ocupado}>
                    {ocupado ? 'Activando…' : 'Activar avisos'}
                </button>
            )}
            {mensaje && <p className="order-status">{mensaje}</p>}
        </div>
    );
}

// ---------------------------------------------------------------------
// Panel principal
// ---------------------------------------------------------------------
function Panel({ negocioInicial, email }) {
    const [pestana, setPestana] = useState('reservas');
    const [negocio, setNegocio] = useState(negocioInicial);
    const [productos, setProductos] = useState([]);
    const [pedidos, setPedidos] = useState([]);
    const [ocupacion, setOcupacion] = useState([]);
    const [rango, setRango] = useState({ desde: primerDiaDelMes(), hasta: hoyPanel() });
    const [aviso, setAviso] = useState('');
    const [subiendo, setSubiendo] = useState(null);
    const [subiendoLogo, setSubiendoLogo] = useState(false);
    const [productoNuevo, setProductoNuevo] = useState(null);
    const [creandoProducto, setCreandoProducto] = useState(false);
    const [reservaManual, setReservaManual] = useState(null);
    const [creandoReserva, setCreandoReserva] = useState(false);

    const moneda = negocio.moneda || 'CUP';

    function notificar(texto) {
        setAviso(texto);
        setTimeout(() => setAviso(''), 4000);
    }

    // ---- Cargas -------------------------------------------------------
    const cargarProductos = useCallback(async () => {
        try {
            setProductos(await window.supaGet(
                `alquiler_productos?negocio_id=eq.${negocio.id}` +
                `&select=id,nombre,descripcion,categoria,precio_dia,cantidad,fuera_de_servicio,foto_url,activo,orden` +
                `&order=orden.asc,creado_en.asc`
            ));
        } catch (e) {
            console.error('[Panel] error cargando productos:', e);
            notificar('No se pudieron cargar los artículos.');
        }
    }, [negocio.id]);

    const cargarPedidos = useCallback(async () => {
        try {
            const filas = await window.supaGet(
                `alquiler_pedidos?negocio_id=eq.${negocio.id}` +
                `&select=id,cliente_nombre,cliente_telefono,fecha_inicio,fecha_fin,dias,total,estado,notas,creado_en,` +
                `alquiler_pedido_items(id,producto_nombre,cantidad)` +
                `&order=creado_en.desc&limit=200`
            );
            setPedidos(filas);
        } catch (e) {
            console.error('[Panel] error cargando pedidos:', e);
            notificar('No se pudieron cargar las reservas.');
        }
    }, [negocio.id]);

    const cargarOcupacion = useCallback(async () => {
        try {
            setOcupacion(await window.supaRpc('alquiler_ocupacion', {
                p_negocio: negocio.id,
                p_desde: rango.desde,
                p_hasta: rango.hasta
            }));
        } catch (e) {
            console.error('[Panel] error cargando ocupación:', e);
            notificar('No se pudo calcular la ocupación.');
        }
    }, [negocio.id, rango.desde, rango.hasta]);

    useEffect(() => { cargarProductos(); cargarPedidos(); }, [cargarProductos, cargarPedidos]);
    useEffect(() => { if (pestana === 'ocupacion') cargarOcupacion(); }, [pestana, cargarOcupacion]);

    // Si llegamos desde una notificación (?pedido=RD-...), abrir Reservas.
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('pedido')) {
            setPestana('reservas');
        }
    }, []);

    // ---- Configuración ------------------------------------------------
    async function guardarConfiguracion() {
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_negocios?id=eq.${negocio.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({
                        nombre: negocio.nombre,
                        titulo_bienvenida: negocio.titulo_bienvenida,
                        texto_bienvenida: negocio.texto_bienvenida,
                        whatsapp: negocio.whatsapp,
                        moneda: negocio.moneda,
                        instagram_url: negocio.instagram_url,
                        facebook_url: negocio.facebook_url,
                        logo_url: negocio.logo_url || '',
                        plantilla_confirmacion: negocio.plantilla_confirmacion || '',
                        plantilla_compartir: negocio.plantilla_compartir || '',
                        plantilla_solicitud: negocio.plantilla_solicitud || '',
                        dias_minimos: Math.max(1, Number(negocio.dias_minimos) || 1),
                        actualizado_en: new Date().toISOString()
                    })
                }
            );
            notificar(res.ok ? 'Configuración guardada.' : 'No se pudo guardar.');
        } catch (e) {
            console.error('[Panel] error guardando configuración:', e);
            notificar('No se pudo guardar.');
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
        // Se guarda solo, sin esperar a "Guardar cambios": si cierra el panel
        // justo después de subir el logo, no se pierde.
        await fetch(`${window.SUPABASE_URL}/rest/v1/alquiler_negocios?id=eq.${negocio.id}`, {
            method: 'PATCH',
            headers: window.supaHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ logo_url: subida.url, actualizado_en: new Date().toISOString() })
        });
        notificar('Logo actualizado.');
    }

    // ---- Productos ----------------------------------------------------
    function abrirFormularioProducto() {
        setProductoNuevo({ ...PRODUCTO_VACIO });
    }

    function cancelarFormularioProducto() {
        setProductoNuevo(null);
    }

    async function crearProducto(evento) {
        evento.preventDefault();
        if (!productoNuevo.nombre.trim()) {
            notificar('Ponle un nombre al artículo.');
            return;
        }
        setCreandoProducto(true);
        try {
            const res = await fetch(`${window.SUPABASE_URL}/rest/v1/alquiler_productos`, {
                method: 'POST',
                headers: window.supaHeaders({ Prefer: 'return=representation' }),
                body: JSON.stringify({
                    negocio_id: negocio.id,
                    nombre: productoNuevo.nombre.trim(),
                    descripcion: productoNuevo.descripcion.trim(),
                    categoria: productoNuevo.categoria.trim() || 'Decoración',
                    precio_dia: Math.max(0, Number(productoNuevo.precio_dia) || 0),
                    cantidad: Math.max(0, Math.floor(Number(productoNuevo.cantidad) || 0)),
                    foto_url: '',
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
            console.error('[Panel] error creando artículo:', e);
            notificar('No se pudo crear el artículo.');
        } finally {
            setCreandoProducto(false);
        }
    }

    async function guardarProducto(producto) {
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_productos?id=eq.${producto.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({
                        nombre: producto.nombre,
                        descripcion: producto.descripcion,
                        categoria: producto.categoria,
                        precio_dia: Math.max(0, Number(producto.precio_dia) || 0),
                        cantidad: Math.max(0, Math.floor(Number(producto.cantidad) || 0)),
                        fuera_de_servicio: Math.max(0, Math.floor(Number(producto.fuera_de_servicio) || 0)),
                        foto_url: producto.foto_url,
                        activo: producto.activo,
                        actualizado_en: new Date().toISOString()
                    })
                }
            );
            notificar(res.ok ? `${producto.nombre} guardado.` : 'No se pudo guardar.');
        } catch (e) {
            console.error('[Panel] error guardando artículo:', e);
            notificar('No se pudo guardar.');
        }
    }

    async function ocultarProducto(producto) {
        // Ocultar en vez de borrar: los pedidos históricos apuntan a este
        // artículo, y borrarlo dejaría reservas pasadas sin referencia.
        if (!window.confirm(`¿Quitar "${producto.nombre}" del catálogo? Las reservas anteriores se conservan.`)) return;
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_productos?id=eq.${producto.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() })
                }
            );
            if (res.ok) {
                setProductos((actual) => actual.map((p) =>
                    p.id === producto.id ? { ...p, activo: false } : p));
                notificar('Artículo oculto en la tienda.');
            }
        } catch (e) {
            console.error('[Panel] error ocultando artículo:', e);
        }
    }

    async function subirFoto(evento, producto) {
        const archivo = evento.target.files?.[0];
        if (!archivo) return;
        setSubiendo(producto.id);
        const subida = await window.subirFotoProducto(archivo, producto.id);
        setSubiendo(null);
        if (!subida) return;

        setProductos((actual) => actual.map((p) =>
            p.id === producto.id ? { ...p, foto_url: subida.url } : p));
        // Guardamos la foto sola, sin esperar a que pulse Guardar: si cierra
        // el panel después de subirla, la foto no se pierde.
        await guardarProducto({ ...producto, foto_url: subida.url });
    }

    // ---- Reservas -----------------------------------------------------
    async function cambiarEstado(pedido, estado) {
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_pedidos?id=eq.${pedido.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ estado, actualizado_en: new Date().toISOString() })
                }
            );
            if (!res.ok) {
                notificar('No se pudo actualizar la reserva.');
                return;
            }
            setPedidos((actual) => actual.map((p) =>
                p.id === pedido.id ? { ...p, estado } : p));
            notificar(`Reserva ${ETIQUETA_ESTADO[estado].toLowerCase()}.`);

            // Al confirmar, abrir un WhatsApp hacia LA CLIENTA (no el negocio)
            // con el mensaje de confirmación ya armado. El admin lo revisa y
            // lo envía con un clic — igual que el resto de la app, no hay
            // envío automático de mensajes desde el servidor.
            if (estado === 'confirmado' && pedido.cliente_telefono) {
                const numero = pedido.cliente_telefono.replace(/\D/g, '');
                if (numero) {
                    const mensaje = armarMensajeConfirmacion(negocio.plantilla_confirmacion, pedido, moneda);
                    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank');
                }
            }
        } catch (e) {
            console.error('[Panel] error cambiando estado:', e);
            notificar('No se pudo actualizar la reserva.');
        }
    }

    async function salir() {
        await window.AlquilerAuth.salir();
        window.location.replace('admin-login.html');
    }

    const enlaceTienda = `index.html?s=${encodeURIComponent(negocio.slug)}`;
    const enlaceTiendaCompleto =
        `${window.location.origin}${window.location.pathname.replace(/admin\.html$/, '')}index.html?s=${negocio.slug}`;

    // ---- Compartir tienda ----------------------------------------------
    async function compartirTienda() {
        const mensaje = (negocio.plantilla_compartir || '¡Mira mi tienda! {enlace}')
            .replaceAll('{nombre}', negocio.nombre || '')
            .replaceAll('{enlace}', enlaceTiendaCompleto);

        // navigator.share abre el selector nativo del teléfono (WhatsApp,
        // Instagram, lo que tenga instalado) — es justo lo que se pidió,
        // en vez de armar un enlace fijo a una sola red.
        if (navigator.share) {
            try {
                await navigator.share({ text: mensaje });
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return; // la dueña canceló, no es error
                console.warn('[Panel] navigator.share falló, usando respaldo:', e);
            }
        }
        // Respaldo (escritorio o navegadores sin Web Share API): abre
        // WhatsApp sin un contacto fijo, así la dueña elige a quién mandarlo.
        window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
    }

    // ---- Reserva manual (clienta sin internet) -------------------------
    function abrirReservaManual() {
        setReservaManual({ cliente_nombre: '', cliente_telefono: '', notas: '', fecha_inicio: '', fecha_fin: '', items: {} });
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
            notificar('Ponle un nombre a la clienta.');
            return;
        }
        if (!reservaManual.fecha_inicio || !reservaManual.fecha_fin) {
            notificar('Elige las fechas del alquiler.');
            return;
        }
        const items = Object.entries(reservaManual.items).map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
        if (!items.length) {
            notificar('Elige al menos un artículo.');
            return;
        }

        setCreandoReserva(true);
        try {
            const pedido = await window.supaRpc('alquiler_crear_pedido_manual', {
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

    return (
        <main className="admin">
            <header className="admin-header">
                <div>
                    <a className="brand" href={enlaceTienda}>
                        {negocio.logo_url
                            ? <img src={negocio.logo_url} alt="" className="brand-logo" />
                            : <span>✦</span>}
                        {' '}{negocio.nombre}
                    </a>
                    <p>Panel del negocio</p>
                </div>
                <div className="admin-user">
                    <span>{email}</span>
                    <a href="#" onClick={(e) => { e.preventDefault(); salir(); }}>Salir</a>
                </div>
            </header>

            <div className="admin-shell">
                <aside className="admin-nav">
                    <button className={pestana === 'reservas' ? 'active' : ''}
                        onClick={() => setPestana('reservas')}>Reservas</button>
                    <button className={pestana === 'productos' ? 'active' : ''}
                        onClick={() => setPestana('productos')}>Artículos</button>
                    <button className={pestana === 'ocupacion' ? 'active' : ''}
                        onClick={() => setPestana('ocupacion')}>Ocupación</button>
                    <button className={pestana === 'config' ? 'active' : ''}
                        onClick={() => setPestana('config')}>Configuración</button>
                    <a href={enlaceTienda}>Ver mi tienda ↗</a>
                    <button onClick={compartirTienda}>Compartir tienda</button>
                </aside>

                <section className="admin-content">
                    {aviso && <p className="admin-notice">{aviso}</p>}

                    {/* ---- Reservas ---- */}
                    {pestana === 'reservas' && (
                        <>
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Agenda y disponibilidad</p>
                                    <h1>Reservas</h1>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {!reservaManual && (
                                        <button onClick={abrirReservaManual}>+ Reserva manual</button>
                                    )}
                                    <button onClick={cargarPedidos}>Actualizar</button>
                                </div>
                            </div>

                            {reservaManual && (
                                <form className="admin-card producto-form" onSubmit={crearReservaManual}>
                                    <h3>Reserva manual</h3>
                                    <p className="producto-form-nota">
                                        Para una clienta que acordó todo en persona o por teléfono, sin
                                        pasar por la tienda. Queda confirmada de una vez.
                                    </p>
                                    <div className="producto-form-fila">
                                        <label>Nombre de la clienta
                                            <input autoFocus required value={reservaManual.cliente_nombre}
                                                onChange={(e) => setReservaManual({ ...reservaManual, cliente_nombre: e.target.value })} />
                                        </label>
                                        <label>Teléfono (opcional)
                                            <input inputMode="tel" value={reservaManual.cliente_telefono}
                                                onChange={(e) => setReservaManual({ ...reservaManual, cliente_telefono: e.target.value })} />
                                        </label>
                                    </div>
                                    <div className="producto-form-fila">
                                        <label>Desde
                                            <input type="date" required value={reservaManual.fecha_inicio}
                                                onChange={(e) => setReservaManual({ ...reservaManual, fecha_inicio: e.target.value, fecha_fin: reservaManual.fecha_fin && reservaManual.fecha_fin < e.target.value ? e.target.value : reservaManual.fecha_fin })} />
                                        </label>
                                        <label>Hasta
                                            <input type="date" required min={reservaManual.fecha_inicio} value={reservaManual.fecha_fin}
                                                onChange={(e) => setReservaManual({ ...reservaManual, fecha_fin: e.target.value })} />
                                        </label>
                                    </div>
                                    <label className="wide">Artículos
                                        <div className="reserva-manual-items">
                                            {!productos.filter((p) => p.activo).length && (
                                                <p className="producto-form-nota">No hay artículos activos en el catálogo.</p>
                                            )}
                                            {productos.filter((p) => p.activo).map((producto) => (
                                                <div className="reserva-manual-item" key={producto.id}>
                                                    <span>{producto.nombre}</span>
                                                    <input type="number" min="0" inputMode="numeric"
                                                        placeholder="0"
                                                        value={reservaManual.items[producto.id] || ''}
                                                        onChange={(e) => cambiarCantidadReserva(producto.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                                                </div>
                                            ))}
                                        </div>
                                    </label>
                                    <label className="wide">Nota (opcional)
                                        <textarea value={reservaManual.notas}
                                            onChange={(e) => setReservaManual({ ...reservaManual, notas: e.target.value })} />
                                    </label>
                                    <div className="producto-form-acciones">
                                        <button type="submit" disabled={creandoReserva}>
                                            {creandoReserva ? 'Creando…' : 'Crear reserva confirmada'}
                                        </button>
                                        <button type="button" className="apagar" onClick={cancelarReservaManual}>
                                            Cancelar
                                        </button>
                                    </div>
                                </form>
                            )}

                            <TarjetaAvisos negocioId={negocio.id} />

                            <div className="admin-orders">
                                {!pedidos.length && (
                                    <div className="admin-card empty-orders">
                                        Todavía no hay solicitudes.
                                    </div>
                                )}
                                {pedidos.map((pedido) => (
                                    <article className="admin-order admin-card" key={pedido.id}>
                                        <div>
                                            <span className={`order-chip ${pedido.estado}`}>
                                                {ETIQUETA_ESTADO[pedido.estado] || pedido.estado}
                                            </span>
                                            <h3>{pedido.cliente_nombre}</h3>
                                            <p>{pedido.id} · {pedido.fecha_inicio} al {pedido.fecha_fin} · {pedido.dias} {pedido.dias === 1 ? 'día' : 'días'}</p>
                                            {pedido.cliente_telefono && (
                                                <p>📞 <a href={`tel:${pedido.cliente_telefono}`}>{pedido.cliente_telefono}</a></p>
                                            )}
                                            {pedido.notas && <p>📝 {pedido.notas}</p>}
                                        </div>
                                        <ul>
                                            {(pedido.alquiler_pedido_items || []).map((item) => (
                                                <li key={item.id}>{item.cantidad} × {item.producto_nombre}</li>
                                            ))}
                                        </ul>
                                        <strong>{dineroPanel(pedido.total)} {moneda}</strong>
                                        <div>
                                            {pedido.estado === 'pendiente' && (
                                                <button onClick={() => cambiarEstado(pedido, 'confirmado')}>Confirmar</button>
                                            )}
                                            {pedido.estado === 'confirmado' && (
                                                <button onClick={() => cambiarEstado(pedido, 'entregado')}>Entregada</button>
                                            )}
                                            {pedido.estado === 'entregado' && (
                                                <button onClick={() => cambiarEstado(pedido, 'devuelto')}>Devuelta</button>
                                            )}
                                            {pedido.estado !== 'cancelado' && pedido.estado !== 'devuelto' && (
                                                <button className="danger" onClick={() => cambiarEstado(pedido, 'cancelado')}>Cancelar</button>
                                            )}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </>
                    )}

                    {/* ---- Artículos ---- */}
                    {pestana === 'productos' && (
                        <>
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Tu inventario</p>
                                    <h1>Artículos</h1>
                                </div>
                                {!productoNuevo && (
                                    <button onClick={abrirFormularioProducto}>+ Nuevo artículo</button>
                                )}
                            </div>

                            {productoNuevo && (
                                <form className="admin-card producto-form" onSubmit={crearProducto}>
                                    <h3>Nuevo artículo</h3>
                                    <label>Nombre
                                        <input autoFocus required value={productoNuevo.nombre}
                                            onChange={(e) => setProductoNuevo({ ...productoNuevo, nombre: e.target.value })} />
                                    </label>
                                    <label className="wide">Descripción
                                        <textarea value={productoNuevo.descripcion}
                                            onChange={(e) => setProductoNuevo({ ...productoNuevo, descripcion: e.target.value })} />
                                    </label>
                                    <div className="producto-form-fila">
                                        <label>Categoría
                                            <input value={productoNuevo.categoria}
                                                onChange={(e) => setProductoNuevo({ ...productoNuevo, categoria: e.target.value })} />
                                        </label>
                                        <label>Precio por día
                                            <input type="number" min="0" inputMode="numeric" value={productoNuevo.precio_dia}
                                                onChange={(e) => setProductoNuevo({ ...productoNuevo, precio_dia: e.target.value })} />
                                        </label>
                                        <label>Cantidad
                                            <input type="number" min="0" inputMode="numeric" value={productoNuevo.cantidad}
                                                onChange={(e) => setProductoNuevo({ ...productoNuevo, cantidad: e.target.value })} />
                                        </label>
                                    </div>
                                    <p className="producto-form-nota">La foto se agrega después de crear el artículo.</p>
                                    <div className="producto-form-acciones">
                                        <button type="submit" disabled={creandoProducto}>
                                            {creandoProducto ? 'Creando…' : 'Crear artículo'}
                                        </button>
                                        <button type="button" className="apagar" onClick={cancelarFormularioProducto}>
                                            Cancelar
                                        </button>
                                    </div>
                                </form>
                            )}

                            <div className="admin-products">
                                {!productos.length && !productoNuevo && (
                                    <div className="admin-card empty-orders">
                                        Todavía no tienes artículos. Pulsa «Nuevo artículo» para empezar.
                                    </div>
                                )}
                                {productos.map((producto) => {
                                    const disponibleAhora = Math.max(0, (producto.cantidad || 0) - (producto.fuera_de_servicio || 0));
                                    return (
                                    <article className="admin-product admin-card" key={producto.id}
                                        style={producto.activo ? undefined : { opacity: .6 }}>
                                        <img src={producto.foto_url || 'images/producto-arco.png'} alt="" />
                                        <div className="product-fields">
                                            <input value={producto.nombre}
                                                onChange={(e) => setProductos((p) => p.map((x) =>
                                                    x.id === producto.id ? { ...x, nombre: e.target.value } : x))} />
                                            <textarea placeholder="Descripción corta" value={producto.descripcion}
                                                onChange={(e) => setProductos((p) => p.map((x) =>
                                                    x.id === producto.id ? { ...x, descripcion: e.target.value } : x))} />
                                            <div>
                                                <label>Categoría
                                                    <input value={producto.categoria}
                                                        onChange={(e) => setProductos((p) => p.map((x) =>
                                                            x.id === producto.id ? { ...x, categoria: e.target.value } : x))} />
                                                </label>
                                                <label>Precio por día
                                                    <input type="number" min="0" inputMode="numeric" value={producto.precio_dia}
                                                        onChange={(e) => setProductos((p) => p.map((x) =>
                                                            x.id === producto.id ? { ...x, precio_dia: e.target.value } : x))} />
                                                </label>
                                                <label>Cantidad total
                                                    <input type="number" min="0" inputMode="numeric" value={producto.cantidad}
                                                        onChange={(e) => setProductos((p) => p.map((x) =>
                                                            x.id === producto.id ? { ...x, cantidad: e.target.value } : x))} />
                                                </label>
                                                <label>Fuera de servicio
                                                    <input type="number" min="0" inputMode="numeric" value={producto.fuera_de_servicio || 0}
                                                        onChange={(e) => setProductos((p) => p.map((x) =>
                                                            x.id === producto.id ? { ...x, fuera_de_servicio: e.target.value } : x))} />
                                                </label>
                                            </div>
                                            <p className="producto-disponible-ahora">
                                                ● {disponibleAhora} de {producto.cantidad || 0} disponibles ahora
                                                {producto.fuera_de_servicio > 0 && ` (${producto.fuera_de_servicio} fuera de servicio)`}
                                            </p>
                                            <label className="upload">
                                                {subiendo === producto.id ? 'Subiendo foto…' : 'Cambiar foto'}
                                                <input type="file" accept="image/*"
                                                    disabled={subiendo === producto.id}
                                                    onChange={(e) => subirFoto(e, producto)} />
                                            </label>
                                        </div>
                                        <div className="product-admin-actions">
                                            <label>
                                                <input type="checkbox" checked={producto.activo}
                                                    onChange={(e) => setProductos((p) => p.map((x) =>
                                                        x.id === producto.id ? { ...x, activo: e.target.checked } : x))} />
                                                {' '}Visible
                                            </label>
                                            <button onClick={() => guardarProducto(producto)}>Guardar</button>
                                            <button className="danger" onClick={() => ocultarProducto(producto)}>Quitar</button>
                                        </div>
                                    </article>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* ---- Ocupación ---- */}
                    {pestana === 'ocupacion' && (
                        <>
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Qué te está produciendo</p>
                                    <h1>Ocupación</h1>
                                </div>
                            </div>
                            <div className="admin-card push-card">
                                <p>
                                    Días que estuvo alquilado cada artículo en el período elegido.
                                    Lo de arriba es lo que más te produce; lo de abajo, lo que te
                                    está ocupando espacio.
                                </p>
                                <div className="dates" style={{ maxWidth: '360px' }}>
                                    <label>Desde
                                        <input type="date" value={rango.desde}
                                            onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
                                    </label>
                                    <label>Hasta
                                        <input type="date" value={rango.hasta} min={rango.desde}
                                            onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
                                    </label>
                                </div>
                            </div>
                            <div className="admin-card ocupacion-tabla">
                                {!ocupacion.length ? (
                                    <p className="ocupacion-vacia">
                                        Todavía no hay reservas confirmadas en este período.
                                    </p>
                                ) : (
                                    <div className="ocupacion-scroll">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Artículo</th>
                                                    <th className="num">Veces</th>
                                                    <th className="num">Días</th>
                                                    <th className="num">Ingreso</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ocupacion.map((fila) => (
                                                    <tr key={fila.producto_id}>
                                                        <td>{fila.producto_nombre}</td>
                                                        <td className="num">{fila.veces_alquilado}</td>
                                                        <td className="num">{fila.dias_alquilado}</td>
                                                        <td className="num">{dineroPanel(fila.ingreso)} {moneda}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* ---- Configuración ---- */}
                    {pestana === 'config' && (
                        <>
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Personaliza tu tienda</p>
                                    <h1>Configuración</h1>
                                </div>
                                <button onClick={guardarConfiguracion}>Guardar cambios</button>
                            </div>
                            <div className="admin-card settings-form">
                                <label className="wide">Logo de tu negocio
                                    <div className="logo-picker">
                                        {negocio.logo_url && <img src={negocio.logo_url} alt="" className="logo-preview" />}
                                        <label className="upload">
                                            {subiendoLogo ? 'Subiendo…' : (negocio.logo_url ? 'Cambiar logo' : 'Subir logo')}
                                            <input type="file" accept="image/*" disabled={subiendoLogo} onChange={subirLogo} />
                                        </label>
                                    </div>
                                </label>
                                <label>Nombre del negocio
                                    <input value={negocio.nombre}
                                        onChange={(e) => setNegocio({ ...negocio, nombre: e.target.value })} />
                                </label>
                                <label>WhatsApp del negocio
                                    <input placeholder="Ej. 5351234567" inputMode="tel" value={negocio.whatsapp}
                                        onChange={(e) => setNegocio({ ...negocio, whatsapp: e.target.value })} />
                                </label>
                                <label>Título de bienvenida
                                    <input value={negocio.titulo_bienvenida}
                                        onChange={(e) => setNegocio({ ...negocio, titulo_bienvenida: e.target.value })} />
                                </label>
                                <label>Moneda
                                    <input value={negocio.moneda}
                                        onChange={(e) => setNegocio({ ...negocio, moneda: e.target.value })} />
                                </label>
                                <label className="wide">Mensaje de bienvenida
                                    <textarea value={negocio.texto_bienvenida}
                                        onChange={(e) => setNegocio({ ...negocio, texto_bienvenida: e.target.value })} />
                                </label>
                                <label>Mínimo de días por alquiler
                                    <input type="number" min="1" inputMode="numeric" value={negocio.dias_minimos}
                                        onChange={(e) => setNegocio({ ...negocio, dias_minimos: e.target.value })} />
                                </label>
                                <label>Instagram
                                    <input placeholder="https://instagram.com/..." value={negocio.instagram_url}
                                        onChange={(e) => setNegocio({ ...negocio, instagram_url: e.target.value })} />
                                </label>
                                <label>Facebook
                                    <input placeholder="https://facebook.com/..." value={negocio.facebook_url}
                                        onChange={(e) => setNegocio({ ...negocio, facebook_url: e.target.value })} />
                                </label>
                                <label className="wide">Mensaje de confirmación (a la clienta)
                                    <textarea value={negocio.plantilla_confirmacion || ''}
                                        onChange={(e) => setNegocio({ ...negocio, plantilla_confirmacion: e.target.value })} />
                                    <small>Variables disponibles: {'{nombre}'}, {'{pedido_id}'}, {'{fechas}'}, {'{total}'}. Se abre por WhatsApp al confirmar una reserva.</small>
                                </label>
                                <label className="wide">Mensaje para compartir tu tienda
                                    <textarea value={negocio.plantilla_compartir || ''}
                                        onChange={(e) => setNegocio({ ...negocio, plantilla_compartir: e.target.value })} />
                                    <small>Variables disponibles: {'{nombre}'}, {'{enlace}'}. Se usa en el botón "Compartir tienda".</small>
                                </label>
                                <label className="wide">Mensaje de solicitud (de la clienta a ti)
                                    <textarea value={negocio.plantilla_solicitud || ''}
                                        onChange={(e) => setNegocio({ ...negocio, plantilla_solicitud: e.target.value })} />
                                    <small>Variables disponibles: {'{nombre}'}, {'{fechas}'}, {'{items}'}, {'{total}'}, {'{telefono}'}, {'{notas}'}, {'{pedido_id}'}. Es el mensaje que le llega a WhatsApp cuando una clienta pide un alquiler desde tu tienda.</small>
                                </label>
                                <label className="wide">Enlace de tu tienda
                                    <input readOnly value={enlaceTiendaCompleto}
                                        onFocus={(e) => e.target.select()} />
                                </label>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </main>
    );
}

window.Panel = Panel;
