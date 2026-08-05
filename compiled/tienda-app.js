const raizTienda = document.getElementById("root");
const tokenReserva = new URLSearchParams(window.location.search).get("reserva");
ReactDOM.createRoot(raizTienda).render(
  tokenReserva ? React.createElement(window.MiReserva, { token: tokenReserva }) : React.createElement(window.Tienda)
);
