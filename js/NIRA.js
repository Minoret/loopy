/**********************************

NIRA!
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
    MAX_TICKS:         600, // tope de ticks por simulación
    THRESHOLD:         0.003, // umbral de estabilidad
    MIN_STABLE_TICKS:  3,     // ticks consecutivos bajo el umbral
    INTENSITY:         1,     // intervención: +1 a la alta

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
    HORIZON_MIN: 600,           // Ticks mínimos de simulación
    HORIZON_MAX: 2000,          // Ticks máximos de simulación
    HORIZON_FACTOR: 4          // Multiplicador del diámetro × velocidad

};

    NIRA.DEFAULT_ITERATIONS = 100;

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
NIRA.clampValues = function(model){
    var nodes = model.nodes.filter(function(n) { return !n.hidden; });
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
            node.takeSignal({ delta: NIRA.INTENSITY });
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
NIRA._runSinglePass = function(loopy) {
    var model = loopy.model;
    var nodes = NIRA.getVisibleNodes(model);
    var snap = NIRA.snapshot(loopy);
    var prevMode = loopy.mode;
    loopy.mode = Loopy.MODE_PLAY;

    // ==========================================
    // HORIZONTE DINÁMICO (basado en topología)
    // ==========================================
    var diameter = NIRA.calculateDiameter(model);
    var HORIZON = Math.max(NIRA.HORIZON_MIN, Math.min(NIRA.HORIZON_MAX, diameter * loopy.signalSpeed * NIRA.HORIZON_FACTOR));

    // ==========================================
    // PERTURBACIÓN ALEATORIA (una vez por iteración)
    // ==========================================
    var perturbationStrength = 0.05;
    for (var i = 0; i < nodes.length; i++) {
        var noise = (Math.random() - 0.5) * 2 * perturbationStrength;
        nodes[i].value = Math.max(0, Math.min(1, nodes[i].value + noise));
    }
    
    // Snapshot DESPUÉS de perturbar (para que cada intervención parta de aquí)
    var perturbedSnap = NIRA.snapshot(loopy);

    // ==========================================
    // FUNCIÓN DE SIMULACIÓN CON AUC
    // ==========================================
    function simulateWithAUC(clampNode) {
        NIRA.restore(loopy, perturbedSnap);
        loopy.mode = Loopy.MODE_PLAY;
        NIRA._resetSimState();
        
        var auc = 0;
        
        for (var t = 0; t < HORIZON; t++) {
            // INTERVENCIÓN: Bloquear el nodo a 0 (Alleviating)
            if (clampNode) {
                clampNode.value = 0;
                if (clampNode.isMolar && clampNode.children) {
                    for (var c = 0; c < clampNode.children.length; c++) {
                        var child = model.getNode(clampNode.children[c]);
                        if (child) child.value = 0;
                    }
                }
            }
            
            // Avanzar física nativa de Loopy (respeta aristas +/-)
            model.update();
            NIRA.clampValues(model);
            
            // Forzar emisión de señales pendientes (sincronizar con runSimulationUntilStable)
            if (t % 10 === 0) {
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i].aggregate) {
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
            
            // Medir score total en este tick (excluyendo nodo intervenido)
            var tickScore = 0;
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (clampNode && n.id === clampNode.id) continue;
                
                var nodeValue = n.value;
                if (n.isMolar && n.children && n.children.length > 0) {
                    for (var c = 0; c < n.children.length; c++) {
                        var child = model.getNode(n.children[c]);
                        if (child && child.hidden) {
                            nodeValue += child.value;
                        }
                    }
                }
                tickScore += Math.max(0, nodeValue);
            }
            auc += tickScore;
        }
        return auc;
    }

    // 1. CONTROL (baseline)
    var baselineAUC = simulateWithAUC(null);

    // 2. INTERVENCIONES
    var results = [];
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var interventionAUC = simulateWithAUC(node);
        
        // Impacto = AUC_control - AUC_intervención
        // Positivo = la red se "desactivó" más gracias a la intervención
        var impact = baselineAUC - interventionAUC;
        
        results.push({
            node: node,
            label: node.label,
            impact: impact,
            baselineAUC: baselineAUC,
            interventionAUC: interventionAUC
        });
    }

    // 3. Ordenar y restaurar
    results.sort(function(a, b) { return b.impact - a.impact; });
    NIRA.restore(loopy, snap);
    loopy.mode = prevMode;
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
    NIRA.running = true;
    NIRA.cancelled = false;
    
    // ==========================================
    // NIRA: ENCENDER EL INTERRUPTOR MAESTRO
    // ==========================================
    loopy._niraRunning = true;
    // ==========================================

    var nodes = model.nodes.filter(function(n) { return !n.hidden; });
    var stabilityCounts = {};
    var impactSums = {}; // NUEVO: Acumulador de impacto real
    
    nodes.forEach(function(n) {
        stabilityCounts[n.id] = { label: n.label, top1: 0, top3: 0, top5: 0 };
        impactSums[n.id] = 0; 
    });
    
    var currentIter = 0;
    var batchSize = 5; // Lotes de 5 para no congelar la UI
    
    var processBatch = function() {
        if (NIRA.cancelled) {
            NIRA.running = false;
            loopy._niraRunning = false; 
            onError("Análisis cancelado por el usuario.");
            return;
        }
        if (currentIter >= iterations) {
            var finalRanking = [];
            for (var id in stabilityCounts) {
                var counts = stabilityCounts[id];
                // NUEVO: Cálculo de impacto promedio (Magnitud real)
                var avgImpact = impactSums[id] / iterations; 
                
                finalRanking.push({
                    label: counts.label,
                    top1: (counts.top1 / iterations) * 100,
                    top3: (counts.top3 / iterations) * 100,
                    top5: (counts.top5 / iterations) * 100,
                    avgImpact: avgImpact 
                });
            }
            
            // CAMBIO CLAVE: Ordenar por Impacto Promedio (Potencia Clínica)
            // El nodo #1 del ranking ahora es el que mayor reducción sistémica genera.
            finalRanking.sort(function(a, b) { return b.avgImpact - a.avgImpact; });
            
            NIRA.running = false;
            loopy._niraRunning = false; 
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
