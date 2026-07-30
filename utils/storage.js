// utils/storage.js - Imagenes de servicios en Cloudinary

// Polyfill localStorage para modo privado en iOS (donde lanza SecurityError)
(function() {
    try {
        localStorage.setItem('__ls_test__', '1');
        localStorage.removeItem('__ls_test__');
    } catch (e) {
        const mem = {};
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem:    (k) => Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null,
                setItem:    (k, v) => { mem[String(k)] = String(v); },
                removeItem: (k) => { delete mem[k]; },
                clear:      () => { Object.keys(mem).forEach(k => delete mem[k]); },
                key:        (i) => Object.keys(mem)[i] || null,
                get length() { return Object.keys(mem).length; }
            },
            writable: false, configurable: true
        });
        console.warn('localStorage no disponible (modo privado) — usando memoria temporal');
    }
})();

console.log('storage.js cargado (Cloudinary)');

// 25MB y no 8: los celulares de 48MP+ sacan fotos de 8-15MB y el limite se
// mide ANTES de comprimir, asi que un tope bajo rechazaba fotos legitimas que
// habrian terminado pesando ~200KB. Si el telefono no puede con una imagen
// enorme, el try/catch de abajo lo avisa en vez de fallar en silencio.
const CLOUDINARY_MAX_ORIGINAL_MB = 25;
const CLOUDINARY_MAX_DIMENSION = 1200;
const CLOUDINARY_IMAGE_QUALITY = 0.75;

// Carpetas dentro de la cuenta de Cloudinary. Un mismo upload preset sin
// firma sirve para todas: la carpeta se manda en cada subida.
const CLOUDINARY_FOLDER_SERVICIOS = 'rservasroma/servicios';
const CLOUDINARY_FOLDER_FONDOS = 'rservasroma/fondos';
const CLOUDINARY_FOLDER_PRODUCTOS = 'romadetalles/productos';

function getCloudinaryConfig() {
    return {
        cloudName: window.CLOUDINARY_CLOUD_NAME || localStorage.getItem('cloudinaryCloudName') || '',
        uploadPreset: window.CLOUDINARY_UPLOAD_PRESET || localStorage.getItem('cloudinaryUploadPreset') || ''
    };
}

function slugArchivoImagen(valor) {
    return String(valor || 'servicio')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'servicio';
}

function cargarImagenEnCanvas(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('No se pudo leer la imagen'));
        };
        image.src = objectUrl;
    });
}

async function comprimirImagenServicio(file, maxDimension) {
    const limite = maxDimension || CLOUDINARY_MAX_DIMENSION;
    const image = await cargarImagenEnCanvas(file);
    const scale = Math.min(1, limite / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            resolve(blob || file);
        }, 'image/jpeg', CLOUDINARY_IMAGE_QUALITY);
    });
}

// Sube una imagen a Cloudinary comprimiendola antes en el navegador.
// Devuelve { url, publicId, width, height, bytes } o null si algo falla
// (los errores se avisan con alert, igual que el resto del panel).
async function subirImagenACloudinary(file, opciones) {
    const config = opciones || {};
    const folder = config.folder || CLOUDINARY_FOLDER_SERVICIOS;
    const etiqueta = config.etiqueta || 'imagen';
    const tags = config.tags || 'rservasroma';
    const maxDimension = config.maxDimension || CLOUDINARY_MAX_DIMENSION;

    try {
        if (!file) {
            console.error('No se proporciono archivo');
            return null;
        }

        if (!file.type.startsWith('image/')) {
            alert('Solo se permiten archivos de imagen');
            return null;
        }

        if (file.size > CLOUDINARY_MAX_ORIGINAL_MB * 1024 * 1024) {
            alert(`La imagen no puede superar los ${CLOUDINARY_MAX_ORIGINAL_MB}MB`);
            return null;
        }

        const { cloudName, uploadPreset } = getCloudinaryConfig();
        if (!cloudName || !uploadPreset || cloudName.includes('TU_') || uploadPreset.includes('TU_')) {
            alert('Falta configurar Cloudinary: CLOUDINARY_CLOUD_NAME y CLOUDINARY_UPLOAD_PRESET.');
            return null;
        }

        const imagenComprimida = await comprimirImagenServicio(file, maxDimension);
        const formData = new FormData();
        formData.append('file', imagenComprimida, `${slugArchivoImagen(etiqueta)}-${Date.now()}.jpg`);
        formData.append('upload_preset', uploadPreset);
        formData.append('folder', folder);
        formData.append('tags', tags);

        console.log(`Subiendo imagen a Cloudinary (${folder})`);

        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Error al subir imagen:', error);
            alert('No se pudo subir la imagen. Revisa tu conexion e intenta de nuevo.');
            return null;
        }

        const data = await response.json();
        console.log('Imagen subida:', data.secure_url);

        return {
            url: data.secure_url,
            publicId: data.public_id,
            width: data.width,
            height: data.height,
            bytes: data.bytes
        };
    } catch (error) {
        console.error('Error en subirImagenACloudinary:', error);
        alert('Error al procesar la imagen.');
        return null;
    }
}

window.subirImagenACloudinary = subirImagenACloudinary;

// Foto de un servicio (se ve como miniatura en el panel y al reservar).
window.subirImagenServicio = function(file, servicioId) {
    return subirImagenACloudinary(file, {
        folder: CLOUDINARY_FOLDER_SERVICIOS,
        etiqueta: servicioId || 'servicio',
        tags: 'rservasroma,servicio',
        maxDimension: 1000
    });
};

// Imagen de fondo propia del negocio (pantalla de bienvenida y acceso de la
// clienta). 1200px basta: se muestra a pantalla completa pero detras de una
// capa oscura, y en Cuba pesa mas la velocidad que el detalle.
window.subirImagenFondo = function(file, negocioId) {
    return subirImagenACloudinary(file, {
        folder: CLOUDINARY_FOLDER_FONDOS,
        etiqueta: negocioId || 'fondo',
        tags: 'rservasroma,fondo',
        maxDimension: 1200
    });
};

// Foto de un artículo de alquiler (RomaDetalles). 1200px porque aquí la foto
// ES el producto: la clienta decide si alquila una estructura por cómo se ve,
// así que vale la pena algo más de detalle que en una miniatura de servicio.
window.subirFotoProducto = function(file, productoId) {
    return subirImagenACloudinary(file, {
        folder: CLOUDINARY_FOLDER_PRODUCTOS,
        etiqueta: productoId || 'producto',
        tags: 'romadetalles,producto',
        maxDimension: 1200
    });
};

window.eliminarImagenServicio = async function() {
    console.warn('Para borrar imagenes de Cloudinary hace falta una firma segura desde backend.');
    return true;
};

console.log('storage.js funciones Cloudinary disponibles');
