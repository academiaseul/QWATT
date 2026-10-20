# Trabajo previo al sprint Instawards

El sprint Instawards Chile empieza el **lunes 19 de octubre de 2026 (Día 1)**. Todo lo que está en
la tabla es anterior a ese día o ajeno al sprint. **Nada de esto lo financia el Instaward.** Lo hecho
cada semana desde el Día 1 está en [`CHANGELOG.md`](../CHANGELOG.md).

Fuente: `git log` de este repositorio (fecha de autor de cada commit). En GitHub, `academiaseul` es
Jay Kim y `CogeloEasy` es Diego Ostertag.

| Qué | Fecha | Autor | Commits | Dentro o fuera del sprint |
|---|---|---|---|---|
| Sitio, demo en Stellar testnet y documentos del hackathon de agosto; propuesta y SOW del Instaward; especificación única de los filtros de verificación con su suite de conformidad; ingesta independiente del medidor (Modbus, HTTP, CSV); presentación del Demo Day | 22 ago – 25 sep 2026 | Jay Kim (academiaseul) | `41a6d38` … `48a40d3`: 57 commits, toda la historia de `main` hasta `48a40d3` (`git log 48a40d3`), incluido `98b281a` (9 sep) | Fuera: trabajo previo, no financiado |
| Lotes de evidencia y cadena de hashes; licencia MIT; transacción de anclaje y ensayo 2 de 3; proponente y verificador independiente; recuperación; conciliación; datos NREL PVDAQ y prueba de escala; corrida en vivo con fallas programadas; ensayo acelerado; herramienta de la cuenta de anclaje; vigilancia, publicación del feed, informe automático, manual y kit de despliegue | 8 oct 2026 | Diego Ostertag (CogeloEasy) | 17 de los 20 commits de `8b112aa^..3c2cc88` (`8b112aa` … `ba93bca`) | Fuera: trabajo previo, no financiado |
| Prueba de resistencia en tiempo real, herramienta de pruebas A–D para la cuenta definitiva y chequeo previo a la operación en vivo | 17 oct 2026 | Diego Ostertag (CogeloEasy) | 3 de los 20 commits de `8b112aa^..3c2cc88` (`e43c32d`, `975e7ae`, `3c2cc88`) | Fuera: trabajo previo, no financiado |
| Limpieza de afirmaciones en el sitio y el protocolo (piloto anonimizado, sin «moneda» ni garantía de recompra) | 13 oct 2026 | Jay Kim (academiaseul) | `48a40d3..5e315ea`: 3 commits (`b133d6c`, `5aba403`, `5e315ea`), rama `limpieza-afirmaciones` | Fuera: trabajo previo, no financiado |
| Configuración local del editor (`.claude/launch.json`) | 19 oct 2026 | Jay Kim (academiaseul) | `2bb5496`: 1 commit | Fuera: mantenimiento del repositorio, no es trabajo del sprint (el archivo deja de versionarse en la semana 1) |
| Prototipo de contrato Soroban (registro) y su plan | 17 oct 2026 | Diego Ostertag (CogeloEasy) | `6bc1b34^..d6d85b2`: 4 commits, en la rama `sprint-phase-0` de Diego | Fuera del alcance del sprint; **no se trajo** a este repositorio |

Los 20 commits de Diego entraron con la fusión `35a1e77` y los 3 de `limpieza-afirmaciones` con la
fusión `7336e20` (ambas del 20 oct). Las dos fusiones conservan el autor y la fecha de cada commit y
no agregan cambios propios.

## Títulos que no se reescriben

- **`98b281a` «Sprint week 1»** (9 sep 2026) se escribió cuando la propuesta suponía partir el
  14 sep. Es trabajo previo, no la semana 1 de este sprint.
- **`ef93cb7`** dice «two-day live run», pero es el **ensayo acelerado: 48 h simuladas en 4 min 18 s
  (testnet, cuentas desechables, feed local, datos simulados)**. Su título no se reescribe; el
  informe que generó ya lleva el nombre correcto
  ([`evidence/dress-rehearsal/WRITEUP-dress.md`](../evidence/dress-rehearsal/WRITEUP-dress.md)).
- «Sprint phase 0» (`8b112aa`, 8 oct) y los pasos del CI llamados «Deliverable 1» a «Deliverable 4» también son
  trabajo previo: nombran las partes del plan, no semanas del sprint.

## Cómo comprobarlo

```bash
git log --format='%h %ad %an %s' --date=short 48a40d3            # Jay, 22 ago – 25 sep: 57 commits
git log --format='%h %ad %an %s' --date=short 8b112aa^..3c2cc88  # Diego, 8–17 oct: 20 commits
git log --format='%h %ad %an %s' --date=short 48a40d3..5e315ea   # limpieza-afirmaciones, 13 oct: 3 commits
git show --stat 2bb5496                                          # configuración del editor, 19 oct
```

*In English: everything in the table predates Day 1 (Monday 19 Oct 2026) or is outside the sprint,
and none of it is funded by the Instaward. What was done each week from Day 1 on is in CHANGELOG.md.*
