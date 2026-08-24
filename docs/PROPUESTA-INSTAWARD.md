# QWATT × Stellar Instawards — Propuesta de sprint

> **Proyecto:** QWATT — The Clean Token · [qwatt.org](https://qwatt.org) · [github.com/academiaseul/QWATT](https://github.com/academiaseul/QWATT)
> **Equipo:** Jay Kim y Diego — co-fundadores (ingeniería, diseño y comercial compartidos) · Santiago, Chile
> **Contacto:** jay@quorelia.org · **Fecha:** 24 de agosto de 2026
> **Solicitud:** 1 sprint de 4 semanas — **WattNode v0: el primer kWh solar real verificado on-chain**

---

## Qué es QWATT (lo que ya existe, verificable hoy)

QWATT es un protocolo de verificación energética: producción renovable medible → eventos verificados → registros públicos en Stellar. **1 QWATT = 1 MWh** atestiguado bajo el protocolo. No es un producto de inversión; todo corre en testnet y está etiquetado honestamente (TESTNET / PROTOTIPO / PLANIFICADO / DEMO).

Construido en 4 días desde la hackathon Stellar × AI Studio (20 de agosto):

- **Activo real en testnet** — génesis, supply y compras atómicas auditables en stellar.expert
- **Oráculo en vivo** — precio spot EPEX day-ahead real en la portada (incluidos precios negativos)
- **Proof-of-Generation funcionando** — rig de minería Modbus que paga 0,001 QWATT por kWh con memo `PoG#id:kWh@precio/MWh`
- **QWATT Explorer** — cualquiera re-verifica eventos y reservas leyendo Horizon directo, sin backend
- **8 apps + whitepaper v2.0** — sitio con Lighthouse 100 en accesibilidad, ES/EN

**Lo que falta es exactamente una cosa: que el kWh venga de un medidor físico real.** Eso es este sprint.

## Objetivo del sprint

Instalar **WattNode v0** — el nodo de verificación — sobre el sistema solar híbrido del piloto El Arrayán (Lo Barnechea, Chile) y producir **los primeros eventos Proof-of-Generation reales de la historia del protocolo**, verificables por cualquier persona de la comunidad Stellar en el explorer.

## Prioridades, en orden

1. **P1 — Primer PoG real on-chain.** Medidor real (Modbus RTU + Shelly 3EM) → gateway → transacción con memo `PoG#…` → visible como `QW-000001` en [qwatt.org/proof](https://qwatt.org/proof.html). *Criterio de éxito: cualquiera abre el link de stellar.expert y ve el evento.*
2. **P2 — Firma en el nodo.** Clave del panel en el gateway; minteo de dos firmas (nodo + tesorería): un nodo comprometido es un sensor roto, no una impresora de dinero.
3. **P3 — Anti-fraude físico.** Testigo solar (celda de referencia 5 W + INA226) y validadores: tope físico kWh ≤ capacidad × horas × 1,15, generación nocturna = rechazo, divergencia entre medidores, reloj y tamper.
4. **P4 — Documentación pública.** Write-up bilingüe + demo en video + código en GitHub, presentado en Stellar Barrio.

## Arquitectura WattNode v1 (resumen)

*(diagrama completo: `wattnode-architecture.svg` adjunto)*

| Capa | Componentes |
|---|---|
| **Física (existente, no financiada aquí)** | Arreglo FV 8×550 Wp · inversor híbrido (Deye/Growatt) · batería LiFePO4 2×4,8 kWh |
| **Medición (M1–M4, este sprint)** | M1 medidor DC por MPPT · M2 Modbus del inversor · M3 Shelly Pro 3EM con CTs (import/export red) · M4 testigo solar |
| **WattNode (este sprint)** | Raspberry Pi 4 · RS485 aislado · RTC DS3231 · elemento seguro SE050 · watchdog · 4G de respaldo · muestreo 10 s → lote 5 min → validadores → firma → outbox |
| **Stellar (existente)** | Co-firma de tesorería (clave en Vault, nunca en el nodo) · 1 tx atómica: ancla de evidencia + acumulado + pago QWATT · Explorer público |

## Cronograma (4 semanas)

| Semana | Entregable |
|---|---|
| 1 | Hardware armado y probado en banco: lecturas Modbus reales reemplazan al simulador |
| 2 | Instalación retrofit en el sistema del piloto; medición continua 24/7 |
| 3 | **Primeros PoG reales on-chain** (P1) + firma en nodo (P2) |
| 4 | Validadores anti-fraude (P3) + write-up, video y demo a la comunidad (P4) |

## Presupuesto solicitado (hardware + logística del nodo)

> El sistema solar (paneles, inversor, batería) **ya existe y no se financia con este grant**. Se financia solo la capa de verificación. Precios referenciales agosto 2026, por confirmar con distribuidores locales.

| Ítem | USD aprox. |
|---|---|
| Raspberry Pi 4 (4 GB) + fuente DIN + SD industrial + gabinete | 140 |
| Shelly Pro 3EM + 3 CTs | 160 |
| Medidor DC Modbus (≥600 V, por MPPT) | 120 |
| RS485 aislado (USB/HAT) + terminaciones 120 Ω | 40 |
| RTC DS3231 + elemento seguro SE050 (breakout) | 45 |
| Testigo solar: celda ref. 5 W + INA226 | 45 |
| Módem 4G + SIM datos (3 meses) | 70 |
| Tablero DIN, protecciones, cableado, prensaestopas | 130 |
| Envío/importación a Chile + imprevistos (~20%) | 150 |
| **Total** | **≈ 900 USD** |

Mano de obra de instalación e ingeniería: aportada por el equipo (no se solicita).

## Por qué esto le sirve a Stellar

- **Un caso de uso físico y auditable**: memos, transacciones atómicas y assets nativos de Stellar haciendo algo que un smart contract caro no hace mejor — a $0.00001 por operación.
- **Todo público**: cada entregable es un link de stellar.expert, no una promesa.
- **Puerta LATAM**: net billing chileno (Ley 21.118) + generación distribuida = terreno real para pagos y atestación en Stellar; después de este sprint viene la aplicación a SCF con tracción demostrada.

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Retraso de importación de componentes | Semana 1 con alternativas locales (Shelly y Pi hay stock en Chile); DC meter puede llegar en semana 2–3 |
| Reset trimestral de testnet | Recuperación automatizada ya construida (`redeploy-testnet.js`); los write-ups archivan los links históricos |
| Clima/acceso al sitio del piloto | Banco de pruebas con inversor en laboratorio como plan B para P1; instalación en sitio para P2–P3 |
