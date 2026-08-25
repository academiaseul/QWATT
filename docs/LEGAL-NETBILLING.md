# QWATT — Investigación legal: ¿podemos comprar y vender energía bajo net billing?

> **Investigación interna, 24 de agosto de 2026. NO es asesoría legal.** Antes de cualquier
> contrato comercial o paso a mainnet, validar con un abogado de energía chileno
> (el punto 8 lista las preguntas exactas que hay que hacerle).

## 1. La respuesta corta

**No — una empresa privada no puede "comprar" los excedentes de net billing de un cliente,
ni venderle energía a clientes residenciales regulados.** El net billing (Ley 21.118) es una
relación cerrada y regulada entre **el cliente titular del suministro** y **su distribuidora**:
el cliente inyecta, la distribuidora valoriza al precio regulado (≈ precio nudo) y descuenta
de la boleta o paga excedentes. No existe figura legal para que un tercero se meta en ese flujo.

Tampoco existe todavía en Chile el **comercializador minorista** para clientes regulados:
los residenciales solo pueden comprar energía a la distribuidora de su zona de concesión
(la reforma a la distribución que crearía comercializadores lleva años en discusión y en 2026
sigue sin ser ley).

**Pero eso no mata el negocio — lo enmarca.** Lo que QWATT quiere hacer tiene tres vehículos
legales existentes, y el token queda fuera de la definición de "venta de energía" si se
estructura bien.

## 2. Lo que SÍ podemos hacer hoy (sin abogado de por medio)

| Vehículo | Qué es | Estado legal |
|---|---|---|
| **Venta e instalación de kits** | Vender el sistema + instalación certificada SEC (TE4) + tramitación net billing a nombre del cliente | Totalmente legal — es el plan de negocio actual |
| **Monitoreo y verificación** | Cobrar por la capa de datos: SCADA Quorelia + WattNode + reportes. Es un servicio, no energía | Totalmente legal — nadie más lo vende como producto |
| **ESCO / arriendo / PPA tras el medidor** | QWATT financia y es dueña del sistema en el techo del cliente; el cliente paga cuota o tarifa por kWh **autoconsumido** (la energía nunca pasa por la red pública — es un contrato privado de servicio/arriendo) | Modelo usado en Chile para empresas; para residencial requiere redacción contractual cuidadosa |

Clave del modelo ESCO: aunque QWATT sea dueña del sistema, **el titular del net billing sigue
siendo el cliente** (es su suministro). Los créditos de excedentes llegan a la boleta del cliente.
QWATT puede capturar ese valor **contractualmente** (por ejemplo, la cuota del arriendo considera
los créditos que el cliente recibe), pero nunca es la contraparte de la distribuidora.

## 3. El único camino para vender energía como empresa: PMGD

Si QWATT quiere ser vendedora de energía de verdad, la figura es el **PMGD**
(Pequeño Medio de Generación Distribuida, DS 88/2019): generadora de hasta 9 MW conectada
a la red de distribución, que vende al **precio estabilizado** que fija el Ministerio de
Energía (Decreto 23T para 2026, con precios por bloque horario y subestación).

- Es un modelo de **planta generadora** (un terreno, una instalación, una conexión aprobada),
  no de agregación de techos residenciales. Cada techo ajeno no puede ser "nuestro PMGD".
- **Alerta regulatoria 2026**: el régimen de precio estabilizado PMGD está en plena discusión
  de reforma — hay presión por cambiarlo antes de 2026-2027. Cualquier plan de negocio PMGD
  debe modelarse con escenarios de precio post-reforma, no con el decreto vigente.
- No existe aún "agregador virtual" (VPP) de techos residenciales para clientes regulados.

## 4. Traspaso de excedentes: qué permite y qué no

La Ley 21.118 permite al cliente **imputar sus excedentes a otros suministros del mismo
titular** (otra propiedad del mismo dueño, bajo la misma distribuidora). No permite ceder
excedentes a un tercero distinto (como QWATT). O sea: no podemos "recolectar" los excedentes
de los pilotos hacia una cuenta de la empresa. *(Confirmar alcance exacto con abogado — punto 8.)*

## 5. El token NO es venta de energía (y hay que mantenerlo así)

QWATT (el token) registra y atesta generación verificada — **1 QWATT = 1 MWh atestiguado**.
Eso es un **instrumento de verificación/atributo**, no un contrato de suministro eléctrico.
Mientras se mantenga así, la regulación eléctrica no aplica al token. La que sí puede aplicar
es la financiera:

- **Ley Fintech 21.521 (vigente, CMF)** define los criptoactivos y regula servicios sobre
  ellos: custodia para terceros, intermediación, plataformas de transacción y ruteo de órdenes
  requieren **registro/autorización CMF**. Si QWATT solo emite y la gente lo guarda en sus
  propias wallets (auto-custodia, como hoy), no estamos prestando esos servicios.
- **Riesgo de "valor" (security)**: si el token se vende prometiendo retorno, rescate
  garantizado o representa deuda/participación, la CMF puede tratarlo como valor tokenizado
  → regulación de valores completa. Las reglas que ya tenemos escritas nos protegen:
  sin lenguaje de inversión, sin promesa de rescate a precio spot (invariante de precio
  vintage), testnet hasta revisión legal.
- **QWATT-C (atributo verde)**: venderlo como certificado voluntario de atributo renovable
  es análogo a los I-REC (mercado voluntario que ya opera en Chile) — no es subsidio ni
  crédito de carbono mientras no lo digamos. Nunca presentarlo como equivalente a
  certificados oficiales sin homologación.

## 6. Cómo queda el modelo con "esta gente" (los pilotos)

1. **El vecino del piloto** es y sigue siendo el titular del net billing: sus créditos de
   excedentes llegan a su boleta, de la distribuidora, al precio regulado. Nada que hacer ahí
   — y está bien: ese flujo ya funciona solo.
2. **QWATT le vende** el kit, la instalación, la tramitación y la capa de verificación
   (WattNode + SCADA + reportes). Ingresos por producto y servicio: legales hoy.
3. **El token** registra su generación verificada (PoG). En testnet: cero problema legal.
   En mainnet: el reward pasa a tener valor → revisar con abogado el encuadre tributario
   y financiero antes (¿premio?, ¿pago por datos?, boleta/factura, IVA).
4. **El atributo verde** (QWATT-C) es de quien genera; QWATT puede operar el registro y
   cobrar por él, y más adelante estructurar la venta de atributos a empresas — con asesoría.

**En una frase: no compramos ni vendemos la energía de los pilotos — vendemos el fierro,
el servicio y la verdad verificable sobre esa energía. La energía se paga sola vía
distribuidora, como la ley manda.**

## 7. Señales de alerta (nunca hacer sin abogado)

- Cobrar a un piloto "por su energía" o pagarle "por comprarle su energía" — eso es
  suministro eléctrico no autorizado.
- Vender QWATT o QWATT-C con lenguaje de inversión, rentabilidad o rescate garantizado.
- Custodiar claves o tokens de clientes (nos convierte en custodio CMF).
- Presentar QWATT-C como REC oficial, crédito de carbono o beneficio tributario.
- Firmar PPAs residenciales sin revisión contractual (protección al consumidor, SERNAC).

## 8. Preguntas exactas para el abogado (cuando toque)

1. Alcance real del traspaso de excedentes del art. correspondiente de la Ley 21.118:
   ¿solo mismo titular? ¿aplica a comunidades/copropiedad (generación comunitaria)?
2. Estructura ESCO residencial: ¿arriendo con opción de compra, leasing o contrato de
   servicio energético? Impacto SERNAC y tributario de cada uno.
3. Encuadre del reward PoG en mainnet: ¿premio, permuta, pago por servicio de datos?
   IVA y renta.
4. QWATT-C como certificado voluntario: ¿requiere registro en algún esquema (I-REC u otro)
   para ser vendible a empresas con valor de reporte ESG?
5. Estado 2026 de la reforma a la distribución (comercializador minorista) y de la reforma
   al precio estabilizado PMGD — timing para decidir si un PMGD propio entra al plan.
6. Momento en que la emisión del token en mainnet gatilla obligaciones Ley 21.521
   ante la CMF, si es que alguna.

## 9. Anexo 25-ago — ¿podemos ser broker/trader de energía?

**Pregunta de Jay:** ¿actuar como puente para comprar y vender energía, usando QWATT para
validar, o solo generar para mintear?

**Respuesta corta: el broker puro de kWh no existe legalmente en Chile hoy.**
(1) Minorista: los regulados solo compran a su distribuidora; el comercializador minorista
sigue trabado en la reforma a la distribución. (2) Mayorista: el mercado spot del Coordinador
admite generadores, transmisores, distribuidoras y clientes libres — actores con activos
físicos o carga real; no hay asiento para un trader sin activos. (3) Net billing: soldado
al par cliente↔distribuidora.

**El reframe:** la volatilidad intradía no es argumento para ser broker — es el argumento
de lo que sí podemos ser:
- **Verificador (ahora):** el memo PoG registra kWh + precio spot del momento. La
  volatilidad es el PRODUCTO: atestación horaria que los RECs planos no dan (24/7 CFE
  matching corporativo).
- **Arbitraje físico tras el medidor:** baterías + autoconsumo capturan ~$200/kWh evitado
  vs ~$75 inyectado (2,5×) dentro de la propiedad del cliente, sin licencia. Es el único
  "trading" legal a nuestra escala y es un servicio vendible (kit híbrido C + software).
- **Generador (después):** PMGD vende a precio estabilizado por bloques horarios — el
  régimen neutraliza justamente la volatilidad spot. Modelar con escenarios post-reforma.
- **El "puente" legal es el atributo, no el kWh:** QWATT-C vendido bilateralmente a
  empresas (mercado voluntario). Límite CMF: operar una PLATAFORMA donde terceros transan
  tokens entre sí puede ser "sistema alternativo de transacción" (Ley 21.521) → registro.
  Venta bilateral primaria de certificados/servicio: no.

**Posición estratégica:** mintear ahora, arbitrar físicamente con baterías, corretear la
PRUEBA y no la energía — y si la reforma crea el comercializador, QWATT ya tiene la
infraestructura (medición + verificación + clientes) que ese rol exigirá.

**Nota banco de pruebas (depto):** el rig QW-PRO-001 es CC aislado, nunca en paralelo con
la red del depto → sin SEC/TE4/distribuidora. Mantenerlo isla; si algún día inyecta AC,
cambia el régimen completo.

## 10. Fuentes consultadas (agosto 2026)

- Guías Ley 21.118 / net billing: Solarity, Solcor, Punto Solar, Tritec, Solar Store,
  Terralink (coinciden: el derecho de inyección y venta de excedentes es del cliente regulado,
  contra la distribuidora, a precio regulado)
- PMGD y precio estabilizado: DS 88/2019; Decreto 23T (precios 2026 por bloque horario y
  subestación); Energía Estratégica y Consejo Minero/PPU sobre la reforma en discusión
- Ley Fintech 21.521: textos CMF y análisis (Metlabs, Anguita Osorio, CryptoSlate, Bloktok) —
  definición de criptoactivo, servicios regulados, tokens respaldados como valores
