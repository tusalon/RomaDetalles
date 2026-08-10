// sw.js — Service worker de RomaDetalles
//
// Hace dos cosas: recibir los avisos push del dueño, y guardar en caché lo
// justo para que la tienda abra rápido en conexiones lentas.
//
// REGLA DE ORO al editar cualquier archivo cacheado: subir CACHE_NAME abajo
// y el `?v=` de ese archivo en los HTML. Si no, los teléfonos siguen
// sirviendo la versión vieja de la caché y el cambio no llega. Es el mismo
// problema que ya conoces de rservasroma.
const CACHE_NAME = 'romadetalles-v14';

// Solo lo que de verdad conviene precargar. Las fotos de productos viven en
// Cloudinary (CDN) y no se cachean aquí: son grandes y cambian seguido.
const PRECARGA = [
    'index.html',
    'styles.css',
    'fonts/Fraunces-variable.woff2',
    'utils/supabase-config.js',
    'utils/storage.js',
    'vendor/react.production.min.js',
    'vendor/react-dom.production.min.js',
    'manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // addAll falla completo si un solo archivo falla; uno por uno es
            // más tolerante y evita que un 404 tumbe toda la instalación.
            .then((cache) => Promise.allSettled(PRECARGA.map((url) => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((nombres) => Promise.all(
                nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Nunca cachear Supabase ni Cloudinary: disponibilidad, pedidos y
    // catálogo tienen que ser siempre datos frescos. Servir un stock viejo
    // desde la caché haría que la clienta pidiera algo ya alquilado.
    if (url.hostname.includes('supabase.co') || url.hostname.includes('cloudinary.com')) {
        return;
    }

    // Los scripts de la app: red primero, caché como red de seguridad. Así
    // un arreglo llega sin depender de que suban el ?v=, y sin conexión
    // sigue abriendo.
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
        event.respondWith(
            fetch(request)
                .then((respuesta) => {
                    const copia = respuesta.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
                    return respuesta;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // El resto (iconos, css): caché primero.
    event.respondWith(
        caches.match(request).then((cacheada) => cacheada || fetch(request))
    );
});

// ---------------------------------------------------------------------
// Avisos push
// ---------------------------------------------------------------------
self.addEventListener('push', (event) => {
    let datos = {};
    try {
        datos = event.data ? event.data.json() : {};
    } catch {
        datos = { title: 'RomaDetalles', body: event.data?.text() || 'Tienes un aviso nuevo' };
    }

    // `enviar-web-push` manda {title, body, url}; algunos servicios lo
    // envuelven en `notification`. Aceptamos las dos formas.
    const notif = datos.notification || datos;
    const titulo = notif.title || 'RomaDetalles';
    const cuerpo = notif.body || 'Tienes un pedido nuevo';
    const destino = notif.url || datos.url || 'admin.html';

    event.waitUntil(
        self.registration.showNotification(titulo, {
            body: cuerpo,
            icon: 'icons/icon-192x192.png',
            badge: 'icons/icon-192x192.png',
            data: { url: destino },
            // Un pedido nuevo merece insistir un poco: en un negocio de
            // alquiler la clienta suele estar esperando respuesta.
            requireInteraction: false,
            tag: 'pedido-alquiler',
            renotify: true
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const destino = event.notification.data?.url || 'admin.html';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientes) => {
                // Si el panel ya está abierto, lo traemos al frente en vez
                // de abrir otra pestaña encima.
                for (const cliente of clientes) {
                    if (cliente.url.includes('admin.html') && 'focus' in cliente) {
                        cliente.navigate(destino).catch(() => {});
                        return cliente.focus();
                    }
                }
                return self.clients.openWindow(destino);
            })
    );
});
