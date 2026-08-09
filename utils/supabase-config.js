// utils/supabase-config.js — Configuración central de RomaDetalles
//
// Mismo proyecto Supabase que rservasroma y RomaHub: así la Edge Function
// `enviar-web-push` y la tabla `push_suscripciones` se reusan sin duplicar
// nada. Las tablas de alquiler van con prefijo `alquiler_`.

const SUPABASE_URL = 'https://zorhclhvykikaachfrmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvcmhjbGh2eWtpa2FhY2hmcm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDQzMzUsImV4cCI6MjA4NzcyMDMzNX0.reauF3UfNTFJFZ3Mnzf8ctYH1d5p7C3msi7AvYJUaos';

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

// Cloudinary: las fotos de productos van aquí, NO a Supabase Storage.
// El upload preset es "sin firma": no es un secreto, solo permite subir.
// Un mismo preset sirve para todo el ecosistema; la carpeta se manda en
// cada subida (ver utils/storage.js).
window.CLOUDINARY_CLOUD_NAME = 'uyvla7fj';
window.CLOUDINARY_UPLOAD_PRESET = 'romahub_productos';

// Negocio por defecto cuando la URL no trae ?s=slug. Sirve para que la
// tienda de un cliente pueda vivir en su propio enlace corto sin parámetros.
window.ALQUILER_SLUG_POR_DEFECTO = 'roma-detalles';

// Edge Function que crea los pedidos. La tienda NUNCA inserta pedidos
// directo: la anon key no tiene permiso, a propósito.
window.ALQUILER_FUNCION_PEDIDO = 'crear-pedido-alquiler';

/**
 * Cabeceras para hablar con la API REST de Supabase como visitante anónimo.
 * Si hay sesión de Supabase Auth (panel del dueño), usa su token en vez de
 * la anon key — así las policies de RLS ven quién es y le dejan ver lo suyo.
 */
window.supaHeaders = function (extra) {
    const token = window.ALQUILER_ACCESS_TOKEN || SUPABASE_ANON_KEY;
    return Object.assign({
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
    }, extra || {});
};

/** GET a la API REST. Devuelve el JSON o lanza con un mensaje legible. */
window.supaGet = async function (ruta) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
        headers: window.supaHeaders()
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
};

/** Llama a una función de Postgres (rpc). */
window.supaRpc = async function (nombre, args) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
        method: 'POST',
        headers: window.supaHeaders(),
        body: JSON.stringify(args || {})
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    // Una función que devuelve void contesta con el cuerpo vacío, y ahí
    // res.json() lanza "Unexpected end of JSON input": el RPC funcionó
    // pero la app lo vería como error. No tener nada que devolver no es
    // un fallo.
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
};

console.log('✅ Configuración de RomaDetalles cargada');
