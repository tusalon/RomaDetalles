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

    // ---- APK (Capacitor) ----------------------------------------------
    // Dentro de la APK el WebView de Android NO tiene Web Push: no existen
    // PushManager ni Notification. El aviso llega por Firebase, con el
    // plugin nativo. La Edge Function compartida ya sabe mandar a estos
    // tokens: reconoce las filas por subscription.provider === 'fcm'.

    function esAppNativa() {
        const cap = window.Capacitor;
        return Boolean(cap && (
            cap.isNativePlatform?.() ||
            cap.getPlatform?.() === 'android' ||
            cap.getPlatform?.() === 'ios'
        ));
    }

    function pluginPush() {
        return window.Capacitor?.Plugins?.PushNotifications || null;
    }

    /**
     * ¿Esta APK se compiló con Firebase dentro?
     *
     * Importa muchísimo: si el plugin está pero falta google-services.json,
     * llamar a register() no devuelve un error — tumba la app entera, y es
     * un fallo nativo que ningún try/catch de JS puede atrapar. Así que no
     * se intenta salvo que el build lo confirme.
     *
     * La confirmación viene en el User-Agent: el workflow añade esta marca
     * solo cuando escribió el google-services.json.
     */
    function apkConFirebase() {
        return /romadetalles-push-fcm/.test(navigator.userAgent || '');
    }

    function plataformaNativa() {
        return window.Capacitor?.getPlatform?.() || 'native';
    }

    /**
     * El token no lo devuelve register(): llega después por el listener
     * 'registration'. Se envuelve en una promesa con tope de tiempo para
     * que la interfaz no quede colgada si Firebase no responde (sin
     * google-services.json en el APK, por ejemplo, no llega nunca).
     */
    function pedirTokenNativo(PushNotifications) {
        return new Promise((resolve, reject) => {
            let resuelto = false;
            const corte = setTimeout(() => {
                if (!resuelto) {
                    resuelto = true;
                    reject(new Error('SIN_TOKEN'));
                }
            }, 15000);

            PushNotifications.addListener('registration', (t) => {
                if (resuelto) return;
                resuelto = true;
                clearTimeout(corte);
                resolve(t?.value || '');
            });
            PushNotifications.addListener('registrationError', (e) => {
                if (resuelto) return;
                resuelto = true;
                clearTimeout(corte);
                reject(new Error(`REGISTRO_FALLO: ${JSON.stringify(e)}`));
            });
            PushNotifications.register().catch((e) => {
                if (resuelto) return;
                resuelto = true;
                clearTimeout(corte);
                reject(e);
            });
        });
    }

    async function activarAvisosNativos(negocioId) {
        // Primero lo que puede tumbar la app: sin Firebase compilado,
        // register() no falla, revienta. Ni se intenta.
        if (!apkConFirebase()) {
            return {
                ok: false,
                motivo: 'apk_sin_avisos',
                mensaje: 'Esta versión de la app todavía no trae los avisos. Descarga la última versión y vuelve a intentarlo.'
            };
        }
        const PushNotifications = pluginPush();
        if (!PushNotifications) {
            return {
                ok: false,
                motivo: 'apk_sin_plugin',
                mensaje: 'Esta versión de la app no trae los avisos. Actualiza la app a la última versión.'
            };
        }

        let permiso = await PushNotifications.checkPermissions();
        if (permiso.receive !== 'granted') {
            permiso = await PushNotifications.requestPermissions();
        }
        if (permiso.receive !== 'granted') {
            return { ok: false, motivo: 'rechazado', mensaje: 'No se activaron los avisos.' };
        }

        let token;
        try {
            token = await pedirTokenNativo(PushNotifications);
        } catch (e) {
            console.error('[Push] no se obtuvo el token nativo:', e);
            return {
                ok: false,
                motivo: 'sin_token',
                mensaje: 'No se pudo registrar este teléfono para los avisos. Revisa tu conexión e inténtalo de nuevo.'
            };
        }
        if (!token) {
            return { ok: false, motivo: 'sin_token', mensaje: 'No se pudo registrar este teléfono para los avisos.' };
        }

        const plataforma = plataformaNativa();
        // Mismo formato que usa rservasroma, que es lo que enviar-web-push
        // sabe leer: el endpoint identifica la fila y el token va dentro
        // de `subscription` junto al provider.
        const guardada = await guardarFilaPush({
            negocio_id: negocioId,
            role: 'admin',
            endpoint: `native:${plataforma}:${token}`,
            subscription: { provider: 'fcm', token, platform: plataforma },
            user_agent: navigator.userAgent || plataforma,
            activo: true,
            updated_at: new Date().toISOString()
        });
        if (!guardada.ok) return guardada;

        localStorage.setItem('romadetallesPushNativo', token);
        localStorage.setItem('romadetallesPushActivo', 'true');
        window.dispatchEvent(new CustomEvent('romadetalles-push-cambio'));
        return { ok: true };
    }

    async function desactivarAvisosNativos(negocioId) {
        const token = localStorage.getItem('romadetallesPushNativo');
        if (token) {
            const endpoint = `native:${plataformaNativa()}:${token}`;
            await fetch(
                `${window.SUPABASE_URL}/rest/v1/${TABLA}` +
                `?endpoint=eq.${encodeURIComponent(endpoint)}` +
                `&negocio_id=eq.${negocioId}&role=eq.admin`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ activo: false, updated_at: new Date().toISOString() })
                }
            ).catch((e) => console.warn('[Push] no se desactivó la fila nativa:', e));
        }
        localStorage.removeItem('romadetallesPushNativo');
        localStorage.removeItem('romadetallesPushActivo');
        window.dispatchEvent(new CustomEvent('romadetalles-push-cambio'));
        return { ok: true };
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
        // La APK va primero que todo: ahí no hay Web Push (el WebView no
        // trae PushManager) pero sí hay push nativo, así que preguntar por
        // el soporte web daría 'no_soportado' — un callejón sin salida —
        // cuando el teléfono sí puede recibir avisos.
        //
        // El permiso nativo se consulta en async, y esto es sync, así que
        // aquí solo se dice "se puede ofrecer el botón"; el permiso de
        // verdad se pide al pulsarlo.
        if (esAppNativa()) {
            if (!apkConFirebase()) return 'apk_sin_avisos';
            return localStorage.getItem('romadetallesPushNativo') ? 'permitido' : 'puede_pedirse';
        }
        // El iPhone se pregunta ANTES que el soporte general: Safari no
        // expone Notification ni PushManager fuera de una PWA instalada,
        // así que soportaPush() daría false y el dueño leería "este
        // navegador no puede recibir avisos" — un callejón sin salida —
        // cuando en realidad sí puede, instalando la app.
        if (esIOS() && !esAppInstalada()) return 'instalar_primero';
        if (!soportaPush()) return 'no_soportado';
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

        if (esAppNativa()) return activarAvisosNativos(negocioId);

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
        return guardarFilaPush({
            negocio_id: negocioId,
            role: 'admin',
            endpoint: suscripcion.endpoint,
            subscription: suscripcion.toJSON ? suscripcion.toJSON() : suscripcion,
            user_agent: navigator.userAgent || '',
            activo: true,
            updated_at: new Date().toISOString()
        });
    }

    /** El insert compartido por las dos vías: web y nativa (APK). */
    async function guardarFilaPush(payload) {
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
        if (esAppNativa()) return desactivarAvisosNativos(negocioId);
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
        // En la APK no hay pushManager que consultar: la señal es el token
        // que se guardó al activar.
        if (esAppNativa()) return Boolean(localStorage.getItem('romadetallesPushNativo'));
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
        esAppNativa,
        esIOS,
        estadoPush,
        activarAvisos,
        desactivarAvisos,
        avisosActivos
    };

    console.log('push-alquiler.js cargado — estado:', estadoPush());
})();
