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

// "sábado 15 de agosto" en vez de "2026-08-15". Mediodía UTC como ancla,
// igual que diaAntes() en Tienda.js, para que el texto no se corra un
// día por el huso horario.
function fechaLargaPanel(iso) {
    if (!iso) return '';
    return new Date(`${iso}T12:00:00Z`)
        .toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
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

// Debe reproducir exactamente el default de la columna en
// sql/03-mejoras-panel.sql (chr(10) allí == '\n' aquí).
const PLANTILLA_CONFIRMACION_POR_DEFECTO =
    'Hola {nombre}, tu pedido quedó confirmado ✅\n' +
    '📅 {fechas}\n' +
    '💰 Total: {total}\n' +
    'Cualquier duda me avisas. ¡Gracias por tu preferencia!';

// Rellena la plantilla de confirmación con los datos reales del pedido.
// Variables soportadas: {nombre} {pedido_id} {fechas} {total}
function armarMensajeConfirmacion(plantilla, pedido, moneda) {
    // El backfill de la migración a día de evento puso fecha_evento =
    // fecha_inicio en todo pedido viejo, incluyendo alquileres de varios
    // días (dias > 1). Para esos hay que seguir mostrando el rango real
    // (fecha_inicio al fecha_fin), o la clienta pierde de vista cuándo
    // debe devolver el artículo.
    const fechas = pedido.dias > 1
        ? `${fechaLargaPanel(pedido.fecha_inicio)} al ${fechaLargaPanel(pedido.fecha_fin)} (${pedido.dias} días)`
        : fechaLargaPanel(pedido.fecha_evento || pedido.fecha_inicio);
    const total = `${dineroPanel(pedido.total)} ${moneda}`;
    const base = plantilla && plantilla.trim() ? plantilla : PLANTILLA_CONFIRMACION_POR_DEFECTO;
    return base
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
        return nombre ? `${nombre} no tiene stock suficiente ese día.` : 'No hay stock suficiente ese día.';
    }
    if (texto.includes('PERIODO_INVALIDO')) return 'Ese día no es válido.';
    if (texto.includes('PEDIDO_VACIO')) return 'Elige al menos un artículo.';
    if (texto.includes('PRODUCTO_NO_EXISTE')) return 'Uno de los artículos ya no existe.';
    if (texto.includes('NO_AUTORIZADO')) return 'No tienes permiso para crear reservas en este negocio.';
    if (texto.includes('RESERVA_NO_EDITABLE')) return 'Esta reserva ya no se puede editar. Cancélala y haz otra.';
    if (texto.includes('FECHA_PASADA')) return 'No puedes mover la reserva a un día que ya pasó.';
    if (texto.includes('PEDIDO_NO_EXISTE')) return 'Esa reserva ya no existe.';
    console.error('[Panel] error de reserva no reconocido:', texto);
    return 'No se pudo guardar la reserva. Inténtalo de nuevo.';
}

function cumpleFiltroReserva(estado, filtro) {
    if (filtro === 'todas') return true;
    if (filtro === 'pendientes') return estado === 'pendiente' || estado === 'confirmado';
    if (filtro === 'completadas') return estado === 'entregado' || estado === 'devuelto';
    if (filtro === 'canceladas') return estado === 'cancelado';
    return true;
}

const NOMBRES_MES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

// Cuadrícula del mes: null para los huecos antes del día 1 (para que
// el primer día caiga en su columna real de domingo a sábado).
function diasDelMesPanel(mesStr) {
    const [anio, mes] = mesStr.split('-').map(Number);
    const primerDia = new Date(anio, mes - 1, 1);
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const celdas = [];
    for (let i = 0; i < primerDia.getDay(); i++) celdas.push(null);
    for (let d = 1; d <= ultimoDia; d++) {
        celdas.push(`${mesStr}-${String(d).padStart(2, '0')}`);
    }
    return celdas;
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
// Tarjeta de una reserva — la usan tanto la Lista como el Calendario
// ---------------------------------------------------------------------
function TarjetaReserva({ pedido, moneda, onCambiarEstado, onEliminar, onEditar }) {
    const puedeEliminar =
        pedido.estado === 'entregado' || pedido.estado === 'devuelto' || pedido.estado === 'cancelado';
    // Una vez entregada o devuelta, editar ya no describiría lo que pasó.
    const puedeEditar = pedido.estado === 'pendiente' || pedido.estado === 'confirmado';

    return (
        <article className="admin-order admin-card">
            <div>
                <span className={`order-chip ${pedido.estado}`}>
                    {ETIQUETA_ESTADO[pedido.estado] || pedido.estado}
                </span>
                <h3>{pedido.cliente_nombre}</h3>
                {pedido.dias > 1
                    ? <p>{pedido.id} · Reserva anterior: {fechaLargaPanel(pedido.fecha_inicio)} al {fechaLargaPanel(pedido.fecha_fin)} · {pedido.dias} días</p>
                    : <p>{pedido.id} · Evento: {fechaLargaPanel(pedido.fecha_evento || pedido.fecha_inicio)}</p>}
                {pedido.dias <= 1 && (
                    <p>Recoge el {fechaLargaPanel(pedido.fecha_inicio)} después de las 5:00 PM</p>
                )}
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
            <div className="order-importes">
                <strong>{dineroPanel(pedido.total)} {moneda}</strong>
                {Number(pedido.anticipo) > 0 && (
                    <small>Anticipo: {dineroPanel(pedido.anticipo)} {moneda}</small>
                )}
            </div>
            <div>
                {pedido.estado === 'pendiente' && (
                    <button onClick={() => onCambiarEstado(pedido, 'confirmado')}>Confirmar</button>
                )}
                {pedido.estado === 'confirmado' && (
                    <button onClick={() => onCambiarEstado(pedido, 'entregado')}>Entregada</button>
                )}
                {pedido.estado === 'entregado' && (
                    <button onClick={() => onCambiarEstado(pedido, 'devuelto')}>Devuelta</button>
                )}
                {puedeEditar && (
                    <button className="secondary" onClick={() => onEditar(pedido)}>Editar</button>
                )}
                {pedido.estado !== 'cancelado' && pedido.estado !== 'devuelto' && (
                    <button className="danger" onClick={() => onCambiarEstado(pedido, 'cancelado')}>Cancelar</button>
                )}
                {puedeEliminar && (
                    <button className="danger" onClick={() => onEliminar(pedido)}>Eliminar</button>
                )}
            </div>
        </article>
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
    const [filtroReservas, setFiltroReservas] = useState('todas');
    const [vistaReservas, setVistaReservas] = useState('lista');
    const [mesCalendario, setMesCalendario] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [pedidosMes, setPedidosMes] = useState([]);
    const [diaSeleccionado, setDiaSeleccionado] = useState(null);
    const [creandoReserva, setCreandoReserva] = useState(false);
    const [galeria, setGaleria] = useState([]);
    const [subiendoFotoGaleria, setSubiendoFotoGaleria] = useState(false);

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
                `alquiler_pedidos?negocio_id=eq.${negocio.id}&oculto=eq.false` +
                `&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,` +
                `alquiler_pedido_items(id,producto_id,producto_nombre,cantidad)` +
                `&order=creado_en.desc&limit=200`
            );
            setPedidos(filas);
        } catch (e) {
            console.error('[Panel] error cargando pedidos:', e);
            notificar('No se pudieron cargar las reservas.');
        }
    }, [negocio.id]);

    const cargarPedidosDelMes = useCallback(async () => {
        const [anio, mes] = mesCalendario.split('-').map(Number);
        const desde = `${mesCalendario}-01`;
        const hasta = `${mesCalendario}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
        try {
            const filas = await window.supaGet(
                `alquiler_pedidos?negocio_id=eq.${negocio.id}&oculto=eq.false` +
                `&fecha_evento=gte.${desde}&fecha_evento=lte.${hasta}` +
                `&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,` +
                `alquiler_pedido_items(id,producto_id,producto_nombre,cantidad)` +
                `&order=fecha_evento.asc`
            );
            setPedidosMes(filas);
        } catch (e) {
            console.error('[Panel] error cargando calendario:', e);
            notificar('No se pudo cargar el calendario.');
        }
    }, [negocio.id, mesCalendario]);

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

    const cargarGaleria = useCallback(async () => {
        try {
            setGaleria(await window.supaGet(
                `alquiler_galeria?negocio_id=eq.${negocio.id}` +
                `&select=id,imagen_url,descripcion,creado_en&order=creado_en.desc`
            ));
        } catch (e) {
            console.error('[Panel] error cargando galería:', e);
            notificar('No se pudo cargar la galería.');
        }
    }, [negocio.id]);

    useEffect(() => { cargarProductos(); cargarPedidos(); }, [cargarProductos, cargarPedidos]);
    useEffect(() => {
        if (pestana === 'reservas' && vistaReservas === 'calendario') cargarPedidosDelMes();
    }, [pestana, vistaReservas, cargarPedidosDelMes]);
    useEffect(() => { if (pestana === 'ocupacion') cargarOcupacion(); }, [pestana, cargarOcupacion]);
    useEffect(() => { if (pestana === 'galeria') cargarGaleria(); }, [pestana, cargarGaleria]);

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
                        anticipo_porciento: Math.min(100, Math.max(0, Math.floor(Number(negocio.anticipo_porciento) || 0))),
                        anticipo_redondear: negocio.anticipo_redondear !== false,
                        pago_tarjeta: negocio.pago_tarjeta || '',
                        pago_telefono: negocio.pago_telefono || '',
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
            } else notificar('No se pudo quitar el artículo.');
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

    // ---- Galería de muestras -------------------------------------------
    async function agregarFotoGaleria(evento) {
        const archivo = evento.target.files?.[0];
        if (!archivo) return;
        setSubiendoFotoGaleria(true);
        const subida = await window.subirFotoGaleria(archivo, negocio.id);
        setSubiendoFotoGaleria(false);
        if (!subida) return;

        try {
            const res = await fetch(`${window.SUPABASE_URL}/rest/v1/alquiler_galeria`, {
                method: 'POST',
                headers: window.supaHeaders({ Prefer: 'return=representation' }),
                body: JSON.stringify({ negocio_id: negocio.id, imagen_url: subida.url, descripcion: '' })
            });
            if (!res.ok) throw new Error(await res.text());
            const [creada] = await res.json();
            setGaleria((actual) => [creada, ...actual]);
            notificar('Foto agregada a la galería.');
        } catch (e) {
            console.error('[Panel] error guardando foto de galería:', e);
            notificar('La foto se subió pero no se pudo guardar. Inténtalo de nuevo.');
        }
    }

    async function guardarDescripcionGaleria(foto) {
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_galeria?id=eq.${foto.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ descripcion: foto.descripcion })
                }
            );
            notificar(res.ok ? 'Descripción guardada.' : 'No se pudo guardar.');
        } catch (e) {
            console.error('[Panel] error guardando descripción:', e);
            notificar('No se pudo guardar.');
        }
    }

    async function eliminarFotoGaleria(foto) {
        if (!window.confirm('¿Quitar esta foto de la galería?')) return;
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_galeria?id=eq.${foto.id}`,
                { method: 'DELETE', headers: window.supaHeaders({ Prefer: 'return=minimal' }) }
            );
            if (res.ok) {
                setGaleria((actual) => actual.filter((f) => f.id !== foto.id));
                notificar('Foto eliminada.');
            } else notificar('No se pudo eliminar la foto.');
        } catch (e) {
            console.error('[Panel] error eliminando foto de galería:', e);
        }
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
            setPedidosMes((actual) => actual.map((p) =>
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

    async function eliminarReserva(pedido) {
        if (!window.confirm('¿Quitar esta reserva de la lista? No se borra del historial de Ocupación.')) return;
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_pedidos?id=eq.${pedido.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ oculto: true, actualizado_en: new Date().toISOString() })
                }
            );
            if (res.ok) {
                setPedidos((actual) => actual.filter((p) => p.id !== pedido.id));
                setPedidosMes((actual) => actual.filter((p) => p.id !== pedido.id));
                notificar('Reserva quitada de la lista.');
            } else {
                notificar('No se pudo eliminar la reserva.');
            }
        } catch (e) {
            console.error('[Panel] error eliminando reserva:', e);
            notificar('No se pudo eliminar la reserva.');
        }
    }

    function cambiarMesCalendario(delta) {
        const [anio, mes] = mesCalendario.split('-').map(Number);
        const d = new Date(anio, mes - 1 + delta, 1);
        setMesCalendario(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        setDiaSeleccionado(null);
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

    // ---- Reserva manual (clienta sin internet) y edición ---------------
    // El mismo formulario sirve para las dos cosas: si trae `id`, está
    // editando una reserva que ya existe; si no, está creando una nueva.
    function abrirReservaManual() {
        setReservaManual({ cliente_nombre: '', cliente_telefono: '', notas: '', fecha_evento: '', items: {} });
    }

    function abrirEdicionReserva(pedido) {
        const items = {};
        (pedido.alquiler_pedido_items || []).forEach((item) => {
            if (item.producto_id) items[item.producto_id] = item.cantidad;
        });
        setReservaManual({
            id: pedido.id,
            cliente_nombre: pedido.cliente_nombre || '',
            cliente_telefono: pedido.cliente_telefono || '',
            notas: pedido.notas || '',
            fecha_evento: pedido.fecha_evento || pedido.fecha_inicio || '',
            items
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
            notificar('Ponle un nombre a la clienta.');
            return;
        }
        if (!reservaManual.fecha_evento) {
            notificar('Elige el día del evento.');
            return;
        }
        const items = Object.entries(reservaManual.items).map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
        if (!items.length) {
            notificar('Elige al menos un artículo.');
            return;
        }
        const editando = Boolean(reservaManual.id);

        setCreandoReserva(true);
        try {
            if (editando) {
                await window.supaRpc('alquiler_editar_pedido', {
                    p_pedido: reservaManual.id,
                    p_nombre: reservaManual.cliente_nombre.trim(),
                    p_telefono: reservaManual.cliente_telefono.trim(),
                    p_notas: reservaManual.notas.trim(),
                    p_evento: reservaManual.fecha_evento,
                    p_items: items
                });
                notificar(`Reserva ${reservaManual.id} actualizada.`);
            } else {
                const pedido = await window.supaRpc('alquiler_crear_pedido_manual', {
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
            // El total, el anticipo y las fechas los recalcula Postgres:
            // se recargan las dos vistas en vez de adivinarlos aquí.
            cargarPedidos();
            if (vistaReservas === 'calendario') cargarPedidosDelMes();
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
                    <button className={pestana === 'galeria' ? 'active' : ''}
                        onClick={() => setPestana('galeria')}>Galería</button>
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
                                    <div className="vista-toggle">
                                        <button className={vistaReservas === 'lista' ? 'active' : ''}
                                            onClick={() => setVistaReservas('lista')}>Lista</button>
                                        <button className={vistaReservas === 'calendario' ? 'active' : ''}
                                            onClick={() => setVistaReservas('calendario')}>Calendario</button>
                                    </div>
                                    {!reservaManual && (
                                        <button onClick={abrirReservaManual}>+ Reserva manual</button>
                                    )}
                                    <button onClick={vistaReservas === 'calendario' ? cargarPedidosDelMes : cargarPedidos}>
                                        Actualizar
                                    </button>
                                </div>
                            </div>

                            {reservaManual && (
                                <form className="admin-card producto-form" onSubmit={guardarReserva}>
                                    <h3>{reservaManual.id ? `Editar reserva ${reservaManual.id}` : 'Reserva manual'}</h3>
                                    <p className="producto-form-nota">
                                        {reservaManual.id
                                            ? 'Corrige lo que haga falta. El total y el anticipo se recalculan solos, y el día nuevo se comprueba contra el stock.'
                                            : 'Para una clienta que acordó todo en persona o por teléfono, sin pasar por la tienda. Queda confirmada de una vez.'}
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
                                        <label>Día del evento
                                            <input type="date" required value={reservaManual.fecha_evento}
                                                onChange={(e) => setReservaManual({ ...reservaManual, fecha_evento: e.target.value })} />
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
                                            {creandoReserva
                                                ? 'Guardando…'
                                                : (reservaManual.id ? 'Guardar cambios' : 'Crear reserva confirmada')}
                                        </button>
                                        <button type="button" className="apagar" onClick={cancelarReservaManual}>
                                            Cancelar
                                        </button>
                                    </div>
                                </form>
                            )}

                            <TarjetaAvisos negocioId={negocio.id} />

                            <div className="reserva-filtros">
                                {[
                                    ['todas', 'Todas'],
                                    ['pendientes', 'Pendientes'],
                                    ['completadas', 'Completadas'],
                                    ['canceladas', 'Canceladas']
                                ].map(([valor, etiqueta]) => (
                                    <button key={valor}
                                        className={filtroReservas === valor ? 'active' : ''}
                                        onClick={() => setFiltroReservas(valor)}>
                                        {etiqueta}
                                    </button>
                                ))}
                            </div>

                            {vistaReservas === 'lista' ? (
                                <div className="admin-orders">
                                    {!pedidos.filter((p) => cumpleFiltroReserva(p.estado, filtroReservas)).length && (
                                        <div className="admin-card empty-orders">
                                            {pedidos.length ? 'Ninguna reserva con ese filtro.' : 'Todavía no hay solicitudes.'}
                                        </div>
                                    )}
                                    {pedidos
                                        .filter((p) => cumpleFiltroReserva(p.estado, filtroReservas))
                                        .map((pedido) => (
                                            <TarjetaReserva key={pedido.id} pedido={pedido} moneda={moneda}
                                                onCambiarEstado={cambiarEstado} onEliminar={eliminarReserva}
                                                onEditar={abrirEdicionReserva} />
                                        ))}
                                </div>
                            ) : (
                                <>
                                    <div className="calendario-nav">
                                        <button onClick={() => cambiarMesCalendario(-1)}>←</button>
                                        <strong>
                                            {NOMBRES_MES[Number(mesCalendario.split('-')[1]) - 1]} {mesCalendario.split('-')[0]}
                                        </strong>
                                        <button onClick={() => cambiarMesCalendario(1)}>→</button>
                                    </div>
                                    <div className="calendario-grid">
                                        {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => (
                                            <span className="calendario-dow" key={i}>{d}</span>
                                        ))}
                                        {diasDelMesPanel(mesCalendario).map((dia, i) => {
                                            const enEsteDia = dia ? pedidosMes.filter((p) => p.fecha_evento === dia) : [];
                                            return (
                                                <button key={i}
                                                    className={`calendario-dia${dia ? '' : ' vacio'}${diaSeleccionado === dia ? ' activo' : ''}`}
                                                    disabled={!dia}
                                                    onClick={() => setDiaSeleccionado(dia)}>
                                                    {dia && <span>{Number(dia.split('-')[2])}</span>}
                                                    {enEsteDia.length > 0 && <b>{enEsteDia.length}</b>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {diaSeleccionado && (
                                        <div className="admin-orders" style={{ marginTop: '20px' }}>
                                            <h3>{fechaLargaPanel(diaSeleccionado)}</h3>
                                            {!pedidosMes.filter((p) => p.fecha_evento === diaSeleccionado).length && (
                                                <div className="admin-card empty-orders">
                                                    No hay reservas ese día.
                                                </div>
                                            )}
                                            {pedidosMes
                                                .filter((p) => p.fecha_evento === diaSeleccionado)
                                                .map((pedido) => (
                                                    <TarjetaReserva key={pedido.id} pedido={pedido} moneda={moneda}
                                                        onCambiarEstado={cambiarEstado} onEliminar={eliminarReserva}
                                                        onEditar={abrirEdicionReserva} />
                                                ))}
                                        </div>
                                    )}
                                </>
                            )}
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
                                        <label>Precio por evento
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
                                                <label>Precio por evento
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
                                    está ocupando espacio. Cada evento cuenta 2 días: la tarde que
                                    se recoge y la mañana que se entrega.
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

                    {/* ---- Galería ---- */}
                    {pestana === 'galeria' && (
                        <>
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Tu portafolio</p>
                                    <h1>Galería</h1>
                                </div>
                                <label className="galeria-add">
                                    {subiendoFotoGaleria ? 'Subiendo…' : '+ Agregar foto'}
                                    <input type="file" accept="image/*" disabled={subiendoFotoGaleria}
                                        onChange={agregarFotoGaleria} />
                                </label>
                            </div>
                            <p className="producto-form-nota">
                                Estas fotos se ven en tu tienda pública, en la sección
                                "Nuestros trabajos" — son la prueba de lo que ya has hecho.
                            </p>
                            <div className="admin-galeria">
                                {!galeria.length && (
                                    <div className="admin-card empty-orders">
                                        Todavía no tienes fotos. Pulsa «+ Agregar foto» para empezar.
                                    </div>
                                )}
                                {galeria.map((foto) => (
                                    <article className="admin-galeria-item admin-card" key={foto.id}>
                                        <img src={foto.imagen_url} alt="" />
                                        <textarea placeholder="Descripción corta (opcional)"
                                            value={foto.descripcion}
                                            onChange={(e) => setGaleria((actual) => actual.map((f) =>
                                                f.id === foto.id ? { ...f, descripcion: e.target.value } : f))} />
                                        <div className="admin-galeria-item-acciones">
                                            <button onClick={() => guardarDescripcionGaleria(foto)}>Guardar</button>
                                            <button className="danger" onClick={() => eliminarFotoGaleria(foto)}>Eliminar</button>
                                        </div>
                                    </article>
                                ))}
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
                                {Number(negocio.anticipo_porciento) > 0 && !negocio.pago_tarjeta && (
                                    <p className="config-warning">
                                        Configuraste un anticipo pero no una tarjeta para cobrarlo — tus clientas no sabrán a dónde transferir.
                                    </p>
                                )}
                                {Number(negocio.anticipo_porciento) > 0 && negocio.plantilla_solicitud &&
                                    !negocio.plantilla_solicitud.includes('{anticipo}') && !negocio.plantilla_solicitud.includes('{tarjeta}') && (
                                    <p className="config-warning">
                                        Tu mensaje de solicitud personalizado no menciona el anticipo — tus clientas no lo verán en WhatsApp. Agrega {'{anticipo}'} donde quieras que aparezca.
                                    </p>
                                )}
                                <label>Anticipo (%)
                                    <input type="number" min="0" max="100" inputMode="numeric"
                                        value={negocio.anticipo_porciento ?? 0}
                                        onChange={(e) => setNegocio({ ...negocio, anticipo_porciento: e.target.value })} />
                                    <small>0 = sin anticipo. La clienta ve cuánto paga ahora y cuánto al recoger.</small>
                                </label>
                                <label className="check-linea">
                                    <input type="checkbox"
                                        checked={negocio.anticipo_redondear !== false}
                                        onChange={(e) => setNegocio({ ...negocio, anticipo_redondear: e.target.checked })} />
                                    {' '}Redondear el anticipo a la centena
                                </label>
                                <label>Tarjeta para el anticipo
                                    <input placeholder="Ej. 9227 0699 1234 5678" inputMode="numeric"
                                        value={negocio.pago_tarjeta || ''}
                                        onChange={(e) => setNegocio({ ...negocio, pago_tarjeta: e.target.value })} />
                                </label>
                                <label>Teléfono asociado a la tarjeta
                                    <input placeholder="Ej. 53842336" inputMode="tel"
                                        value={negocio.pago_telefono || ''}
                                        onChange={(e) => setNegocio({ ...negocio, pago_telefono: e.target.value })} />
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
                                    <small>Variables disponibles: {'{nombre}'}, {'{fechas}'} (el día del evento), {'{items}'}, {'{total}'}, {'{anticipo}'}, {'{tarjeta}'}, {'{telefono_pago}'}, {'{telefono}'}, {'{notas}'}, {'{pedido_id}'}. {'{telefono}'}, {'{notas}'} y {'{anticipo}'} ya vienen con su propio emoji y desaparecen del todo si el dato no aplica — ponlas en su propia línea. Es el mensaje que le llega a WhatsApp cuando una clienta pide un alquiler desde tu tienda.</small>
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
