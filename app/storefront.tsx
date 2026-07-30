"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Product = {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  image: string;
};

const fallbackProducts: Product[] = [
  {
    id: 1,
    name: "Arco Terracota",
    description: "Arco curvo, globos y dos pedestales acanalados.",
    category: "Fondos",
    price: 3500,
    stock: 1,
    image: "/images/producto-arco.png",
  },
  {
    id: 2,
    name: "Pedestales Aura",
    description: "Juego de tres pedestales en crema, coral y lavanda.",
    category: "Mobiliario",
    price: 2200,
    stock: 2,
    image: "/images/producto-arco.png",
  },
  {
    id: 3,
    name: "Candelabros Ámbar",
    description: "Seis portavelas de cristal con alturas variadas.",
    category: "Mesa",
    price: 1200,
    stock: 3,
    image: "/images/producto-mesa.png",
  },
  {
    id: 4,
    name: "Bases Doradas",
    description: "Cuatro bases para dulces y pasteles en latón.",
    category: "Mesa",
    price: 1600,
    stock: 2,
    image: "/images/producto-mesa.png",
  },
  {
    id: 5,
    name: "Combo Celebración",
    description: "Arco, pedestales, bases y candelabros coordinados.",
    category: "Combos",
    price: 6500,
    stock: 1,
    image: "/images/hero-evento.png",
  },
  {
    id: 6,
    name: "Estación Coral",
    description: "Barra, dispensador y accesorios para bebidas.",
    category: "Estaciones",
    price: 2800,
    stock: 1,
    image: "/images/hero-evento.png",
  },
];

function daysBetween(start: string, end: string) {
  if (!start || !end) return 0;
  return Math.max(
    0,
    Math.floor(
      (new Date(`${end}T12:00:00Z`).getTime() -
        new Date(`${start}T12:00:00Z`).getTime()) /
        86_400_000,
    ) + 1,
  );
}

function money(value: number) {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 0 }).format(value);
}

type StorefrontProps = {
  initialSettings: {
    businessName: string;
    welcomeTitle: string;
    welcomeText: string;
    whatsappNumber: string;
    currency: string;
    instagramUrl: string;
    facebookUrl: string;
  };
  initialProducts: Array<{
    id: number;
    name: string;
    description: string;
    category: string;
    pricePerDay: number;
    stock: number;
    imageUrl: string;
    active: boolean;
  }>;
};

export default function Storefront({
  initialSettings,
  initialProducts,
}: StorefrontProps) {
  const products = useMemo(
    () =>
      initialProducts.length
        ? initialProducts.map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description,
            category: product.category,
            price: product.pricePerDay,
            stock: product.stock,
            image: product.imageUrl || "/images/producto-arco.png",
          }))
        : fallbackProducts,
    [initialProducts],
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [category, setCategory] = useState("Todos");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [availability, setAvailability] = useState<Record<number, number>>({});
  const [checking, setChecking] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const categories = ["Todos", ...new Set(products.map((p) => p.category))];
  const filtered =
    category === "Todos"
      ? products
      : products.filter((p) => p.category === category);
  const rentalDays = daysBetween(startDate, endDate);
  const cartProducts = products.filter((p) => cart[p.id]);
  const itemCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const dailyTotal = useMemo(
    () =>
      products.reduce((sum, product) => sum + product.price * (cart[product.id] || 0), 0),
    [cart, products],
  );

  useEffect(() => {
    if (!startDate || !endDate || endDate < startDate) return;
    const controller = new AbortController();
    setTimeout(() => setChecking(true), 0);
    fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((payload: { availability: Array<{ productId: number; available: number }> }) => {
        setAvailability(
          Object.fromEntries(
            payload.availability.map((item) => [item.productId, item.available]),
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, [startDate, endDate]);

  function availableFor(product: Product) {
    return rentalDays ? (availability[product.id] ?? product.stock) : product.stock;
  }

  function add(product: Product) {
    if (!rentalDays) {
      document.getElementById("fechas")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setCart((current) => ({
      ...current,
      [product.id]: Math.min(
        availableFor(product),
        (current[product.id] || 0) + 1,
      ),
    }));
    setDrawerOpen(true);
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    if (!customerName.trim()) {
      setOrderStatus("Escribe tu nombre para continuar.");
      return;
    }
    setOrderStatus("Comprobando disponibilidad…");
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName,
        customerPhone,
        notes,
        startDate,
        endDate,
        items: cartProducts.map((product) => ({
          productId: product.id,
          quantity: cart[product.id],
        })),
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      orderId?: string;
      whatsappUrl?: string | null;
    };
    if (!response.ok) {
      setOrderStatus(payload.error || "No se pudo guardar el pedido.");
      return;
    }
    setOrderStatus(
      payload.whatsappUrl
        ? `Pedido ${payload.orderId} guardado. Abriendo WhatsApp…`
        : `Pedido ${payload.orderId} guardado. Falta configurar el WhatsApp del negocio.`,
    );
    if (payload.whatsappUrl) window.location.assign(payload.whatsappUrl);
  }

  return (
    <main>
      <header className="header">
        <a className="brand" href="#inicio">
          <span>✦</span> {initialSettings.businessName}
        </a>
        <nav>
          <a href="#inicio">Inicio</a>
          <a href="#catalogo">Catálogo</a>
          <a href="#como">Cómo funciona</a>
        </nav>
        <button className="cart-trigger" onClick={() => setDrawerOpen(true)}>
          Mi pedido <b>{itemCount}</b>
        </button>
      </header>

      <section className="hero shell" id="inicio">
        <div className="hero-copy">
          <p className="eyebrow">Decora · celebra · recuerda</p>
          <h1>{initialSettings.welcomeTitle}</h1>
          <p className="intro">{initialSettings.welcomeText}</p>
          <div className="hero-buttons">
            <a className="primary" href="#catalogo">Explorar catálogo →</a>
            <a className="secondary" href="#como">¿Cómo funciona?</a>
          </div>
          <p className="benefits">
            Reserva por días <i>•</i> Combina productos <i>•</i> Pedido por WhatsApp
          </p>
        </div>
        <div className="hero-visual">
          <img src="/images/hero-evento.png" alt="Decoración elegante para eventos" />
          <div className="date-card" id="fechas">
            <div className="date-title">
              <span>◫</span>
              <div>
                <strong>Comprueba tu fecha</strong>
                <small>
                  {checking
                    ? "Comprobando…"
                    : rentalDays
                      ? "Disponibilidad actualizada"
                      : "Elige las fechas"}
                </small>
              </div>
            </div>
            <div className="dates">
              <label>
                Desde
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate < e.target.value) setEndDate(e.target.value);
                  }}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  min={startDate}
                  disabled={!startDate}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </div>
            {rentalDays > 0 && (
              <p className="available">● Revisado · {rentalDays} {rentalDays === 1 ? "día" : "días"}</p>
            )}
          </div>
        </div>
      </section>

      <section className="catalog" id="catalogo">
        <div className="shell">
          <div className="section-head">
            <div>
              <p className="eyebrow">Tu evento, a tu manera</p>
              <h2>Combina todo lo que te inspire</h2>
            </div>
            <p>
              Agrega varios artículos y forma tu combo. El total se calcula
              según los días seleccionados.
            </p>
          </div>
          <div className="filters">
            {categories.map((item) => (
              <button
                className={category === item ? "active" : ""}
                key={item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="product-grid">
            {filtered.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image">
                  <img src={product.image} alt={product.name} />
                  <span>{product.category}</span>
                  {rentalDays > 0 && (
                    <b className={availableFor(product) < 1 ? "reserved" : ""}>
                      {availableFor(product) < 1
                        ? "● Reservado"
                        : `● ${availableFor(product)} disponible${availableFor(product) === 1 ? "" : "s"}`}
                    </b>
                  )}
                </div>
                <div className="product-body">
                  <div className="product-title">
                    <h3>{product.name}</h3>
                    <p><strong>{money(product.price)} {initialSettings.currency}</strong><small>/ día</small></p>
                  </div>
                  <p>{product.description}</p>
                  <button
                    disabled={rentalDays > 0 && availableFor(product) < 1}
                    onClick={() => add(product)}
                  >
                    {rentalDays
                      ? availableFor(product) < 1
                        ? "No disponible"
                        : "Agregar al pedido +"
                      : "Elegir fechas"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="how shell" id="como">
        <div className="center-head">
          <p className="eyebrow">Simple y transparente</p>
          <h2>Tu decoración lista en tres pasos</h2>
        </div>
        <div className="steps">
          <article><b>01</b><span>◫</span><h3>Elige las fechas</h3><p>Indica los días para comprobar cada artículo.</p></article>
          <article><b>02</b><span>✦</span><h3>Crea tu combo</h3><p>Combina productos y mira el total al instante.</p></article>
          <article><b>03</b><span>◉</span><h3>Confirma por WhatsApp</h3><p>El negocio recibe el pedido completo y confirma.</p></article>
        </div>
      </section>

      <footer className="footer shell">
        <span className="brand"><i>✦</i> {initialSettings.businessName}</span>
        <p>Decoraciones que convierten un día especial en un gran recuerdo.</p>
        <a href="/admin">Administrar negocio</a>
      </footer>

      {drawerOpen && <button className="overlay" aria-label="Cerrar" onClick={() => setDrawerOpen(false)} />}
      <aside className={`drawer ${drawerOpen ? "open" : ""}`}>
        <div className="drawer-head">
          <div><small>Tu selección</small><h2>Mi pedido</h2></div>
          <button onClick={() => setDrawerOpen(false)}>×</button>
        </div>
        <div className="drawer-content">
          {rentalDays > 0 && <p className="drawer-date">◫ {startDate} — {endDate} · {rentalDays} días</p>}
          {!cartProducts.length ? (
            <div className="empty"><span>✦</span><h3>Tu combo empieza aquí</h3><p>Agrega los artículos que harán único tu evento.</p></div>
          ) : (
            <>
              {cartProducts.map((product) => (
                <div className="cart-line" key={product.id}>
                  <img src={product.image} alt="" />
                  <div><strong>{product.name}</strong><small>{money(product.price)} {initialSettings.currency} / día</small></div>
                  <div className="qty">
                    <button onClick={() => setCart(c => ({...c, [product.id]: Math.max(0, c[product.id] - 1)}))}>−</button>
                    <span>{cart[product.id]}</span>
                    <button onClick={() => add(product)}>+</button>
                  </div>
                </div>
              ))}
              <div className="total"><span>Total estimado</span><strong>{money(dailyTotal * rentalDays)} {initialSettings.currency}</strong></div>
              <form className="checkout" onSubmit={submitOrder}>
                <input
                  placeholder="Tu nombre"
                  required
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                />
                <input
                  placeholder="Tu teléfono"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                />
                <textarea
                  placeholder="Nota opcional"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
                <button disabled={checking}>Enviar pedido por WhatsApp</button>
                {orderStatus && <p className="order-status">{orderStatus}</p>}
                <small>La disponibilidad se revisará nuevamente antes de enviar.</small>
              </form>
            </>
          )}
        </div>
      </aside>
    </main>
  );
}
