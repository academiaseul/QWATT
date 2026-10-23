# Registro de cambios · QWATT

Lo hecho cada semana del sprint Instawards Chile, desde el 19 oct 2026. Lo anterior a ese día está en [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md).

## Semana 1 · 19–23 oct 2026

Publicado el viernes 23 de octubre. Todo corre solo en Stellar testnet y con entrada simulada: esta semana no se leyó ningún medidor físico ni ninguna instalación real.

**Verificación y lotes.** Fusionados el 21 oct en [#7](https://github.com/academiaseul/QWATT/pull/7), [#5](https://github.com/academiaseul/QWATT/pull/5), [#1](https://github.com/academiaseul/QWATT/pull/1) y [#8](https://github.com/academiaseul/QWATT/pull/8). Cada arreglo tiene su prueba en un commit anterior, que falla hasta que llega el arreglo.

- **S1 · El verificador ya no confía en el total heredado.** Antes de firmar recorre la cadena de lotes hasta el último anclado en testnet, recalcula el hash de cada lote y vuelve a sumar los totales (`bdd5784` prueba, `09210b0` arreglo).
- **S2 · La misma energía no cuenta dos veces.** Entre lotes se rechazan los intervalos repetidos, superpuestos, fuera de grilla o de otro sitio. Hay cuatro casos de manipulación (`6204b12` prueba, `40aaa3d` arreglo).
- **Revisión de S1 y S2 (DV-1 a DV-5):**
  - la referencia de tiempo sale solo del último lote aceptado;
  - un lote rechazado no aporta energía al total anclado;
  - cada lote anterior se descarga una vez y se recalcula su hash antes de leerlo;
  - la entrada aplica, línea por línea, las reglas del verificador;
  - el recorrido de la cadena tiene un límite con su propio código de motivo, `verifier.walk_too_long`, y el proponente hace el mismo recorrido antes de proponer.

  Prueba en `301bc50`, arreglo en `8385da3`.
- **Ingesta HTTP (DV-4, en `8385da3`).** `POST /intervals` guarda cada instante en UTC canónico. Si la forma de escribirlo cambia, guarda el hash de la solicitud en `raw_sha256`, y si el intervalo cae fuera de la grilla responde 400 `ingest.off_grid`.
- **CI.** `main` quedó en rojo en las corridas #26 a #28 mientras se fusionaban las pruebas antes que su arreglo. Volvió a verde en la [corrida #30](https://github.com/academiaseul/QWATT/actions/runs/39593847463), sobre `c1ae630`.

**Sitio y repositorio.** Fusionados el 21 oct en [#6](https://github.com/academiaseul/QWATT/pull/6), [#2](https://github.com/academiaseul/QWATT/pull/2) y [#3](https://github.com/academiaseul/QWATT/pull/3).

- **Portada.** Una portada solo de verificación para el sprint. Lo que dice de la entrada simulada es exacto, no tiene enlaces ni afirmaciones sobre el token y no usa analítica (`8175ba9`, `255f541`, `ad71bee`, `799ab5a`).
- **Documentación.** El README explica qué es QWATT, el sprint y el descargo completo. El trabajo previo está rotulado y separado en [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md). Se agregaron este registro y lo que deben aportar los fundadores, en [docs/FOUNDER-CHECKLIST.md](docs/FOUNDER-CHECKLIST.md).
- **Limpieza.** Se dejaron de desplegar las páginas del token de agosto. Se dejaron de versionar las presentaciones antiguas, los documentos internos y la SOW v3 reemplazada. `stellar.toml` describe solo testnet.

**Congelación de la arquitectura v3.** Los dos fundadores la acordaron el miércoles 21 de octubre (Día 3), con los umbrales 2/2/3 para la cuenta de anclaje (OD-1). El documento está en la rama `semana-1/acuerdo-v3` ([docs/ARCHITECTURE-FREEZE-v3.md](https://github.com/academiaseul/QWATT/blob/semana-1/acuerdo-v3/docs/ARCHITECTURE-FREEZE-v3.md)) y entra a `main` cuando se fusione. La prueba de esos umbrales está en la rama `semana-1/umbrales-2-2-3` (`075b14e`): queda en rojo a propósito hasta que se aplique el cambio.

**Entregable 1 (ingesta independiente del medidor): evidencia completa.** La ingesta es trabajo previo: `98b281a`, del 9 sep 2026. Esta semana se completó su evidencia, resumida con sus límites en [docs/DELIVERABLE-1-EVIDENCE.md](docs/DELIVERABLE-1-EVIDENCE.md):

- **Prueba de aceptación.** Su salida quedó guardada en [evidence/harness/harness-c1ae630.txt](evidence/harness/harness-c1ae630.txt). La genera `node ingest/capture-evidence.js c1ae630`. Dos horas simuladas de datos solares, con muestras cada 10 s, pasan por CSV, HTTP y Modbus y dan registros idénticos byte a byte; el camino Modbus corre contra un simulador.
- **Modbus RTU.** Se prueba contra un puerto serie en memoria, sin hardware.
- **Mapas de registros.** Se revisaron campo por campo contra los documentos de protocolo de cada fabricante. Faltan dos registros de batería del EPEver, que necesitan una lectura en vivo.
- **`raw_sha256`.** La regla exacta está en `ingest/README.md`, y las pruebas recalculan el hash desde la entrada.
