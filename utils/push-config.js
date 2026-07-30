// utils/push-config.js — Web Push de RomaDetalles
//
// Misma llave VAPID que rservasroma: comparten el proyecto Supabase y la
// Edge Function `enviar-web-push`, que firma con la llave privada pareja.
// Si algún día RomaDetalles se separa a su propio proyecto, esta llave y la
// privada de la función tienen que cambiar juntas.
window.ROMADETALLES_PUSH_PUBLIC_KEY = 'BBiW2ZRGmtS35uTqW_Cc77VKtaf8v_lIovQ5mErGUQeTr1K29dNqOuRhMAcFH0u3m5SKbvgFse1CLWqAcVtZ074';

// Función que envía los avisos. La llama el servidor (la Edge Function
// crear-pedido-alquiler), nunca el navegador de la clienta.
window.ROMADETALLES_PUSH_FUNCTION = 'enviar-web-push';
