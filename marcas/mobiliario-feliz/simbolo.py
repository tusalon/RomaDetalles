from PIL import Image, ImageDraw
import math

CORAL = (232, 96, 122)
CARBON = (43, 43, 43)
BLANCO = (255, 255, 255)

# Geometría del signo en una caja de 1000 x 1000 (y hacia abajo).
W = 84              # grosor único del trazo: todo el sistema deriva de él
R = 240             # radio (línea media) del arco
CX, CY = 500, 440   # centro del semicírculo
PIE = 800           # centro del remate redondo de las patas
SR = 128            # radio (línea media) de la sonrisa
SCY = 515           # centro de la sonrisa
SA0, SA1 = 30, 150  # extremos de la sonrisa (grados; 90 = abajo)

# Caja visual exacta del signo (para centrarlo con precisión).
CAJA = (CX - R - W / 2, CY - R - W / 2, CX + R + W / 2, PIE + W / 2)


def _banda_arco(c, r, w, a0, a1, n=360):
    """Contorno exacto de un trazo circular de grosor w entre a0 y a1."""
    ext = [(c[0] + (r + w / 2) * math.cos(math.radians(a)),
            c[1] + (r + w / 2) * math.sin(math.radians(a)))
           for a in [a0 + (a1 - a0) * i / n for i in range(n + 1)]]
    inn = [(c[0] + (r - w / 2) * math.cos(math.radians(a)),
            c[1] + (r - w / 2) * math.sin(math.radians(a)))
           for a in [a1 - (a1 - a0) * i / n for i in range(n + 1)]]
    return ext + inn


def dibujar_simbolo(draw, ox, oy, s, color):
    """Dibuja el signo con origen (ox, oy) y escala s (1 = caja de 1000)."""
    t = lambda p: (ox + p[0] * s, oy + p[1] * s)
    w = W * s

    def disco(p):
        x, y = t(p)
        draw.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)

    # Arco superior + patas, como un único contorno sin costuras.
    arco = _banda_arco((CX, CY), R, W, 180, 360)
    draw.polygon([t(p) for p in arco], fill=color)
    # Cada pata es un solo polígono con su remate semicircular: sin el
    # rectángulo + círculo de antes, que dejaba una muesca al pie.
    for x in (CX - R, CX + R):
        remate = [(x + W / 2 * math.cos(math.radians(a)), PIE + W / 2 * math.sin(math.radians(a)))
                  for a in range(0, 181, 2)]
        draw.polygon([t(p) for p in [(x - W / 2, CY - 1), (x + W / 2, CY - 1)] + remate], fill=color)

    # Sonrisa.
    draw.polygon([t(p) for p in _banda_arco((CX, SCY), SR, W, SA0, SA1)], fill=color)
    for a in (SA0, SA1):
        disco((CX + SR * math.cos(math.radians(a)), SCY + SR * math.sin(math.radians(a))))


def render(tam, color=CORAL, fondo=BLANCO, ss=4, margen=0.16):
    """Signo centrado en un cuadrado de tam px, con margen relativo."""
    S = tam * ss
    img = Image.new('RGB', (S, S), fondo)
    d = ImageDraw.Draw(img)
    cw, ch = CAJA[2] - CAJA[0], CAJA[3] - CAJA[1]
    s = S * (1 - 2 * margen) / max(cw, ch)
    ox = (S - cw * s) / 2 - CAJA[0] * s
    oy = (S - ch * s) / 2 - CAJA[1] * s
    dibujar_simbolo(d, ox, oy, s, color)
    return img.resize((tam, tam), Image.LANCZOS)


if __name__ == '__main__':
    render(800).save(r'C:\Users\RODO\AppData\Local\Temp\claude\mf-logo\simbolo-prueba.png')
    print('ok')
