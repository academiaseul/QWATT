# Plan de Negocio — Instalación Solar en Chile

> **Documento interno QWATT** · Del mínimo al ideal: qué ofrecer, a quién, y qué números dan.
> Preparado: 22 de agosto de 2026 · Para: Jay & Diego (QWATT) · Mercado base: Región Metropolitana, cliente residencial BT1 y pyme.
> Moneda: CLP sin IVA salvo indicación (cliente residencial paga +19% IVA). TC referencial $950 CLP/USD — ajustar al cotizar.
> Diagrama de hardware asociado: [wattnode-architecture.svg](wattnode-architecture.svg)

## 0. Resumen ejecutivo

Cinco formas de entrar al mercado; no todas son negocio hoy:

| Escenario | Producto | ¿Ofrecerlo? | Rol |
|---|---|---|---|
| **A — Mínimo** | Kit on-grid 1,5–2 kWp | Sí, con cuidado | Gancho de entrada, ticket bajo, margen bajo |
| **B — Estándar** ⭐ | On-grid 3–5 kWp + net billing | Sí — producto core | 60% de las ventas, economía probada |
| **C — Híbrido** ⭐ | 5 kWp + híbrido + batería 5–10 kWh | Sí — upsell "respaldo" | Mejor margen absoluto; se vende por cortes, no por ahorro |
| **D — Ideal/Off-grid** | 8–10 kWp + 15–20 kWh + generador | Solo a pedido | Nicho parcelas sin red; alta complejidad |
| **E — Comercial pyme** | On-grid 10–30 kWp | Desde el mes 6 | Mejor payback del mercado (3,5–4 años); requiere capital |

**Recomendación:** lanzar con **B** como producto principal y **C** como upsell; usar A para cerrar clientes chicos; D solo a pedido; abrir E con 5+ instalaciones de referencia. En todos los escenarios, la diferenciación frente a los ~200 instaladores de la RM es **la capa de datos: monitoreo + Proof of Generation (QWATT), opcional**.

**Por qué ahora:** las cuentas subieron >50% desde 2024 y la deuda de estabilización se paga hasta 2035 — cada alza acorta el payback solar. Los cortes masivos en la RM convirtieron la batería de "lujo" en "seguro".

## 1. Contexto de mercado (2026)

- **Tarifas.** BT1 RM: cargo energía Enel ~$110–135/kWh; costo efectivo "todo incluido" $160–250/kWh (ej. real: 200 kWh/mes en Maipú ≈ $47.000 → ~$235/kWh). CNE confirmó alza promedio 4,9% desde julio 2026. **Base de cálculo: $200/kWh.**
- **Net billing (Ley 21.118).** Hasta 300 kW por cliente regulado. Chile es *net billing*, no *net metering*: inyección a precio de nudo (~$60–90/kWh ≈ 50% del precio de compra), crédito acumulable; residenciales ≤20 kW tienen derecho a pago en efectivo de excedentes. **Implicancia de diseño: el autoconsumo vale 2,5× la inyección → dimensionar para el consumo, no para el techo.**
- **Costos.** 5 kWp residencial: $3,8–5,0M sin IVA instalado y certificado; ~7.500 kWh/año en Santiago (1.500 kWh/kWp, FP ~17%). Tramitación SEC + distribuidora aparte: $200–400k.
- **Demanda.** (1) alza estructural hasta 2035, (2) cortes prolongados (temporal ago-2024), (3) electrificación del hogar (AC, EV, bombas de calor).
- **Competencia.** Fragmentada: grandes en C&I (Punto Solar, Solarity, Tritec, Solcor), decenas compitiendo por precio en residencial, kits DIY en retail. **Nadie vende la capa de datos y verificación como producto.**

## 2. Supuestos comunes

| Variable | Valor | Nota |
|---|---|---|
| Rendimiento RM | 1.500 kWh/kWp/año | Norte, 15–30°, sin sombra |
| Tarifa efectiva | $200/kWh | Rango real $160–250 |
| Precio inyección | $75/kWh | Rango $60–90 (nudo) |
| Consumo casa típica | 300 kWh/mes | Parcela con AC: 500–800 |
| Panel 550–600 Wp | $90–110k c/u | Distribuidor Chile |
| Inversor string 5 kW | $600–800k | Growatt / Sungrow / Huawei |
| Inversor híbrido 5–6 kW | $1,2–1,6M | Deye / Growatt SPH / Sungrow SH |
| Batería LiFePO4 4,8–5,1 kWh | $1,3–1,7M | Pylontech US5000 / Dyness / BYD |
| Tramitación TE4 + net billing | $200–300k interno | 6–10 semanas |
| Mano de obra | $250k (2 kWp) – $700k (híbrido) | Cuadrilla de 2, 1–3 días |

Precios de equipos referenciales a agosto 2026 — confirmar con 2–3 distribuidores (Punto Solar, Natura Energy, EMAT, DMU Energy).

## 3. Escenarios en detalle

### A — "Mínimo": on-grid 1,5–2 kWp
**Para quién:** techos chicos, "probar", presupuesto <$2,5M con IVA.
**Ojo:** en Chile no existe el "solar de balcón" enchufable legal; todo sistema en paralelo a la red requiere instalador SEC + TE4 + aviso a distribuidora, incluso en cero inyección. Ese costo fijo mata la economía del kit chico.

| Generación | 3.000 kWh/año | Ahorro cliente | ~$450k/año |
|---|---|---|---|
| Precio venta | $1,6–2,0M | Costo | $1,35–1,55M |
| **Margen bruto** | **$250–450k (15–22%)** | Payback | ~4 años |

**Veredicto:** puerta de entrada, no negocio. Ofrecer "ampliable" (inversor de 3 kW).

### B — "Estándar": on-grid 3–5 kWp ⭐ core
**Para quién:** casas 250–450 kWh/mes — Ñuñoa, La Reina, Maipú, Puente Alto, Peñalolén, Colina. 80% del mercado.

| | 3 kWp | 5 kWp |
|---|---|---|
| Generación anual | 4.500 kWh | 7.500 kWh |
| Ahorro cliente/año | ~$590k | ~$985k |
| Precio venta | $2,7–3,3M | $3,9–4,6M |
| Costo | $2,0–2,3M | $2,9–3,2M |
| **Margen bruto** | **$0,7–1,0M (25–30%)** | **$1,0–1,4M (26–30%)** |
| Payback | ~5 años | ~4,3 años |

Desglose 5 kWp: paneles 9×$95k=$855k · inversor $700k · estructura $300k · protecciones/tablero $350k · MO $500k · ingeniería+tramitación $250k · imprevistos 5%.
**Palancas:** compra por lote (−8–12% en inversores), dos configuraciones estándar (instalación en 1 día), tramitación como línea aparte ($250–350k).
**Veredicto:** *esto es el negocio.* Defensa ante guerra de precios: transparencia (monitoreo real, reporte mensual) + capa QWATT.

### C — "Híbrido": 5 kWp + batería 5–10 kWh ⭐ upsell
**Para quién:** Lo Barnechea, El Arrayán, Chicureo, Pirque, Peñalolén alto — cortes largos, bomba de agua, teletrabajo. Compra **tranquilidad, no payback**. Es exactamente el kit del piloto El Arrayán.

| | 1 batería (4,8 kWh) | 2 baterías (9,6 kWh) |
|---|---|---|
| Ahorro cliente/año | ~$1,27M | ~$1,36M |
| Precio venta | $7,0–8,5M | $8,5–10,3M |
| Costo | $5,3–5,9M | $6,7–7,5M |
| **Margen bruto** | **$1,5–2,6M (22–30%)** | **$1,8–2,8M (21–28%)** |
| Payback | ~6 años | ~7 años |

**La verdad incómoda (decirla):** BT1 es tarifa plana → la batería sola se paga en ~10–11 años. Se vende como **seguro contra cortes**, no como inversión. Verificar que el híbrido esté en el listado SEC de productos autorizados antes de cotizar.

### D — "Ideal/Off-grid": 8–10 kWp + 15–20 kWh + generador
Parcelas sin red (extensión cuesta $5–30M), consumos >700 kWh/mes, lodges. Venta $14–22M, margen $3–6M (20–25%), payback 7–9 años o inmediato vs. alternativa. **Solo a pedido**, con ingeniero eléctrico responsable en el equipo.

### E — "Comercial pyme": on-grid 10–30 kWp
Bodegas, talleres, clínicas, colegios: consumen de día, tarifas BT2/BT3, deciden con calculadora.

| 20 kWp | Generación 30.000 kWh/año | Ahorro ~$4,5M/año |
|---|---|---|
| Venta $15–17M ($750–850k/kWp) | Costo $12–13,5M | **Margen $2,5–4M (18–22%)** · payback 3,5–4 años |

**Barreras:** financiar equipos (pedir 50–60% anticipo), licencia SEC de clase adecuada, estudio CIP (8–14 semanas), referencias. **Entrar mes 6** con 5+ instalaciones fotografiadas.

## 4. Comparativa

| | A | B | C | D | E |
|---|---|---|---|---|---|
| Ticket sin IVA | $1,6–2,0M | $2,7–4,6M | $7–10M | $14–22M | $15–17M |
| Margen % | 15–22% | 25–30% | 21–30% | 20–25% | 18–22% |
| Payback | ~4 a | 4–5 a | 6–7 a | 7–9/inmediato | 3,5–4 a |
| Capital de trabajo | Bajo | Medio | Alto | Muy alto | Muy alto |
| Se vende por… | Precio | Ahorro | Respaldo | Necesidad | ROI |
| Decisión | Gancho | **Core** | **Upsell** | A pedido | Mes 6+ |

## 5. Modelo de negocio

- **Estructura:** SpA (Empresa en un Día), giro instalación + comercialización, seguro RC desde la primera obra. TE4 firmada por instalador autorizado SEC — Fase 1: socio instalador por obra ($400–700k); Fase 2: certificar a alguien del equipo. Roles: **Jay & Diego — co-fundadores con roles compartidos**: ambos ingeniería, diseño, comercial y construcción del protocolo (sin silos; la responsabilidad de cada obra/venta se asigna por proyecto).
- **Ingresos:** (1) venta+instalación 20–30% (85% del total), (2) tramitación $250–350k, (3) monitoreo y mantención $60–120k/año (recurrente, fideliza), (4) ampliaciones, (5) capa QWATT — hoy diferenciación y pipeline SCF, no ingreso.
- **Financiamiento cliente:** 50/50 contra TE4 · convenio 12–24 cuotas (5 kWp a 24 meses ≈ $200k/mes ≈ ahorro) · leasing "solar como servicio" solo en fase 2 ($50M+ de respaldo).

## 6. Proyección año 1 (ilustrativa)

Fijos: ~$2,1M/mes ($25M/año). **Punto de equilibrio: 2×B al mes.**
Meta: 30 instalaciones (4A · 18B · 6C · 2E) → ingreso ~$160M, margen bruto ~$41M, **resultado operacional ~$16M (10%)**.
Capital de trabajo: $10–15M rotativos (baja a $5M con 60% anticipo — **sin anticipo el modelo no escala**).
Sensibilidad: B al 20% de margen → ~$9M; 10 híbridos → ~$24M. **La palanca es C, no A.**

## 7. La capa QWATT: Proof of Generation como diferenciador

Cada instalación puede incluir el kit de verificación (Shelly Pro 3EM + Raspberry Pi 4 + SIM 4G, ≈$150–250k, sin recargo en B/C/E durante el piloto). El nodo lee los medidores, descarta lecturas imposibles (capacidad física, noche, divergencia, testigo solar), ancla el hash de cada lote en Stellar y entrega QWATT en la misma transacción atómica — ver [wattnode-architecture.svg](wattnode-architecture.svg).

- **Cliente gana:** historial de generación verificable públicamente, recompensa QWATT por kWh, y a futuro pago de cuenta con QWATT.
- **Empresa gana:** (1) única propuesta con verificación onchain, (2) datos reales de 30 instalaciones para el piloto SCF Tranche 2 (10–20 prosumidores con medidor real), (3) el cliente queda en el ecosistema.
- **Cómo presentarlo:** recompensa por generación verificada, **opt-in, sin prometer rentabilidad ni precio**. QWATT está en testnet; no es instrumento financiero ofrecido al público (la CMF observa todo lo que suene a inversión). Revisión legal antes de mainnet (Tranche 0 del SCF).

## 8. Go-to-market

| Segmento | Zonas | Producto | Mensaje |
|---|---|---|---|
| Casa 250–450 kWh/mes | Ñuñoa, La Reina, Maipú, Puente Alto, Colina | B | "Tu cuenta sube hasta 2035. Fíjala hoy." |
| Parcela con cortes | Lo Barnechea, El Arrayán, Chicureo, Pirque | C | "Cuando se corte la luz, tu casa sigue." |
| Pyme diurna | Bodegas Quilicura, talleres, clínicas | E | "Se paga en 4 años y después es utilidad." |

**Canales (por costo-efectividad):** 1) referidos ($100k por instalado; 40–60% de las ventas solares vienen de vecinos), 2) LinkedIn + build-in-public del piloto, 3) alianzas (electricistas 5%, corredores, administradores, instaladores AC/EV), 4) **web con cotizador instantáneo** (dirección + cuenta → propuesta en 60 s — nadie lo hace bien en residencial), 5) pagado solo con 5 casos reales.

**Proceso (meta 3 semanas a firma):** cotizador → visita técnica 45 min → propuesta con simulación 25 años → firma + 50% → instalación 1–2 días → TE4 + net billing (6–10 semanas) → medidor bidireccional → entrega con app + primer reporte.

## 9. Regulatorio y operación

- **TE4 (SEC)** obligatoria siempre, por instalador autorizado.
- **Net billing:** F3/SCR → respuesta distribuidora (5–20 días hábiles) → instalación → Notificación de Conexión → medidor bidireccional (30 días hábiles legales). Presupuestar 8–10 semanas residencial, 8–14 comercial.
- **Normativa:** RIC + pliegos SEC; equipos en listado autorizado.
- **Garantías:** paneles 25/12 años, inversor 5–10, batería 10 años/6.000 ciclos, instalación 2 años (propia).
- **Seguridad:** altura (arnés, línea de vida), protecciones DC, desconexión visible. *Un accidente cierra la empresa.*

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Guerra de precios en B | No competir por precio: monitoreo, garantía 2 años, QWATT |
| Dólar +10% | Cotizaciones válidas 15 días; comprar al firmar |
| Híbrido no certificado SEC | Verificar listado antes de cotizar (Deye/Growatt tienen modelos OK) |
| Techo malo / sombra | Visita técnica obligatoria; rechazar techos malos |
| Tramitación lenta | Cobrar 50/40/10; comunicar plazos día 1 |
| Batería comprada "por ahorro" | Decir la verdad: es respaldo, payback ~10 años |
| Dependencia de un instalador | Dos socios desde el inicio; certificar interno en 12 meses |
| QWATT percibido como "cripto inversión" | Opt-in, sin promesas, testnet, revisión legal pre-mainnet |

## 11. Roadmap 90 días

1. **Sem 1–4 — Piloto El Arrayán:** kit C (4,4 kWp + Deye 5 kW + 2×US5000 + Shelly + Pi) con socio instalador. Documentar costos reales por línea, horas, plazos. **Primer mint real de QWATT con datos de medidor.** Fija el costo real de C.
2. **Sem 3–6 — Formalizar:** SpA, banco, seguro RC, 2 socios instaladores, 2 distribuidores con crédito 30 días, plantillas (cotización, contrato, acta).
3. **Sem 5–8 — Tres referencias (B)** a precio de lanzamiento (margen 15%) por fotos + testimonio + datos. Ñuñoa/La Reina · Maipú/Puente Alto · Colina/Chicureo.
4. **Sem 6–10 — Cotizador web + lanzamiento:** landing con cotizador instantáneo y 4 casos reales. Post "de la hackathon al techo".
5. **Sem 10–13 — Escalar a 3–4/mes:** referidos, alianzas, primera cotización E.

**Métricas a 90 días:** 6 instalaciones · margen real B y C medido · CAC · plazo real de tramitación · 6 paneles reportando generación verificada a Stellar.

## 12. Decisión final

Tres productos con nombre y precio claro:
1. **Solar Base** (B, 3–5 kWp) — desde $3,2M + IVA · 60% de ventas
2. **Solar + Respaldo** (C, 5 kWp + 5–10 kWh) — desde $8,3M + IVA · 25% de ventas, 40% del margen
3. **Solar Negocio** (E, 10–30 kWp) — a medida, desde mes 6

Con *Solar Mini* (A) como respuesta al cliente chico y *Off-grid* (D) solo por referencia directa. **Todo con monitoreo incluido, garantía de instalación 2 años y Proof of Generation opcional.** Esa oferta no existe hoy en la RM — y convierte un negocio de instalación (bueno pero commodity) en la base física de QWATT.

## Fuentes (agosto 2026)
Punto Solar (precios 2026) · León Solar (tarifas BT1 y alzas a 2035) · SolarPro Chile (inyección precio de nudo) · 24horas/CNE (alza 4,9% jul-2026; caso Maipú) · Chilquinta/cuantomecuesta.cl · Min. Energía + SEC (Ley 21.118, TE4) · Terralink (plazos comerciales) · docs internos: piloto El Arrayán v3, oracle daemon, borrador SCF.

---

## Addendum — Alineación con el estado actual de QWATT (2026-08-23)

Este plan fue redactado bajo la marca anterior (WattCoin/WATT). Al integrarlo al repo se armoniza con el estado real:

1. **Marca:** WattCoin → **QWATT — The Clean Token**; el token es QWATT (testnet, emisor `GDN6IW…`). El diagrama WattNode fue actualizado en este repo con la marca y el memo vigentes.
2. **Formato de memo:** el plan/diagrama original usaba `SOLAR:12.40kWh`; el miner desplegado usa **`PoG#<id>:<kWh>kWh@<precio>/MWh`** (idempotente, explorable en /proof). El WattNode debe emitir este formato.
3. **Piloto El Arrayán:** el plan confirma **kit C con baterías** (Deye 5 kW + 2×US5000). El whitepaper §13 del sitio decía "sin baterías" — corregido en esta misma actualización. `mining-rig/README.md` aún describe el kit sin baterías como banco de pruebas mínimo; sigue siendo válido como *bench test*, pero el piloto real es el kit C.
4. **WattNode vs mining-rig actual:** `mining-rig/miner.js` (Modbus TCP, un medidor, pagos directos con clave de tesorería) es el **prototipo v0**; el WattNode del diagrama (M1–M5, testigo solar, SE050, co-firma de tesorería en HSM, root de solo lectura) es la **especificación v1** para el piloto — coincide con el roadmap del whitepaper (firma del medidor + multi-firma).
5. **SCF (Stellar Community Fund):** el plan referencia Tranche 0 (revisión legal) y Tranche 2 (10–20 prosumidores). El borrador SCF vive fuera de este repo — traerlo a `docs/` cuando exista.
6. **QWATT-Clean:** los atributos verdes por MWh (doc `CLEAN-TOKEN-ARCHITECTURE.md`) son la capa comercial B2B que este plan no cubre — las 30 instalaciones del año 1 son exactamente la base de generación verificada que la haría real.
7. **Regulatorio:** coherente con el sitio — opt-in, sin promesas de valor, testnet, CMF en el radar, revisión legal pre-mainnet.
