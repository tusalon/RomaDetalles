// admin-app.js — Monta el panel, tras comprobar sesión y negocio.

(async function () {
    const raiz = document.getElementById('root');

    const tieneSesion = await window.AlquilerAuth.exigirSesion();
    if (!tieneSesion) return; // exigirSesion ya redirigió a admin-login.html

    const negocio = await window.AlquilerAuth.negocioDelUsuario();
    if (!negocio) {
        // Cuenta válida en Supabase Auth pero sin fila en alquiler_usuarios:
        // pasó el login pero nadie la vinculó a un negocio todavía.
        raiz.innerHTML =
            '<div class="empty" style="min-height:100dvh;justify-content:center">' +
            '<span>✦</span><h3>Tu cuenta no está vinculada a ningún negocio</h3>' +
            '<p>Pide que te agreguen en alquiler_usuarios, o contacta con soporte.</p>' +
            '<p><a href="#" onclick="window.AlquilerAuth.salir().then(() => location.replace(\'admin-login.html\'))">Salir</a></p>' +
            '</div>';
        return;
    }

    const sesion = window.AlquilerAuth.leerSesion();
    ReactDOM.createRoot(raiz).render(
        React.createElement(window.Panel, { negocioInicial: negocio, email: sesion?.email || '' })
    );
})();
