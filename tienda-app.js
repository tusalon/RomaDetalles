// tienda-app.js — Monta la tienda pública, o la vista de "Mi reserva"
// si la URL trae ?reserva=TOKEN.

const raizTienda = document.getElementById('root');
const tokenReserva = new URLSearchParams(window.location.search).get('reserva');
ReactDOM.createRoot(raizTienda).render(
    tokenReserva
        ? React.createElement(window.MiReserva, { token: tokenReserva })
        : React.createElement(window.Tienda)
);
