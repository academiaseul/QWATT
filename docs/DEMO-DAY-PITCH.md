# QWATT — Stellarbarrio Demo Day · guion de 5 minutos

**Fecha:** viernes 25 de septiembre de 2026 · **Presenta:** una sola persona · **Hard stop:** 5:00 · **Total del guion:** 4:38

**One-liner:** QWATT helps small solar producers prove what they generated through physics-gated, independently verifiable records anchored on Stellar (testnet).

Deck: `docs/QWATT-Demo-Day.pptx` (7 slides, inglés). Guion hablado en español. El texto de cada slide está también en las notas del presentador.

---

## 1. QWATT makes energy claims falsifiable  ·  0:00 → 0:20  (20 s)

*Sección: oneliner · En pantalla: QWATT logo on the Stellar standard title layout; below it a three-step strip (meter icon → four gate icons labelled plausibility / nameplate ceiling / solar elevation / two-meter agreement → Stellar tx icon). Small 'TESTNET' tag bottom-right.*

**Texto en el slide**

- Small solar cannot prove what it produced
- Meter → physics gates → record on Stellar
- The token is a receipt. The record is the product.
- Testnet · Santiago, Chile

**Se dice**

> Hola, soy Jay, de QWATT. QWATT ayuda a la solar pequeña a demostrar lo que generó: un medidor, compuertas de física y un registro en Stellar que cualquiera puede verificar. El token es un recibo; el producto es el registro. Y en un minuto van a intentar engañarlo.

## 2. Trust is the most expensive part of small solar  ·  0:20 → 0:58  (38 s)

*Sección: problem · En pantalla: Three simple icons in a row (apartment building with one meter, factory with a PPA contract, utility bill with a single kWh figure circled). Below them one big line: 'Verifying costs more than the energy earns.'*

**Texto en el slide**

- Shared rooftop: one meter, many neighbors
- PPA client: must trust the seller's meter
- Net billing (Ley 21.118): one number on a bill
- Today's proof: site visits, statements, spreadsheets

**Se dice**

> Tres personas. Un edificio que comparte un techo solar: un medidor, muchos vecinos, una discusión permanente. Un cliente con PPA detrás del medidor: solo le queda confiar en el medidor del vendedor. Y un prosumidor con net billing: un solo número en la boleta. ¿Cómo se verifica hoy? Visitas a terreno, estados de cuenta y planillas. Resultado: la solar pequeña queda fuera de los mercados de atributos y del financiamiento, porque verificar cuesta más de lo que rinde. La confianza es cara. QWATT la hace casi gratis.

## 3. Live: try to falsify an event  ·  0:58 → 1:58  (60 s)

*Sección: solution · En pantalla: LIVE DEMO, browser full-screen on qwatt.org/verificacion; this slide stays behind it as fallback and shows only the four lines above plus a screenshot of the page with the ACCEPTED state. Click sequence: (1) preset 'honest noon' → four gates green, ACCEPTED, mint 0.0000116 QWATT; point at the 3-op transaction panel (manageData qwatt.anchor.sha256 · manageData qwatt.cumulative_mwh · payment QWATT). (2) preset 'night generation' → hour 23:00, sun −41°, REJECTED G2. (3) ask the room for a number, type it into meter A, read the verdict aloud. (4) zoom on the badge 'spec 1.0.0 · 056f1b51' and the published rejection reason. Backup: recorded screen capture of the same four steps.*

**Texto en el slide**

- qwatt.org/verificacion · 4 physics gates, one open spec
- Honest noon: 11.8 / 11.6 Wh → ACCEPTED → 1 tx, 3 ops
- Night 23:00, sun −41° → REJECTED (solar elevation)
- Your number → verdict · spec 1.0.0 · 056f1b51

**Se dice**

> Esto está vivo en qwatt.org/verificacion: «Intenta falsificar un evento». Preset «Intervalo honesto»: medidor A 11,8 watt-hora, medidor B 11,6. Cuatro compuertas: plausibilidad, techo de placa, elevación solar y acuerdo entre medidores. ACEPTADO: emite 0,0000116 QWATT, siempre por el menor de los dos medidores. Ahora «Generar de noche»: las 23:00, sol a menos 41 grados. RECHAZADO, compuerta G2. Ahora ustedes: díganme un número para el medidor A. [mueve el slider A y lee el veredicto] Sobre 14,4 lo frena el techo de placa; lejos del medidor B, el acuerdo entre medidores. Solo pasa si es honesto. Y este sello, spec 1.0.0, es la huella exacta de las reglas que juzgaron. Los rechazos se publican, no se esconden.

## 4. Why Stellar: record, counter and receipt cannot diverge  ·  1:58 → 2:43  (45 s)

*Sección: stellar · En pantalla: Diagram of one Stellar transaction as a single box containing three operation rows (manageData qwatt.anchor.sha256, manageData qwatt.cumulative_mwh, payment QWATT) with a bracket 'atomic'; to the right, three key icons (proposer, independent verifier, off-team signer) with '2 of 3' and a small tag 'sprint week 3'.*

**Texto en el slide**

- 1 tx, 3 ops: evidence hash + MWh counter + QWATT payment
- manageData = native 64-byte anchor for one SHA-256
- Native 2-of-3 multisig (sprint wk 3): no single key writes
- 288 anchors/day ≈ USD 1 per site per year · < 5 s finality

**Se dice**

> ¿Por qué Stellar? Uno: atomicidad. Cada lote es una transacción con tres operaciones: el hash de la evidencia en manageData, el contador en megawatt-hora, y el pago. Pasan las tres o ninguna: registro, contador y recibo no pueden divergir. Dos: multifirma nativa, la construimos en la semana tres. Un 2-de-3 sin escribir un contrato: proponente, un verificador independiente que re-ejecuta las compuertas desde datos publicados, y un tercer firmante fuera del equipo. Ninguna llave sola, ni la nuestra, podrá escribir un registro. Tres: costo. 288 anclajes al día cuestan cerca de un dólar por sitio al año. Finalidad bajo cinco segundos, todo público en stellar.expert.

## 5. What exists today, and what doesn't  ·  2:43 → 3:28  (45 s)

*Sección: traction · En pantalla: Big number '82' with the three sub-counts; beside it a screenshot of the testnet asset on stellar.expert (issuer GDN6IW…BLT46, 2 trustlines, ledger 4,277,175) and a small screenshot of qwatt.org/proof.html in its honest empty state, captioned 'no real generation anchored yet'. Bottom strip: 'Instawards · SOW v1 rejected (single operator) → v3 multisig · sprint week 1 shipped'.*

**Texto en el slide**

- Aug 2026: won Stellar hackathon Santiago → built QWATT
- Testnet asset live Aug 22: 42.7M QWATT · 2 trustlines
- 82 CI checks: 37 conformance · 24 adversarial · 21 ingestion
- 0 real MWh anchored · 0 customers · 0 revenue · 0 mainnet

**Se dice**

> En agosto ganamos el hackathon de Stellar en Santiago y en los días siguientes construimos QWATT. El activo está en testnet desde el 22 de agosto: 42,7 millones de QWATT, dos trustlines. 82 chequeos automáticos: 37 de conformidad, 24 adversariales y 21 de ingesta; la misma mañana por Modbus, HTTP y CSV da registros idénticos byte a byte. Con Stellar Barrio postulamos a Instawards: la primera SOW fue rechazada por depender de un solo operador; la versión tres responde con multifirma, y la semana uno ya está entregada. Y lo que no existe: cero megawatt-hora reales anclados, cero clientes, cero ingresos, cero mainnet. El explorador está vacío, a propósito.

## 6. Next milestone: 7 unattended days on testnet  ·  3:28 → 4:08  (40 s)

*Sección: roadmap · En pantalla: Horizontal timeline: Sept 14 (sprint start, week 1 checked) → mid-October (big marker: '7 days · 2-of-3 · rejection log ≠ empty') → faded 'first real MWh: 150 Wp bench + El Arrayán 4.4 kWp' → faded 'Soroban verifier · physical pilot'.*

**Texto en el slide**

- Today: sprint week 1 of 4 — ingestion shipped
- Wk 2 evidence chain · wk 3 2-of-3 · wk 4 public feed
- Day 30 (mid-Oct): 7 days of 2-of-3 batches + rejection log ≠ empty
- Then: first real MWh from 150 Wp bench and 4.4 kWp roof

**Se dice**

> Del sprint de 30 días, la semana uno está entregada: ingesta. Semana dos, cadena de evidencia. Semana tres, el 2-de-3 con verificador independiente. Semana cuatro, feed público y corrida en vivo. El hito medible, a mediados de octubre: siete días seguidos de lotes anclados con 2-de-3 en testnet, con fallas inyectadas y un registro público de rechazos que no esté vacío. Después, el primer megawatt-hora real: el banco de 150 watts y el techo de 4,4 kilowatts en El Arrayán. Luego, el verificador en Soroban.

## 7. Two founders. Three asks.  ·  4:08 → 4:38  (30 s)

*Sección: team_ask · En pantalla: Two headshots side by side with one-line roles; center: a large key icon labelled '2 of 3: your key here'; below, two smaller ask cards; footer with qwatt.org · github.com/academiaseul/QWATT · jay@quorelia.org.*

**Texto en el slide**

- Jay Kim: 10 yrs energy ops · 10 PMGD plants · 50 MW
- Diego Ostertag: engineering and product
- Ask 1: your key in the 2-of-3, by sprint day 10
- Ask 2: shared-rooftop design partner · Ask 3: registry/audit intro

**Se dice**

> Somos dos. Yo vengo de diez años en energía, en Chile y Corea: operé diez plantas solares PMGD, 50 megawatts. Conozco los medidores y las discusiones. Diego lleva ingeniería y producto. Tres pedidos: un tercer firmante del ecosistema para una llave del 2-de-3, antes del día 10; un edificio o instalador con techo solar compartido; y una intro a un registro de atributos renovables o a una auditora. Lo que viene: siete días sin tocar nada. Gracias.

---

## Notas para el presentador

- ANTES DE SUBIR: abre tres pestañas y déjalas cargadas — qwatt.org/verificacion (zoom 125 %, desplazada hasta «01 · Pruébalo»), la página del activo QWATT en stellar.expert (testnet) y qwatt.org/proof.html. Cierra todo lo demás. Notificaciones apagadas, laptop enchufado, pantalla sin suspensión.
- DEMO, slide 3 (≈ 60 s con clics): (1) clic en «Intervalo honesto» → cuatro compuertas OK, ACEPTADO, «emite 0,0000116 QWATT». (2) clic en «Generar de noche» → 23:00, sol a −41,1°, RECHAZADO G2. (3) pide un número al público y ARRASTRA el slider «Medidor A» (0 a 30 Wh, pasos de 0,1; el B queda en 11,6): sobre 14,4 → RECHAZADO G1 techo de placa; fuera de ≈ 11,1–12,2 → RECHAZADO G3 acuerdo; dentro → ACEPTADO. Nunca prometas el veredicto antes de moverlo. (4) señala el sello «spec 1.0.0 · 056f1b51» en la fila de etiquetas. Vuelve al deck con Alt+Tab.
- La transacción de tres operaciones no está junto al veredicto: está más abajo, en «05 · Onchain». No la busques en vivo; el slide 4 la explica.
- RESPALDO: graba hoy los cuatro pasos como video de 45 s sin audio y guárdalo en el escritorio, no en la nube. Si la página no carga en 5 segundos, reproduce el video con el mismo guion. Si también falla, el slide 3 tiene una captura del estado ACEPTADO: di «esto es una captura; la página está en qwatt.org/verificacion».
- TIEMPO: guion ≈ 4:40 incluyendo clics; tope duro 5:00. Si llegas al slide 6 pasado el 3:45, salta la frase de Soroban y ve directo al pedido. No agregues frases en el escenario.
- SI PREGUNTAN «¿es un crédito o una inversión?»: «No. Un QWATT es un recibo de un megawatt-hora verificado, en testnet: se emite solo desde generación verificada y se consume cuando alguien lo retira para hacer una afirmación verdadera. No es un instrumento de mercado.»
- NO DECIR: «descentralizado», «DeFi», «REC» o «I-REC» (di «registro de atributos renovables»), «bono de carbono», «inversión», «precio», «mainnet» como si existiera, «clientes» o «ingresos» como si existieran, «ya anclamos generación real». La multifirma se construye en la semana 3: di «podrá», no «puede». Las plantas PMGD están en Chile; «Chile y Corea» se refiere solo a los diez años de carrera. Sobre Diego, solo «ingeniería y producto».

## Checklist del organizador

- [ ] Deck final (pptx + pdf de respaldo)
- [ ] Demo funcionando: qwatt.org/verificacion abierta en una pestaña, preset "Intervalo honesto" cargado
- [ ] Demo grabada como backup (pantalla, 40 s: honesto → generar de noche → exceder el techo)
- [ ] Links listos: qwatt.org · qwatt.org/verificacion · stellar.expert asset QWATT (testnet)
- [ ] Wallet / cuenta iniciada (no hace falta: la demo no firma nada)
- [ ] Testnet preparado: el asset está vivo; comprobar Horizon 10 min antes
- [ ] Pitch ensayado con cronómetro (objetivo 4:40, tope 5:00)
- [ ] Una persona definida como presenter
