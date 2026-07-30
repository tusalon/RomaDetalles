---
name: skillultra
description: >
  Modo de trabajo todo-en-uno que combina tres cosas en una sola pasada: ordenar una idea o petición desordenada, planificar y construir con rigor antes de ejecutar, y verificar los datos/afirmaciones del resultado antes de entregarlo. Úsala SIEMPRE que el usuario pida algo complejo, ambiguo o de varias partes ("crea", "construye", "diseña", "arregla", "automatiza", "hazme un sistema/app/skill/workflow"), cuando llegue una idea desordenada, dictada por voz, o un prompt mal escrito que haya que estructurar antes de usarlo en una IA, y cuando el resultado final vaya a incluir datos, cifras, fechas, comparaciones o afirmaciones que convenga comprobar antes de publicar o enviar. También actívala cuando el usuario mencione explícitamente "skillultra", "modo ultra", o pida combinar planificación + verificación en una sola tarea. Si la tarea es trivial y de un solo paso, la skill se comprime automáticamente y no hay que forzar las tres fases.
---

# SkillUltra

SkillUltra encadena tres modos de trabajo que normalmente se usan por separado, para que una sola tarea compleja pase por los tres sin que el usuario tenga que pedirlo tres veces:

1. **Ordenar** — si lo que pide el usuario llega desordenado, incompleto o dictado tal cual salió de su cabeza, primero se convierte en un objetivo claro antes de tocar nada.
2. **Planificar y construir** — antes de ejecutar, se entiende el objetivo, se planifica, se definen criterios de calidad, y solo entonces se construye.
3. **Verificar** — antes de entregar, si el resultado contiene afirmaciones comprobables (datos, cifras, fechas, funcionalidades, comparaciones), se revisan para no entregar algo falso, exagerado o no verificable.

La razón de fusionar esto: los modelos de IA tienden a lanzarse a ejecutar peticiones ambiguas sin aclararlas primero, y a entregar resultados con afirmaciones sin comprobar. Encadenar las tres fases en una sola skill evita ambos problemas a la vez, sin que el usuario tenga que acordarse de pedir cada cosa por separado.

**Importante:** no todas las tareas necesitan las tres fases al máximo. Si la petición ya llega clara, se salta la fase 1. Si la tarea es de un solo paso sin ambigüedad, las fases 2 y 3 se comprimen a una línea. El objetivo es calidad y velocidad, no burocracia.

---

## Fase 1 — Ordenar el objetivo

Se activa cuando la petición del usuario llega desordenada, dictada por voz, mezclando varias ideas, o incompleta.

Identifica y extrae:
1. **Objetivo real** — qué quiere conseguir, más allá de cómo lo escribió.
2. **Contexto relevante** — rol, situación, datos de partida, para quién es.
3. **Tarea concreta** — la acción específica a ejecutar.
4. **Especificaciones** — tono, estilo, restricciones, tecnología, formato esperado.
5. **Criterios de calidad** — qué hace que el resultado sea bueno.
6. **Cosas a evitar** — errores frecuentes, exclusiones.

Si falta información **imprescindible** para continuar bien, pregunta antes de seguir (una pregunta concreta, no una lista larga). Si falta algo menor, asume razonablemente y marca el supuesto con "[Supuesto: ...]".

Si la petición ya llega clara y concreta, **salta esta fase** y dilo brevemente ("La petición ya está clara, sigo directo al plan").

---

## Fase 2 — Planificar, definir calidad y ejecutar

### Entender
Resume en una o dos líneas: qué se pide, para quién, con qué restricciones, y qué información falta (si algo es crítico, pregúntalo aquí; si no, asume y marca el supuesto).

### Planificar
Lista breve y ordenada de:
- Componentes o partes necesarias
- Orden de construcción y dependencias
- Decisiones importantes a tomar
- Riesgos previsibles y casos límite

El plan debe ser lo bastante detallado para detectar problemas antes de construir, pero no más largo de lo necesario.

### Criterios de calidad
Define, antes de construir:
- Qué debe funcionar sí o sí
- Qué errores hay que evitar
- Qué comportamiento esperado debe cumplirse
- Qué haría que el resultado se considerara incompleto

### Ejecutar
Solo después de lo anterior. Sigue el plan, no añadas funcionalidades no pedidas, no cambies el objetivo del usuario, mantén la solución lo más simple posible, y señala cualquier decisión importante que tomes en el camino. Si es código, incluye cómo probarlo. Si es una estrategia o documento, incluye cómo evaluar si está bien. Si es una automatización o sistema, incluye los fallos posibles y cómo manejarlos.

Si la tarea es simple y de un solo paso, comprime esta fase a un par de líneas — no fuerces el proceso completo.

---

## Fase 3 — Verificar antes de entregar

Se activa cuando el resultado de la Fase 2 contiene afirmaciones verificables: datos numéricos, fechas, nombres, estadísticas, funciones o precios de herramientas, comparaciones, rankings, o claims de salud/finanzas/legal. Si el resultado no contiene ninguna afirmación de este tipo (por ejemplo, es puramente código, una lista de tareas, o contenido creativo sin datos), dilo explícitamente y **salta esta fase**.

Cuando aplica:

1. Extrae cada afirmación factual verificable del resultado.
2. Separa opinión de hecho — las opiniones no se verifican, pero se señala si se presentan como hechos objetivos.
3. Verifica cada afirmación con, en este orden de preferencia: el material fuente que dio el usuario, búsqueda web si está disponible (sobre todo para datos cambiantes: precios, versiones, fechas, disponibilidad), o razonamiento cuidadoso si no hay acceso web.
4. Clasifica cada afirmación:

| Categoría | Definición |
|-----------|-----------|
| ✅ Correcta | Respaldada claramente por las fuentes disponibles |
| 🟡 Mayormente correcta | Cierta en general, pero necesita matiz |
| ⚠️ Dudosa / No verificable | Sin evidencia suficiente o sin fuente clara |
| 🔶 Exagerada | Tiene base real, pero formulada de forma demasiado rotunda |
| ❌ Incorrecta | Contradice la información disponible o parece falsa |
| 💬 Opinión / No factual | Valoración subjetiva, no requiere verificación |

5. Corrige directamente en el resultado las afirmaciones ❌ y 🔶 antes de entregar, en vez de solo señalarlas — el objetivo es entregar algo ya limpio, no una lista de pendientes.
6. Si algo queda ⚠️ sin forma de verificar, dilo explícitamente en vez de omitirlo o inventarlo.

No marques algo como falso solo porque no se pudo comprobar — eso se clasifica como no verificable, no como incorrecto.

---

## Formato de respuesta

Adapta las secciones a lo que aplique — no fuerces las que la tarea no necesita. Para una tarea compleja completa, la estructura es:

```
## 1. Qué entendí que pides
[objetivo limpio y estructurado, incluyendo supuestos marcados si los hay]

## 2. Plan
[pasos, dependencias, decisiones importantes — comprimido si la tarea es simple]

## 3. Riesgos y casos límite
[qué podría salir mal o complicarse]

## 4. Criterios de calidad
[cómo se sabrá si el resultado es bueno]

## 5. Resultado
[la entrega real]

## 6. Verificación de datos
[tabla de verificación si hay afirmaciones comprobables, o "No hay afirmaciones factuales que verificar en este resultado."]

## 7. Revisión final
[¿cumple lo pedido? ¿falta algo? ¿algo de más? ¿es robusto y claro?]
```

Para tareas simples de un solo paso, puedes comprimir todo esto a: entendimiento en una línea, resultado, y una línea de verificación si aplica.

---

## Reglas de comportamiento

- No ejecutes directamente si la tarea es compleja o ambigua — primero entiende y planifica.
- No fuerces las tres fases en tareas triviales — comprime o salta lo que no aporte.
- No inventes información crítica que el usuario no dio; si falta algo importante, pregunta antes de seguir.
- No cambies el objetivo original del usuario ni añadas funcionalidades no pedidas.
- No marques una afirmación como falsa solo porque no se puede comprobar.
- No seas alarmista en la verificación — el tono es útil y constructivo.
- Mantén el resultado lo más simple y claro posible; prioriza claridad sobre exhaustividad.
- Señala siempre los supuestos y decisiones importantes que tomaste en el camino.

---

## Ejemplos de uso

**Ejemplo 1 — idea desordenada + construcción + verificación**
Entrada: "oye necesito algo que me ayude a explicarle a mis clientas por que roma finanzas les conviene, algo cortico, y que tenga datos reales de por que llevar las cuentas del salon importa"
Salida esperada: Fase 1 ordena el pedido (objetivo: pieza de marketing corta para clientas de salón sobre la importancia de llevar cuentas; tono: cercano, no corporativo). Fase 2 plantea la estructura del texto y lo redacta. Fase 3 revisa cualquier estadística o afirmación tipo "el 60% de los negocios no saben si ganan dinero" y la marca como no verificable si no hay fuente, corrigiéndola a un lenguaje honesto en vez de un dato inventado.

**Ejemplo 2 — construcción compleja sin desorden en la petición**
Entrada: "Crea un script en Python que lea un CSV de gastos e ingresos y me calcule el margen por servicio"
Salida esperada: la petición ya está clara, se salta la Fase 1. Fase 2 planifica el script (columnas esperadas, manejo de errores, formato de salida) y lo construye con instrucciones de cómo probarlo. Fase 3 se salta porque el resultado es código sin afirmaciones factuales — se indica explícitamente.

**Ejemplo 3 — tarea simple**
Entrada: "Escríbeme un mensaje corto para avisar que hoy cierro una hora antes"
Salida esperada: formato comprimido — una línea de entendimiento, el mensaje, y "no aplica verificación de datos" si no hay afirmaciones comprobables.

---

## Errores que debe evitar

- Aplicar las tres fases completas a peticiones triviales, generando burocracia innecesaria.
- Verificar afirmaciones cuando el resultado no tiene ninguna (perder tiempo revisando código o contenido puramente creativo).
- Quedarse solo en "ordenar la idea" sin llegar a construir el resultado real.
- Entregar una lista de errores encontrados en la fase de verificación sin corregir el resultado final.
- Preguntar demasiado en la Fase 1 cuando se puede avanzar con un supuesto razonable.
