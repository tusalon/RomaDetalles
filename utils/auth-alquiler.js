// utils/auth-alquiler.js — Acceso al panel con Supabase Auth.
//
// A diferencia de rservasroma (que guarda contraseñas con bcrypt en una tabla
// propia legible con la anon key), aquí se usa Supabase Auth de verdad:
//   · la contraseña nunca pasa por nuestras tablas
//   · el token que devuelve es lo que hace que las policies de RLS sepan
//     quién eres, así el dueño ve solo lo de SU negocio sin que tengamos
//     que filtrar a mano en cada consulta
//
// Se habla con la API REST directamente para no cargar supabase-js (~40 KB)
// por dos llamadas.

(function () {
    'use strict';

    const CLAVE_SESION = 'romadetallesSesion';

    function guardarSesion(sesion) {
        localStorage.setItem(CLAVE_SESION, JSON.stringify({
            access_token: sesion.access_token,
            refresh_token: sesion.refresh_token,
            // expires_at viene en segundos epoch; si falta lo calculamos
            expires_at: sesion.expires_at ||
                Math.floor(Date.now() / 1000) + (sesion.expires_in || 3600),
            email: sesion.user?.email || '',
            user_id: sesion.user?.id || ''
        }));
        window.ALQUILER_ACCESS_TOKEN = sesion.access_token;
    }

    function leerSesion() {
        try {
            const bruto = localStorage.getItem(CLAVE_SESION);
            if (!bruto) return null;
            const sesion = JSON.parse(bruto);
            window.ALQUILER_ACCESS_TOKEN = sesion.access_token;
            return sesion;
        } catch {
            return null;
        }
    }

    function borrarSesion() {
        localStorage.removeItem(CLAVE_SESION);
        delete window.ALQUILER_ACCESS_TOKEN;
    }

    /** Entra con correo y contraseña. Devuelve {ok} o {ok:false, mensaje}. */
    async function entrar(email, password) {
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/auth/v1/token?grant_type=password`,
                {
                    method: 'POST',
                    headers: {
                        apikey: window.SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email: email.trim(), password })
                }
            );
            const datos = await res.json();

            if (!res.ok) {
                // Supabase devuelve "Invalid login credentials" para correo
                // inexistente Y para contraseña mala, a propósito: así no se
                // puede averiguar qué correos están registrados. Mantenemos
                // ese comportamiento en el mensaje que mostramos.
                const msg = /invalid/i.test(datos.error_description || datos.msg || '')
                    ? 'Correo o contraseña incorrectos.'
                    : (datos.error_description || datos.msg || 'No se pudo entrar.');
                return { ok: false, mensaje: msg };
            }

            guardarSesion(datos);
            return { ok: true };
        } catch (e) {
            console.error('[Auth] error al entrar:', e);
            return { ok: false, mensaje: 'No se pudo conectar. Revisa tu conexión.' };
        }
    }

    /** Renueva el token si está por vencer. Devuelve true si hay sesión válida. */
    async function asegurarSesion() {
        const sesion = leerSesion();
        if (!sesion) return false;

        // Margen de 60 s para no usar un token que vence mientras viaja.
        if (sesion.expires_at && sesion.expires_at - 60 > Math.floor(Date.now() / 1000)) {
            return true;
        }

        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
                {
                    method: 'POST',
                    headers: {
                        apikey: window.SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ refresh_token: sesion.refresh_token })
                }
            );
            if (!res.ok) {
                borrarSesion();
                return false;
            }
            guardarSesion(await res.json());
            return true;
        } catch (e) {
            console.error('[Auth] no se pudo renovar la sesión:', e);
            // Sin conexión no borramos la sesión: el token viejo puede seguir
            // sirviendo, y borrarla obligaría a entrar de nuevo sin internet.
            return true;
        }
    }

    async function salir() {
        const sesion = leerSesion();
        if (sesion) {
            try {
                await fetch(`${window.SUPABASE_URL}/auth/v1/logout`, {
                    method: 'POST',
                    headers: {
                        apikey: window.SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${sesion.access_token}`
                    }
                });
            } catch { /* da igual: lo importante es borrar local */ }
        }
        borrarSesion();
    }

    /**
     * El negocio que administra el usuario de la sesión.
     * Devuelve el negocio completo o null si el usuario no administra ninguno
     * (cuenta creada pero sin vincular en alquiler_usuarios).
     */
    async function negocioDelUsuario() {
        const sesion = leerSesion();
        if (!sesion) return null;

        const vinculos = await window.supaGet(
            `alquiler_usuarios?user_id=eq.${sesion.user_id}&select=negocio_id,rol`
        );
        if (!vinculos.length) return null;

        const negocios = await window.supaGet(
            `alquiler_negocios?id=eq.${vinculos[0].negocio_id}` +
            `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos,activo,` +
            `logo_url,plantilla_confirmacion,plantilla_compartir,plantilla_solicitud`
        );
        return negocios[0] || null;
    }

    /** Manda al login si no hay sesión. Para usar al abrir admin.html. */
    async function exigirSesion() {
        const valida = await asegurarSesion();
        if (!valida) {
            window.location.replace('admin-login.html');
            return false;
        }
        return true;
    }

    window.AlquilerAuth = {
        entrar,
        salir,
        leerSesion,
        asegurarSesion,
        exigirSesion,
        negocioDelUsuario
    };

    // Deja el token disponible para supaHeaders() en cuanto carga el archivo.
    leerSesion();
})();
