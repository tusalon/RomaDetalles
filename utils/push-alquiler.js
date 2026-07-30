// utils/push-alquiler.js — Avisos al dueño del negocio de alquiler.
//
// Versión enfocada del push de rservasroma: allí hay tres destinatarios
// (admin, profesional, clienta) y ~1200 líneas de casos; aquí solo hace
// falta uno — el dueño, que quiere enterarse cuando entra un pedido.
//
// Guarda la suscripción en `push_suscripciones` con role='admin' y el
// negocio_id del negocio de alquiler. La Edge Function `enviar-web-push`
// (compartida con rservasroma) es la que luego entrega el aviso.
//
// OJO: para que `negocio_id` acepte un id de `alquiler_negocios` hay que
// haber corrido sql/02-push-compartido.sql, que quita la llave foránea
// contra la tabla `negocios`. Sin eso los inserts dan 23503.

(function () {
    'use strict';

    const TABLA = 'push_suscripciones';

    /** ¿El navegador puede recibir push? */
    function soportaPush() {
        return 'serviceWorker' in navigator &&
               'PushManager' in window &&
               'Notification' in window;
    }

    /** ¿Estamos corriendo como app instalada? */
    function esAppInstalada() {
        return window.matchMedia?.('(display-mode: standalone)').matches === true ||
               window.navigator.standalone === true;
    }

    function esIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    /**
     * Qué se le puede ofrecer a este dispositivo, para que la interfaz diga
     * la verdad en vez de mostrar un botón que no va a funcionar.
     *
     * En iPhone el push web SOLO funciona si la PWA está instalada en la
     * pantalla de inicio — es una restricción de Safari, no algo que
     * podamos rodear. Por eso ahí devolvemos 'instalar_primero'.
     */
    function estadoPush() {
        if (!soportaPush()) return 'no_soportado';
        if (esIOS() && !esAppInstalada()) return 'instalar_primero';
        if (Notification.permission === 'denied') return 'bloqueado';
        if (Notification.permission === 'granted') return 'permitido';
        return 'puede_pedirse';
    }

    function base64UrlAUint8Array(base64) {
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const normal = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(normal);
        const salida = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) salida[i] = raw.charCodeAt(i);
        return salida;
    }

    async function registrarServiceWorker() {
        // Ruta relativa: así funciona igual en /RomaDetalles/ de GitHub Pages
        // que en la raíz si algún día se sirve desde un dominio propio.
        const reg = await navigator.serviceWorker.register('sw.js');
        await navigator.serviceWorker.ready;
        return reg;
    }

    /**
     * Activa los avisos para este negocio. Devuelve
     * { ok: true } o { ok: false, motivo, mensaje } con un mensaje que se
     * puede mostrar tal cual al dueño.
     */
    async function activarAvisos(negocioId) {
        if (!negocioId) {
            return { ok: false, motivo: 'sin_negocio', mensaje: 'No se sabe de qué negocio activar los avisos.' };
        }

        const estado = estadoPush();

        if (estado === 'no_soportado') {
            return {
                ok: false,
                motivo: estado,
                mensaje: 'Este navegador no puede recibir avisos. Prueba con Chrome en Android o instala la app.'
            };
        }
        if (estado === 'instalar_primero') {
            return {
                ok: false,
                motivo: estado,
                mensaje: 'En iPhone los avisos solo funcionan con la app instalada. Pulsa Compartir → Añadir a pantalla de inicio, ábrela desde el ícono y vuelve a intentarlo.'
            };
        }
        if (estado === 'bloqueado') {
            return {
                ok: false,
                motivo: estado,
                mensaje: 'Los avisos están bloqueados para este sitio. Habilítalos en los ajustes del navegador y vuelve a intentarlo.'
            };
        }

        try {
            const permiso = await Notification.requestPermission();
            if (permiso !== 'granted') {
                return { ok: false, motivo: 'rechazado', mensaje: 'No se activaron los avisos.' };
            }

            const registro = await registrarServiceWorker();

            // Si ya había una suscripción, la reusamos: pedir otra con la
            // misma llave devolvería la misma, pero así evitamos la llamada.
            let suscripcion = await registro.pushManager.getSubscription();
            if (!suscripcion) {
                suscripcion = await registro.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64UrlAUint8Array(window.ROMADETALLES_PUSH_PUBLIC_KEY)
                });
            }

            const guardada = await guardarSuscripcion(negocioId, suscripcion);
            if (!guardada.ok) return guardada;

            localStorage.setItem('romadetallesPushActivo', 'true');
            window.dispatchEvent(new CustomEvent('romadetalles-push-cambio'));
            return { ok: true };
        } catch (e) {
            console.error('[Push] fallo al activar:', e);
            return {
                ok: false,
                motivo: 'error',
                mensaje: 'No se pudieron activar los avisos. Revisa tu conexión e inténtalo de nuevo.'
            };
        }
    }

    async function guardarSuscripcion(negocioId, suscripcion) {
        const payload = {
            negocio_id: negocioId,
            role: 'admin',
            endpoint: suscripcion.endpoint,
            subscription: suscripcion.toJSON ? suscripcion.toJSON() : suscripcion,
            user_agent: navigator.userAgent || '',
            activo: true,
            updated_at: new Date().toISOString()
        };

        const url = `${window.SUPABASE_URL}/rest/v1/${TABLA}?on_conflict=endpoint,negocio_id,role`;
        const res = await fetch(url, {
            method: 'POST',
            headers: window.supaHeaders({
                Prefer: 'resolution=merge-duplicates,return=minimal'
            }),
            body: JSON.stringify(payload)
        });

        if (res.ok) return { ok: true };

        const error = await res.text();
        console.error('[Push] no se guardó la suscripción:', res.status, error);

        // 23503 = llave foránea. Pasa si no se corrió sql/02-push-compartido.sql.
        if (error.includes('23503')) {
            return {
                ok: false,
                motivo: 'falta_sql',
                mensaje: 'Falta aplicar sql/02-push-compartido.sql en Supabase (la tabla de avisos todavía exige un negocio de rservasroma).'
            };
        }
        return {
            ok: false,
            motivo: 'error_guardado',
            mensaje: 'Los avisos se autorizaron pero no se pudieron registrar. Inténtalo de nuevo.'
        };
    }

    /** Desactiva los avisos en este dispositivo. */
    async function desactivarAvisos(negocioId) {
        try {
            const registro = await navigator.serviceWorker.getRegistration();
            const suscripcion = await registro?.pushManager.getSubscription();
            if (suscripcion) {
                const url = `${window.SUPABASE_URL}/rest/v1/${TABLA}` +
                    `?endpoint=eq.${encodeURIComponent(suscripcion.endpoint)}` +
                    `&negocio_id=eq.${negocioId}&role=eq.admin`;
                await fetch(url, {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ activo: false, updated_at: new Date().toISOString() })
                });
                await suscripcion.unsubscribe();
            }
            localStorage.removeItem('romadetallesPushActivo');
            window.dispatchEvent(new CustomEvent('romadetalles-push-cambio'));
            return { ok: true };
        } catch (e) {
            console.error('[Push] fallo al desactivar:', e);
            return { ok: false, mensaje: 'No se pudieron desactivar los avisos.' };
        }
    }

    /** ¿Están activos en ESTE dispositivo? */
    async function avisosActivos() {
        if (!soportaPush() || Notification.permission !== 'granted') return false;
        try {
            const registro = await navigator.serviceWorker.getRegistration();
            return Boolean(await registro?.pushManager.getSubscription());
        } catch {
            return false;
        }
    }

    window.RomaDetallesPush = {
        soportaPush,
        esAppInstalada,
        esIOS,
        estadoPush,
        activarAvisos,
        desactivarAvisos,
        avisosActivos
    };

    console.log('push-alquiler.js cargado — estado:', estadoPush());
})();
