# QWATT — Registro maestro del proyecto / Master Project Record

> **Propósito:** archivo canónico de todo lo procesado y decidido hasta la fecha. Las conversaciones
> de trabajo pueden borrarse: este archivo + los docs enlazados contienen el estado completo.
> Última actualización: **2026-08-23** · Sitio: https://qwatt.org · Repo: github.com/academiaseul/QWATT

---

## 1. Identidad

- **QWATT — The Clean Token.** Protocolo de verificación energética: producción renovable medible → eventos verificados → registros públicos en Stellar. **1 QWATT representa 1 MWh bajo el protocolo** (convención, no equivalencia certificada). Nunca se presenta como criptomoneda especulativa.
- **Entidad independiente** de Quorelia (empresa de infraestructura crítica para gobierno). Relación pública: Quorelia SCADA = primera integración certificada prevista (whitepaper §4). Nada más.
- **Equipo:** Jay (producto, ingeniería, QWATT, web) · Diego (comercial, clientes, aliados).
- **Origen:** hackathon Stellar × AI Studio Build Challenge (ago 2026), evolucionado a plataforma.

## 2. Cronología

| Fecha | Hito |
|---|---|
| 2026-08-20 | WattCoin (WATT) nace en la hackathon; primer activo en testnet (hoy huérfano) |
| 2026-08-21 | Oráculo real: EPEX day-ahead vía aWATTar + FX CoinGecko; fallback simulado |
| 2026-08-22 | Rebrand QWATT · génesis actual (42.7M) · mining rig PoG · dominio qwatt.org + Vercel · rediseño editorial → separación de Quorelia → paleta tierra/terracota · menús unificados · header/footer/mega-menú · efectos typing + reveal · dashboard 24H–5Y · reposicionamiento "protocolo de verificación" + chips de estado · SEO completo · whitepaper v2.0 (16 secciones) · QWATT-Clean (filosofía + arquitectura) · repo git |
| 2026-08-23 | Migración a D:\quorelia\QWATT\QWATT + GitHub (academiaseul/QWATT) · miner endurecido (estado persistente, PoG#id idempotente) · redeploy-testnet.js · motto "The Clean Token" · ¿Por qué Stellar? + trustlines LIVE · **QWATT Explorer** (/proof) · plan de negocio solar + WattNode v1 · **invariante económico vintage** · kit social · blueprint 1 página · teaser inversionistas |

## 3. Estado on-chain (testnet)

| Parámetro | Valor |
|---|---|
| Activo | QWATT (alphanum12) |
| Emisor | `GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46` |
| Distribuidor/tesorería | `GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW` |
| Génesis | tx `1859e7e5…40c56e` · ledger 4,277,175 · 2026-08-22 · memo `QWATT genesis 1QWATT=1MWh` |
| Supply | 42,700,000 (100M máx) · trustlines: 2 (tesorería + rig `GCFW7R…`) |
| Eventos PoG | 0 (el miner solo ha corrido en dry-run; falta distributorSecret en config) |
| Claves | solo en poder del fundador; consola/grid las auto-guardan en localStorage al hacer génesis/restore |
| Fuente única de verdad | `deployment.json` (raíz); recovery: `mining-rig/redeploy-testnet.js --check|--go` |

⚠ La testnet se reinicia ~trimestralmente. Pendientes del fundador: conectar Vercel↔GitHub (auto-deploy) y `home_domain=qwatt.org` en el emisor (pasos en README).

## 4. El sitio (qwatt.org)

**Diseño:** paleta tierra/terracota (papel #faf8f2, acento #b0582f claro / #d08a57 oscuro, espresso #16100a, café #291d13; las variables CSS conservan nombres antiguos --teal/--navy/--amber con valores nuevos). Tipografía Inter + IBM Plex Mono (portada), Chakra Petch + Plex (apps). Motion: typing en etiquetas cortas, fly-in+blur (.rv/.in) en bloques; prefers-reduced-motion respetado.

**Portada (index):** hero "Energía, verificada onchain" → diagrama ENERGÍA→DATOS→QWATT→STELLAR + 6 etapas con chips de estado → mercado en vivo (EPEX real, pestañas 24H/7D/1M/1Y/5Y, curvas suaves) → onchain (No confíes: verifícalo · ¿Por qué Stellar? · trustlines LIVE de Horizon) → QWATT-Clean (filosofía) → apps 01-09 → tokenomics (PLANIFICADO) → roadmap → seguridad → footer unificado. Bilingüe ES/EN. Mega-menú Apps con hover; burger móvil.

**Apps:** console (génesis/compras atómicas) · grid (ecosistema) · pay (pagos XLM) · **proof = QWATT Explorer** (eventos onchain en vivo desde Horizon, URLs /proof/QW-000001 vía rewrite, cadena de evidencia por evento, estado vacío honesto) · respaldo = Reservas (proof-of-reserves) · red = Pulse · piloto · whitepaper v2.0 · backup (AES-256-GCM local) · terminos (riesgos + glosario). Todas con barra de navegación fija unificada + footer unificado.

**Sistema de honestidad (el foso):** chips TESTNET / PROTOTIPO / PLANIFICADO / DEMO / EN VIVO en todo el sitio; jamás mezclar estados; DEMO nunca vestido de LIVE; sin socios/números inventados.

**SEO:** títulos/descripciones/canónicos/OG/Twitter en 10+ páginas, JSON-LD (Organization alternateName "The Clean Token" + WebSite), sitemap.xml, robots.txt, 404 propia, headers de seguridad (nosniff, SAMEORIGIN, HSTS, referrer, permissions), theme-color, preconnects.

## 5. Ingeniería

- **Stack:** HTML estático sin build, SDK Stellar inlined, Vercel (proyecto `qwatt`, framework null en vercel.json — no quitar), rewrite `/proof/:id`. Deploy: `npx vercel --prod --yes`.
- **mining-rig/ (v0):** miner.js — Modbus TCP crudo o simulador solar; integra kWh; paga 0.001 QWATT/kWh con memo `PoG#<id>:<kWh>kWh@<precio>/MWh` (≤28 bytes); estado persistente (state.json: accKwh store-and-forward + lastEventId); sync de id contra Horizon al arrancar (no doble pago); config.json/wallet.json gitignored. Bug corregido: un pago fallido ya no pierde la energía medida.
- **WattNode v1 (spec, docs/wattnode-architecture.svg):** Pi 4 + oracle.js, M1 DC meters, M2 inversor Modbus, M3 Shelly Pro 3EM, M4 testigo solar (celda 5W + INA226), RTC, SE050, tamper; validador (capacidad·noche·divergencia·testigo·rampa·reloj); **acuñación de dos partes**: el nodo firma evidencia con clave PANEL, la tesorería (HSM en la nube) co-firma tras su propio chequeo físico — "un nodo comprometido es un sensor roto, no una impresora de dinero". Sustituye a miner.js en el piloto.
- **Seguridad:** cero secretos en archivos desplegables (auditado); firma client-side; .gitignore/.vercelignore cubren config/wallet/state/keys/docs internos.

## 6. Diseño económico (decisiones cerradas)

1. **QWATT = registro + recompensa, no derecho de canje.** Sin promesa de redención → sin déficit posible.
2. **INVARIANTE VINTAGE (2026-08-23, whitepaper §12 + CLEAN doc):** ninguna valorización/recompra referencia el spot vigente; siempre el precio atestado del evento de origen o TWAP. Motivo: el solar acuña barato al mediodía; canje al precio nocturno drenaría la tesorería (opción gratis sobre el precio de la luz). El time-shift pertenece a las baterías (capa física). Nota: net billing chileno (BT1) acredita a precio de nudo plano en CLP — la interfaz física tampoco es arbitrable.
3. **QWATT-C (Clean, PLANIFICADO):** atributo verde 1:1 con evento verificado; retiro (burn) = reclamo único → mata el doble conteo. Instrumento voluntario de transparencia; NO es REC/crédito de carbono/título de subsidio sin homologación (I-REC/GdO). Contrato Soroban con invariantes en CLEAN-TOKEN-ARCHITECTURE.md.
4. **Minería PoG paga desde la tesorería** (asignación ecosistema) — el supply no se infla por evento.
5. **Modelo de ingresos:** (a) hoy: negocio de instalación solar (ver §7); (b) protocolo: flujo y float — spread en ventanilla, fees de marketplace/retiro QWATT-C, SaaS de monitoreo, licencias de integración SCADA; nunca "number go up".

## 7. Capa comercial (docs/PLAN-NEGOCIO-SOLAR.md)

Instalación solar RM Chile. Productos: **Solar Base** (B: on-grid 3–5 kWp, margen 25–30%, core 60% ventas) · **Solar + Respaldo** (C: híbrido + batería, margen absoluto mayor, se vende como seguro anti-cortes — decir la verdad: payback batería ~10 años) · **Solar Negocio** (E: pyme 10–30 kWp, payback 3,5–4 años, desde mes 6). A de gancho, D a pedido. Año 1: 30 instalaciones ≈ $41M CLP margen bruto, ~$16M resultado. Punto de equilibrio: 2×B/mes. Sin anticipo 50–60% el modelo no escala. Diferenciador único del mercado: monitoreo + **Proof of Generation opt-in** (sin promesas de valor — CMF). Piloto: **El Arrayán, Lo Barnechea (casa de Felipe Veloso): kit C = 4,4 kWp + Deye 5 kW + 2×Pylontech US5000 + Shelly + Pi** — fija el costo real de C y produce el primer mint con datos de techo real. **El flywheel: la instalación financia el protocolo; el protocolo diferencia la instalación; los techos verificados alimentan QWATT-C.**

## 8. Mapa de archivos

| Archivo | Qué es | ¿Público? |
|---|---|---|
| index/console/grid/pay/proof/respaldo/red/piloto/whitepaper/backup/terminos/404 .html | El sitio | Sí |
| deployment.json · robots · sitemap · stellar.toml · vercel.json · _headers | Infra/SEO | Sí |
| README.md | Guía técnica + deploy + reset | Repo |
| BLUEPRINT.md | Plan de 1 página (canónico) | Interno |
| PROGRESS.md | **Este archivo** | Interno |
| CLEAN-TOKEN-ARCHITECTURE.md | QWATT-C + 5 modelos de venta + invariantes Soroban | Interno |
| docs/PLAN-NEGOCIO-SOLAR.md | Plan de negocio solar completo + addendum | Interno |
| docs/wattnode-architecture.svg | Spec hardware WattNode v1 | Interno |
| docs/INVESTOR-TEASER.md | Teaser para fundadores/inversionistas Stellar | Interno |
| social-posts.md | Kit de lanzamiento LinkedIn/X | Interno |
| mining-rig/ | Miner v0 + redeploy tool (+ secretos gitignored) | Repo (no deploy) |

## 9. Pendientes (orden)

1. ⚠ Fundador: Vercel↔GitHub · 2. ⚠ Fundador: home_domain · 3. Fundador: pegar distributorSecret → primer PoG real (aparece solo en el Explorer) · 4. Piloto El Arrayán (hardware real) · 5. SCF draft → docs/ (Tranche 0 legal, Tranche 2 prosumidores) · 6. Analytics + Lighthouse · 7. Firma de medidor + Soroban + QWATT-C · 8. ⚠ Revisión legal pre-mainnet.

## 10. Reglas permanentes

Sin partners/clientes/producción/transacciones/tokenomics/certificaciones inventadas · DEMO ≠ LIVE · sin lenguaje de inversión (si preguntan por comprar: "testnet, nada está a la venta") · sin secretos client-side · exactitud > hype · el invariante vintage no se negocia.
