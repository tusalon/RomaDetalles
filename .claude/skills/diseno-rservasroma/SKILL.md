---
name: diseno-rservasroma
description: |
  Sistema de diseño UI/UX del ecosistema Rservasroma. Conoce la identidad visual completa de todas las apps: ExoticNailsByYuli, RomaFinanzas, RomaCrece, SuperAdmin y HouseofRservasRoma.

  Actívate SIEMPRE cuando la tarea involucre diseño + Rservasroma:
  - "diseña esta pantalla", "crea el mockup de X", "cómo se vería Y en la app"
  - "componente para Z", "crea la UI de...", "diseña el onboarding"
  - Crear o proponer cualquier pantalla, vista, componente o elemento visual de las apps del ecosistema
  - Cuando se pida HTML visual o código React/Tailwind para cualquier app de Rservasroma
  - Cualquier tarea de diseño que mencione rservasroma, romafinanzas, romacrece, superadmin, exotic, o cualquier app del ecosistema

  Produce HTML mockup listo para ver en browser O código React/Tailwind para integrar en la app — según lo que se necesite. Todo sale con la identidad de marca correcta sin tener que explicarla.
---

# Sistema de Diseño Rservasroma

Eres el diseñador UI/UX del ecosistema Rservasroma. Conoces la identidad visual de todas las apps de memoria. Cuando te activas, produces diseños consistentes con la marca sin que el usuario tenga que explicar colores, tipografía ni estilo cada vez.

---

## Paso 0 — Detectar qué producir

Antes de diseñar, identifica qué formato necesita la tarea:

**→ HTML mockup** cuando:
- Se pide "ver cómo se vería", "mockup", "presentación visual", "muéstrame la pantalla"
- Es para revisar o validar el diseño visualmente
- Se va a presentar a alguien o usar como referencia

**→ Código React/Tailwind** cuando:
- Se va a integrar directamente en la app (RomaFinanzas, RomaCrece)
- Se pide "componente", "código", "para la app"
- El stack de la app es React + Tailwind

**→ Ambos** cuando la tarea lo requiera o no quede claro — primero el mockup visual, luego el código.

Si no queda claro, pregunta una sola vez: "¿Lo necesitas para ver en browser o para meter en la app?"

---

## Sistema de diseño

### Colores

```css
/* Colores principales */
--roma-pink: #FF1493;        /* Rosa fucsia — color principal de marca */
--roma-pink-light: #FF69B4;  /* Rosa suave — hover, fondos sutiles */
--roma-pink-dark: #C71585;   /* Rosa oscuro — estados activos */
--roma-black: #1A1A1A;       /* Negro principal — textos, fondos oscuros */
--roma-white: #FFFFFF;       /* Blanco puro */
--roma-gray-100: #F8F8F8;    /* Fondo de pantalla */
--roma-gray-200: #F0F0F0;    /* Fondos de tarjetas */
--roma-gray-400: #AAAAAA;    /* Textos secundarios */
--roma-gray-600: #666666;    /* Textos de apoyo */

/* Colores semánticos */
--roma-success: #22C55E;     /* Verde — ganancias, logros, métricas positivas */
--roma-danger: #EF4444;      /* Rojo — alertas, pérdidas, errores */
--roma-warning: #F59E0B;     /* Naranja — advertencias, métricas neutras */
--roma-info: #3B82F6;        /* Azul — información, estados neutros */
```

**Regla de uso:**
- Rosa fucsia (#FF1493): botones primarios, acentos, íconos activos, headers de marca
- Negro: textos principales, fondos oscuros de login/splash
- Blanco + grises: fondos de pantalla y tarjetas
- Verde SOLO para métricas positivas, ganancias, logros
- Rojo/naranja SOLO para alertas y errores — nunca decorativo

### Tipografía

```css
/* Stack de fuentes */
font-family: 'Inter', 'SF Pro Display', -apple-system, sans-serif;

/* Escala tipográfica */
--text-xs: 11px;    /* Labels pequeños, badges */
--text-sm: 13px;    /* Textos secundarios, subtítulos */
--text-base: 15px;  /* Texto de cuerpo principal */
--text-lg: 17px;    /* Subtítulos de sección */
--text-xl: 20px;    /* Títulos de tarjeta */
--text-2xl: 24px;   /* Títulos de pantalla */
--text-3xl: 30px;   /* Números de métricas grandes */
--text-4xl: 36px;   /* Números hero, métricas principales */

/* Pesos */
font-weight: 400;   /* Texto normal */
font-weight: 500;   /* Texto medio — subtítulos */
font-weight: 600;   /* Semi-bold — títulos de sección */
font-weight: 700;   /* Bold — títulos, números importantes */
font-weight: 800;   /* Extra-bold — headlines de impacto */
```

### Espaciado y layout

```css
/* Padding de pantalla */
--screen-padding: 16px;      /* Margen lateral en móvil */
--card-padding: 16px;        /* Padding interno de tarjetas */
--section-gap: 24px;         /* Espacio entre secciones */
--item-gap: 12px;            /* Espacio entre items de lista */

/* Bordes redondeados */
--radius-sm: 8px;            /* Tags, badges */
--radius-md: 12px;           /* Tarjetas pequeñas */
--radius-lg: 16px;           /* Tarjetas principales */
--radius-xl: 20px;           /* Modales, sheets */
--radius-full: 9999px;       /* Botones pill, avatares */
```

### Componentes base

#### Botón primario
```css
background: #FF1493;
color: white;
border-radius: 9999px;        /* Siempre pill */
padding: 14px 24px;
font-weight: 700;
font-size: 16px;
width: 100%;                  /* Full-width en móvil */
```

#### Botón secundario
```css
background: transparent;
border: 2px solid #FF1493;
color: #FF1493;
border-radius: 9999px;
padding: 12px 24px;
font-weight: 600;
```

#### Tarjeta estándar
```css
background: white;
border-radius: 16px;
padding: 16px;
box-shadow: 0 2px 8px rgba(0,0,0,0.06);
```

#### Tarjeta de métrica
```css
background: white;
border-radius: 16px;
padding: 20px;
/* Número grande arriba, label pequeño abajo */
/* Número: font-size 30-36px, font-weight 700 */
/* Label: font-size 13px, color #666 */
```

#### Input
```css
background: #F8F8F8;
border: 2px solid transparent;
border-radius: 12px;
padding: 14px 16px;
font-size: 15px;
/* Focus: border-color #FF1493 */
```

#### Menú inferior (Bottom Navigation)
```css
position: fixed;
bottom: 0;
width: 100%;
background: white;
border-top: 1px solid #F0F0F0;
padding: 8px 0 24px;          /* 24px para safe area en iPhone */
/* 4-5 ítems máximo */
/* Ícono activo: color #FF1493 */
/* Ícono inactivo: color #AAAAAA */
```

#### Badge / Tag
```css
background: rgba(255,20,147,0.1);
color: #FF1493;
border-radius: 9999px;
padding: 4px 10px;
font-size: 12px;
font-weight: 600;
```

---

## Estructura de pantallas

### Layout base (todas las apps)
```
┌─────────────────────────────┐
│  TopBar / Header            │  h: 56px, fondo blanco o rosa
│  (título + acciones)        │
├─────────────────────────────┤
│                             │
│  Contenido scrolleable      │  padding: 16px
│  (tarjetas, listas, forms)  │
│                             │
├─────────────────────────────┤
│  Bottom Navigation          │  h: 64px + safe area
└─────────────────────────────┘
```

### Pantalla de login / splash
- Fondo negro o rosa fucsia
- Logo/mascota Roma centrada
- Tagline en blanco
- Botón principal en rosa (sobre fondo negro) o en negro (sobre fondo rosa)

### Dashboard
- Header con saludo + nombre del negocio
- Fila de métricas: 2 tarjetas por fila, números grandes
- Secciones con título + lista de items o cards
- FAB (botón flotante) rosa para acción principal si aplica

### Formularios / Onboarding
- Una pregunta por pantalla (paso a paso)
- Progreso visual arriba (dots o barra)
- Botón "Continuar" fijo abajo
- Fondo blanco, inputs en gris claro

---

## La mascota Roma (la pug)

Roma aparece en momentos clave, nunca de fondo decorativo:
- **Splash / Login**: tamaño grande, centrada
- **Onboarding**: acompañando la bienvenida
- **Estado vacío**: cuando no hay datos que mostrar
- **Logro / éxito**: celebrando con la clienta
- **Motivación**: cuando algo salió mal o hay que animar

Versiones disponibles en el universo de marca:
- Roma ilustrada / ícono (para la app)
- Roma 3D rosada (para marketing, posts de RomaCrece)
- Roma real (foto — para redes de Rservasroma)

En código usar el ícono del manifest o un emoji 🐾 como placeholder hasta tener el asset.

---

## Apps del ecosistema y sus variantes

Todas comparten el sistema base. Diferencias por app:

| App | Color de acento | Foco visual |
|---|---|---|
| ExoticNailsByYuli / clientes | Rosa fucsia | Agenda, citas, servicios |
| RomaFinanzas | Rosa fucsia + verde para ganancias | Números, métricas financieras |
| RomaCrece | Rosa fucsia + gradiente | Fases, progreso, checklist semanal |
| SuperAdmin | Rosa fucsia + azul info | Tablas, gestión masiva, estados |
| HouseofRservasRoma | Rosa fucsia | Igual que clientes |

---

## Cómo producir el output

### Si es HTML mockup

Genera un archivo HTML autocontenido con:
- Todo el CSS inline o en `<style>`
- Sin dependencias externas (máximo Google Fonts)
- Viewport mobile: `<meta name="viewport" content="width=device-width, initial-scale=1">`
- Ancho máximo de 390px centrado (tamaño iPhone 14)
- Fondo de página en gris (#F0F0F0) para que se vea el "teléfono"
- Usa los colores, radios, tipografía y componentes del sistema de diseño

Estructura del HTML:
```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>[Nombre de la pantalla] — [App]</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    /* Variables CSS del sistema de diseño */
    /* Reset básico */
    /* Estilos de la pantalla */
  </style>
</head>
<body>
  <!-- Wrapper que simula el teléfono -->
  <div class="phone-wrapper">
    <!-- Contenido de la pantalla -->
  </div>
</body>
</html>
```

### Si es código React/Tailwind

Genera un componente funcional con:
- Tailwind CSS para estilos (clases utilitarias)
- Para el rosa fucsia usar `style={{ color: '#FF1493' }}` o `className` con color hardcodeado donde Tailwind no lo cubra
- Estructura de componentes clara y reutilizable
- Props documentadas brevemente
- Sin lógica de negocio — solo UI

```jsx
// NombrePantalla.js
import { useState } from 'react';

export default function NombrePantalla({ /* props */ }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* contenido */}
    </div>
  );
}
```

---

## Errores que debes evitar

- Usar colores fuera del sistema (azules, morados, amarillos como decoración)
- Verde o rojo como color decorativo — solo para métricas
- Botones cuadrados — siempre pill (border-radius: 9999px) en botones principales
- Texto pequeño que no se lea en móvil (mínimo 13px)
- Diseños no mobile-first
- Muchos elementos en una sola pantalla — priorizar claridad sobre completitud
- Poner a Roma de fondo o de decoración genérica
- Mezclar el estilo de distintas apps sin justificación

---

## Criterios de calidad

Un diseño está bien cuando:
1. Alguien que no conoce Rservasroma lo ve y lo reconoce como parte de la misma familia visual
2. Se ve igual de bien en un iPhone 12 que en un Android básico
3. Los números y textos importantes se leen de un vistazo
4. El rosa fucsia aparece donde debe aparecer — sin exceso ni escasez
5. Roma aparece en el momento correcto, no en todos lados
