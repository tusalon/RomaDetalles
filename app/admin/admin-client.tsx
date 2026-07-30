"use client";

import { ChangeEvent, useState } from "react";
import Link from "next/link";

type Settings = {
  businessName: string;
  welcomeTitle: string;
  welcomeText: string;
  whatsappNumber: string;
  currency: string;
  instagramUrl: string;
  facebookUrl: string;
};
type Product = {
  id: number;
  name: string;
  description: string;
  category: string;
  pricePerDay: number;
  stock: number;
  imageUrl: string;
  active: boolean;
};
type Order = {
  id: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  rentalDays: number;
  total: number;
  status: string;
  notes: string;
  items: Array<{ id: number; productName: string; quantity: number }>;
};

export default function AdminClient({
  initialData,
  userName,
}: {
  initialData: { settings: Settings; products: Product[]; orders: Order[] };
  userName: string;
}) {
  const [tab, setTab] = useState<"settings" | "products" | "orders">("settings");
  const [settings, setSettings] = useState(initialData.settings);
  const [products, setProducts] = useState(initialData.products);
  const [orders, setOrders] = useState(initialData.orders);
  const [notice, setNotice] = useState("");

  async function saveSettings() {
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setNotice(response.ok ? "Configuración guardada." : "No se pudo guardar.");
  }

  async function addProduct() {
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nuevo artículo",
        description: "",
        category: "Decoración",
        pricePerDay: 0,
        stock: 1,
        imageUrl: "/images/producto-arco.png",
        active: true,
      }),
    });
    const payload = await response.json();
    if (response.ok) setProducts((current) => [...current, payload.product]);
  }

  async function saveProduct(product: Product) {
    const response = await fetch("/api/admin/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product),
    });
    setNotice(response.ok ? `${product.name} guardado.` : "No se pudo guardar.");
  }

  async function removeProduct(id: number) {
    const response = await fetch(`/api/admin/products?id=${id}`, { method: "DELETE" });
    if (response.ok) setProducts((current) => current.filter((product) => product.id !== id));
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, id: number) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/admin/upload", { method: "POST", body: form });
    const payload = await response.json();
    if (response.ok) {
      setProducts((current) =>
        current.map((product) =>
          product.id === id ? { ...product, imageUrl: payload.url } : product,
        ),
      );
      setNotice("Foto subida. Pulsa Guardar en el artículo.");
    }
  }

  async function updateOrder(id: string, status: string) {
    const response = await fetch("/api/admin/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (response.ok) {
      setOrders((current) =>
        current.map((order) => (order.id === id ? { ...order, status } : order)),
      );
    }
  }

  return (
    <main className="admin">
      <header className="admin-header">
        <div>
          <Link href="/" className="brand"><span>✦</span> Alquila Fácil</Link>
          <p>Panel del negocio</p>
        </div>
        <div className="admin-user">
          <span>{userName}</span>
          <a href="/signout-with-chatgpt?return_to=/">Salir</a>
        </div>
      </header>
      <div className="admin-shell">
        <aside className="admin-nav">
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Configuración</button>
          <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>Productos</button>
          <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Reservas</button>
          <Link href="/">Ver tienda ↗</Link>
        </aside>
        <section className="admin-content">
          {notice && <p className="admin-notice">{notice}</p>}
          {tab === "settings" && (
            <>
              <div className="admin-title"><div><p className="eyebrow">Personaliza la app</p><h1>Configuración</h1></div><button onClick={saveSettings}>Guardar cambios</button></div>
              <div className="admin-card settings-form">
                <label>Nombre del negocio<input value={settings.businessName} onChange={(e) => setSettings({...settings,businessName:e.target.value})}/></label>
                <label>Título de bienvenida<input value={settings.welcomeTitle} onChange={(e) => setSettings({...settings,welcomeTitle:e.target.value})}/></label>
                <label className="wide">Mensaje de bienvenida<textarea value={settings.welcomeText} onChange={(e) => setSettings({...settings,welcomeText:e.target.value})}/></label>
                <label>WhatsApp del negocio<input placeholder="Ej. 5351234567" value={settings.whatsappNumber} onChange={(e) => setSettings({...settings,whatsappNumber:e.target.value})}/></label>
                <label>Moneda<input value={settings.currency} onChange={(e) => setSettings({...settings,currency:e.target.value})}/></label>
                <label>Instagram<input placeholder="https://instagram.com/..." value={settings.instagramUrl} onChange={(e) => setSettings({...settings,instagramUrl:e.target.value})}/></label>
                <label>Facebook<input placeholder="https://facebook.com/..." value={settings.facebookUrl} onChange={(e) => setSettings({...settings,facebookUrl:e.target.value})}/></label>
              </div>
            </>
          )}
          {tab === "products" && (
            <>
              <div className="admin-title"><div><p className="eyebrow">Tu inventario</p><h1>Productos</h1></div><button onClick={addProduct}>+ Nuevo artículo</button></div>
              <div className="admin-products">
                {products.map((product) => (
                  <article className="admin-product admin-card" key={product.id}>
                    <img src={product.imageUrl || "/images/producto-arco.png"} alt="" />
                    <div className="product-fields">
                      <input value={product.name} onChange={(e) => setProducts(p => p.map(x => x.id === product.id ? {...x,name:e.target.value}:x))}/>
                      <textarea value={product.description} onChange={(e) => setProducts(p => p.map(x => x.id === product.id ? {...x,description:e.target.value}:x))}/>
                      <div><label>Categoría<input value={product.category} onChange={(e) => setProducts(p => p.map(x => x.id === product.id ? {...x,category:e.target.value}:x))}/></label><label>Precio/día<input type="number" value={product.pricePerDay} onChange={(e) => setProducts(p => p.map(x => x.id === product.id ? {...x,pricePerDay:Number(e.target.value)}:x))}/></label><label>Cantidad<input type="number" min="0" value={product.stock} onChange={(e) => setProducts(p => p.map(x => x.id === product.id ? {...x,stock:Number(e.target.value)}:x))}/></label></div>
                      <label className="upload">Cambiar foto<input type="file" accept="image/*" onChange={(e) => uploadImage(e, product.id)}/></label>
                    </div>
                    <div className="product-admin-actions">
                      <label><input type="checkbox" checked={product.active} onChange={(e) => setProducts(p => p.map(x => x.id === product.id ? {...x,active:e.target.checked}:x))}/> Visible</label>
                      <button onClick={() => saveProduct(product)}>Guardar</button>
                      <button className="danger" onClick={() => removeProduct(product.id)}>Eliminar</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "orders" && (
            <>
              <div className="admin-title"><div><p className="eyebrow">Agenda y disponibilidad</p><h1>Reservas</h1></div></div>
              <div className="admin-orders">
                {!orders.length && <div className="admin-card empty-orders">Todavía no hay solicitudes.</div>}
                {orders.map((order) => (
                  <article className="admin-order admin-card" key={order.id}>
                    <div><span className={`order-chip ${order.status}`}>{order.status === "confirmed" ? "Confirmada" : order.status === "cancelled" ? "Cancelada" : "Pendiente"}</span><h3>{order.customerName}</h3><p>{order.id} · {order.startDate} al {order.endDate}</p></div>
                    <ul>{order.items.map((item) => <li key={item.id}>{item.quantity} × {item.productName}</li>)}</ul>
                    <strong>{new Intl.NumberFormat("es").format(order.total)} {settings.currency}</strong>
                    <div><button onClick={() => updateOrder(order.id,"confirmed")}>Confirmar</button><button className="danger" onClick={() => updateOrder(order.id,"cancelled")}>Cancelar</button></div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
