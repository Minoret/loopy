/**********************************

NIRA! OPCIÓN B
- Network InteRvention Analysis (Lite)

Algoritmo de identificación de mejores dianas de intervención,
100% client-side. Recorre la red, mide el impacto de intervenir
cada nodo contra una línea base de control y devuelve un ranking.

Parámetros fijos (Fase 1, auditados):
  - Intensidad:     +1 (solo a la alta)
  - Umbral:         0.001 (Σ|Δvalue| entre ticks)
  - Ticks estables: 5
  - Tope de ticks:  2000
  - Clamp de valores: [VALUE_MIN, VALUE_MAX] = [0, 1]
    (rango nominal de LOOPY, alineado con la intención original de
    Node.bound(): los nodos son niveles psicopatológicos normalizados,
    el máximo total del sistema es N = Σ values con todos los nodos en
    1; evita la explosión exponencial por realimentación positiva y
    mantiene el puntaje total clínicamente significativo).
  - Cota de rango del IMPACTO: proporcional a la red, no fija.
    Cada nodo acotado a [VALUE_MIN, VALUE_MAX] contribuye a lo sumo
    (VALUE_MAX - VALUE_MIN) = 1 al |impacto total| (post - control),
    luego para N nodos el tope físico es  N * (VALUE_MAX - VALUE_MIN)
    = N. Con el factor de seguridad IMPACT_SAFETY_FACTOR = 1.05, la
    cota práctica es  N * (VALUE_MAX - VALUE_MIN) * 1.05  (ver
    NIRA.impactRangeBound). Un número fijo (p. ej. 10) NO sirve: en
    redes largas saturadas el impacto escala con N.

Junto a Loopy/Model/Node/Edge expone una API global `NIRA`.

**********************************/

var NIRA = {

    // Parámetros fijos Fase 1 (sin UI)
    MAX_TICKS:         2000, // tope de ticks por simulación
    THRESHOLD:         0.003, // umbral de estabilidad
    MIN_STABLE_TICKS:  3,     // ticks consecutivos bajo el umbral
    INTENSITY:         1,     // intervención: +1 a la alta
    WEAKEN_FACTOR: 0.3,
    REPERTOIRE_COMPETITION_FACTOR: 0.5, // 0..1. Fracción del presupuesto que la
    // diana libera (Ec. 1-2, Baum) que se induce hacia la conducta alternativa
    // ya presente en la red. No inventa relaciones causales nuevas — lo que
    // esa conducta le hace al resto de la red corre por las aristas que el
    // clínico ya dibujó.
    ADAPTIVE_NODE_LABEL: null, // label exacto del nodo de conducta valorada/
    // adaptativa en ESTA red. Si es null o no se encuentra, el mecanismo de
    // competencia de repertorio simplemente no aplica — no hay error, no hay
    // fallback inventado.


    // Límites de clamp de los valores de nodo DURANTE el batch NIRA.
    // Rango nominal de LOOPY [0, 1] (intención original de Node.bound(),
    // sin el buffer 1.2 que usaba el fix anterior): los nodos son niveles
    // psicopatológicos normalizados, el máximo total del sistema es N
    // (Σ values con todos los nodos en 1) y, por tanto, el |impacto|
    // máximo posible (post - control) es N. Un rango más amplio (p. ej.
    // [-1.2, 2.2]) inflaba los impactos hasta ~7×3.4 ≈ 24 en redes de 7
    // nodos, inconsistente con el máximo esperado de 7. Sin clamp, los
    // bucles de realimentación positiva hacen explotar los valores
    // exponencialmente y el puntaje total (Σ values) se dispara
    // (impactos de cientos de miles). Ajustables por constante.
    VALUE_MIN:         0,
    VALUE_MAX:         1,
    // Margen de seguridad sobre el tope teórico para las aserciones de
    // rango del impacto (ver NIRA.impactRangeBound). 1.05 = 5%.
    IMPACT_SAFETY_FACTOR: 1.05,

    // Estado de ejecución / antirreentrada
    running: false,

    // Array reusado para el estado previo (minimiza allocations/GC)
    _prevValues: null,

    // Tamaño de cada rebanada asíncrona (ticks por setTimeout(0))
    CHUNK_TICKS: 500,

    // Parámetros del Motor Definitivo (AUC)
    HORIZON_MIN: 800,           // Ticks mínimos de simulación
    HORIZON_MAX: 2000,          // Ticks máximos de simulación
    HORIZON_FACTOR: 4,          // Multiplicador del diámetro × velocidad

    // ========================================================
    // NUEVO: velocidad interna de simulación de NIRA.
    // Esto desacopla el análisis del slider visual de Loopy.
    // El playbar puede moverse libremente; NIRA siempre usa este valor.
    // ========================================================
    SIM_SIGNAL_SPEED: 3,

    // ========================================================
    // NUEVO: perturbación gaussiana truncada para Monte Carlo.
    // Sigma = 0.02 implica que la mayoría de las perturbaciones
    // caen cerca de ±0.02, y se trunca en ±0.05 para no explotar el rango.
    // ========================================================
    PERTURBATION_SIGMA: 0.02,
    PERTURBATION_MAX: 0.05,

    // §6.9 — Perturbación ESTRUCTURAL: ruido gaussiano RELATIVO sobre
    // edge.strength (una vez por pasada, igual para baseline e
    // intervenciones, así que la comparación sigue pareada). Modela que
    // los pesos dibujados por el clínico son hipótesis, no mediciones.
    // 0 = desactivado (reproduce exactamente el comportamiento previo).
    // Evidencia: en UNA red (7 nodos, 1 molar de 3 hijos) el ranking fue
    // invariante a σ=0.05 (Spearman 1.0000) y solo creció la dispersión
    // de los nodos de alto impacto (~30%). 5% es una perturbación MUY
    // chica frente a la incertidumbre real de un peso dibujado a mano:
    // no extrapolar a "robusto" en general (ver NIRA_T.t6, barrido de σ).
    // Sesgo conocido: aristas con |s|=1 solo pueden bajar (clamp a ±1),
    // ≈ -2% en la media de esas aristas. Las aristas del interruptor
    // maestro (molar→hijo) NO se perturban: no son hipótesis clínicas.
    PERTURBATION_EDGE_REL_SIGMA: 0.05,

    // §6.7 — Umbral PROVISIONAL de densidad dirigida (pares ordenados
    // distintos entre nodos visibles / n(n-1), sin autolazos) a partir
    // del cual el ranking tiende a aplastarse. Calibrado en un barrido
    // sintético; falta confirmarlo en 1-2 redes reales más.
    DENSITY_WARN_THRESHOLD: 0.38,

    // §6.6 — Banda de "empate": si P(A>B) entre dianas adyacentes cae en
    // [TIE_LOW, TIE_HIGH], se reporta como dianas equivalentes.
    TIE_LOW: 0.35,
    TIE_HIGH: 0.65,

    // ========================================================
    // FIX (auditoría): "patada inicial" (initial kick).
    // Confirmado en Node.js: self.update() (llamado cada tick desde
    // Model.update) es puramente visual — ninguna función emite señal
    // de forma autónoma a partir de node.value. La ÚNICA vía por la que
    // un nodo llega a emitir (sendSignal) es (a) interacción de mouse en
    // vivo, o (b) el timeout de agregación dentro de takeSignal, que solo
    // se arma si el nodo YA recibió una señal antes. Un snapshot recién
    // restaurado no trae señales en vuelo (edge.signals vacío) ni
    // aggregate armado en ningún nodo, así que sin una señal inicial
    // explícita, ningún nodo llama nunca a takeSignal, el flush de cada
    // 10 ticks no encuentra nada que reenviar, y la red completa
    // permanece estática los 800 ticks: aucByNode[n.id] = value*800 en
    // TODOS los nodos, tanto en baseline como en intervención → impact
    // idénticamente 0. Umbral por debajo del cual un nodo no aporta
    // patada inicial (su propio aporte sería ruido de todos modos: un
    // valor así de bajo emitiría value*0.3 ≈ 0.003 o menos). No impide
    // que ese nodo reciba señal de otros y se active más tarde.
    KICK_THRESHOLD: 0.01,

    // 6.8: cada cuántos ticks se fuerza la reemisión (flush) de los nodos con
    // agregación pendiente. Valor histórico = 10; no cambia el comportamiento.
    FLUSH_INTERVAL: 10,

    // §6.5 Molares. false = comportamiento histórico: los hijos ocultos reciben
    // señal del interruptor maestro y acumulan valor, pero NO re-emiten en el
    // flush; sus aristas internas (entre hijos) quedan inertes en NIRA.
    // true = los hijos ocultos participan del kick y del flush, así que esas
    // aristas internas se simulan. OJO: los hijos no tienen aristas hacia el
    // exterior (groupNodes las elimina), así que esta opción solo cambia lo
    // que se acredita al molar (Σ hijos), no la dinámica del resto de la red.
    FLUSH_HIDDEN: false,

    // Diagnóstico: con true, _diag incluye childAucByNode (AUC de cada hijo).
    DEBUG_MOLAR: false,

    // Topes de señales de Edge SOLO durante NIRA._runSinglePass (se restauran
    // en finally). El juego interactivo conserva 100 / 10.
    // null = automático y exacto: en el loop síncrono cada nodo emite como
    // mucho (1 + ceil(HORIZON_MIN / FLUSH_INTERVAL)) veces por arista, así que
    // ese es el máximo de señales simultáneas por arista; el global es
    // nAristas × eso. Con estos topes el descarte es imposible por construcción.
    // Un número fuerza el valor (p. ej. para reproducir el truncamiento viejo).
    SIM_LIFT_SIGNAL_CAPS: true,
    SIM_MAX_SIGNALS: null,
    SIM_MAX_SIGNALS_PER_EDGE: null,

    // Diagnóstico opcional (6.5/6.7). null = desactivado (producción).
    // Para usarlo: NIRA._diag = []; correr _runSinglePass; leer NIRA._diag.
    _diag: null

};

    NIRA.DEFAULT_ITERATIONS = 100;

// =============================================
// NUEVO: generador de ruido gaussiano (Box-Muller)
// Devuelve una variable ~ N(mean, sd^2)
// ==========================================
NIRA._gaussianNoise = function(mean, sd) {
    var u = 0, v = 0;

    // Evitar log(0)
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();

    var standardNormal = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + sd * standardNormal;
};

// ==========================================
// MOLAR: Obtener solo los nodos visibles (Red Visible)
// ==========================================
NIRA.getVisibleNodes = function(model) {
    var visible = [];
    for (var i = 0; i < model.nodes.length; i++) {
        if (!model.nodes[i].hidden) visible.push(model.nodes[i]);
    }
    return visible;
};

// ==========================================
// NIRA: Cálculo de Diámetro de Red (Horizonte Dinámico)
// ==========================================
// BFS para encontrar el camino más largo entre cualquier par de nodos.
NIRA.calculateDiameter = function(model) {
    var nodes = NIRA.getVisibleNodes(model);
    if (nodes.length === 0) return 1;
    
    var nodeMap = {};
    nodes.forEach(function(n, i) { nodeMap[n.id] = i; });
    var N = nodes.length;
    
    var adj = Array(N).fill(null).map(function() { return []; });
    model.edges.forEach(function(e) {
        if (nodeMap[e.from.id] !== undefined && nodeMap[e.to.id] !== undefined) {
            adj[nodeMap[e.from.id]].push(nodeMap[e.to.id]);
        }
    });
    
    var maxDist = 0;
    for (var start = 0; start < N; start++) {
        var dist = Array(N).fill(-1);
        dist[start] = 0;
        var queue = [start];
        while (queue.length > 0) {
            var curr = queue.shift();
            for (var j = 0; j < adj[curr].length; j++) {
                var next = adj[curr][j];
                if (dist[next] === -1) {
                    dist[next] = dist[curr] + 1;
                    if (dist[next] > maxDist) maxDist = dist[next];
                    queue.push(next);
                }
            }
        }
    }
    return maxDist || 1;
};

//////////////////////////////////////
// TOTAL SCORE ///////////////////////
//////////////////////////////////////

// Puntaje total del sistema = suma de values de todos los nodos.
// Si se pasa excludeIdx (índice de nodo a EXCLUIR), ese nodo queda fuera
// del total: métrica de "derrame" (spillover). El nodo diana de una
// intervención aporta +1 (o el INTENSITY) y su propio desequilibrio
// (1 - init); excluirlo deja solo la propagación al RESTO del sistema
// (efecto cascada), que es lo clínicamente relevante al elegir una diana.

NIRA.totalScore = function(model, excludeNode) {
    var nodes = NIRA.getVisibleNodes(model);
    var excludeIds = [];
    if (excludeNode) {
        excludeIds.push(excludeNode.id);
        if (excludeNode.isMolar && excludeNode.children) {
            for (var c = 0; c < excludeNode.children.length; c++) {
                excludeIds.push(excludeNode.children[c]);
            }
        }
    }
    var sum = 0;
    for (var i = 0; i < nodes.length; i++) {
        if (excludeIds.indexOf(nodes[i].id) !== -1) continue;
        sum += nodes[i].value;
    }
    return sum;
};

// Acota los valores de todos los nodos a [VALUE_MIN, VALUE_MAX].
// Se aplica SOLO dentro de las simulaciones del batch NIRA (control e
// intervenciones), NO en el comportamiento global en vivo de LOOPY
// (Node.bound() sigue comentado; re-habilitarlo se debate aparte).
// Clamp sobre el valor del nodo (no sobre signal.delta), así que no
// rompe la propagación: solo limita el estado que da el puntaje total.
// FIX (auditoría): antes filtraba !hidden, dejando a los hijos ocultos de
// molares sin ningún acotamiento durante toda la simulación (Node.bound()
// es un no-op en vivo). En redes con retroalimentación positiva esos
// valores podían crecer sin límite y contaminar el tickScore del padre
// visible (que suma padre.value + children.value). Ahora clampea TODOS
// los nodos, visibles y ocultos.
NIRA.clampValues = function(model){
    var nodes = model.nodes;
    for(var i=0;i<nodes.length;i++){
        var v = nodes[i].value;
        if(v < NIRA.VALUE_MIN)      nodes[i].value = NIRA.VALUE_MIN;
        else if(v > NIRA.VALUE_MAX) nodes[i].value = NIRA.VALUE_MAX;
    }
};

// Cota práctica del |impacto| máximo para una red de n nodos, dada la
// aserción de rango del impacto en tests/reportes. Es PROPORCIONAL a la
// red, no un número fijo: cada nodo acotado a [VALUE_MIN, VALUE_MAX]
// aporta a lo sumo (VALUE_MAX - VALUE_MIN) al |impacto total|, luego el
// tope físico es n * (VALUE_MAX - VALUE_MIN). Con valores en [0,1] ese
// tope es n (el máximo total del sistema es Σ values = N con todos los
// nodos en 1); se multiplica por IMPACT_SAFETY_FACTOR (1.05) de margen.
// Ej: red del owner (7 nodos) => 7 * 1 * 1.05 = 7.35 como cota dura;
// los impactos reales (post - control) quedan por debajo salvo red
// totalmente saturada. Para 8 nodos saturados (TEST 3): 8 * 1 * 1.05
// ≈ 8.4 (el |impacto| real es ≤ N).
NIRA.impactRangeBound = function(n){
    return n * (NIRA.VALUE_MAX - NIRA.VALUE_MIN) * NIRA.IMPACT_SAFETY_FACTOR;
};

//////////////////////////////////////
// SNAPSHOT / RESTORE ////////////////
//////////////////////////////////////

// Snapshot propio: NO usa Model.serialize/deserialize
// (no preservan value ni signals, y deserialize mata/recrea objetos).
// Guarda valores por nodo + copia profunda de señales por borde.
NIRA.snapshot = function(loopy){
    var model = loopy.model;
    var snap = {
        mode: loopy.mode,
        signalSpeed: loopy.signalSpeed,
        nodeValues: [],
        nodeCount: model.nodes.length,
        edgeCount: model.edges.length,
        edgeSignals: []
    };
    for(var i=0;i<model.nodes.length;i++){
        snap.nodeValues.push(model.nodes[i].value);
    }
    for(var i=0;i<model.edges.length;i++){
        var edge = model.edges[i];
        var signals = [];
        for(var j=0;j<edge.signals.length;j++){
            var s = edge.signals[j];
            signals.push({
                delta: s.delta,
                position: s.position,
                scaleX: s.scaleX,
                scaleY: s.scaleY,
                age: s.age
            });
        }
        snap.edgeSignals.push(signals);
    }
    return snap;
};

// Restaura values + edge.signals + reconstruye Edge.allSignals + mode.
// No publica "model/changed" (evita autosave). Publica "view/changed"
// para forzar un redibujado sin marcar el modelo como sucio.
NIRA.restore = function(loopy, snap){
    var model = loopy.model;
    var n = Math.min(model.nodes.length, snap.nodeValues.length);
    for(var i=0;i<n;i++){
        model.nodes[i].value = snap.nodeValues[i];
    }
    Edge.allSignals = [];
    var e = Math.min(model.edges.length, snap.edgeSignals.length);
    for(var i=0;i<e;i++){
        var edge = model.edges[i];
        var signals = snap.edgeSignals[i].slice(); // copia superficial del array
        edge.signals = signals;
        for(var j=0;j<signals.length;j++){
            Edge.allSignals.push(signals[j]);
        }
    }
    loopy.mode = snap.mode;
    loopy.signalSpeed = snap.signalSpeed;
    publish("view/changed");
};

//////////////////////////////////////
// SIMULACIÓN HASTA ESTABILIDAD //////
//////////////////////////////////////

// Corre model.update() hasta que la Σ|Δvalue| entre ticks quede
// < threshold durante minStableTicks seguidos Y no queden señales en
// vuelo (Edge.allSignals vacío), o hasta alcanzar maxTicks.
// Devuelve nº de ticks usados.
//
// Tras CADA tick de model.update() se acota el valor de los nodos a
// [VALUE_MIN, VALUE_MAX] (NIRA.clampValues). Sin eso, los bucles de
// realimentación positiva hacen explotar los valores exponencialmente
// (Node.bound() está comentado en js/Node.js) y el puntaje total se
// dispara a impactos de cientos de miles. El clamp es sobre el valor
// (no sobre signal.delta), así que no rompe la propagación.
//
// El requisito de señales en vuelo vacías evita la falsa convergencia:
// una señal en tránsito aún no ha cambiado valores, por lo que los
// primeros ticks tras intervenir pueden parecer "estables" antes de
// que la señal aterrice y propague. Solo cuando no queda ninguna señal
// pendiente el estado es un punto realmente estable.
//
// Nota: requiere loopy.mode == MODE_PLAY (en EDIT, Node.update fuerza
// value=init en cada tick).
NIRA.runSimulationUntilStable = function(loopy, maxTicks, threshold, minStableTicks){
    threshold = (threshold===undefined) ? NIRA.THRESHOLD : threshold;
    minStableTicks = (minStableTicks===undefined) ? NIRA.MIN_STABLE_TICKS : minStableTicks;

    var model = loopy.model;
    var nodes = model.nodes;
    var n = nodes.length;

    var prev = NIRA._prevValues;
    if(!prev || prev.length < n) prev = NIRA._prevValues = new Array(n);

    var stable = 0;
    var t;
    for(t=0; t<maxTicks; t++){
        model.update();
        NIRA.clampValues(model);

        // Cada 10 ticks: forzar emisión de señales pendientes
        // (simula el setTimeout de 100ms de forma síncrona)
        if(t % 10 === 0){
            for(var i=0;i<n;i++){
                if(nodes[i].aggregate){
                    clearTimeout(nodes[i].aggregate);
                    nodes[i].aggregate = null;
                    nodes[i].sendSignal({
                        delta: nodes[i].value * 0.3,
                        age: 1000000
                    });
                    nodes[i].deltaPool = 0;
                }
            }
        }

        if(t === 0){
            for(var i=0;i<n;i++) prev[i] = nodes[i].value;
            continue;
        }
        var change = 0;
        for(var i=0;i<n;i++){
            change += Math.abs(nodes[i].value - prev[i]);
            prev[i] = nodes[i].value;
        }
        if(change < threshold && Edge.allSignals.length === 0){
            stable++;
            if(stable >= minStableTicks) return t+1;
        }else{
            stable = 0;
        }
    }
    return maxTicks;
};

//////////////////////////////////////
// ANÁLISIS (NIRA LITE) //////////////
//////////////////////////////////////

// Ejecuta el análisis completo en rebanadas asíncronas:
//   0) Simulación de CONTROL sin intervenir -> puntaje línea base.
//   1..N) Por nodo: restaurar snapshot -> +1 en ese nodo ->
//          simular -> puntaje -> impacto de derrame (spillover).
// MÉTRICA DE DERRAME: el impacto de cada intervención excluye el nodo
// diana del puntaje, tanto en post como en control, de modo que mide solo
// cuánto cambia el RESTO del sistema (efecto cascada), no el +1 propio del
// nodo intervenido ni su desequilibrio (1 - init).
//   impact = totalScore(post,  exclude=diana)
//          - totalScore(control, exclude=diana)
//          = (totalScore(post) - postValue_diana)
//          - (baseScore      - controlValue_diana)
// donde baseScore = totalScore(control) (Σ de TODOS los nodos del control,
// el mismo escalar para todas las intervenciones) y controlValue_diana es
// el valor final del diana en la simulación de control.
// Al final restaura el snapshot completo (modo incluido).
//
// options:
//   onProgress(p)  p en 0..1
//   onComplete(results)  results: [{node,label,impact,impactNormalized,ticks}] desc
//   onError(msg)
NIRA.analyze = function(loopy, options){
    options = options || {};
    var onProgress   = options.onProgress   || function(){};
    var onComplete   = options.onComplete   || function(){};
    var onError      = options.onError      || function(){};

    if(NIRA.running) return; // antirreentrada: no correr dos análisis a la vez
    var model = loopy.model;
    if(!model || model.nodes.length === 0){
        onError("No hay nodos en la red para analizar.");
        return;
    }

    NIRA.running = true;

    // Durante el análisis la simulación debe comportarse como PLAY:
    // en modo EDIT, Node.update fuerza value=init en cada tick.
    // Se asigna loopy.mode directamente (sin setMode, que publica y
    // cambiaría el playbar); al final se restaura el modo original.
    var prevMode = loopy.mode;
    loopy.mode = Loopy.MODE_PLAY;
    loopy._niraRunning = true;

    // Bloquear edición/clics sobre barra de herramientas, playbar y sidebar
    // durante el análisis (además del flag _niraRunning en Node.js).
    var _blocked = [];
    var _blockEls = [loopy.toolbar?loopy.toolbar.dom:null,
                     loopy.playbar?loopy.playbar.dom:null,
                     loopy.sidebar?loopy.sidebar.dom:null];
    for(var _b=0;_b<_blockEls.length;_b++){
        if(_blockEls[_b]){
            _blocked.push([_blockEls[_b], _blockEls[_b].style.pointerEvents]);
            _blockEls[_b].style.pointerEvents = "none";
        }
    }

    // Snapshot del estado del usuario (se restaura al finalizar).
    var snap = NIRA.snapshot(loopy);
    var nodes = NIRA.getVisibleNodes(model);
    var totalTasks = nodes.length + 1;
    var taskIndex = 0;     // 0 = control, k>0 = nodo k-1
    var taskTicksDone = 0; // ticks consumidos en la tarea actual
    var baseScore = 0;     // puntaje total del control (Σ de todos los nodos)
    var controlValues = null; // valor final de cada nodo en el control
    var results = [];
    var aborted = false;

    var _cleanup = function(){
        // Devuelve la UI bloqueada.
        for(var i=0;i<_blocked.length;i++){
            _blocked[i][0].style.pointerEvents = _blocked[i][1] || "";
        }
        loopy._niraRunning = false;
        NIRA.running = false;
    };

    var _integrityOK = function(){
        return (model.nodes.length === snap.nodeCount) &&
               (model.edges.length === snap.edgeCount);
    };

    var _finishTask = function(){
        if(!_integrityOK()){
            aborted = true;
            NIRA._resetSimState();
            NIRA.restore(loopy, snap);
            loopy.mode = prevMode;
            _cleanup();
            onError("La red cambió durante el análisis. Intenta de nuevo.");
            return;
        }
        if(taskIndex === 0){
            // Tarea de control (sin intervenir). Línea base de referencia.
            // baseScore = puntaje total del control con TODOS los nodos (sin
            // exclusión: en el control no hay diana). Es el mismo escalar para
            // todas las intervenciones.
   baseScore = NIRA.totalScore(model, null);
   controlValues = {};
   for(var ci=0; ci<nodes.length; ci++){
       controlValues[nodes[ci].id] = nodes[ci].value;
   }
        }else{
            // Tarea de intervención sobre nodo taskIndex-1.
            // Métrica de DERRAME (spillover): excluimos el nodo diana del
            // puntaje, tanto en post como en control. Lo que interesa en NIRA
            // no es cuánto sube el nodo intervenido (eso es obvio, +1) ni su
            // propio desequilibrio (1 - init), sino cuánto cambia el RESTO del
            // sistema (efecto cascada). Excluir el diana elimina ese confusor
            // y restaura la discriminación por topología.
            //   impact = totalScore(post,  exclude=diana)   (= postScoreExcl)
            //          - totalScore(control, exclude=diana) (= controlScoreExcl
            //              = baseScore - controlValues[idx])
   var idx = taskIndex - 1;
   var node = nodes[idx];
   var postScoreExcl = NIRA.totalScore(model, node);
   var controlScoreExcl = baseScore - (controlValues[node.id] || 0);
   if (node.isMolar && node.children) {
       for (var c = 0; c < node.children.length; c++) {
           controlScoreExcl -= (controlValues[node.children[c]] || 0);
       }
   }
   var impact = postScoreExcl - controlScoreExcl;
            results.push({
                node: node,
                label: node.label,
                impact: impact,
                impactNormalized: 0, // se normaliza en _finishAll
                ticks: taskTicksDone
            });
        }
        // Restaurar snapshot para que cada intervención parta del mismo estado
        NIRA._resetSimState();
        NIRA.restore(loopy, snap);
        loopy.mode = Loopy.MODE_PLAY; // re-afirmar modo simulación entre tareas
    };

    var _finishAll = function(){
        // Normalizar impacto a 0..1. Con el clamp de valores en el bucle
        // de simulación los impactos ya son finitos y acotados; la rama
        // isFinite/NaN queda solo como red de seguridad por estados
        // extremos del usuario (p. ej. valores previos gigantes en el
        // snapshot restaurado antes del primer clamp).
        var maxAbs = 0;
        for(var i=0;i<results.length;i++){
            var a = Math.abs(results[i].impact);
            if(isFinite(a) && a > maxAbs) maxAbs = a;
        }
        for(var i=0;i<results.length;i++){
            var imp = results[i].impact;
            var norm;
            if(!isFinite(imp)){
                norm = (imp > 0) ? 1 : 0; // red de seguridad: saturar
            }else if(maxAbs > 0){
                norm = imp / maxAbs;
            }else{
                norm = 0;
            }
            norm = norm < 0 ? 0 : (norm > 1 ? 1 : norm);
            if(isNaN(norm)) norm = 0;
            results[i].impactNormalized = norm;
            results[i].node.impact = norm;
        }
        results.sort(function(a,b){ return b.impact - a.impact; });

        // Auras SOLO en el top 5 del ranking: node.impact (0..1) se asigna
        // únicamente a los 5 primeros; el resto queda en 0. Node.js dibuja
        // el aura solo si showImpact && impact > 0, así que con esto queda
        // automáticamente limitada a top 5. El ranking (results con
        // impactNormalized) sigue incluyendo TODOS los nodos.
        for(var i=0;i<results.length;i++){
            results[i].node.impact = (i < 5) ? results[i].impactNormalized : 0;
        }

        // Restaurar snapshot completo (valores/signales/modo) del usuario.
        NIRA._resetSimState();
        NIRA.restore(loopy, snap);
        loopy.mode = prevMode;
        loopy.showImpact = true; // pintar auras
        _cleanup();
        onComplete(results);
    };

    var _resetBeforeTask = function(){
        // Cada tarea parte del snapshot limpio.
        taskTicksDone = 0;
    };

    var step = function(){
        if(aborted) return;

        var budget = NIRA.MAX_TICKS - 0; // tope por tarea
        var remaining = budget - taskTicksDone;
        if(remaining <= 0){
            // Tarea consumió todo el presupuesto -> medir
            _finishTask();
            taskIndex++;
            if(taskIndex > totalTasks - 1){
                _finishAll();
                return;
            }
            _resetBeforeTask();
            _prepareIntervention(); // intervenir el nuevo nodo
            setTimeout(step, 0);
            return;
        }

        var batch = Math.min(NIRA.CHUNK_TICKS, remaining);
        var used = NIRA.runSimulationUntilStable(loopy, batch, NIRA.THRESHOLD, NIRA.MIN_STABLE_TICKS);
        taskTicksDone += used;

        // Progreso: tareas completadas + fracción de la tarea actual
        var progress = (taskIndex + (taskTicksDone / budget)) / totalTasks;
        onProgress(progress < 1 ? progress : 1);

        if(used < batch){
            // Convergió dentro de esta rebanada
            _finishTask();
            taskIndex++;
            if(taskIndex > totalTasks - 1){
                _finishAll();
                return;
            }
            _resetBeforeTask();
            _prepareIntervention();
        }
        setTimeout(step, 0);
    };

var _prepareIntervention = function(){
    if(taskIndex === 0) return;
    var node = nodes[taskIndex-1];
    
    if (node.isMolar && node.children && node.children.length > 0) {
        for (var c = 0; c < node.children.length; c++) {
            var childNode = model.getNode(node.children[c]); // <-- OBTENER REFERENCIA DEL HIJO
            if (childNode) childNode.takeSignal({ delta: NIRA.INTENSITY }); // <-- APLICAR AL HIJO
        }
    } else {
        node.takeSignal({ delta: NIRA.INTENSITY });
    }
    NIRA.clampValues(model);
};
    // ---- Arranque ----
    _resetBeforeTask();
    setTimeout(step, 0);
};

// Limpia el array reusado de estado previo entre tareas/simulaciones para
// que el primer tick de cada tarea se considere "sin referencia".
NIRA._resetSimState = function(){
    NIRA._prevValues = null;
};

/**********************************
NIRA: Pasada rápida CON perturbación (rompe el determinismo)
**********************************/
/**********************************
NIRA: Motor Definitivo (AUC + Horizonte Dinámico)
**********************************/
// ------------------------------------------------------------------
// §6.3 — Guardia del nodo adaptativo.
// El nodo adaptativo debe ser un SUMIDERO: sin aristas de SALIDA. Es la
// única condición que impide el lazo de ganancia >1 (Prueba 1: adaptativo
// = nodo real con aristas → Spearman 0.65 vs. sin mecanismo, impactos
// ~4 → ~260). Un nodo virtual sin salidas es inerte para el ranking
// (Prueba 2 y NIRA_T.t1: max|Δimpacto| = 0). OJO: el nodo virtual SÍ es
// un nodo visible del modelo, así que la guardia es estructural (aristas
// de salida), NO "¿está en la red visible?".
// Devuelve un string de error, o null si la configuración es válida.
// Si el label no existe, el mecanismo simplemente no aplica (sin error).
// ------------------------------------------------------------------
NIRA.validateAdaptiveNode = function(model) {
    if (!NIRA.ADAPTIVE_NODE_LABEL) return null;
    var label = String(NIRA.ADAPTIVE_NODE_LABEL).trim();
    var nodes = NIRA.getVisibleNodes(model);
    var found = null;
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].label && String(nodes[i].label).trim() === label) { found = nodes[i]; break; }
    }
    if (!found) return null;
    var out = [];
    for (var j = 0; j < model.edges.length; j++) {
        var e = model.edges[j];
        if (e.from && e.from.id === found.id) out.push(e);
    }
    if (out.length > 0) {
        return "ADAPTIVE_NODE_LABEL ('" + label + "') apunta a un nodo con " + out.length +
            " arista(s) de salida. El nodo adaptativo debe ser un nodo VIRTUAL sin aristas de salida: " +
            "con salidas, la inyección crea retroalimentación positiva y reordena el ranking (§6.3).";
    }
    return null;
};

// ------------------------------------------------------------------
// §6.9 — Perturbación estructural de edge.strength.
// Ruido relativo N(0, σ_rel) (factor ≥ 0: preserva el signo), clamp a
// [-1, 1]. Excluye aristas del interruptor maestro (molar → hijo).
// Devuelve una función que restaura las fuerzas originales.
// NIRA.snapshot/restore NO guardan edge.strength, por eso la restauración
// es responsabilidad de quien perturba (ver wrapper con try/finally).
// ------------------------------------------------------------------
NIRA._isMasterEdge = function(e) {
    return !!(e.from && e.from.isMolar && e.from.children &&
              e.to && e.from.children.indexOf(e.to.id) !== -1);
};
NIRA._perturbEdgeStrengths = function(model) {
    var sigma = NIRA.PERTURBATION_EDGE_REL_SIGMA;
    if (!(sigma > 0)) return function() {};
    var edges = model.edges, saved = [];
    for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (NIRA._isMasterEdge(e)) continue;
        saved.push({ edge: e, strength: e.strength });
        var factor = Math.max(0, 1 + NIRA._gaussianNoise(0, sigma));
        e.strength = Math.max(-2, Math.min(2, e.strength * factor)); // rango real del slider: ±2
    }
    return function() {
        for (var k = 0; k < saved.length; k++) saved[k].edge.strength = saved[k].strength;
    };
};

// ------------------------------------------------------------------
// §6.7 / §6.5 — Diagnóstico previo de la red (sin simular).
// Densidad dirigida sobre nodos visibles (pares ordenados distintos, sin
// autolazos) y lista de molares con su k (para la nota "intervención
// sobre k procesos simultáneos").
// ------------------------------------------------------------------
NIRA.networkDiagnostics = function(model) {
    var nodes = NIRA.getVisibleNodes(model);
    var n = nodes.length, pairs = {}, m = 0;
    for (var i = 0; i < model.edges.length; i++) {
        var e = model.edges[i];
        if (!e.from || !e.to || e.from.hidden || e.to.hidden) continue;
        if (e.from.id === e.to.id) continue;
        var key = e.from.id + ">" + e.to.id;
        if (!pairs[key]) { pairs[key] = 1; m++; }
    }
    var density = n > 1 ? m / (n * (n - 1)) : 0;
    var molars = [];
    for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].isMolar && nodes[j].children && nodes[j].children.length > 0) {
            molars.push({ label: nodes[j].label, k: nodes[j].children.length });
        }
    }
    return {
        nodes: n, edges: m, density: density,
        warnDensity: density > NIRA.DENSITY_WARN_THRESHOLD,
        densityThreshold: NIRA.DENSITY_WARN_THRESHOLD,
        molars: molars
    };
};

// Percentil con interpolación lineal sobre un arreglo YA ordenado.
NIRA._percentile = function(sorted, p) {
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

// Wrapper público. Orden de operaciones:
//  1) validar ANTES de tocar estado (un throw acá no deja el modelo sucio),
//  2) el núcleo perturba valores de nodo (mismas N primeras extracciones
//     de RNG que antes), y recién después invoca el hook que perturba
//     aristas,
//  3) finally: las fuerzas SIEMPRE se restauran, aun si el núcleo falla.
NIRA._runSinglePass = function(loopy) {
    var err = NIRA.validateAdaptiveNode(loopy.model);
    if (err) throw new Error(err);
    var restoreEdges = null;
    var prevMaxSignals = Edge.MAX_SIGNALS;
    var prevMaxPerEdge = Edge.MAX_SIGNALS_PER_EDGE;

    try {
        if (NIRA.SIM_LIFT_SIGNAL_CAPS) {
            var emisiones = 1 + Math.ceil(NIRA.HORIZON_MIN / NIRA.FLUSH_INTERVAL);
            var capEdge = NIRA.SIM_MAX_SIGNALS_PER_EDGE || (emisiones + 2);
            var capTotal = NIRA.SIM_MAX_SIGNALS ||
                (loopy.model.edges.length * capEdge + 2);
            Edge.MAX_SIGNALS = capTotal;
            Edge.MAX_SIGNALS_PER_EDGE = capEdge;
            NIRA._lastCaps = { total: capTotal, perEdge: capEdge };
        }

        var out = NIRA._runSinglePassCore(loopy, {
            afterNodePerturbation: function() {
                restoreEdges = NIRA._perturbEdgeStrengths(loopy.model);
            }
        });

        if (NIRA._lastDrops > 0 && !NIRA._dropWarned) {
            NIRA._dropWarned = true;
            console.warn("NIRA: se descartaron hasta " + NIRA._lastDrops +
                " señales en una simulación (topes Edge: " + Edge.MAX_SIGNALS +
                " / " + Edge.MAX_SIGNALS_PER_EDGE + "). Resultados truncados.");
        }

        return out;
    } finally {
        if (restoreEdges) restoreEdges();
        Edge.MAX_SIGNALS = prevMaxSignals;
        Edge.MAX_SIGNALS_PER_EDGE = prevMaxPerEdge;
    }
};

NIRA._runSinglePassCore = function(loopy, hooks) {
    var model = loopy.model;
    var nodes = NIRA.getVisibleNodes(model);

    // Snapshot del estado REAL del usuario antes de tocar nada.
    // Esto preserva signalSpeed visual para restaurarlo al final.
    var snap = NIRA.snapshot(loopy);
    var prevMode = loopy.mode;
    var prevSignalSpeed = loopy.signalSpeed;

    // ========================================================
    // NUEVO: forzar velocidad interna de simulación NIRA.
    // Desde acá, el slider del playbar no afecta esta pasada.
    // ========================================================
    loopy.mode = Loopy.MODE_PLAY;
    loopy.signalSpeed = NIRA.SIM_SIGNAL_SPEED;

    // ==========================================
    // HORIZONTE FIJO (Opción A, auditoría)
    // ==========================================
    // La fórmula dinámica anterior (diam × SIM_SIGNAL_SPEED × HORIZON_FACTOR)
    // era código muerto en el rango clínico: con SIM_SIGNAL_SPEED=3 y
    // HORIZON_FACTOR=4, superar el piso de 800 requiere diam > 66.67, y
    // ninguna red clínica (diam ≤ 10) llega ahí. HORIZON_MAX nunca se
    // alcanzaba. Además, el diámetro por hop-count no es un buen proxy del
    // tiempo de tránsito real: ignora tanto la fuerza de las aristas
    // (effectiveStrength en Edge.js) como la longitud física dibujada
    // (Edge.js: signalSpeed = speed / getArrowLength()), así que "recalibrar"
    // la fórmula sin resolver eso solo cambiaría una constante arbitraria
    // por otra con apariencia de rigor. Se deja fijo en HORIZON_MIN y se
    // conserva el cálculo del diámetro, desacoplado, para un futuro
    // diagnóstico topológico previo (§8.8: saturación, radio espectral),
    // no para determinar cuánto dura la simulación.
    var diameter = NIRA.calculateDiameter(model); // reservado para diagnóstico futuro, no fija el horizonte
    var HORIZON = NIRA.HORIZON_MIN;

    // ==========================================
    // NUEVO: PERTURBACIÓN GAUSSIANA TRUNCADA
    // ==========================================
    for (var i = 0; i < nodes.length; i++) {
        var noise = NIRA._gaussianNoise(0, NIRA.PERTURBATION_SIGMA);

        // Truncamiento duro para mantener la perturbación clínica pequeña
        if (noise > NIRA.PERTURBATION_MAX) {
            noise = NIRA.PERTURBATION_MAX;
        } else if (noise < -NIRA.PERTURBATION_MAX) {
            noise = -NIRA.PERTURBATION_MAX;
        }

        nodes[i].value = Math.max(0, Math.min(1, nodes[i].value + noise));
    }

    // §6.9: perturbación estructural de aristas (después de las N
    // extracciones de los nodos, para no alterar su secuencia de RNG).
    if (hooks && hooks.afterNodePerturbation) hooks.afterNodePerturbation();
    
    // Snapshot DESPUÉS de perturbar y después de forzar SIM_SIGNAL_SPEED.
    // Así cada intervención parte del mismo estado perturbado y con la misma velocidad interna.
    var perturbedSnap = NIRA.snapshot(loopy);
    NIRA._lastDrops = 0; // máx. de señales descartadas en esta pasada (ver Edge.droppedSignals)
    NIRA._lastPeak = 0;

    // ==========================================
    // NUEVO: resolver nodo adaptativo (si está configurado)
    // ==========================================
    var adaptiveNode = null;

    if (NIRA.ADAPTIVE_NODE_LABEL) {
        var targetLabel = String(NIRA.ADAPTIVE_NODE_LABEL).trim();

        for (var ai = 0; ai < nodes.length; ai++) {
            if (nodes[ai].label && String(nodes[ai].label).trim() === targetLabel) {
                adaptiveNode = nodes[ai];
                break;
            }
        }
    }

    // ==========================================
    // FUNCIÓN DE SIMULACIÓN CON AUC
    // ==========================================
    function simulateWithAUC(clampNode) {
        NIRA.restore(loopy, perturbedSnap);
        loopy.mode = Loopy.MODE_PLAY;
        NIRA._resetSimState();
        // Higiene: la rotación de emisión de cada nodo es estado oculto que
        // restore() no cubre; sin esto cada simulación arranca distinta.
        for (var _ri = 0; _ri < model.nodes.length; _ri++) {
            if (model.nodes[_ri]._resetSignalOrder) model.nodes[_ri]._resetSignalOrder();
        }
        Edge.droppedSignals = 0;
        Edge.peakSignals = 0;

        // FIX (auditoría): patada inicial. Ver NIRA.KICK_THRESHOLD arriba
        // para el porqué. Se reemite value*0.3 — la MISMA constante que ya
        // usa el motor en su propio ciclo de agregación (Node.js,
        // self.aggregate) y que NIRA ya reutiliza en el flush de cada 10
        // ticks — para no inventar una magnitud nueva. Va ANTES de instalar
        // el parche de takeSignal: sendSignal solo encola señales salientes
        // (edge.addSignal), nunca invoca takeSignal sobre el propio nodo
        // emisor, así que el orden respecto al parche no cambia el
        // resultado — pero se deja así para que quede explícito que la
        // patada no puede ser interceptada por WEAKEN_FACTOR en ningún
        // caso. Se ejecuta en CADA llamada a simulateWithAUC (baseline y
        // cada intervención), siempre sobre el mismo estado restaurado de
        // perturbedSnap, así que las N+1 corridas arrancan de condiciones
        // idénticas — la comparación sigue siendo justa.
        // Nodos que participan de kick/flush. Para AUC y ranking se sigue
        // usando `nodes` (visibles); `stateNodes` solo agrega los hijos
        // ocultos cuando NIRA.FLUSH_HIDDEN está activo.
        var stateNodes = NIRA.FLUSH_HIDDEN ? model.nodes : nodes;
        for (var _ki = 0; _ki < stateNodes.length; _ki++) {
            if (stateNodes[_ki].value > NIRA.KICK_THRESHOLD) {
                stateNodes[_ki].sendSignal({
                    delta: stateNodes[_ki].value * 0.3,
                    age: 1000000
                });
            }
        }

        var adaptiveAuc = 0;  // Serie 2: activación de la conducta valorada (dependiente #2)

        // FIX (auditoría, hallazgo 1): AUC acumulado POR NODO, no un escalar
        // único. Antes, cuando clampNode era null (baseline), el diana d NO
        // se excluía del escalar 'auc'; cuando clampNode = d (intervención),
        // sí se excluía. Eso sumaba AUC_d_baseline completo (la trayectoria
        // no amortiguada de d durante todo el horizonte) como artefacto al
        // impacto de cada nodo. Ahora se acumula el AUC de CADA nodo visible
        // en todas las corridas (baseline e intervención por igual), sin
        // excluir a nadie acá. La exclusión simétrica del diana y del
        // adaptativo se aplica después, al calcular el impacto, sobre
        // ambos lados de la resta.
        var aucByNode = {};
        var parentAucByNode = {}; // solo diagnóstico (6.5): AUC del padre molar
        var childAucByNode = {};  // solo diagnóstico (DEBUG_MOLAR): AUC de cada hijo oculto
        for (var _ni = 0; _ni < nodes.length; _ni++) {
            aucByNode[nodes[_ni].id] = 0;
        }

        // Ec. 1 de Baum: menor peso competitivo (c) del nodo diana.
        // FIX (auditoría, Bug B): antes se parcheaba takeSignal del padre Y
        // de cada hijo. Verificado en Model.js (groupNodes, paso 9, líneas
        // 276-315): TODA arista externa que tocaba un hijo se consolida en
        // una arista nueva hacia/desde molar.id — ningún hijo oculto puede
        // recibir una arista externa directa. El único punto de entrada
        // externo a un molar es el padre. Por lo tanto alcanza con
        // amortiguar al padre: el interruptor maestro (strength=1.0, sin
        // atenuación propia) distribuye a los hijos la señal YA amortiguada.
        // Parchear también a los hijos aplicaba una segunda amortiguación
        // (≈9% en vez de 30%) y una segunda desviación al nodo adaptativo
        // por cada hijo.
        var weakenTargets = [];
        var originalTakeSignals = [];
        if (clampNode) {
            weakenTargets.push(clampNode);
            // NO se pushean los hijos (ver nota arriba).
            weakenTargets.forEach(function(n) {
                var original = n.takeSignal;
                originalTakeSignals.push({ node: n, fn: original });
                n.takeSignal = function(signal) {
                    var originalDelta = signal.delta;
                    var dampenedDelta = originalDelta * NIRA.WEAKEN_FACTOR;
                    var divertedDelta = originalDelta - dampenedDelta;

                    var dampened = {
                        delta: dampenedDelta,
                        position: signal.position !== undefined ? signal.position : 0,
                        scaleX: Math.abs(dampenedDelta),
                        scaleY: dampenedDelta,
                        age: signal.age
                    };
                    original.call(n, dampened);

                    // Ec. 2 de Baum: el presupuesto liberado induce a la
                    // conducta alternativa ya presente en la red.
                    if (adaptiveNode && adaptiveNode.id !== n.id &&
                        Math.abs(divertedDelta) > 0.001 &&
                        NIRA.REPERTOIRE_COMPETITION_FACTOR > 0) {
                        adaptiveNode.takeSignal({
                            delta: divertedDelta * NIRA.REPERTOIRE_COMPETITION_FACTOR,
                            age: signal.age
                        });
                    }
                };
            });
        }

        for (var t = 0; t < HORIZON; t++) {
            model.update();
            NIRA.clampValues(model);

            if (t % NIRA.FLUSH_INTERVAL === 0) {
                for (var i = 0; i < stateNodes.length; i++) {
                    if (stateNodes[i].aggregate) {
                        clearTimeout(stateNodes[i].aggregate);
                        stateNodes[i].aggregate = null;
                        stateNodes[i].sendSignal({
                            delta: stateNodes[i].value * 0.3,
                            age: 1000000
                        });
                        stateNodes[i].deltaPool = 0;
                    }
                }
            }

            // FIX (auditoría, hallazgo 1): ya NO se excluye a clampNode acá.
            // Se acumula el AUC de cada nodo, siempre, en baseline y en
            // intervención por igual — simétrico. La exclusión del diana
            // (y la del adaptativo) se hace más abajo, al calcular impact(),
            // sobre ambos lados de la resta.
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                // Serie 2 (Dixon): la ganancia adaptativa NO se mezcla con la
                // carga sintomática — se registra aparte, en su propio total.
                if (adaptiveNode && n.id === adaptiveNode.id) {
                    adaptiveAuc += Math.max(0, n.value);
                    continue;
                }
                var nodeValue;
                if (n.isMolar && n.children && n.children.length > 0) {
                    // FIX (auditoría, Bug A): el molar ES la agregación de sus
                    // hijos (Baum, 2002, p.95, citado en Shimp, 2020, JEAB
                    // 114(1): "molar carries the connotation of aggregation
                    // or extendedness"). El padre es un proxy visual, no una
                    // instancia conductual propia — antes se sumaba
                    // n.value + Σ(children.value), pero children.value ya SE
                    // DERIVA de n.value vía el interruptor maestro, así que
                    // sumar ambos duplicaba la misma señal. Ahora el AUC del
                    // molar es solo Σ(children.value).
                    //
                    // CAVEAT sin resolver: children.value llega por el
                    // interruptor maestro sujeto al mecanismo de emisión
                    // periódica de Node.js (self.value * 0.3 por ciclo de
                    // agregación, estructural del motor, no específico de
                    // NIRA), así que en redes que NO saturan dentro del
                    // horizonte (régimen "óptimo clínico" de §7, densidad
                    // 20-30%) esta suma puede ir por detrás de lo que el
                    // padre realmente absorbió, sobre todo en los primeros
                    // ticks. En redes que sí saturan (v→1 para casi todos los
                    // nodos), padre e hijos convergen igual y el efecto se
                    // diluye. Si esto importa en la práctica, la solución NO
                    // es volver a tocar esta fórmula, sino revisar si el
                    // interruptor maestro debería entregar la señal a los
                    // hijos sin el recorte del 30%.
                    nodeValue = 0;
                    for (var c = 0; c < n.children.length; c++) {
                        var child = model.getNode(n.children[c]);
                        if (child && child.hidden) nodeValue += child.value;
                    }
                } else {
                    nodeValue = n.value;
                }
                aucByNode[n.id] += Math.max(0, nodeValue);
                if (NIRA._diag && n.isMolar && n.children && n.children.length > 0) {
                    parentAucByNode[n.id] = (parentAucByNode[n.id] || 0) + Math.max(0, n.value);
                    if (NIRA.DEBUG_MOLAR) {
                        for (var _dc = 0; _dc < n.children.length; _dc++) {
                            var _dch = model.getNode(n.children[_dc]);
                            if (_dch) childAucByNode[_dch.id] = (childAucByNode[_dch.id] || 0) + Math.max(0, _dch.value);
                        }
                    }
                }
            }
        }

//====================================================
        // NUEVO: limpieza final de agregaciones pendientes.
        // Evita que setTimeout de Node.takeSignal sigan vivos
        // después de terminar simulateWithAUC.
//====================================================
        // Higiene: también los hijos ocultos de molares (antes solo visibles).
        for (var fi = 0; fi < model.nodes.length; fi++) {
            if (model.nodes[fi].aggregate) {
                clearTimeout(model.nodes[fi].aggregate);
                model.nodes[fi].aggregate = null;
            }
            model.nodes[fi].deltaPool = 0;
        }
        // Validez: si los topes de Edge descartaron señales, la simulación
        // está truncada (no conserva la señal emitida).
        NIRA._lastDrops = Math.max(NIRA._lastDrops || 0, Edge.droppedSignals || 0);
        NIRA._lastPeak = Math.max(NIRA._lastPeak || 0, Edge.peakSignals || 0);

        originalTakeSignals.forEach(function(o) { o.node.takeSignal = o.fn; });
        if (NIRA._diag && !clampNode) {
            NIRA._diag.push({
                horizon: HORIZON,
                flush: NIRA.FLUSH_INTERVAL,
                finalValues: nodes.map(function(n) { return { id: n.id, label: n.label, value: n.value, molar: !!n.isMolar }; }),
                aucByNode: aucByNode,
                parentAucByNode: parentAucByNode,
                childAucByNode: childAucByNode,
                droppedSignals: Edge.droppedSignals,
                peakSignals: Edge.peakSignals
            });
        }
        return { aucByNode: aucByNode, adaptiveAUC: adaptiveAuc };
    }

    // FIX (auditoría, hallazgo 1): suma el AUC de todos los nodos en
    // aucByNode EXCLUYENDO simétricamente a excludeId (el diana) y al
    // adaptativo. Se usa para ambos lados (baseline e intervención), así
    // que la resta ya no arrastra el artefacto de AUC_diana_baseline.
    function sumExcluding(aucByNode, excludeId) {
        var sum = 0;
        for (var id in aucByNode) {
            if (String(id) === String(excludeId)) continue;
            if (adaptiveNode && String(id) === String(adaptiveNode.id)) continue;
            sum += aucByNode[id];
        }
        return sum;
    }

    // 1. CONTROL (baseline)
    var baseline = simulateWithAUC(null);

    var results = [];
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var intervention = simulateWithAUC(node);

        // FIX (auditoría, hallazgo 1): impacto = spillover SIMÉTRICO.
        // Antes: impact = baseline.symptomAUC - intervention.symptomAUC,
        // donde baseline sumaba TODOS los nodos (sin excluir a d) e
        // intervention excluía a d. Eso agregaba +AUC_d_baseline como
        // artefacto (la trayectoria completa no amortiguada de d durante
        // todo el horizonte), inflando el impacto de cada nodo en
        // proporción a su propia activación basal, no a su efecto sobre
        // el resto de la red. Test nulo: con WEAKEN_FACTOR=1 el impacto
        // daba ≈AUC_d_baseline en vez de 0.
        // Ahora: se excluye a d (y al adaptativo) de AMBOS lados antes de
        // restar, así que solo queda el efecto cascada sobre el resto del
        // sistema — el spillover real.
        var baselineExcl = sumExcluding(baseline.aucByNode, node.id);
        var interventionExcl = sumExcluding(intervention.aucByNode, node.id);
        var impact = baselineExcl - interventionExcl;

        // Ganancia adaptativa: la variable dependiente #2, reportada aparte,
        // nunca sumada ni restada del impacto sintomático.
        var adaptiveGain = intervention.adaptiveAUC - baseline.adaptiveAUC;

        results.push({
            node: node,
            label: node.label,
            impact: impact,
            adaptiveGain: adaptiveGain,
            baselineAUC: baselineExcl,
            interventionAUC: interventionExcl
        });
    }

    results.sort(function(a, b) { return b.impact - a.impact; });
    NIRA.restore(loopy, snap);
    loopy.mode = prevMode;
    loopy.signalSpeed = prevSignalSpeed;
    return results;
};


/**********************************
NIRA: Análisis de Estabilidad (MICRO-BATCHING + CANCELAR + IMPACTO PROMEDIO)
**********************************/
NIRA.analyzeStability = function(loopy, iterations, onProgress, onComplete, onError) {
    if (NIRA.running) return;
    var model = loopy.model;
    if (!model || model.nodes.length === 0) {
        onError("No hay nodos en la red para analizar.");
        return;
    }
    // §6.3: fallar ANTES de arrancar si el nodo adaptativo no es un sumidero.
    var _adaptiveErr = NIRA.validateAdaptiveNode(model);
    if (_adaptiveErr) { onError(_adaptiveErr); return; }
    // §6.7 / §6.5: diagnóstico previo disponible para la UI (warning de
    // densidad, nota de k en molares): NIRA.lastDiagnostics.
    NIRA.lastDiagnostics = NIRA.networkDiagnostics(model);
    NIRA.running = true;
    NIRA.cancelled = false;
    
    // ==========================================
    // NIRA: ENCENDER EL INTERRUPTOR MAESTRO
    // ==========================================
    loopy._niraRunning = true;
    // ==========================================

    //====================================================
    // NUEVO: bloquear el playbar durante el análisis.
    // Esto evita que el usuario mueva el slider de velocidad
    // mientras corre el Monte Carlo.  //====================================================
    var _blocked = [];
    var _blockEls = [
        loopy.playbar ? loopy.playbar.dom : null
    ];

    for (var _b = 0; _b < _blockEls.length; _b++) {
        if (_blockEls[_b]) {
            _blocked.push([_blockEls[_b], _blockEls[_b].style.pointerEvents]);
            _blockEls[_b].style.pointerEvents = "none";
        }
    }

    var _cleanupStability = function() {
        for (var i = 0; i < _blocked.length; i++) {
            _blocked[i][0].style.pointerEvents = _blocked[i][1] || "";
        }
        loopy._niraRunning = false;
        NIRA.running = false;
    };

    var nodes = model.nodes.filter(function(n) { return !n.hidden; });
    var stabilityCounts = {};
    var impactSums = {}; // Acumulador de impacto
    var adaptiveGainSums = {}; 
    var impactSeries = {}; // §6.6: impacto por réplica (para DE, p5-p95 y P(A>B) pareado)
    
    nodes.forEach(function(n) {
        stabilityCounts[n.id] = {
            label: n.label, top1: 0, top3: 0, top5: 0,
            molarK: (n.isMolar && n.children) ? n.children.length : 0
        };
        impactSums[n.id] = 0;
        adaptiveGainSums[n.id] = 0; 
        impactSeries[n.id] = [];
    });
    
    var currentIter = 0;
    var batchSize = 5; // Lotes de 5 para no congelar la UI
    
    var processBatch = function() {
        if (NIRA.cancelled) {
            _cleanupStability();
            onError("Análisis cancelado por el usuario.");
            return;
        }
        if (currentIter >= iterations) {
            var finalRanking = [];
            for (var id in stabilityCounts) {
                var counts = stabilityCounts[id];
                // NUEVO: Cálculo de impacto promedio (Magnitud real)
                var avgImpact = impactSums[id] / iterations; 
                
                // §6.6: dispersión del impacto entre réplicas.
                var ser = impactSeries[id], nS = ser.length, varSum = 0;
                for (var q = 0; q < nS; q++) varSum += (ser[q] - avgImpact) * (ser[q] - avgImpact);
                var sdImpact = nS > 1 ? Math.sqrt(varSum / (nS - 1)) : 0;
                var sortedSer = ser.slice().sort(function(a, b) { return a - b; });

                finalRanking.push({
                    id: id,
                    label: counts.label,
                    top1: (counts.top1 / iterations) * 100,
                    top3: (counts.top3 / iterations) * 100,
                    top5: (counts.top5 / iterations) * 100,
                    avgImpact: avgImpact,
                    sdImpact: sdImpact,
                    p5Impact: NIRA._percentile(sortedSer, 0.05),
                    p95Impact: NIRA._percentile(sortedSer, 0.95),
                    // §6.5: k>0 si es molar. Al intervenirlo se atenúan k procesos
                    // a la vez: la UI debe anotarlo cuando esté en el Top 3.
                    molarK: counts.molarK,
                    // §6.3: MÉTRICA INTERNA, no clínica. Saturada (techo =
                    // HORIZON_MIN) y casi redundante con el impacto (ρ=0.90, n=7).
                    // No mostrar en el informe clínico.
                    avgAdaptiveGain: adaptiveGainSums[id] / iterations
                });
            }
            
            // CAMBIO CLAVE: Ordenar por Impacto Promedio (Potencia Clínica)
            // El nodo #1 del ranking ahora es el que mayor reducción sistémica genera.
            finalRanking.sort(function(a, b) { return b.avgImpact - a.avgImpact; });

            // §6.6: P(A>B) pareado entre dianas ADYACENTES del ranking.
            // Réplica a réplica (mismo estado perturbado para ambas). Los
            // empates exactos cuentan 1/2 (si no, dos nodos con impacto 0
            // darían P=0 y parecerían "claramente peores").
            for (var r = 0; r < finalRanking.length; r++) {
                var cur = finalRanking[r], nxt = finalRanking[r + 1];
                if (!nxt) { cur.pBeatsNext = null; cur.tieWithNext = false; continue; }
                var sa = impactSeries[cur.id], sb = impactSeries[nxt.id], score = 0;
                for (var z = 0; z < sa.length; z++) {
                    score += sa[z] > sb[z] ? 1 : (sa[z] === sb[z] ? 0.5 : 0);
                }
                cur.pBeatsNext = sa.length ? score / sa.length : null;
                cur.tieWithNext = cur.pBeatsNext !== null &&
                    cur.pBeatsNext >= NIRA.TIE_LOW && cur.pBeatsNext <= NIRA.TIE_HIGH;
            }
            
            _cleanupStability();
            onComplete(finalRanking);
            return;
        }
        var limit = Math.min(currentIter + batchSize, iterations);
        for (var i = currentIter; i < limit; i++) {
            var singleRunResults = NIRA._runSinglePass(loopy);
            
            // NUEVO: Acumular el impacto de TODOS los nodos en esta iteración
            for (var k = 0; k < singleRunResults.length; k++) {
                var res = singleRunResults[k];
                impactSums[res.node.id] += res.impact;
                impactSeries[res.node.id].push(res.impact);
                adaptiveGainSums[res.node.id] += res.adaptiveGain;
            }
            
            // Contar Top 1, 3, 5 (Consistencia)
            for (var j = 0; j < Math.min(5, singleRunResults.length); j++) {
                var nodeId = singleRunResults[j].node.id;
                if (j === 0) stabilityCounts[nodeId].top1++;
                if (j < 3) stabilityCounts[nodeId].top3++;
                if (j < 5) stabilityCounts[nodeId].top5++;
            }
        }
        currentIter = limit;
        onProgress(currentIter, iterations);
        setTimeout(processBatch, 0); // Cede el hilo al navegador
    };
    setTimeout(processBatch, 0);
};

// Función global para cancelar el análisis
NIRA.cancel = function() {
    NIRA.cancelled = true;
};
