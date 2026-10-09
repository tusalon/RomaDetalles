"""Genera los íconos y la pantalla de carga de la APK de Mobiliario Feliz.

Copia exacta de la estructura de android/app/src/main/res (mismos nombres y
tamaños que la APK de RomaDetalles), pero con su logo: fondo coral y el arco
con sonrisa en blanco, sin la flor (a tamaño de ícono se lee mejor limpio).
El workflow build-android-mobiliario-feliz-apk.yml copia esta carpeta res/
encima de la de RomaDetalles antes de compilar.

Uso:  python marcas/mobiliario-feliz/generar-android.py
"""
import os
from PIL import Image, ImageDraw
import simbolo as S

AQUI = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(AQUI, 'res')
CORAL = S.CORAL + (255,)
BLANCO = S.BLANCO + (255,)
TRANSP = (0, 0, 0, 0)
SS = 4

CW = S.CAJA[2] - S.CAJA[0]
CH = S.CAJA[3] - S.CAJA[1]

DENSIDADES = {'ldpi': 0.75, 'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def signo(img, alto_rel, color):
    """Signo centrado en la imagen, con alto = alto_rel del lado menor."""
    w, h = img.size
    alto = min(w, h) * alto_rel
    s = alto / CH
    ox = (w - CW * s) / 2 - S.CAJA[0] * s
    oy = (h - alto) / 2 - S.CAJA[1] * s
    S.dibujar_simbolo(ImageDraw.Draw(img), ox, oy, s, color[:3])


def pieza(ancho, alto, fondo, alto_rel, forma=None):
    img = Image.new('RGBA', (ancho * SS, alto * SS), TRANSP if forma else fondo)
    d = ImageDraw.Draw(img)
    if forma == 'circulo':
        d.ellipse([0, 0, ancho * SS - 1, alto * SS - 1], fill=fondo)
    elif forma == 'cuadrado':
        d.rounded_rectangle([0, 0, ancho * SS - 1, alto * SS - 1], radius=ancho * SS * 0.22, fill=fondo)
    if alto_rel:
        signo(img, alto_rel, BLANCO)
    return img.resize((ancho, alto), Image.LANCZOS)


def guardar(img, ruta_rel):
    ruta = os.path.join(RES, ruta_rel)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    img.save(ruta)


def main():
    for nombre, k in DENSIDADES.items():
        lado = round(48 * k)
        capa = round(108 * k)
        guardar(pieza(lado, lado, CORAL, 0.52, 'cuadrado'), f'mipmap-{nombre}/ic_launcher.png')
        guardar(pieza(lado, lado, CORAL, 0.50, 'circulo'), f'mipmap-{nombre}/ic_launcher_round.png')
        # Ícono adaptativo: el XML ya aplica un inset de 16.7 %, así que la
        # capa delantera se dibuja dentro de la zona visible del launcher.
        guardar(pieza(capa, capa, CORAL, 0), f'mipmap-{nombre}/ic_launcher_background.png')
        fg = Image.new('RGBA', (capa * SS, capa * SS), TRANSP)
        signo(fg, 0.56, BLANCO)
        guardar(fg.resize((capa, capa), Image.LANCZOS), f'mipmap-{nombre}/ic_launcher_foreground.png')

    # Pantalla de carga: mismos tamaños que las de RomaDetalles.
    splash = {
        'drawable': (320, 480), 'drawable-night': (320, 240),
        'drawable-port-ldpi': (240, 320), 'drawable-port-mdpi': (320, 480),
        'drawable-port-hdpi': (480, 800), 'drawable-port-xhdpi': (720, 1280),
        'drawable-port-xxhdpi': (960, 1600), 'drawable-port-xxxhdpi': (1280, 1920),
        'drawable-land-ldpi': (320, 240), 'drawable-land-mdpi': (480, 320),
        'drawable-land-hdpi': (800, 480), 'drawable-land-xhdpi': (1280, 720),
        'drawable-land-xxhdpi': (1600, 960), 'drawable-land-xxxhdpi': (1920, 1280),
    }
    for carpeta, (w, h) in splash.items():
        img = pieza(w, h, CORAL, 0.30)
        guardar(img, f'{carpeta}/splash.png')
        if carpeta.startswith('drawable-port-') or carpeta.startswith('drawable-land-'):
            guardar(img, carpeta.replace('-port-', '-port-night-').replace('-land-', '-land-night-') + '/splash.png')

    with open(os.path.join(RES, 'values', 'strings.xml'), 'w', encoding='utf-8') as f:
        f.write("""<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">Mobiliario Feliz</string>
    <string name="title_activity_main">Mobiliario Feliz</string>
    <string name="package_name">com.mobiliariofeliz.admin</string>
    <string name="custom_url_scheme">com.mobiliariofeliz.admin</string>
</resources>
""")
    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w', encoding='utf-8') as f:
        f.write("""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#E8607A</color>
</resources>
""")
    print('ok')


if __name__ == '__main__':
    os.makedirs(os.path.join(RES, 'values'), exist_ok=True)
    main()
