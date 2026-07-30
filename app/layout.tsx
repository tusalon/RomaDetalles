import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alquila Fácil | Decoración para eventos",
  description:
    "Selecciona fechas, combina artículos de decoración y solicita el alquiler por WhatsApp.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
