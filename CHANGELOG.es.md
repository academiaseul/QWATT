# Registro de cambios · QWATT

Lo que hicimos cada semana del sprint Instawards Chile, que empezó el 19 oct 2026. El trabajo anterior a ese día está en [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md).

*Traducción al español. El texto oficial es [CHANGELOG.md](CHANGELOG.md), en inglés.*

## Semana 2 — 26 al 30 de octubre de 2026

### Resumen
Esta semana construimos lo que necesita la cuenta de anclaje 2 de 3 definitiva, para que crearla sea una serie de comandos y no código nuevo. Cada clave ahora se crea en la máquina que la usa y firma con stellar-cli. Cada lote lleva una huella de sus lecturas crudas, y el verificador lee la evidencia pública fijada en un solo commit de git y publica su propia bitácora. La página de conciliación volvió a qwatt.org. Las pruebas pasaron de 194 a 449, todas en verde. La cuenta misma, las pruebas A–D y el primer anclaje no ocurrieron esta semana, porque todavía faltan dos de las tres claves públicas (ver Bloqueos). Toda la entrada es simulada.

### Agregado
- **Firma con stellar-cli, nunca con una clave secreta en un archivo** (V3-8):
  - el proponente y el verificador le piden a stellar-cli 28.1.0 que firme, y no arrancan si hay una clave secreta en su entorno ([PR #18](https://github.com/academiaseul/QWATT/pull/18));
  - la cuenta se configura solo con las cuatro claves públicas. Las transacciones de configuración y de fondeo se reconstruyen desde valores públicos y se revisan antes de que nada firme, y [docs/THIRD-SIGNER.md](docs/THIRD-SIGNER.md) le explica al firmante externo al equipo qué hacer ([PR #22](https://github.com/academiaseul/QWATT/pull/22));
  - `keys.js check` confirma una clave en su propia máquina sin leerla, y un simulacro de respaldo prueba que cada respaldo en papel recupera la misma clave antes de crear la cuenta ([PR #23](https://github.com/academiaseul/QWATT/pull/23)).
- **Una huella de cada lectura cruda en cada lote** (V3-5, `samples_root`, formato de lote 1.1.0, desviación DV-6). Las lecturas crudas se publican junto a cada lote en `raw/<batch_id>.jsonl`, y cada lector recalcula la huella ([PR #24](https://github.com/academiaseul/QWATT/pull/24)). La auditoría de la corrida liga cada lectura cruda a una fila de un archivo de muestras publicado ([PR #28](https://github.com/academiaseul/QWATT/pull/28)).
- **Dos repositorios públicos de evidencia, cada uno escrito por un solo host** (V3-7):
  - el publicador, con reglas de integridad, instantáneas consistentes y una auditoría de la historia pública ([PR #19](https://github.com/academiaseul/QWATT/pull/19));
  - la bitácora pública del verificador (sus decisiones, sus rechazos y su estado), publicada solo desde el host del verificador (desviación DV-8; [PR #25](https://github.com/academiaseul/QWATT/pull/25), [PR #26](https://github.com/academiaseul/QWATT/pull/26));
  - cada lector toma un commit de la evidencia, después de leer Stellar, y lee todos los archivos en ese commit, así que nunca mezcla dos versiones ([PR #29](https://github.com/academiaseul/QWATT/pull/29));
  - Jay Kim creó [academiaseul/qwatt-evidence](https://github.com/academiaseul/qwatt-evidence) y [academiaseul/qwatt-verifier-log](https://github.com/academiaseul/qwatt-verifier-log): públicos, con licencia MIT, cada uno con dos reglas en GitHub, una que impide borrar o reescribir la historia y otra que deja escribir solo a la deploy key de su host. Todavía no se ha publicado nada en ellos.
- **Las pruebas A–D y la prueba de independencia, listas para la cuenta definitiva** (V3-4a, desviación DV-7), corridas como una sola secuencia. En el paso de independencia, el código real del verificador debe rechazar un lote retenido de su única entrada ([PR #27](https://github.com/academiaseul/QWATT/pull/27)). Se probaron contra una red simulada; no se han corrido en la cuenta definitiva, que todavía no existe.
- **El desfase del reloj en cada vía de entrada** (V3-6, `clock_skew_s`): cada intervalo registra cuánto se alejaba el reloj del nodo del de la pasarela ([PR #14](https://github.com/academiaseul/QWATT/pull/14), [PR #15](https://github.com/academiaseul/QWATT/pull/15)).
- **Paquete de hosts** ([PR #32](https://github.com/academiaseul/QWATT/pull/32)). Un script instala cualquiera de los dos hosts desde un commit dado:
  - Node 24.14.1 y stellar-cli 28.1.0, cada uno comprobado contra su SHA-256 oficial;
  - solo los servicios del rol de ese host, y su deploy key;
  - en Windows, una tarea que mantiene WSL corriendo sin ventanas abiertas y lo arranca después de reiniciar sin que nadie inicie sesión;
  - 26 pruebas de aceptación, 23 de ellas automáticas.

  Un nuevo job del CI lo instala en una máquina Ubuntu limpia para cada rol. Ese job encontró un defecto antes del merge: el archivo privado de la deploy key quedaba legible por otros (644), y ssh rechaza una clave así. Jay instaló el host del verificador en su PC con este paquete, sin ninguna comprobación fallida. Su clave del verificador se creó en esa máquina, en su propia terminal, y quedó respaldada en papel; su clave pública es `GAJCK4PA3CFEZNQD3TLVWWSMHIXGIBV33SIYWZM6CUTMLH7LQKKSYI3U`.
- **El CI corre cada paso de prueba aunque falle uno anterior,** así un commit en rojo registra cada suite que falla ([PR #13](https://github.com/academiaseul/QWATT/pull/13)).

### Cambiado
- **La conciliación lee la cuenta desde Stellar:** sus firmantes, sus umbrales y las firmas de cada ancla (V3-9.1, [PR #16](https://github.com/academiaseul/QWATT/pull/16), [PR #17](https://github.com/academiaseul/QWATT/pull/17)). El `faults.json` de cada corrida ahora lleva la etiqueta fija "Simulated input · assurance A0 · Stellar testnet", las tres claves públicas de los firmantes y el commit del código con que partió (V3-9.2, [PR #21](https://github.com/academiaseul/QWATT/pull/21)).
- **La página de conciliación volvió** a [qwatt.org/reconcile.html](https://qwatt.org/reconcile.html), con la plantilla del sitio, en español e inglés. Dice que todavía no hay un feed público (V3-9.3, [PR #31](https://github.com/academiaseul/QWATT/pull/31)).
- **Un nombre neutral para el sitio, `qwatt-chispa-01`.** Los ids de los lotes son `qwatt-chispa-01-000000` y no nombran ningún lugar (FD-14, [PR #30](https://github.com/academiaseul/QWATT/pull/30)).
- **Las ideas de agosto volvieron a qwatt.org,** cada una rotulada TESTNET, PROTOTIPO o PLANIFICADO, con una página de verificación que recalcula un lote publicado en el navegador ([PR #12](https://github.com/academiaseul/QWATT/pull/12)).

### Corregido
- **No se estima energía a través de un corte del medidor** de más de tres períodos de muestreo (V3-10, [PR #20](https://github.com/academiaseul/QWATT/pull/20)).
- **Tres defectos encontrados en la revisión de Diego Ostertag de los PR 8 a 14 (27 oct),** cada uno corregido con una prueba en rojo primero:
  1. un "archivo no encontrado" en un commit fijado quedaba guardado para ese commit, así que un solo retraso del servidor de archivos de GitHub justo después de un push podía volverse un rechazo público que ninguna comprobación posterior corregía. Ahora el archivo se vuelve a leer una vez y una falta nunca se guarda ([PR #29](https://github.com/academiaseul/QWATT/pull/29));
  2. un corte de luz en medio de una escritura podía dejar al verificador sin poder volver a arrancar. Ahora se quita la última línea a medio escribir antes de escribir la siguiente ([PR #26](https://github.com/academiaseul/QWATT/pull/26));
  3. el test C tomaba el último anclaje en vez de la transacción que usaron los tests A y B. Ahora busca esa transacción ([PR #27](https://github.com/academiaseul/QWATT/pull/27)).
- **Un archivo vacío llamado `=1000`,** que llegó a main por error, se eliminó ([PR #27](https://github.com/academiaseul/QWATT/pull/27)).

### Progreso vs. semana anterior
Las metas de "Próxima semana" de la semana pasada:

- Meta: crear la cuenta 2 de 3 definitiva → Resultado: no hecho. Pasa al sábado 31 de octubre y domingo 1 de noviembre, el margen del plan. Todavía necesita la clave pública del proponente, que espera el servidor del proponente, y la clave pública del firmante externo al equipo.
- Meta: las pruebas A–D y la prueba de independencia en esa cuenta → Resultado: construidas y probadas contra una red simulada ([PR #27](https://github.com/academiaseul/QWATT/pull/27)); no corridas, porque la cuenta no existe.
- Meta: una huella de todas las lecturas crudas en cada lote → Resultado: hecho ([PR #24](https://github.com/academiaseul/QWATT/pull/24), [PR #28](https://github.com/academiaseul/QWATT/pull/28)). El primer anclaje y su evidencia en los nuevos repositorios → no hecho.
- También para la semana 2 según el acuerdo v3:
  - cada vía de entrada registra su desfase de reloj → hecho;
  - cada clave se crea en su propia máquina → hecho en el código, y la clave del verificador ya existe;
  - la conciliación lee firmantes y umbrales desde Stellar → hecho;
  - no se estima energía a través de un corte → hecho.
- Post de mitad de semana con el test A → no hecho: el test A necesita la cuenta.

**En números**
- Pruebas: 194 en verde en `semana-1` → 449 en verde en main en `03169a8`, 0 en rojo (342 en `npm test`, 107 pruebas de anclaje). CI en main: [corrida #117](https://github.com/academiaseul/QWATT/actions/runs/40983782958).
- Pull requests mergeados: 21 ([#12](https://github.com/academiaseul/QWATT/pull/12) al [#32](https://github.com/academiaseul/QWATT/pull/32)). Commits en main desde `semana-1` hasta `03169a8`: 72, sin contar los commits de merge.
- Desviaciones del acuerdo v3 aprobadas por los dos fundadores: DV-6, DV-7 y DV-8.

### Bloqueos y aprendizajes
- **Faltan dos claves públicas.** La cuenta se crea solo con las tres claves:
  - la clave del proponente espera el servidor del proponente, una máquina siempre encendida en un proveedor de nube, que no se armó esta semana;
  - el firmante externo al equipo ya está elegido y tiene las instrucciones; su clave pública no ha llegado.

  Si no llega antes de la noche del domingo 1 de noviembre, los dos fundadores escribirán juntos una desviación numerada, nunca un cambio en silencio.
- **El [PR #25](https://github.com/academiaseul/QWATT/pull/25) se mergeó solo con su prueba en rojo,** así que main quedó en rojo hasta que el [PR #26](https://github.com/academiaseul/QWATT/pull/26) trajo el cambio. Es el mismo aprendizaje de la semana 1: mergear la prueba junto con su arreglo.
- **Instalar en una máquina limpia encuentra lo que las pruebas en el lugar no encuentran.** La deploy key legible por otros apareció solo cuando el paquete corrió en un Ubuntu nuevo en el CI. En el PC de Jay, el script de Windows registraba su tarea antes de pedir la contraseña, y Windows la rechazó (0x8007052E). Jay corrió una copia corregida que funcionó; el arreglo al repositorio está abierto como [PR #33](https://github.com/academiaseul/QWATT/pull/33).
- **Node 24.14.1 para el CI y los dos hosts** (decisión 1). Los hosts ya lo usan; el cambio del CI está abierto como [PR #34](https://github.com/academiaseul/QWATT/pull/34).

### Próxima semana (2 al 6 de noviembre)
Planificado, todavía no hecho.

Antes del lunes (sábado 31 de octubre y domingo 1 de noviembre):
1. El servidor del proponente, con su clave y su deploy key.
2. La clave pública del firmante externo al equipo, confirmada por voz por los dos fundadores.
3. El simulacro de respaldo.
4. La cuenta 2 de 3 definitiva.
5. Las pruebas A–D y la prueba de independencia en ella, y el primer anclaje.

Semana 3:
- **Decisiones el lunes 2 de noviembre:** qué rechazos del verificador son finales, el fee fijo, dónde corre el chequeo de fuera de los dos hosts, y la pareja suplente (el proponente y el firmante externo al equipo).
- **Código:**
  - un rechazo del verificador es final, con una ventana de validez de máximo 60 minutos y un fee fijo;
  - una lectura con fecha futura ya no bloquea las siguientes;
  - la corrida dura 8 días, para que los 7 días contados queden completos;
  - los servicios se reinician solo después de una falla;
  - ninguna muestra se publica antes de su hora;
  - monitoreo desde fuera de los dos hosts;
  - el rol de suplente.
- **Ensayo y freeze:** un ensayo del commit candidato en una cuenta 2/2/3 desechable, con pruebas de caída. Freeze del código el viernes 6 de noviembre. La corrida parte el sábado 7 de noviembre a las 00:00 hora de Chile, y los 7 días contados van del domingo 8 de noviembre 00:00 al domingo 15 de noviembre 00:00.

### Enlaces
- **Lo nuevo de esta semana, commit por commit:** https://github.com/academiaseul/QWATT/compare/semana-1...semana-2
- **Pull requests:** [#12](https://github.com/academiaseul/QWATT/pull/12) sitio · [#13](https://github.com/academiaseul/QWATT/pull/13) CI · [#14](https://github.com/academiaseul/QWATT/pull/14), [#15](https://github.com/academiaseul/QWATT/pull/15) desfase del reloj · [#16](https://github.com/academiaseul/QWATT/pull/16), [#17](https://github.com/academiaseul/QWATT/pull/17), [#21](https://github.com/academiaseul/QWATT/pull/21), [#31](https://github.com/academiaseul/QWATT/pull/31) conciliación · [#18](https://github.com/academiaseul/QWATT/pull/18), [#22](https://github.com/academiaseul/QWATT/pull/22), [#23](https://github.com/academiaseul/QWATT/pull/23) claves · [#19](https://github.com/academiaseul/QWATT/pull/19), [#25](https://github.com/academiaseul/QWATT/pull/25), [#26](https://github.com/academiaseul/QWATT/pull/26), [#29](https://github.com/academiaseul/QWATT/pull/29) repositorios de evidencia · [#20](https://github.com/academiaseul/QWATT/pull/20) cortes · [#24](https://github.com/academiaseul/QWATT/pull/24), [#28](https://github.com/academiaseul/QWATT/pull/28) lecturas crudas · [#27](https://github.com/academiaseul/QWATT/pull/27) pruebas A–D · [#30](https://github.com/academiaseul/QWATT/pull/30) nombre del sitio · [#32](https://github.com/academiaseul/QWATT/pull/32) paquete de hosts
- **CI en main después del último merge de la semana:** [corrida #117](https://github.com/academiaseul/QWATT/actions/runs/40983782958), en `03169a8`.
- **Repositorio:** https://github.com/academiaseul/QWATT. Con Node.js 20 o superior y git, corre `npm test`; para las pruebas de anclaje, `npm ci --prefix anchor` y después `npm run test:anchor`. Ninguna prueba se conecta a Stellar testnet.
- **Documentos:** [runbook](docs/RUNBOOK.md) · [firmante externo al equipo](docs/THIRD-SIGNER.md) · [formato del feed](protocol/FEED-FORMAT.md) · [paquete de hosts](ops/deploy/host/README.md)

### Términos nuevos de esta semana
- **stellar-cli:** la herramienta oficial de línea de comandos de Stellar. Guarda cada clave en la máquina que la usa y firma ahí.
- **Huella de las lecturas crudas (`samples_root`):** un código calculado a partir de todas las lecturas crudas de un lote, así que una lectura cambiada lo cambia.
- **Repositorio de evidencia:** un repositorio git público donde publica un solo host, y cuya historia nadie puede reescribir.
- **Deploy key:** una clave que le permite a una máquina escribir en un repositorio, y nada más.
- **Commit fijado:** una versión fija de un repositorio, leída completa, para que ningún archivo venga de una copia más antigua.
- **WSL:** el Subsistema de Windows para Linux, que corre Ubuntu dentro de Windows; el host del verificador lo usa.

## Semana 1 — 19 al 23 de octubre de 2026

### Resumen
QWATT es un verificador de código abierto que convierte lecturas de medidores solares en constancias en Stellar testnet, que cualquiera puede volver a comprobar solo con datos públicos; no puede demostrar que un medidor sea exacto ni que la energía se haya producido de verdad. Esta semana cerramos dos formas de engañar a nuestro propio verificador, y cuatro más que encontramos al revisar esos arreglos; las pruebas pasaron de 154 a 194, todas en verde. Toda la entrada es simulada (no se leyó ningún medidor real), y esta semana enviamos 0 transacciones en testnet, a propósito.

### Agregado
- **Trabajo previo, público y rotulado.** Los 20 commits de Diego Ostertag del 8 al 17 oct entraron a este repositorio con sus fechas y su autor originales ([PR #4](https://github.com/academiaseul/QWATT/pull/4)). La etiqueta `dia-1` (`7336e20`) marca el corte, y [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md) lista todo lo anterior (agregado en `6be021f`).
- **40 pruebas automáticas nuevas** (154 → 194), la mayoría intentos de manipulación que deben ser rechazados.
- **Acuerdo de arquitectura v3** ([docs/ARCHITECTURE-FREEZE-v3.md](docs/ARCHITECTURE-FREEZE-v3.md), `b304ddb`), acordado por los dos fundadores el mié 21 oct (Día 3) y registrado en el repositorio el jue 22 oct. Fija el formato de la evidencia, las reglas de firma y de rechazo, y el plan de cada semana. Entró a main en un pull request posterior al PR #10 (ver Bloqueos).
- **Evidencia del Entregable 1, leer cualquier medidor** (`cae00a6`, [PR #10](https://github.com/academiaseul/QWATT/pull/10)): [docs/DELIVERABLE-1-EVIDENCE.md](docs/DELIVERABLE-1-EVIDENCE.md), la salida guardada de la prueba de aceptación ([evidence/harness/harness-c1ae630.txt](evidence/harness/harness-c1ae630.txt)) y 5 pruebas nuevas de lectura de medidores. Una de ellas prueba Modbus RTU (Modbus por cable serie) sobre un puerto simulado.
- **Avisos de licencia** del código de terceros y de los datos públicos: `THIRD_PARTY_NOTICES.md` y `datasets/LICENSE` (`141089a`). Queda un punto abierto: un archivo del trabajo previo de agosto, `assets/vendor/stellar-wallets-kit.js` (no se publica en el sitio), incluye un paquete con licencia GPL-3.0, y todavía no decidimos si lo mantenemos.
- **[CHANGELOG.es.md](CHANGELOG.es.md):** este registro en español.

### Cambiado
- **Un lote rechazado ya no suma energía al total acumulado que se escribirá en Stellar testnet;** lleva el total anterior sin cambios (`8385da3`, [PR #8](https://github.com/academiaseul/QWATT/pull/8)). Estaba planificado para la semana 3; lo hicimos ahora porque, sin esta regla, la misma energía podía contarse dos veces.
- **Umbrales 2/2/3 para la cuenta de anclaje** (`075b14e` prueba, `666c65b` cambio, [PR #9](https://github.com/academiaseul/QWATT/pull/9)). En esa cuenta, que todavía no existe, ninguna clave sola, ni siquiera una de nuestras dos, podrá enviar una transacción; anclar exigirá 2 de las 3 claves, y cambiar firmantes o umbrales, las 3. Nuestras dos claves del equipo, juntas, pueden anclar sin el firmante externo al equipo, pero no pueden cambiar firmantes ni umbrales sin la tercera clave. Ya está incorporado en la herramienta que configura la cuenta y en su verificación, y probado contra una red simulada; la cuenta definitiva está planificada para la próxima semana.
- **El trabajo previo, rotulado con exactitud** (`141089a`). La corrida del 8 oct que antes se llamaba “two-day live run” ahora se describe como lo que fue: un ensayo acelerado de 48 horas simuladas en 4 min 18 s, con cuentas desechables de testnet. Los totales de energía de nuestros informes ahora dicen “Simulated input · Stellar testnet” (entrada simulada).
- **El README, el sitio web y `stellar.toml`** (el archivo público que describe nuestras cuentas de Stellar testnet) ahora describen el sprint, dicen que la entrada es simulada y dicen que usamos solo testnet (`152e088`, [PR #2](https://github.com/academiaseul/QWATT/pull/2); `8175ba9`, `799ab5a`, [PR #6](https://github.com/academiaseul/QWATT/pull/6); `155fb0f`, [PR #3](https://github.com/academiaseul/QWATT/pull/3)). La página de demostración nombra bien el valor anclado: `qwatt.cumulative_mwh`, en milivatios-hora (`ad71bee`).

### Corregido
Las fallas 1 y 2 salieron de nuestra propia revisión de código del 12 oct, antes del Día 1. No afectaron ninguna constancia real: la cuenta de anclaje definitiva todavía no existe, y todos los ensayos usaron cuentas desechables.

- **Falla 1 (S1), “el total heredado”.** El verificador independiente copiaba el total acumulado del lote anterior desde nuestro archivo publicado, sin comprobarlo, así que un archivo alterado podía inflar el total. Ahora, antes de firmar, recorre la cadena hacia atrás hasta el último lote anclado en Stellar y recalcula cada huella y cada total. Prueba `bdd5784` ([PR #7](https://github.com/academiaseul/QWATT/pull/7)), arreglo `09210b0` ([PR #5](https://github.com/academiaseul/QWATT/pull/5)).
- **Falla 2 (S2), “la misma energía, dos veces”.** Un lote armado con intervalos ya contados pasaba como nuevo. Ahora se rechazan los intervalos repetidos, superpuestos, fuera de la grilla de 5 minutos o de otra instalación. Prueba `6204b12` ([PR #5](https://github.com/academiaseul/QWATT/pull/5)), arreglo `40aaa3d` ([PR #1](https://github.com/academiaseul/QWATT/pull/1)).
- **Revisión de los dos arreglos: cuatro formas más de contar dos veces la misma energía, cerradas** (DV-1 a DV-4 del acuerdo v3). Prueba `301bc50` ([PR #1](https://github.com/academiaseul/QWATT/pull/1)), arreglo `8385da3` ([PR #8](https://github.com/academiaseul/QWATT/pull/8)):
  - cada lote nuevo se compara solo con el último lote aceptado, nunca con uno rechazado, así que un lote rechazado no puede reabrir tiempo ya contado;
  - cada lote anterior se descarga una sola vez y se comprueba su huella antes de leerlo;
  - la etapa de entrada rechaza solo el intervalo, no su lote completo, cuando viene de otra instalación o de otro dispositivo, o cuando se superpone al anterior;
  - la entrada web (HTTP) guarda cada marca de tiempo en un único formato estándar, y rechaza de inmediato un intervalo fuera de la grilla, en vez de aceptarlo y descartarlo después.
- **Una forma en que el anclaje podía detenerse para siempre** (DV-5, mismos commits). Después de más de 168 lotes rechazados seguidos (una semana de lotes por hora), el verificador rechazaba el lote siguiente una y otra vez con el código de error de una cadena falsificada, y no se podía volver a anclar nada sin cambiar el código. Llegar al límite del recorrido ahora tiene su propio código, `verifier.walk_too_long`, y el proponente hace el mismo recorrido antes de proponer.

### Eliminado
- **Google Analytics**, de la portada, la página de demostración y la página de error (`8175ba9`, `799ab5a`).
- **Las 11 páginas del hackathon de agosto 2026**, de qwatt.org; sus URL ahora redirigen a la portada (`c3fd035`, [PR #3](https://github.com/academiaseul/QWATT/pull/3)).
- **La página de conciliación** (que compara cada anclaje en Stellar con los lotes publicados), del sitio, hasta que lea desde Stellar los firmantes y los umbrales de la cuenta en vez de afirmarlos (`141089a`).
- **Material de presentación antiguo, documentos internos, versiones anteriores de nuestra propuesta y configuración local del editor**, de los archivos actuales del repositorio (`152e088`, `772b8f3`, `c2fd8db`, `16bc6c2`, `184f885`, `26e615c`). Siguen en el historial público de git.

### Progreso vs. semana anterior
Es nuestra primera semana, así que la “semana anterior” es el trabajo previo que existía antes del Día 1 (lun 19 oct), listado en [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md). No lo financia el programa Instawards y no se cuenta abajo. “Meta (lunes)” significa una meta que fijamos el Día 1.

- Meta (lunes): trabajo previo público, rotulado y marcado con `dia-1` → Resultado: hecho el mié 21 oct ([PR #4](https://github.com/academiaseul/QWATT/pull/4), `7336e20`).
- Meta (lunes): Falla 1 cerrada, de rojo a verde → Resultado: hecho. En rojo en la [corrida #19](https://github.com/academiaseul/QWATT/actions/runs/39589564074), en verde en la [corrida #29](https://github.com/academiaseul/QWATT/actions/runs/39593831385) (pull request) y en main en la [corrida #30](https://github.com/academiaseul/QWATT/actions/runs/39593847463).
- Meta (lunes): Falla 2 cerrada, 4 de 4 intentos rechazados → Resultado: hecho, 4 de 4. En rojo en la [corrida #17](https://github.com/academiaseul/QWATT/actions/runs/39589526847), en verde en las corridas [#29](https://github.com/academiaseul/QWATT/actions/runs/39593831385) y [#30](https://github.com/academiaseul/QWATT/actions/runs/39593847463).
- Meta (nuestra propuesta, días 1–3): acordar la arquitectura → Resultado: acuerdo de arquitectura v3 acordado el Día 3, mié 21 oct, y registrado en el repositorio el Día 4 (`b304ddb`).
- Meta (nuestra propuesta, semana 1): Entregable 1, leer cualquier medidor (Modbus, HTTP o CSV) con salida idéntica byte a byte → Resultado: el lector se construyó antes del Día 1 (trabajo previo, `98b281a`, 9 sep). Esta semana agregamos su evidencia (`cae00a6`): 24 de 24 intervalos aceptados, idénticos en las tres entradas, con Modbus leído desde un simulador. Quedan tres puntos abiertos (ver Bloqueos).
- Meta (nuestra propuesta): un firmante externo al equipo, designado al inicio → Resultado: confirmado esta semana, no al inicio.

**En números**
- Pruebas: 154 en verde en `dia-1` → 194 en verde en main, 0 en rojo ([corrida #34](https://github.com/academiaseul/QWATT/actions/runs/39943161382)).
- Pruebas de las dos fallas: 10 escritas; 9 son casos que deben ser rechazados, y los 9 lo son. 5 estuvieron en rojo hasta que llegó su arreglo; las otras 5 llegaron junto con el arreglo.
- Revisión de los arreglos: 14 pruebas nuevas y 6 reescritas; 19 de esas 20 estaban en rojo antes del arreglo y están en verde después. Umbrales: 11 pruebas nuevas, 8 de ellas en rojo sin el cambio (comprobado localmente).
- Sin cambios para datos no alterados: un mes de un conjunto de datos público de investigación (NREL PVDAQ, septiembre de 2017; no son mediciones nuestras), reproducido sin conexión como 720 lotes, sigue verificando con 0 rechazados y la misma huella final que en `dia-1`. Esta prueba no envía nada a Stellar.
- Commits: 30 en main desde `dia-1` hasta `4ac5632`, más `b304ddb`, el documento del acuerdo v3 (sin contar las fusiones ni el commit que agrega este texto).
- Pull requests fusionados hasta `4ac5632`: 9 con trabajo de esta semana, más el #4, que trajo el trabajo previo. El acuerdo v3 necesitó uno más (ver Bloqueos).
- Transacciones en testnet esta semana: 0, a propósito, comprobado en Horizon para cada cuenta que aparece en el repositorio.
- Claves secretas de Stellar en el repositorio: 0, revisando cada commit de cada rama y etiqueta públicas (156 commits al 23 oct).

### Bloqueos y aprendizajes
- **Resuelto: el firmante externo al equipo está confirmado.** Su clave secreta queda en su poder; su clave pública se agregará cuando se cree la cuenta definitiva, la próxima semana. El acuerdo v3 (OD-2), [docs/FOUNDER-CHECKLIST.md](docs/FOUNDER-CHECKLIST.md) y [docs/RUNBOOK.md](docs/RUNBOOK.md) se escribieron antes de la confirmación y todavía lo muestran pendiente, con un plan alternativo de umbrales 2/2/2 y dos firmantes del equipo; ese plan alternativo ya no es el plan.
- **Nuestra rama principal (main) estuvo en rojo unos cinco minutos el 21 oct** (corridas de CI [#26](https://github.com/academiaseul/QWATT/actions/runs/39593287708) a [#28](https://github.com/academiaseul/QWATT/actions/runs/39593346018)): nuestros pull requests apilados #7, #5 y #1 terminaban cada uno en una prueba hecha para fallar hasta su arreglo, que venía en el siguiente, y los fusionamos antes del #8, que traía el último arreglo. Además, fusionamos el [PR #8](https://github.com/academiaseul/QWATT/pull/8) y el [PR #9](https://github.com/academiaseul/QWATT/pull/9) unos 30 segundos antes de que terminara su CI (los dos pasaron). El documento del acuerdo v3 quedó fuera del [PR #10](https://github.com/academiaseul/QWATT/pull/10), así que entró en un pull request posterior. Aprendizaje: fusionar cada prueba junto con su arreglo, esperar a que termine el CI y revisar qué contiene un pull request antes de fusionarlo.
- **Parte de la prueba de rojo a verde es solo local.** Ninguna corrida de CI probó por separado el arreglo de la Falla 1 ni el de la Falla 2, y la prueba de 2/2/3 nunca corrió en rojo en el CI público. Cualquiera puede reproducir ambas cosas corriendo las pruebas en los commits listados arriba. Aprendizaje: subir la prueba que falla para que el CI la registre.
- **Sigue abierto en el Entregable 1 (leer cualquier medidor):** dos campos de batería del controlador de carga EPEver Tracer (registros 0x3104 y 0x3105) y la configuración de banco de pruebas del medidor PZEM-017 necesitan hardware real, que está fuera de este sprint. Aparte, la interfaz de código para las entradas de medidores difiere del primer acuerdo de arquitectura (desviación D1-1). Los fundadores decidirán cómo tratar los tres puntos.
- **Aprendizajes:** un verificador que confía en nuestros archivos no es independiente; tiene que comprobar contra lo que está anclado en Stellar. Y un arreglo está terminado cuando resiste a quien intenta romperlo, no cuando pasa sus propias pruebas.

### Próxima semana (26 al 30 de octubre)
Planificado, todavía no construido:

1. **Crear la cuenta definitiva 2 de 3 en Stellar testnet,** con tres firmantes (el proponente, el verificador independiente y el firmante externo al equipo), umbrales 2/2/3 y desactivada la clave con que se creó la cuenta.
2. **Pruebas A–D y prueba de independencia en esa cuenta:**
   - A (el proponente solo) y B (el verificador solo): la red las rechaza por tener muy pocas firmas (`tx_bad_auth`). Nunca quedan registradas en Stellar, así que la evidencia es la transacción firmada y la respuesta de la red, no un enlace a stellar.expert como decía al principio nuestra propuesta; solo C tiene uno.
   - C (firman los dos): anclada, con un enlace a ella en stellar.expert, un explorador público de Stellar.
   - D (lote alterado después de que firmó el proponente): el verificador lo rechaza; no se ancla nada.
   - Independencia: el verificador rechaza un lote que nunca se publicó, porque solo puede usar datos públicos.
3. **Lecturas crudas en cada lote:** cada lote llevará una huella de todas sus lecturas crudas (`samples_root`). El primer lote se anclará en la cuenta definitiva, y su evidencia se publicará en dos repositorios públicos nuevos: uno que escribe solo el proponente y otro que escribe solo el verificador.

También para la semana 2, según el acuerdo v3: cada vía de entrada registra cuánto se desvía su reloj; cada clave se crea en la máquina que la va a usar, nunca en un navegador; la página de conciliación lee desde Stellar los firmantes y los umbrales; y no se estima energía en un hueco de más de tres lecturas cuando un medidor se corta. Post de mitad de semana: la prueba A, rechazada por la red. Después: congelación del código el vie 6 nov, y luego 7 días en testnet que cuentan para los resultados finales, desde el dom 8 nov a las 00:00 hasta el dom 15 nov a las 00:00, hora de Chile. Es antes de los días 23–30 de nuestra propuesta, y dentro de los mismos 30 días.

### Enlaces
- **Video (2:56):** https://youtube.com/shorts/4PBe8vSmcwM
- **Post en X:** https://x.com/ch1ngukim/status/2113590210952921290
- **Lo nuevo de esta semana, commit por commit:** https://github.com/academiaseul/QWATT/compare/dia-1...semana-1
- **Pull requests:** [#4](https://github.com/academiaseul/QWATT/pull/4) trabajo previo · [#2](https://github.com/academiaseul/QWATT/pull/2) README y documentos · [#6](https://github.com/academiaseul/QWATT/pull/6) sitio web · [#3](https://github.com/academiaseul/QWATT/pull/3) retiro de las páginas de agosto · [#7](https://github.com/academiaseul/QWATT/pull/7), [#5](https://github.com/academiaseul/QWATT/pull/5), [#1](https://github.com/academiaseul/QWATT/pull/1) y [#8](https://github.com/academiaseul/QWATT/pull/8) las dos fallas y la revisión · [#9](https://github.com/academiaseul/QWATT/pull/9) umbrales · [#10](https://github.com/academiaseul/QWATT/pull/10) Entregable 1
- **Corridas de CI, en rojo antes de los arreglos:** [#19](https://github.com/academiaseul/QWATT/actions/runs/39589564074) Falla 1 · [#17](https://github.com/academiaseul/QWATT/actions/runs/39589526847) Falla 2 · [#13](https://github.com/academiaseul/QWATT/actions/runs/39587187862) y [#25](https://github.com/academiaseul/QWATT/actions/runs/39593250856) revisión. **En verde después:** [#29](https://github.com/academiaseul/QWATT/actions/runs/39593831385) (pull request) y [#30](https://github.com/academiaseul/QWATT/actions/runs/39593847463) (main). **Umbrales, en verde:** [#31](https://github.com/academiaseul/QWATT/actions/runs/39939377387) (pull request) y [#32](https://github.com/academiaseul/QWATT/actions/runs/39939391730) (main).
- **CI en main después del último cambio de código de la semana:** [corrida #34](https://github.com/academiaseul/QWATT/actions/runs/39943161382), sobre `4ac5632`.
- **Repositorio:** https://github.com/academiaseul/QWATT. Con Node.js 20 o superior y git, corre `npm test`; para las pruebas del anclaje, `npm ci --prefix anchor` y luego `npm run test:anchor`. Ninguna prueba se conecta a Stellar testnet.
- **Documentos:** [trabajo previo](docs/PRIOR-WORK.md) · [evidencia del Entregable 1](docs/DELIVERABLE-1-EVIDENCE.md) · [acuerdo de arquitectura v3](docs/ARCHITECTURE-FREEZE-v3.md)
- **Demo en el navegador** (trabajo previo de agosto 2026, con nueva redacción esta semana): https://qwatt.org/verificacion.html

### Glosario
- **Testnet:** la red de pruebas de Stellar, separada de su red principal. QWATT usa solo testnet.
- **Lote:** un paquete de intervalos de lecturas de 5 minutos que se revisan y se publican juntos.
- **Lote rechazado:** un lote que no pasó una comprobación. Se publica con su motivo, pero no se ancla y no suma energía al total.
- **Huella (hash):** un código corto calculado a partir de los datos. Si cambia un solo byte, la huella cambia por completo.
- **Cadena de lotes:** cada lote lleva la huella del anterior, así que alterar uno rompe todos los que siguen.
- **Anclar:** escribir la huella de un lote y el total acumulado de energía en una transacción de Stellar testnet, donde queda con fecha y no se puede editar.
- **Proponente:** nuestro servicio que arma y publica cada lote, y firma primero.
- **Verificador independiente:** un servicio aparte, con su propia clave, que vuelve a revisar cada lote solo con datos públicos y luego firma también. Hoy lo opera nuestro propio equipo (correrá en un servidor propio): es independiente en código y en datos, no en organización, y por eso solo puede usar datos públicos. El anclaje de rutina usará nuestras dos claves; la clave del firmante externo al equipo se necesita para cambiar firmantes o umbrales, y con ella se puede suplir al verificador.
- **Firmantes (2 de 3):** las claves que pueden firmar por la cuenta de anclaje. La cuenta, planificada para la próxima semana, tendrá tres: la del proponente, la del verificador y una que guarda una persona externa al equipo. Cualquier par puede anclar, incluidas nuestras dos claves del equipo juntas; ninguna puede actuar sola.
- **Umbrales 2/2/3:** las firmas que exigirá la cuenta: 2 para cualquier transacción, 2 para anclar y 3 para cambiar firmantes o umbrales.
- **Horizon:** la interfaz pública de Stellar para leer lo que registró la red.
- **CI:** las pruebas automáticas que GitHub corre en cada cambio. Rojo significa que falló una prueba; verde, que pasaron todas.
- **Pull request (PR):** una propuesta de cambio que se revisa y luego se fusiona con el código principal.
- **Commit:** un cambio guardado, con su fecha y su autor, identificado por un código corto como `bdd5784`.
- **Etiqueta (tag):** un nombre fijo para un punto del historial. `dia-1` marca dónde termina el trabajo previo (el sprint empezó el lun 19 oct), y `semana-1`, el fin de la semana 1.
- **Modbus, HTTP, CSV:** tres formas en que llegan las lecturas: un protocolo industrial de medidores, una petición web y un archivo.
- **Acuerdo de arquitectura (architecture freeze):** el documento que acordaron los dos fundadores y que fija el diseño y el plan semanal del sprint; v3 es su tercera versión.
- **Entregable 1:** el primer hito de nuestra propuesta: leer cualquier medidor (Modbus, HTTP o CSV) y obtener registros idénticos.
- **Main:** la rama principal del repositorio, el código que recibe todo el mundo.
- **Códigos (S1, S2, DV-1 a DV-5, D1-1):** los números que llevan estos puntos en nuestra revisión de código y en el acuerdo de arquitectura, para quien quiera el detalle.

*QWATT es un proyecto en desarrollo que opera solo en Stellar testnet. QWATT no es electricidad, ni una inversión, ni un valor o instrumento financiero, ni un certificado de energía renovable (REC), ni un crédito de carbono. No tiene precio y no se vende.*
