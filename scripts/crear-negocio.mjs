#!/usr/bin/env node
// scripts/crear-negocio.mjs — Alta automática de un negocio nuevo (dueña
// nueva que paga por su tienda) en RomaDetalles.
//
// Da de alta, en un solo paso:
//   1. El negocio en alquiler_negocios
//   2. La cuenta de acceso en Supabase Auth (con contraseña generada)
//   3. El vínculo dueño↔negocio en alquiler_usuarios
//
// Uso:
//   node scripts/crear-negocio.mjs "Nombre del negocio" "5351234567" "correo@ejemplo.com" [moneda]
//
// Requiere la SERVICE ROLE KEY del proyecto Supabase (zorhclhvykikaachfrmp).
// NUNCA la pongas en este archivo ni la subas a git. Este script la busca en:
//   1. La variable de entorno SUPABASE_SERVICE_ROLE_KEY, o
//   2. Un archivo .env.local en la raíz del proyecto (ya está en .gitignore,
//      así que aunque lo crees aquí, git nunca lo sube), con esta línea:
//        SUPABASE_SERVICE_ROLE_KEY=tu_llave_aqui
//
// La llave la encuentras en: Supabase → tu proyecto → Project Settings →
// API → "service_role" (la secreta, NO la "anon"/pública).

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SUPABASE_URL = 'https://zorhclhvykikaachfrmp.supabase.co';
const SITIO_BASE = 'https://tusalon.github.io/RomaDetalles';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function leerServiceRoleKey() {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;

    const envLocal = path.join(RAIZ, '.env.local');
    if (existsSync(envLocal)) {
        const contenido = readFileSync(envLocal, 'utf8');
        for (const linea of contenido.split('\n')) {
            const limpia = linea.trim();
            if (!limpia || limpia.startsWith('#')) continue;
            const [clave, ...resto] = limpia.split('=');
            if (clave.trim() === 'SUPABASE_SERVICE_ROLE_KEY') {
                return resto.join('=').trim().replace(/^["']|["']$/g, '');
            }
        }
    }
    return null;
}

function slugificar(texto) {
    return String(texto)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'negocio';
}

function generarContrasena() {
    // Sin caracteres ambiguos (0/O, 1/l/I) porque la dueña la va a teclear
    // en el teléfono, probablemente copiándola de un mensaje de WhatsApp.
    const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(12);
    let resultado = '';
    for (let i = 0; i < 12; i++) resultado += alfabeto[bytes[i] % alfabeto.length];
    return resultado;
}

async function supabaseFetch(ruta, opciones, serviceKey) {
    const res = await fetch(`${SUPABASE_URL}${ruta}`, {
        ...opciones,
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            ...(opciones?.headers || {})
        }
    });
    const texto = await res.text();
    let datos;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
    if (!res.ok) {
        const error = new Error(typeof datos === 'string' ? datos : (datos?.message || datos?.msg || JSON.stringify(datos)));
        error.status = res.status;
        error.datos = datos;
        throw error;
    }
    return datos;
}

async function slugDisponible(base, serviceKey) {
    let slug = base;
    let sufijo = 2;
    while (true) {
        const filas = await supabaseFetch(
            `/rest/v1/alquiler_negocios?slug=eq.${encodeURIComponent(slug)}&select=id`,
            { method: 'GET' },
            serviceKey
        );
        if (!filas.length) return slug;
        slug = `${base}-${sufijo}`;
        sufijo++;
    }
}

async function main() {
    const [nombreNegocio, whatsappCrudo, correo, moneda] = process.argv.slice(2);

    if (!nombreNegocio || !whatsappCrudo || !correo) {
        console.error('Uso: node scripts/crear-negocio.mjs "Nombre del negocio" "WhatsApp" "correo@ejemplo.com" [moneda]');
        process.exit(1);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        console.error(`El correo "${correo}" no parece válido.`);
        process.exit(1);
    }

    const serviceKey = leerServiceRoleKey();
    if (!serviceKey) {
        console.error(
            'Falta la SUPABASE_SERVICE_ROLE_KEY.\n' +
            'Créala en Supabase → Project Settings → API → "service_role", y luego:\n' +
            '  - opción A: exporta la variable en tu terminal antes de correr el script, o\n' +
            `  - opción B: crea un archivo .env.local en ${RAIZ} con la línea:\n` +
            '      SUPABASE_SERVICE_ROLE_KEY=tu_llave_aqui\n' +
            '    (ese archivo ya está en .gitignore, nunca se sube a GitHub)'
        );
        process.exit(1);
    }

    const whatsapp = whatsappCrudo.replace(/\D/g, '');
    const contrasena = generarContrasena();

    console.log(`\nCreando negocio "${nombreNegocio}"...\n`);

    // 1. Usuario en Supabase Auth. Si esto falla (ej. correo ya registrado),
    //    no se crea nada más — evita negocios huérfanos sin dueño.
    let usuario;
    try {
        usuario = await supabaseFetch('/auth/v1/admin/users', {
            method: 'POST',
            body: JSON.stringify({ email: correo, password: contrasena, email_confirm: true })
        }, serviceKey);
        console.log(`✓ Cuenta creada para ${correo}`);
    } catch (e) {
        console.error(`✗ No se pudo crear la cuenta: ${e.message}`);
        if (e.status === 422 || /already.*registered/i.test(e.message)) {
            console.error('  (Ese correo ya tiene una cuenta. Usa otro, o vincula la cuenta existente a mano.)');
        }
        process.exit(1);
    }

    // 2. Negocio.
    let negocio;
    try {
        const slugBase = slugificar(nombreNegocio);
        const slug = await slugDisponible(slugBase, serviceKey);
        const filas = await supabaseFetch('/rest/v1/alquiler_negocios', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
                slug,
                nombre: nombreNegocio,
                whatsapp,
                moneda: moneda || 'CUP'
            })
        }, serviceKey);
        negocio = filas[0];
        console.log(`✓ Negocio creado: ${negocio.nombre} (slug: ${negocio.slug})`);
    } catch (e) {
        console.error(`✗ El usuario se creó (id ${usuario.id}) pero el negocio falló: ${e.message}`);
        console.error('  Corrígelo a mano en el SQL Editor y vincula con alquiler_usuarios.');
        process.exit(1);
    }

    // 3. Vínculo dueño ↔ negocio.
    try {
        await supabaseFetch('/rest/v1/alquiler_usuarios', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ user_id: usuario.id, negocio_id: negocio.id, rol: 'dueno' })
        }, serviceKey);
        console.log('✓ Cuenta vinculada al negocio como dueña');
    } catch (e) {
        console.error(`✗ El negocio y la cuenta se crearon, pero el vínculo falló: ${e.message}`);
        console.error(`  Corrígelo a mano:\n  insert into alquiler_usuarios (user_id, negocio_id, rol) values ('${usuario.id}', '${negocio.id}', 'dueno');`);
        process.exit(1);
    }

    console.log('\n──────────────────────────────────────────');
    console.log('Listo. Esto es lo que le compartes a la dueña:');
    console.log('──────────────────────────────────────────');
    console.log(`Negocio:        ${negocio.nombre}`);
    console.log(`Panel (entrar): ${SITIO_BASE}/admin-login.html`);
    console.log(`Correo:         ${correo}`);
    console.log(`Contraseña:     ${contrasena}`);
    console.log(`Su tienda:      ${SITIO_BASE}/index.html?s=${negocio.slug}`);
    console.log('──────────────────────────────────────────\n');
}

main();
