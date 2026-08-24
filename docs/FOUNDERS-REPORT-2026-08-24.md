# QWATT — Founders' Report · 24 de agosto de 2026

> **Para: Jay & Diego.** Todo lo desarrollado — ingeniería, economía, estudios y estrategia —
> desde la hackathon (20-ago) hasta hoy (24-ago). Documento interno; complementa
> PROGRESS.md (registro histórico) y BLUEPRINT.md (plan de una página, vivo).

---

## 1. Qué es QWATT hoy, en cuatro frases

QWATT es un **protocolo de verificación energética** construido sobre Stellar: producción
renovable medible → eventos verificados → registros públicos que cualquiera puede auditar.
**1 QWATT = 1 MWh atestiguado** bajo el protocolo. Es una entidad separada de Quorelia
(que aparece solo como socio de integración SCADA, porque Quorelia atiende clientes de
gobierno). El lema y el foso competitivo son lo mismo: **honestidad verificable** — cada
pieza del sitio dice si es TESTNET, PROTOTIPO, PLANIFICADO o DEMO, y nunca mezclamos.

## 2. Cronología (4 días + 1)

| Fecha | Hito |
|---|---|
| **20 ago** | Nace en la Stellar × AI Studio Build Challenge (como WattCoin) |
| **22 ago** | Rebrand a QWATT · génesis del activo en testnet · qwatt.org comprado y en vivo (GoDaddy → Vercel) |
| **23 ago** | Sistema día/noche completo · menú editorial con dots de estado · logo Q-ring aplicado · formulario de contacto (Formspree) · Google Analytics · whitepaper v2.0 · Explorer · teaser inversionistas · deck Stellar |
| **24 ago** | Lighthouse a11y 100 · dominio apex directo + auto-deploy GitHub · imagen OG · privacidad en Términos · propuesta Instawards + deck 17 slides · investigación legal net billing · este reporte |

## 3. Ingeniería — lo que existe y funciona

### On-chain (Stellar testnet)
- **Activo QWATT** emitido: supply 42.700.000 · issuer `GDN6IW…BLT46` · distribuidor `GCLS6E…TSOKW` · génesis `1859e7e5…` (ledger 4.277.175) — todo auditable en stellar.expert.
- **Compra atómica**: 1 transacción de 3 operaciones (trustline + pago XLM + entrega QWATT), sin intermediarios; el precio del oráculo queda sellado en el memo.
- **Proof-of-Generation**: memo `PoG#id:kWh@precio/MWh` (límite 28 bytes verificado), pago de 0,001 QWATT/kWh desde tesorería, IDs idempotentes sincronizados on-chain.
- **stellar.toml** SEP-1 con cuentas, logo y metadata (visible a wallets cuando se fije `home_domain`).
- **Recuperación de reset de testnet** automatizada (`redeploy-testnet.js --check/--go`) — la testnet se reinicia ~trimestralmente y el protocolo se re-despliega en un comando.

### Oráculos (datos reales, sin backend)
- **EPEX day-ahead** vía aWATTar (gratis, CORS abierto) — precios reales, incluidos negativos (los chequeos usan `!== null`, nunca falsy: 0 y negativo son precios válidos).
- **XLM/USD y EUR→USD** vía CoinGecko. Fallback simulado, siempre etiquetado DEMO.

### El sitio (qwatt.org) — 11 páginas + 404
- **Landing**: hero, diagrama del protocolo, pipeline de 6 etapas con chips de estado, gráfico EPEX en vivo (24H/7D/1M/1Y/5Y, líneas suavizadas Catmull-Rom), sección onchain con trustlines en vivo, filosofía QWATT-Clean, apps 01-09, tokenomics (PLANIFICADO), roadmap, seguridad, contacto.
- **8 apps**: Consola Onchain, Grid (simulador), Pay, Explorer, Proof (reservas en vivo), Pulse, Piloto Solar, Backup de claves — cada una con su estado honesto (dots verdes = testnet real; gris = demo; ámbar = prototipo).
- **QWATT Explorer** (`/proof/QW-…`): lee Horizon directo desde el navegador, clasifica memos, muestra cadenas de evidencia por evento. Sin backend que mantener; un indexador futuro puede reemplazar la capa de datos sin tocar la UI.
- **Sistema día/noche** completo (barras, menú, contenido, footers) con marca Q-ring en SVG que sigue el tema; default día.
- **Calidad medida**: Lighthouse móvil **perf 83 · accesibilidad 100 · best practices 100 · SEO 100**. SEO completo (canonicals, OG con imagen de marca, JSON-LD, sitemap, headers de seguridad).
- **Infra**: dominio apex directo (sin redirect), auto-deploy en cada push a GitHub, GA4 midiendo, formulario → Formspree → inbox (verificado end-to-end).

### Rig de minería (prototipo físico)
- `miner.js`: cliente Modbus TCP crudo + simulador solar, persistencia crash-safe (`state.json`), kWh acumulados solo se descartan tras pago exitoso, sincronización de IDs al arrancar. Listo para el secreto del distribuidor → primer evento real `QW-000001`.

### WattNode v1 (arquitectura de hardware, diseñada)
- **Medición redundante**: M1 medidor DC por MPPT · M2 Modbus del inversor · M3 Shelly Pro 3EM (CTs red) · M4 testigo solar (celda 5 W + INA226).
- **Gateway**: Raspberry Pi 4, RS485 aislado, RTC, elemento seguro SE050, watchdog, 4G; muestreo 10 s → lote 5 min → validadores (tope físico, noche, divergencia, testigo, rampa, reloj, tamper) → firma local → outbox.
- **Principio de seguridad**: minteo de dos firmas (nodo + tesorería con clave en Vault) — *"un nodo comprometido es un sensor roto, no una impresora de dinero"*.
- Diagrama completo: `docs/wattnode-architecture.svg/.png/.pdf`.

## 4. Economía — decisiones cerradas y números

### La invariante de precio vintage (nuestra decisión económica más importante)
El problema que Jay detectó: si QWATT se rescata a precio spot en cualquier momento, un minero
mintea al mediodía (energía barata) y rescata de noche (cara) → déficit de tesorería
garantizado. **Regla cerrada: QWATT vale el precio atestiguado de su evento de origen
(o TWAP), nunca el spot del momento del rescate. El arbitraje temporal le pertenece a las
baterías, no al token.** Esta regla está codificada en CLEAN-TOKEN-ARCHITECTURE.md y en el
whitepaper, y es también nuestra defensa regulatoria (sin promesa de rescate especulativo).

### Mercado chileno (estudio en PLAN-NEGOCIO-SOLAR.md, precios ago-2026)
- **Tarifa efectiva BT1 RM**: base de cálculo $200 CLP/kWh (rango real $160–250; alza CNE 4,9% desde julio).
- **Net billing**: inyección a ~$75/kWh (precio nudo, rango $60–90) → **el autoconsumo vale 2,5× la inyección** → se dimensiona para el consumo, no para el techo.
- **Costos de equipo** (referenciales): panel 550–600 Wp $90–110k · inversor string 5 kW $600–800k · híbrido 5–6 kW $1,2–1,6M · batería LiFePO4 ~5 kWh $1,3–1,7M · tramitación TE4 $200–400k.
- **Configuraciones y márgenes brutos**:
  - **A — Kit chico 1,5–2 kWp**: margen $250–450k (15–22%), payback ~4 años. Puerta de entrada, no negocio.
  - **B — On-grid 3–5 kWp**: margen $0,7–1,4M (25–30%). **Este es el negocio.**
  - **C — Híbrido con respaldo** (Lo Barnechea/El Arrayán: cortes largos, teletrabajo): el cliente compra **tranquilidad, no payback**. Es el kit del piloto.
- **Defensa ante guerra de precios**: transparencia (monitoreo real + reporte mensual) + capa QWATT — *nadie más vende la capa de datos y verificación como producto*.

### Cinco modelos de venta (CLEAN-TOKEN-ARCHITECTURE.md)
1. **Kit Directo** — margen de hardware, el cliente es dueño de todo y de sus atributos.
2. **Kit + SaaS** — hardware casi al costo + suscripción (dashboard, verificación, reportes ESG).
3. **Zero-CAPEX / PPA-lite** — QWATT instala y es dueña; el host paga bajo la tarifa; QWATT vende atributos. *(La investigación legal encuadra esto tras el medidor — ver §6.)*
4. **Retrofit (solo QWATT Box)** — el mercado más grande: cada techo ya instalado.
5. **Integrador / flota** — la caja QWATT en kits de terceros + módulo SCADA industrial (Quorelia primero); rev-share de atributos.

### Presupuesto sprint Instawards (hardware de verificación, sin sistema solar)
≈ **$900 USD** itemizados (Pi 4, Shelly 3EM, medidor DC, RS485, RTC+SE050, testigo, 4G, tablero, envío) — mano de obra aportada por el equipo.

## 5. QWATT-Clean (la capa de atributo verde, planificada)
- Un MWh verificado genera **un atributo limpio único**; reclamarlo = **quemarlo** (retire) → mata el doble conteo por diseño.
- Instrumento de **transparencia voluntaria** — NUNCA presentarlo como REC oficial, crédito de carbono o beneficio tributario sin homologación (regla dura, escrita).
- Camino técnico: firma en medidor → contrato de verificación Soroban → contrato mint/retire QWATT-C.

## 6. Legal (investigación 24-ago, docs/LEGAL-NETBILLING.md — no es asesoría)
- **Net billing es una relación cerrada cliente↔distribuidora** (Ley 21.118): no podemos comprar los excedentes de los pilotos ni venderles energía (no existe comercializador minorista para regulados).
- **Vehículos legales hoy**: venta de kits + instalación certificada · servicio de monitoreo/verificación · ESCO tras el medidor (QWATT dueña del sistema, el cliente paga por autoconsumo; el titular del net billing sigue siendo el cliente).
- **Para vender energía de verdad**: PMGD (DS 88, ≤9 MW, precio estabilizado) — modelo de planta, no de techos; régimen en discusión de reforma 2026.
- **El token**: mantenerlo como instrumento de verificación. Riesgos CMF (Ley Fintech 21.521): lenguaje de inversión, promesas de rescate, custodia de terceros — todos evitados por diseño. Revisión legal formal antes de mainnet (lista de 6 preguntas para el abogado en el doc).
- **La frase**: *no compramos ni vendemos la energía — vendemos el fierro, el servicio y la verdad verificable sobre esa energía.*

## 7. Comunidad y financiamiento
- **Stellar Barrio / Instawards**: Joaquín Farfán nos recomienda al round de mediados de septiembre. Llamada 24-ago. Propuesta lista (`docs/PROPUESTA-INSTAWARD.md` + PDF): sprint WattNode v0, P1 primer PoG real → P4 write-up público, 4 semanas, ~$900.
- **SCF** (Stellar Community Fund): el track grande — aplicar DESPUÉS del Instaward con tracción demostrada.
- **UNBLCK** (aceleradora, Santiago): puerta mencionada por Joaquín, sin explorar.
- **Kit de lanzamiento listo**: post LinkedIn ES/EN + hilo X (≤280/post) + arte promocional (canvas 3 formatos) + imagen OG de marca.
- **Deck comunidad Stellar**: 17 slides (incluye arquitectura WattNode, estado ago-2026 y el sprint).

## 8. Los dos roles (regla de la casa)
Jay y Diego comparten **todos** los roles — ingeniería, diseño, comercial — sin división fija.
Los documentos externos siempre lo reflejan así.

## 9. Tablero de estado

### Hecho ✓
Sitio completo con marca y tema día/noche · activo on-chain + compra atómica · oráculos reales · Explorer · rig prototipo crash-safe · arquitectura WattNode v1 · invariante vintage · estudio de mercado chileno · investigación legal · SEO/analytics/a11y 100 · dominio + auto-deploy · kit de lanzamiento · propuesta Instawards + deck

### Pendiente inmediato (founders)
1. **Secreto del distribuidor → miner → `QW-000001`** (idealmente antes de publicar el post)
2. **`home_domain=qwatt.org`** en el issuer (activa toml/logo en wallets)
3. **Publicar el lanzamiento** (LinkedIn ES + EN de Diego + hilo X)
4. Llamada Instawards → enviar propuesta PDF

### Roadmap (BLUEPRINT.md)
Instaward sprint (hardware WattNode v0) → SCF con tracción → firma en medidor → contrato Soroban → QWATT-C mint/retire → **revisión legal → mainnet**

## 10. Mapa de activos

| Activo | Dónde |
|---|---|
| Plan de una página (vivo) | `BLUEPRINT.md` |
| Registro histórico completo | `PROGRESS.md` |
| Arquitectura económica y QWATT-C | `CLEAN-TOKEN-ARCHITECTURE.md` |
| Estudio de negocio Chile | `docs/PLAN-NEGOCIO-SOLAR.md` |
| Investigación legal | `docs/LEGAL-NETBILLING.md` |
| Propuesta Instawards | `docs/PROPUESTA-INSTAWARD.md` + `docs/QWATT-Propuesta-Instaward.pdf` |
| Teaser inversionistas | `docs/INVESTOR-TEASER.md` + `docs/QWATT-teaser.pdf` |
| Deck comunidad Stellar (17 slides) | `docs/QWATT-stellar-community.pptx` |
| Arquitectura WattNode | `docs/wattnode-architecture.svg/.png/.pdf` |
| Whitepaper v2.0 | `whitepaper.html` (público) |
| Posts de lanzamiento | `social-posts.md` |
| Logo / OG | `logo.png` · `og-image.png` |
| Identificadores on-chain | `deployment.json` |

## 11. Reglas permanentes (las que no se negocian)
Sin socios, clientes, producción ni certificaciones inventadas · DEMO nunca disfrazado de LIVE ·
sin secretos en el cliente (las claves son de los founders y nunca salen de ellos) ·
sin lenguaje de inversión · precisión > hype · un MWh se reclama una sola vez.
