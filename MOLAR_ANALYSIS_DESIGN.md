# LOOPY.ESP — Tercer Camino: Análisis de Sistemas Dinámicos Nativos

> **DOCUMENTO DE DISEÑO / PROPUESTA** — no es una decisión ratificada ni código.
> Este documento formula el marco matemático-algorítmico para analizar redes
> psicopatológicas y simular intervenciones **usando exclusivamente la física
> nativa del motor de LOOPY** (sistemas dinámicos, teoría de control y álgebra
> lineal aplicada). **No** es estadística inferencial ni psicometría.
>
> - Rama objetivo: `molar-analysis` (base: `594adf0`, Fase 1 molar completa).
> - Autor: ingeniero del equipo (sesión delegada). Fecha: 2026-09-11.
> - Regla de esta etapa: **no se modifica nada en `js/`**; la UI del §6 es una
>   proposición. Un script podrá implementar la matemática definida aquí sin
>   re-consultar el motor (ver §8).

---

## Tabla de contenidos

0. Resumen ejecutivo
1. **Paso 0 — Qué motor está vivo en `molar-analysis`** (hallazgo crítico)
2. §1 Representación del estado: grafo → matriz `A` con retardos
3. §2 Estabilidad: radio espectral, ciclos y atractores
4. §3 Simulación de intervenciones nativas (clamping, severing, impulso)
5. §4 Centralidad dinámica molar y bucles dominantes
6. §5 Propuesta de UI "Molar Analysis" (proposición, no implementación)
7. Relación con `NIRA.js` (complemento, no duplicación)
8. Especificación implementable (constantes, fórmulas, pseudocódigo)
9. Supuestos, riesgos e inconsistencias con el prompt del owner

---

## 0. Resumen ejecutivo

El motor vivo en `molar-analysis` **no es el motor original de LOOPY ni
solamente el custom `takeSignal`: es una combinación de ambos**, y la
combinación tiene tres propiedades que cualquier análisis matemático debe
respetar (y que difieren del prompt del owner):

1. **No hay decaimiento**: el valor de un nodo solo cambia por señales
   entrantes (`value += delta`); una vez elevado, se mantiene. "Señales decaen
   a 0" no ocurre: los incrementos cesan o crecen, el valor nunca "vuelve solo".
2. **No hay clamp en vivo**: `Node.bound()` es un no-op (código comentado). El
   clamp `[0,1]` existe **solo dentro de las simulaciones de NIRA**
   (`NIRA.clampValues`), no en el motor que ve el usuario.
3. **Todo ciclo — incluso de strengths pequeñas y de signo mixto — hace
   divergir el modo dominante** (tarde o temprano satura), por la estructura
   integradora `v(t+1) = v(t) + …` combinada con la re-emisión `0.3·value`.
   El criterio clásico del owner ("producto de strengths ≥ 1 en un ciclo →
   inestable") corresponde al motor original de passthrough; con el motor
   actual el umbral es "cualquier ciclo con ganancia neta no nula" (velocidad
   fijada por `ρ`, patrón final por el signo).

La matemática se desarrolla en §1–§5 y se condensa en una especificación
implementable (§8) con las constantes reales del código (sección §1.5).

---

## 1. Paso 0 — Qué motor está vivo en `molar-analysis`

Lectura verificada contra el código de la rama (`git log` → `594adf0`,
descendiente directo del merge de `feat/nira-lite` incluyendo PR #98
"nira-con-nuevo-motor").

### 1.1 La cadena de propagación real (evento por evento)

El ciclo de simulación corre a **30 ticks/s** (`Loopy.js:108`,
`setInterval(self.update, 1000/30)`), y `Model.update()` llama por tick a
`edges[i].update(speed)` y luego `nodes[i].update(speed)`
(`Model.js:155-158`; el `speed=0.05` de `Model.js:13` es vestigial: no se usa
— `Edge.update` solo lo referencia en código comentado, `Edge.js:308`).

**Nodo → arista (emisión, custom):** `Node.js:172-201` (`takeSignal`):

```
v_i  +=  delta_in            // sin clamp (bound() es no-op, Node.js:73-81)
si no hay timer pendiente:
   timer = setTimeout( after 0.1 s ):
       si loopy.mode == MODE_PLAY:   emitir {delta: 0.3 · v_i} a TODAS las aristas salientes
       deltaPool = 0; timer = null
```

- `aggregationLatency = 0.1 s` (`Node.js:168,200`) → a 30 Hz son **3 ticks**.
- La emisión usa el **valor actual** del nodo (no `deltaPool`, que se acumula
  pero no se usa para emitir: `Node.js:194` comentario "← value, no deltaPool").
- **Quirk crítico**: cualquier llegada (incluso `delta=0`, p. ej. por una
  arista con `strength=0`) **dispara el timer** y por tanto la re-emisión del
  valor actual del nodo. La arista de peso 0 actúa como *trigger* booleano.
- `sendSignal` (`Node.js:157-166`) reparte la señal a todas las aristas
  salientes con rotación round-robin (`shiftIndex`).

**Arista (viaje, original):** `Edge.js:38-121` (`addSignal`/`updateSignals`):

```
velocidad v = 2^signalSpeed  píxeles/tick           (Edge.js:79)
por tick:  signal.position += v / arrowLength(e)    (Edge.js:80,87)
al llegar position >= 1:
   w = sign(strength) · (0.3 + 0.7·|strength|)       (Edge.js:112: effectiveStrength)
   delta *= w
   destino.takeSignal(signal)                        (Edge.js:113)
```

- `arrowLength(e) = r·θ` = longitud de arco del trazo dibujado
  (`Edge.js:317-345`); depende de la geometría (posiciones, `arc` visual,
  radios). El retardo en ticks es `τ_e = ⌈ arrowLength / 2^signalSpeed ⌉`.
- `signalSpeed` es una variable global del jugador (`Loopy.js:47`, default 3;
  slider `0..6` paso `0.2`, `PlayControls.js:110-113`).
- El bloque original de LOOPY que multiplicaba por `strength` a mitad de
  camino (`position >= 0.5`) está **comentado** (`Edge.js:90-104`): la
  ganancia de arista se aplica solo en la llegada.
- Topes: `Edge.MAX_SIGNALS = 100` global y `10` por arista
  (`Edge.js:8-9,41,46`): si se superan, la señal **se descarta** (truncación
  no lineal bajo alta carga). `age` arranca en 1000000 ("forever") y se
  decrementa por salto (`Edge.js:52-66`): en la práctica las señales no mueren.

**Destino → valor:** el `takeSignal` del paso 1 (integración `value += delta`,
re-emisión con latencia).

### 1.2 Fundamentos para el modelo matemático

- **Ganancia de emisión (nodo):** `g = 0.3` (constante, `Node.js:194`).
- **Ganancia de arista (llegada):** `w(s) = sign(s)·(0.3 + 0.7|s|)`,
  `s ∈ [−1, 1]` (`Edge.js:112`). Biescala: `w(0)=0`, `w(±1)=±1`, `w(0.1)=0.37`.
- **Ganancia efectiva por salto completo** (emisión en j → incremento en i):
  `a_{ij} = g · w(s_{ij}) = 0.3 · sign(s)·(0.3+0.7|s|)`, en el rango
  `[−0.3, 0.3]`.
- **Retardo total por salto:** `τ_{ij} = τ_e(arista) + L`, con `L = 3` ticks
  (ventana de agregación); la emisión del nodo i ocurre a lo sumo una vez cada
  `L` ticks, `L` ticks después de la primera llegada de la ráfaga.
- **Integrador**: `v(t+1) = v(t) + [llegadas en t]`; **sin decaimiento** y
  **sin clamp** en el motor vivo.

### 1.3 Qué NO está vivo (reconciliación con el prompt del owner)

| Concepto del prompt | Estado real en la rama |
|---|---|
| `addSignal`, `updateSignals`, `signalSpeed` | **Vivos** (`Edge.js:38,76,79-87`) — el viaje de señales es el original. |
| `effectiveStrength` | **Vivo**, pero aplicado a la **llegada** (`Edge.js:112-113`), no a mitad de camino. |
| `arc` como "velocidad" | **No**: `arc` es solo geometría visual (curvatura del trazo, `Edge.js:273-279`; sagita `h = 2|arc|`). El retardo lo define `2^signalSpeed / arrowLength`. |
| Multiplicar por strength a mitad de camino | **Comentado** (`Edge.js:90-104`). |
| `takeSignal` original (pasar el delta) | **Reemplazado** por el custom con `aggregationLatency`/`deltaPool`/`aggregate` (`Node.js:168-201`) + re-emisión `0.3·value`. |
| Clamp de valores | **Solo en simulaciones NIRA** (`NIRA.js:89-100`, `VALUE_MIN=0`, `VALUE_MAX=1`); el motor vivo no clamp (`Node.js:73-81` comentado). |

### 1.4 Cómo simula NIRA hoy (y una discrepancia del harness de test)

`NIRA.runSimulationUntilStable` (`NIRA.js:205-243`) corre el motor real
(`model.update()`) con `clampValues` tras cada tick, por rebanadas de
`CHUNK_TICKS = 200` ticks con `setTimeout(step, 0)` entre tareas
(`NIRA.js:66,450`). **Discrepancia importante**: el harness headless
`test/nira_logic_test.js` **no** ejercita el `takeSignal` real: usa
`StubNode.takeSignal` con emisión instantánea (`value += delta;`
`sendSignal({delta: value*0.3})`) y `setTimeout` síncrono. Es decir, la
validación lógica de NIRA se hizo sobre una versión **sin latencia de
agregación ni retardos de viaje**. La dinámica temporal real (timers de 100 ms
entre micro-rebanadas en el navegador) no está cubierta por ese test. Cualquier
análisis nuevo debe usar el modelo canónico de §1.2/§8, **determinista en
ticks**, y validarse contra el motor real (§8.6).

### 1.5 Tabla de constantes del motor (fuente primaria para §8)

| Símbolo | Valor | Fuente |
|---|---|---|
| `g` (emisión) | `0.3` | `Node.js:194` |
| `w(s)` | `sign(s)·(0.3+0.7|s|)` | `Edge.js:112` |
| `L` (ventana) | `0.1 s` = 3 ticks @30 Hz | `Node.js:168,200` |
| `F` (tick) | 30 Hz | `Loopy.js:108` |
| `σ` (`signalSpeed`) | default `3`; slider `[0,6]` paso `0.2` | `Loopy.js:47`, `PlayControls.js:110` |
| `v_sig` | `2^σ` px/tick | `Edge.js:79` |
| `L_e` | `r·θ` (arco dibujado) | `Edge.js:317-345` |
| `τ_e` | `⌈L_e / v_sig⌉` ticks | derivada |
| caps | 100 global, 10/arista | `Edge.js:8-9` |
| age | `1e6` → "forever" | `Edge.js:52-66` |
| clamp NIRA | `[0,1]` solo en sim | `NIRA.js:53-54,99-100` |
| NIRA params | `MAX_TICKS 2000`, `THRESHOLD 1e-3`, `MIN_STABLE_TICKS 5`, `INTENSITY 1`, `CHUNK_TICKS 200` | `NIRA.js:37-40,66` |

---

## 2. §1 Representación del estado

### 2.1 Notación

- `N` nodos moleculares (visibles), índice `i ∈ [1..N]`.
- `s_{ij}` = `strength` de la arista **j → i** (j emite, i recibe); si no
  existe arista, `s_{ij} = 0` (sin arista ⇒ sin contribución).
- `w_{ij} = sign(s_{ij})·(0.3 + 0.7|s_{ij}|)`; `a_{ij} = g·w_{ij}` con `g=0.3`.
- `τ_{ij}` = retardo total (ticks) del salto j→i:
  `τ_{ij} = ⌈ arrowLength(j→i) / 2^σ ⌉ + L`.
- `v(t) ∈ ℝ^N` vector de valores en el tick `t` (tick = 1/30 s).
- `Ω_j(t) ∈ {0,1}`: indicador de ventana de emisión del nodo j: vale 1 en el
  tick `t` si j recibió al menos una señal en `(t−L, t]` y su timer se cierra
  en `t` (a lo sumo una vez cada 3 ticks por nodo).

### 2.2 Ecuación de estado (modelo canónico en ticks)

Para cada nodo `i`:

```
v_i(t+1) = v_i(t) + Σ_j a_{ij} · e_j(t − τ_{ij})        (ec. 1)
```

donde `e_j(u)` es la **emisión** del nodo j en el tick `u`:

```
e_j(u) = 0.3 · v_j(u) · Ω_j(u)                          (ec. 2)
```

Sustituyendo, la forma de sistema con **retardos distribuidos**:

```
v(t+1) = v(t) + Σ_{τ=0..τ_max} A_τ · v(t − τ)           (ec. 3)
```

con `A_τ[i,j] = 0.3 · w_{ij} · Ω_j(t − τ) · 𝕀[τ ≡ τ_{ij}]`.

En el régimen regular (componentes cíclicas donde las llegadas se repiten y
cada nodo emite una vez por ventana), `Ω_j` se puede relajar a `1` en cada
ventana: el operador es **lineal invariante en el tiempo con retardos** y la
matriz canónica pedida es

```
A[i,j] = a_{ij} = g · w(s_{ij})        (matriz de adyacencia ponderada)
τ_{ij} = ⌈arrowLength(j→i)/2^σ⌉ + 3                     (ec. 4)
```

Es decir: **el grafo de LOOPY se expresa como un par (A, τ)** — una matriz de
pesos `A ∈ ℝ^{N×N}` (grado de amplificación por salto, por arista real) y una
matriz de retardos `τ ∈ ℤ_+^{N×N}` (tiempo de tránsito + ventana de
agregación). El operador de propagación de un paso es `Φ = I + A·z^{−τ}`
(en el dominio Z), y la forma extendida del vector de estado es
`χ(t) = [v(t), v(t−1), …, v(t−τ_max)] ∈ ℝ^{N(τ_max+1)}` con la matriz
companion `Φ` (`B = eye(N·(τmax+1))` más bloques `A_τ`), lo que permite
calcular autovalores, respuesta al impulso y radio espectral por métodos
estándar.

### 2.3 Reducción por laps (matriz `G` de emisión por vuelta)

Como la emisión se muestrea una vez por ventana, conviene definir la dinámica
por **vuelta** (lap) de circulación:

```
v(lap+1) = v(lap) + G · v(lap) = (I + G)·v(lap)         (ec. 5)
G[i,j] = a_{ij} = 0.3·w_{ij}                            (ec. 6)
```

autovalor dominante `μ = 1 + ρ(G)` (modo real; para modos oscilantes
`μ = √(1+ρ²)`, §3.2). Para un ciclo simple dirigido de longitud k con
ganancias `a_1…a_k`: `ρ = |Π_j a_j|^{1/k}` (raíces k-ésimas de la unidad);
la tasa por tick es `ln(μ)/T_vuelta`, `T_vuelta ≈ Σ τ` alrededor del ciclo.

### 2.4 No linealidades reales que el modelo debe conservar

1. **Clamp**: en simulaciones tipo NIRA, `v = clamp(v, 0, 1)` tras cada tick
   (`NIRA.js:99-100`). En el motor vivo **no** hay clamp. El análisis debe
   declarar si opera en régimen lineal (clamp inactivo) o con saturación.
2. **Topes de señales** (`Edge.js:8-9`): en regímenes divergentes o de
   ramificación alta se descartan señales (truncación). Guarda: mantiene la
   divergencia acotada en vivo. El análisis debe detectarlos y avisar.
3. **Trigger de emisión**: una llegada de delta 0 (arista de peso 0) aún
   dispara la ventana de emisión del valor actual (ver §1.1). En el modelo
   lineal se ignora; en régimen cíclico el efecto es despreciable porque hay
   llegadas continuas; en DAGs puede activar ramas "apagadas" — se documenta
   como aproximación (ver §9).
4. **Modo EDIT**: `Node.update` fuerza `v = init` (`Node.js:227-229`); el
   análisis solo aplica en `MODE_PLAY`.

### 2.5 Nivel molar: proyección

Con la agrupación Molecular→Molar (Fase 1: `Node.js` tiene `hidden`,
`isMolar`, `children`, `savedEdges`, `borderWidth`), defínase la matriz de
asignación `P ∈ {0,1}^{M×N}` (`P[m,i] = 1` si el nodo molecular `i` pertenece
al molar `m`). El análisis molar trabaja con

```
A_molar = P · A · P^T  ∈ ℝ^{M×M}                        (ec. 7)
τ_molar[m,n] = mediana( { τ_{ij} : i∈m, j∈n } )         (ec. 8)
v_molar[m] = (1/|m|) · Σ_{i∈m} v_i      (valor agregado propuesto)
```

Convenciones propuestas (alineadas con la Biblia v2.0): los hijos ocultos no
se miden individualmente; las aristas externas de un hijo se "suben" a su
molar (peso `a_{ij}` sin cambios); las aristas internas al molar se descartan
para el análisis molar (no contribuyen a `A_molar`), aunque el motor las siga
corriendo. `P` se renormaliza por filas (media, no suma) para que `A_molar`
sea comparable entre molares de distinto tamaño.

---

## 3. §2 Estabilidad

### 3.1 Clasificación por radio espectral (marco general)

Para el sistema con retardos (ec. 3), la estabilidad se evalúa sobre el
operador completo: polos de `det( z·I − (I + Σ_τ A_τ z^{−τ}) ) = 0`, o sobre
la recurrencia por vuelta (ec. 5), cuyo factor de crecimiento es
`μ = ρ(I + G)`.

**Importante (hallazgo de código):** el integrador `v(t+1) = v(t) + …`
aportado por `takeSignal` hace que la recurrencia por vuelta sea
`v(lap+1) = (I + G)·v(lap)`, con factor de crecimiento `μ = ρ(I + G)`:
`1 + ρ(G)` para el modo real dominante y `√(1 + ρ(G)²)` para el modo
oscilante. Como `|a_{ij}| ≤ g·1 = 0.3`, para un ciclo simple de longitud k
con ganancia acumulada `Λ = Π|a_e|` se tiene `ρ(G) = Λ^{1/k} ≤ 0.3`, y el
modo dominante crece al menos como `μ ≥ √(1 + ρ(G)²) > 1`. Consecuencia
práctica:

- **ρ(G) = 0** (componente acíclica / DAG): `G` nilpotente, incrementos
  finitos — **acotada** (estado final finito, no retorno a `init`).
- **ρ(G) > 0** (cualquier ciclo, independientemente del signo):
  sin clamp el modo dominante **diverge** (exponencial por vuelta, lento si la
  ganancia es pequeña o el ciclo es de signo alternado; rápido si es de
  producto positivo). Con clamp `[0,1]` (simulaciones NIRA) la divergencia
  queda **acotada en saturación**: los nodos de la SCC convergen a un
  atractor de valores en `{0,1}` (todos a 1 en ciclos de producto positivo;
  patrón mixto con aristas negativas).
- **Marginal**: solo por construcción artificial (`Λ^{1/k} = 0` con fases
  constructivas exactas o topes de señales — en la práctica no se da en
  modelos clínicos; el clamp lo absorbe igualmente en saturado).

Observación: en este motor "estable" **no** significa "las señales decaen a 0 y
el sistema vuelve a init" (no hay decaimiento): significa *incrementos finitos*
(DAG) o *incrementos acotados por saturación* (SCC con clamp). Es la
diferencia más relevante frente al modelo mental del prompt del owner (§9).

### 3.2 El criterio real del motor (reducción a componentes cíclicas y ciclos)

Por la recurrencia por vuelta `v(lap+1) = (I + G)·v(lap)` (ec. 5):

- **Componente acíclica (DAG):** `G` nilpotente ⇒ `ρ(G) = 0` ⇒ incrementos
  finitos (cada nodo emite un número finito de ráfagas). **Acotada**.
- **Ciclo (o SCC) con alguna arista y producto NO nulo**: `ρ(G) > 0` con
  `ρ = |Π_j a_j|^{1/k}` para un ciclo simple de longitud k (`a_j = 0.3·w(s_j)`,
  `|a_j| ≤ 0.3`). El factor por vuelta es `μ = |1 + λ_dom|`:
  - **Producto positivo** (número par de aristas negativas): `λ_dom = ρ` real
    ⇒ `μ = 1 + ρ ∈ (1, 1.3]` — divergencia real **por vuelta** (`1.3`/vuelta a
    strengths máximas; `≈ 1 + ρ` a strengths clínicas típicas: `s=0.5` →
    `a=0.3·0.65=0.195`, ciclo 2 → `ρ=0.195`, `μ≈1.195`).
  - **Producto negativo** (número impar de aristas negativas): modo dominante
    complejo `λ_dom = ρ·e^{iθ}` con `θ≈π/2` ⇒ `μ = √(1+ρ²) ∈ (1, 1.044]` —
    **espiral oscilante divergente lenta** (alterna signo por vuelta).
  En el régimen **con clamp** (simulaciones NIRA) la divergencia se detiene en
  la saturación: producto positivo → todos los nodos de la SCC en el techo
  `VALUE_MAX` (atractor "todo encendido"); producto negativo → patrón mixto
  `{VALUE_MIN, VALUE_MAX}` según el signo neto por nodo.

Conclusión operativa: **en este motor, toda componente con ciclo diverge sin
clamp y satura con clamp**; la magnitud de `ρ` fija la velocidad de
saturación; el signo fija el patrón final. Este es el criterio que un script
debe implementar (§3.4), reemplazando al clásico "producto de strengths ≥ 1"
(§3.3).

### 3.3 Criterio del prompt vs realidad del código

El prompt sugiere "producto de strengths ≥ 1 → inestable". Ese criterio es
exacto para el motor ORIGINAL (passthrough del delta, ganancia de arista
`strength` a mitad de camino): la amplitud circulante se multiplica por
`Π s_e` por vuelta, luego converge si `|Π| < 1` y diverge si `|Π| ≥ 1`. Con el
motor actual (integrador puro + re-emisión `0.3·value` + `w(s)` saturada a 1),
**todo** ciclo con ganancia neta no nula diverge sin clamp (los positivos con
fase real `μ = 1 + |Π a|^{1/k}`; los de signo mixto en espiral
`μ = √(1 + (Π|a|)^{2/k})`), y **satura** con clamp. El criterio "producto ≥ 1"
NO rige en esta rama tal cual está descrito: es un hallazgo que debe
comunicarse al owner (ver §9).

### 3.4 Procedimiento de cálculo (implementable)

1. Construir `A` y `τ` (ec. 4) sobre los nodos VISIBLES (regla molar: los
   hijos ocultos se colapsan vía `P`, ec. 7).
2. Descomponer en componentes fuertemente conexas (Tarjan/Kosaraju) con signo.
3. En cada SCC: si es un DAG (`SCC` de 1 nodo sin self-loop), `ρ=0`.
4. En SCC cíclicas: `ρ(G_SCC)` por iteración de potencias sobre `|G|`; signo
   del producto de `w` sobre un ciclo base (o paridad de aristas negativas en
   un ciclo simple cualquiera de la SCC — todas tienen la misma paridad si hay
   un único ciclo; si hay varios, se enumera por ciclos simples, §5.2).
5. Clasificar la SCC: `DAG-acotada` / `positiva → satura al techo` /
   `signo-mixto → espiral a patrón saturado mixto` (§3.2).
6. Etiquetar nodos: `atractor` si su SCC es cíclica (bajo clamp satura);
   `acotada` en DAGs; el `ρ` de la SCC acompaña al ranking como contexto.

---

## 4. §3 Simulación de intervenciones nativas (el "NIRA de Loopy" en versión molar)

Protocolo común (idéntico al de NIRA Lite, reutilizable como primitivas):
`snapshot()` → modo PLAY → simular control → por intervención `restore()` →
intervenir → simular → medir → restaurar. Parámetros sugeridos: mismos que
NIRA (`MAX_TICKS=2000`, `THRESHOLD=1e-3`, `MIN_STABLE_TICKS=5`, clamp
`[0,1]` **solo si se quiere el régimen saturado**; para régimen lineal se
desactiva el clamp y se acota el horizonte a `T ≤ 600` ticks para evitar
overflow).

### 4.1 (a) Node Clamping — forzar nodo a constante

Clamp dinámico: durante la simulación, para el nodo diana `k`:

```
v_k(t) ≡ c        (c ∈ [0,1], típicamente c = v_k(0))
llegadas a k en t: se descartan (no suman a v_k)
emisión de k: e_k(u) = 0.3 · c · Ω_k(u)   (sigue su ventana normal)
```

Efecto: el nodo `k` se transforma en una **entrada constante forzada** de
amplitud `0.3·c` hacia sus vecinos. Medición de impacto de clamping:

```
ΔV_k^clamp(t) = Σ_{i ≠ k} [ v_i(t) − v_i^c(t) ]         (ec. 9)
```

(variación inducida en el resto — mismo espíritu que el derrame de NIRA).
Interpretación clínica: "si este síntoma se mantiene fijo en c, ¿cuánto se
mueve el resto del sistema?" (análogo de *control* en teoría de control:
`k` pasa de estado a entrada). También define el **punto de operación**:
`c = VALUE_MAX` corresponde al "apagado" del síntoma (bajarlo a 0) o su
"fijación" (mantenerlo en su nivel).

### 4.2 (b) Edge Severing / Weight Perturbation

Sea `s` el strength de la arista `j→i` y `δ` la perturbación (`δ ∈ [−1,1]`,
`severing` = `s+δ` tal que `w(s+δ)=0`, i.e. `s+δ=0`; en general
`w_δ = w(s+δ)`). El sistema perturbado usa `A' = A + ΔA` con
`ΔA[i,j] = g·(w(s+δ) − w(s))`, mismo `τ`.

Métrica de sensibilidad de estado estacionario (en régimen lineal, con la
serie de Neumann de ec. 5):

```
ΔSS_{j→i}(δ) = Σ_{t=1..T} [ v_i^{(A')}(t) − v_i^{(A)}(t) ]   por nodo destino
S_{j→i}(δ)   = Σ_i ΔSS_{j→i}(δ)            (impacto total del corte/peso)
```

Derivada de sensibilidad (para ranking con perturbaciones pequeñas):
`d(G^k)/dε` evaluada en `ε=0` — en la práctica se estima por diferencias
finitas con `δ` pequeño (p. ej. `±0.05`) **o** con severing exacto (`δ = −s`),
que es la intervención clínica más legible: "¿qué pasa si corto este arco?".
El severing convierte ciclos positivos en DAGs (o reduce su `ρ`): medir la
**caída de ρ(SCC)** como indicador estructural:

```
Δρ_{e} = ρ(G_SCC) − ρ(G_SCC con arista e eliminada)       (ec. 10)
```

### 4.3 (c) Impulso sistémico — integral de la respuesta al impulso

Intervención: `takeSignal({delta: 1})` en el nodo `X` al tick 0
(equivalente a `NIRA.INTENSITY=1`; el clamp inmediato lo lleva a `v_X=1` en
régimen saturado). Definimos la respuesta al impulso relativa a control:

```
I_i^{(X)}(t) = v_i^{(X)}(t) − v_i^c(t) ,   t = 1..N, i = 1..N   (ec. 11)
```

**Área bajo la curva** (integral de la respuesta de propagación):

```
AUC^{(X)} = Σ_{t=1}^{N} Σ_{i=1}^{N} I_i^{(X)}(t)              (ec. 12)
```

variantes: excluyendo la diana (`AUC_{-X}`, derrame integral), por nodo
(`AUC_i^{(X)} = Σ_t I_i^{(X)}(t)`), primer momento (centroide temporal)
`τ̄^{(X)} = Σ_t t·I / Σ_t I` (velocidad de penetración del sistema), y pico
`I_max^{(X)}`. En régimen lineal y con `N ≥ τ_max·diámetro`, la serie
converge geométricamente (ec. 14) y `AUC` es la norma `ℓ¹` de la respuesta de
la serie de Neumann de `(I + G·z^{−τ})`:

```
v^{(X)}(t) = v^c(t) + Σ_{k≥1} (G·z^{−τ})^k 1_X ·(incrementos)      (ec. 13)
AUC^{(X)} ≈ || (I − G·z^{−τ})^{−1} 1_X − 1_X ||₁, con ρ(G)<1        (ec. 14)
```

En el régimen saturado, `AUC` mide *tiempo hasta saturación y tamaño de la
componente alcanzada* (el ranking entre dianas de la misma componente se
aplana — véase §5.1 y §7, es la observación que motivó la métrica de derrame).

### 4.4 Notas de implementación

- Los tres tipos de intervención se aplican **sobre el modelo canónico** (§2.2)
  o sobre el motor real con `model.update()`; se exige que el canónico y el
  motor coincidan en una gráfica de referencia (§8.6).
- `snapshot/restore` y `clampValues` ya existen en `NIRA.js` — reutilizar como
  primitivas, no duplicar.
- Molar: la intervención sobre un molar `m` se define como impulsar
  (o clampear) **todos** sus hijos visibles simultáneamente con el mismo
  impulso (operador `P^T 1_m`), y la medición sobre `A_molar` (ec. 7).

---

## 5. §4 Centralidad dinámica molar (Ganancia Sistémica) y atractores

### 5.1 Centralidad de Ganancia Sistémica (GS)

Definición (nodo `X`, horizonte `N` ticks):

```
GS(X) = Σ_{t=1}^{N} Σ_{i ≠ X} [ v_i^{(X)}(t) − v_i^c(t) ]
      = AUC_{-X}^{(X)}                                       (ec. 15)
```

Propiedades:
- Es la **integral temporal del derrame** (spillover) — generaliza la métrica
  instantánea de NIRA a toda la trayectoria; en régimen lineal equivale a la
  columna `||·||₁` de la matriz de ganancia `H = (I − G·z^{−τ})^{−1} − I`
  (ec. 14) restringida a `i ≠ X`.
- En régimen saturado, `GS(X)` crece con el tamaño de la componente alcanzable
  y con la rapidez de saturación: identifica **a qué componente pertenece el
  nodo** y **con qué fuerza la enciende**; dentro de una SCC saturada los
  `GS` se aplanan (sensibilidad del ordenación baja) — debe reportarse el
  `ρ(SCC)` como contexto (por eso NIRA eligió derrame; GS es la versión
  integral, útil para comparar componentes entre sí).
- Variante molar: `GS_m(X) = Σ_{t} Σ_{m ≠ mol(X)} [ v_m^{(X)}(t) − v_m^c(t) ]`
  medida sobre `A_molar` (ec. 7) — "ganancia sistémica a nivel molar".

**Uso clínico propuesto**: `GS` ordena las dianas por "energía disipada en el
sistema" tras una intervención de impulso; combinada con `ρ` y el tipo de SCC
(§3.4) distingue: nodo en atractor (satura, GS alto pero aplanado), nodo
puente acíclico (GS moderado, efecto finito), nodo en ciclo de signo mixto
(GS oscilante hacia un patrón saturado mixto).

### 5.2 Identificación de atractores y bucles dominantes

1. **Atractor** = SCC cíclica en régimen con clamp (§3.2): por la ausencia de
   decaimiento, todo SCC con ciclos diverge sin clamp y queda acotado en
   saturación con clamp — el "núcleo patológico" del modelo. Producto positivo
   → todos los nodos al techo `VALUE_MAX`; signo mixto → patrón saturado
   `{VALUE_MIN, VALUE_MAX}` según el signo neto por nodo.
2. **Bucles dominantes**: enumerar los ciclos simples de cada SCC (algoritmo
   de Johnson, práctico para `N ≤ 50`-100) y ordenar por ganancia de potencia:

```
Λ(C) = Π_{e ∈ C} |a_e| = Π (0.3 · |w(s_e)|)               (ec. 16)
```

   El o los ciclos con `Λ` máximo dominan la tasa de crecimiento
   (`ρ ≈ Λ^{1/|C|}`); etiqueta clínica: "bucle motor" de la componente.
3. Para SCC grandes, alternativa escalable: `ρ` de la SCC por iteración de
   potencias y, si se quiere el ciclo dominante, caminata aleatoria
   (Wielandt / retroceso de la iteración de potencias) — la precisión de
   enumeración exhaustiva es opcional.

### 5.3 Por qué Betweenness/Closeness (y el degree simple) fallan aquí

- **Ignoran el signo**: una arista de `strength=−1` inhibe; Betweenness
  trata todo como topología simétrica. En LOOPY la propagación es
  **dirigida, paralela y amplificada por todos los caminos a la vez**
  (no hay "camino más corto": el nodo emite a TODAS sus aristas salientes,
  `Node.js:157-166`).
- **Ignoran la realimentación**: la "importancia" de un nodo en un sistema
  dinámico no es cuántos caminos lo cruzan, sino cuánta energía puede
  **mantener y devolver** (autovalores/ρ); un nodo en un ciclo positivo es
  radicalmente más influyente que un hub acíclico del mismo degree.
- **Ignoran los retardos**: `τ_{ij}` depende de la geometría (longitud de
  arco/signalSpeed); dos caminos topológicamente iguales pueden tener
  dinámicas distintas (fase, resonancia). Closeness asume costes estáticos.
- **Ignoran la saturación y los atractores**: en el régimen con clamp, el
  estado final depende de la SCC (atractor), no de la topología de caminos.
- **No producen respuesta de intervención**: miden estructura, no qué pasa si
  se interviene un nodo (que es la pregunta clínica). El degree estructural ya
  existe en LOOPY ("centrality"); GS responde la pregunta dinámica.

---

## 6. §5 Propuesta de UI "Molar Analysis" (proposición, no implementación)

Objetivo: un botón que ejecute análisis sistémico **en segundo plano** y
visualice el resultado sobre el canvas, sin mutar el modelo del usuario.

- **Botón** "Molar Analysis" (junto al "analizar intervenciones (NIRA)") en la
  barra de reproducción o el sidebar. Estado: `enabled` solo en `MODE_PLAY` y
  con ≥ 2 nodos visibles; bloqueado durante NIRA (antirreentrada compartida).
- **Flujo**: snapshot → (1) construir `A, τ` sobre nodos visibles / con
  proyección molar → (2) clasificar SCCs y calcular `ρ` → (3) impulsos
  virtuales `X=1..M` (nodos visibles o molares) con el modelo canónico (§2.2),
  `N=600` ticks, reportando progreso en rebanadas asíncronas (patrón NIRA:
  `CHUNK_TICKS`, `setTimeout(step,0)`) → (4) restaurar snapshot → (5) pintar.
- **Heatmap** sobre los nodos: color/opacidad = `GS` normalizado a `[0,1]`
  (misma escala de auras que NIRA; los molares reciben el `GS_m` agregado y su
  borde 12px los distingue). Opcional: anillo grueso en nodos de SCC
  divergente ("atractor") y marcas de arista sobre los bucles dominantes.
- **Panel lateral (resultados)**: tabla de SCCs (tipo, `ρ`, miembros), top-3
  bucles dominantes (`Λ`, membresía), y ranking `GS` con su `ρ` de contexto —
  en español, sin jerga innecesaria ("Componente auto-reforzante",
  "Ciclo de signo mixto (oscila)", "El sistema se satura").
- **Zoom/limpieza**: el análisis no modifica valores ni señales (todo virtual
  sobre el snapshot); el heatmap se limpia al salir de PLAY o al editar el
  modelo (`model/changed`). Guardia de costo: si `M·N` supera presupuesto
  (p. ej. 50k ticks), se reduce `N` con aviso.
- **Molar**: en vista molar, los impulsores se eligen entre molares; el
  heatmap muestra `A_molar` y los hijos se colorean por el valor de su molar
  (trazabilidad Molecular→Molar conservada).

Esta sección es **proposición**: la implementación queda fuera de esta etapa.

---

## 7. Relación con NIRA.js

`NIRA.js` ya implementa: análisis de intervención con métrica de **derrame**
(excluye la diana: `impact = totalScore(post, exclude) − totalScore(control,
exclude)`, `NIRA.js:352-365`), snapshot/restore, clamp `[0,1]`, rebanadas
asíncronas, auras top-5 y ranking. El Tercer Camino **no duplica**:

| Capacidad | NIRA (existe) | Tercer Camino (propuesta) |
|---|---|---|
| Ranking de dianas por derrame | ✔ (instantáneo, top-5) | GS = derrame **integral** (toda la trayectoria) |
| Estructura: SCC, ρ, atractores | ✘ | ✔ §3.4 |
| Bucles dominantes | ✘ | ✔ §5.2 (Λ, ec. 16) |
| Clamping / severing / impulso | solo impulso (+1, `_prepareIntervention`) | los tres, con fórmulas §4 |
| Nivel molar | solo nodos visibles | proyección `P` (ec. 7) |
| No linealidades (cap de señales) | no detectadas | detectadas e informadas (§2.4) |

Relación operativa: **NIRA responde "¿sobre qué nodo intervengo? (mejor
derrame inmediato)"; el Tercer Camino contextualiza "¿está ese nodo en un
atractor? ¿el sistema satura? ¿qué bucles alimentan la patología?"** (p. ej.
un ranking NIRA plano dentro de una SCC saturada se explica por `ρ>0` — §5.1).
Ambos comparten primitivas (`snapshot`, `restore`, `clampValues`,
`runSimulationUntilStable`) y la regla "solo nodos visibles". El script futuro
puede coexistir como `MolarAnalysis.js` consumiendo esas primitivas, sin tocar
el comportamiento actual de NIRA.

---

## 8. Especificación implementable (para un script, sin re-consultar el motor)

### 8.1 Entrada

- `nodes[]`: `{id, label, x, y, radius, init, hidden, isMolar, children}`.
- `edges[]`: `{from, to, strength, arc}`.
- `loopy.signalSpeed` (σ), ticks a 30 Hz.

### 8.2 Construcción (paso 1)

```
para cada arista e = (j→i):
    if hidden(j) o hidden(i):    // hijos ocultos se colapsan por molar (§2.5)
        mapear vía P;  si ambos en el mismo molar → arista interna: no aporta a A_molar
    w  = sign(strength) * (0.3 + 0.7*abs(strength))
    a  = 0.3 * w
    τe = ceil( arrowLength(j→i) / 2^σ )          // arrowLength = r*θ (geometría; aproximación rectilínea permitida en 1ª versión)
    τ  = τe + 3                                  // ventana de agregación (0.1 s @ 30 Hz)
    A[i][j] = a ;  TAU[i][j] = τ
```

Para la primera versión es aceptable aproximar `arrowLength ≈ distancia
euclídea entre centros (x,y) · (1 + |arc|/200 ajuste)`, declarando la
aproximación; el cotejo §8.6 decide si hace falta la longitud de arco exacta.

### 8.3 Estabilidad (paso 2)

```
SCCs = Tarjan(grafo dirigido de aristas con a != 0)   // sin self-loops en el grafo SCC
para cada SCC:
    si |SCC| == 1 y sin self-loop  → ρ = 0, tipo = DAG
    si no:
        G = A[SCC][SCC]  (submatriz);  ρ = power_iteration(abs(G))  // asimétrica: iterar sobre |G| da ρ(|G|)
        producto = Π sign(w_e) sobre un ciclo simple de la SCC (DFS)  // paridad
        tipo = (producto > 0) ? "positivo (satura al techo)" : "negativo (espiral a patrón mixto)"
        // todo SCC cíclico diverge sin clamp y satura con clamp [0,1]; ρ fija la velocidad
```

### 8.4 Simulaciones (paso 3) — motor canónico (determinista en ticks)

```
estado: value[N], pendingEmission[N] (tick programado), arrivals por tick
loop t = 1..N:
    // (si clampNIRA) value = clamp(value, 0, 1)
    // llegadas: para cada arista entregada en t: value[to] += a * emisionCursada
    // emisiones: en cada tick u con pendingEmission[j] == u: for each arista j→i: agenda entrega en u + τe
    // ventana: nodo j que recibe ≥1 señal en (u−3, u] y sin emisión pendiente agenda pendingEmission[j] = u + 3 con delta = 0.3 * value[j]
registrar I_i^{(X)}(t) = value(t) − control(t)
```

Protocolo por intervención: snapshot/restore; control una vez; por diana
`X`: `value[X] += 1` (clamp inmediato si régimen saturado) y correr N ticks.
Métricas: `AUC`, `AUC_-X`, `GS`, `τ̄`, pico (ec. 11-15).

### 8.5 Intervenciones (paso 4)

- Clamping: `value[k] ≡ c`; descartar llegadas a k; emisión de k con
  `0.3·c` en su ventana (ec. 9).
- Severing/perturbación: `w' = w(s+δ)`; re-construir `A'`; simular; reportar
  `ΔSS`, `S`, `Δρ` (ec. 10).
- Bucles dominantes: Johnson para SCCs pequeñas; `Λ(C)` (ec. 16); top-3.

### 8.6 Validación (criterio de aceptación)

En una gráfica de referencia (3 nodos en cadena + 1 triángulo positivo +
1 par negativo; strengths `{0.1, 0.5, −0.4, 1}`), el motor canónico debe
reproducir la trayectoria `v(t)` del motor real (mismo init, mismo σ, mismos
impulsos) con `max|Δv| < 0.05` sobre 300 ticks en régimen lineal, y
comportamiento cualitativo idéntico en régimen saturado (mismos nodos
saturados, mismo orden de `AUC`). Este cotejo es obligatorio antes de usar el
canónico como sustituto del motor.

### 8.7 Presupuesto sugerido

`N = 600` ticks por simulación (≈ 20 s virtuales), `O(M·N·d)` con `d` grado
medio; para gráficas típicas clínicas (`N ≤ 50`, `M ≤ 500`) el total es
`< 2·10⁶` operaciones — ejecutable en rebanadas asíncronas de
`CHUNK_TICKS = 200` como NIRA.

---

## 9. Supuestos, riesgos e inconsistencias con el prompt del owner

**Supuestos de modelado (decisiones clave):**
1. Régimen lineal canónico (§2.2) con `Ω_j ≡ 1` por ventana; válido en SCC
   cíclicas con llegadas recurrentes; en DAGs el trigger de emisión puede
   activar ramas con delta 0 (efecto de segundo orden, ignorado).
2. La ventana de agregación se discretiza a `L = 3` ticks fijos (el motor usa
   `setTimeout` de 100 ms reales; en simulaciones sincrónicas esos timers no
   disparan — el modelo canónico es la definición determinista y debe usarse
   para análisis, no los timers del navegador).
3. Estabilidad = "incrementos finitos / estado final acotado", no "retorno a
   init": el motor no tiene decaimiento.
4. `arrowLength` ≈ distancia euclídea en primera versión (pendiente cotejo).
5. En régimen saturado, el ranking intra-SCC se aplana (documentado, §5.1);
   el análisis debe reportar `ρ` de contexto con el ranking.

**Inconsistencias detectadas entre el motor real y el prompt del owner:**
1. **`arc` ≠ velocidad**: el prompt lo trataba como parámetro de retardo;
   en el código solo es curvatura visual. El retardo real = `⌈arrowLength/2^σ⌉`.
2. **Clamp solo en NIRA**: `bound()` es no-op en el motor vivo; `[0,1]` solo
   dentro de simulaciones de análisis (`NIRA.clampValues`).
3. **No hay decaimiento**: "estable = señales decaen a 0" no es alcanzable; el
   mejor análogo es "incrementos cesan/decae la amplitud de los incrementos".
4. **Criterio de ciclo**: "producto de strengths ≥ 1 → inestable" corresponde
   al motor original (passthrough con decaimiento implícito del valor de
   arranque); con el custom, **todo** ciclo con ganancia neta no nula diverge
   sin clamp (positivos: real, `μ = 1+ρ`; signo mixto: espiral
   `μ = √(1+ρ²)`) y **satura** con clamp `[0,1]`. El umbral "≥ 1" no rige;
   el criterio operativo es "SCC con ciclo ⇒ carne de saturación, DAG ⇒
   acotada" (§3.2, §8.3).
5. **Harness de test**: `test/nira_logic_test.js` ejercita un motor
   simplificado (sin latencia de agregación, `arrowLength=200` fija,
   `setTimeout` síncrono) — la dinámica temporal real no está cubierta por
   tests headless actuales.
6. El multiplicar por `strength` a mitad de camino (motor original) está
   **comentado** (`Edge.js:90-104`): la ganancia se aplica en la llegada.

**Riesgos:**
- Redes grandes (M > 500) con enumeración exhaustiva de ciclos (Johnson) — se
  degrada a iteración de potencias (§5.2).
- Divergencia sin clamp: overflow numérico — el análisis SIEMPRE usa clamp o
  horizonte corto.
- Cambios futuros en `g=0.3` o `w(s)` rompen las constantes §1.5 — mantener la
  tabla como contrato y un test de regresión de constantes.

**Fuera de alcance (ratificado por el owner):** estadística inferencial,
permutation tests, bootstrap, CSV/PNG, Grilla 3×3 — el Tercer Camino no los
introduce.