/**********************************

NIRA!
- Network InteRvention Analysis (Lite, Fase 1)

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
    THRESHOLD:         0.001, // umbral de estabilidad
    MIN_STABLE_TICKS:  5,     // ticks consecutivos bajo el umbral
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
    CHUNK_TICKS: 200
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
NIRA.totalScore = function(model, excludeIdx){
    var nodes = model.nodes;
    var sum = 0;
    for(var i=0;i<nodes.length;i++){
        if(i === excludeIdx) continue;
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

    // Array reusado para el estado previo.
    var prev = NIRA._prevValues;
    if(!prev || prev.length < n) prev = NIRA._prevValues = new Array(n);

    var stable = 0;
    var t;
    for(t=0; t<maxTicks; t++){
        model.update();
        NIRA.clampValues(model); // acotar valores tras cada tick (anti-explosión)
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
    var nodes = model.nodes;
    var totalTasks = nodes.length + 1; // control + 1 por nodo
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
            baseScore = NIRA.totalScore(model);
            // Guardar el valor final de cada nodo en el control para que cada
            // intervención pueda excluir su diana también del control:
            //   controlScore(diana) = baseScore - controlValues[diana]
            controlValues = [];
            for(var ci=0; ci<model.nodes.length; ci++){
                controlValues.push(model.nodes[ci].value);
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
            var postScoreExcl = NIRA.totalScore(model, idx);   // Σ_post sin diana
            var controlScoreExcl = baseScore - controlValues[idx]; // Σ_control sin diana
            var impact = postScoreExcl - controlScoreExcl;     // derrame
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
        if(taskIndex === 0) return; // la tarea de control no interviene
        var node = nodes[taskIndex-1];
        // Intervenir subiendo +1: takeSignal hace value += delta Y re-emite
        // propagación (subir solo value no propaga nada). El clamp inmediato
        // deja el boost acotado a VALUE_MAX ("sube value hasta el tope"),
        // de modo que el valor de partida de la simulación queda en rango.
        node.takeSignal({ delta: NIRA.INTENSITY });
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
NIRA._runSinglePass = function(loopy) {
    var model = loopy.model;
    var nodes = model.nodes;
    var snap = NIRA.snapshot(loopy);
    var prevMode = loopy.mode;
    loopy.mode = Loopy.MODE_PLAY;

    // >>> PERTURBACIÓN ALEATORIA (RUIDO) <<<
    var perturbationStrength = 0.05; // 5% de ruido
    for (var i = 0; i < nodes.length; i++) {
        var noise = (Math.random() - 0.5) * 2 * perturbationStrength;
        nodes[i].value = Math.max(0, Math.min(1, nodes[i].value + noise));
    }

    // 1. Control (baseline) con ruido
    NIRA.runSimulationUntilStable(loopy, NIRA.MAX_TICKS, NIRA.THRESHOLD, NIRA.MIN_STABLE_TICKS);
    var baseScore = NIRA.totalScore(model);
    var controlValues = nodes.map(function(n) { return n.value; });
    var results = [];

    // 2. Intervenciones (una por nodo)
    for (var i = 0; i < nodes.length; i++) {
        NIRA.restore(loopy, snap);
        loopy.mode = Loopy.MODE_PLAY;
        
        // Re-aplicar perturbación aleatoria
        for (var k = 0; k < nodes.length; k++) {
            var noise = (Math.random() - 0.5) * 2 * perturbationStrength;
            nodes[k].value = Math.max(0, Math.min(1, nodes[k].value + noise));
        }
        
        NIRA.runSimulationUntilStable(loopy, NIRA.MAX_TICKS, NIRA.THRESHOLD, NIRA.MIN_STABLE_TICKS);
        var perturbedBaseScore = NIRA.totalScore(model);
        var perturbedControlValues = nodes.map(function(n) { return n.value; });
        
        var node = nodes[i];
        node.takeSignal({ delta: NIRA.INTENSITY });
        NIRA.clampValues(model);
        
        NIRA.runSimulationUntilStable(loopy, NIRA.MAX_TICKS, NIRA.THRESHOLD, NIRA.MIN_STABLE_TICKS);
        
        var postScoreExcl = NIRA.totalScore(model, i);
        var controlScoreExcl = perturbedBaseScore - perturbedControlValues[i];
        var impact = postScoreExcl - controlScoreExcl;
        
        results.push({ node: node, label: node.label, impact: impact });
    }

    // 3. Ordenar y restaurar
    results.sort(function(a, b) { return b.impact - a.impact; });
    NIRA.restore(loopy, snap);
    loopy.mode = prevMode;
    return results;
};

/**********************************
NIRA: Análisis de Estabilidad (MICRO-BATCHING + CANCELAR)
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
    var nodes = model.nodes;
    var stabilityCounts = {};
    nodes.forEach(function(n) {
        stabilityCounts[n.id] = { label: n.label, top1: 0, top3: 0, top5: 0 };
    });

    var currentIter = 0;
    var batchSize = 5; // Lotes de 5 para no congelar la UI

    var processBatch = function() {
        if (NIRA.cancelled) {
            NIRA.running = false;
            onError("Análisis cancelado por el usuario.");
            return;
        }

        if (currentIter >= iterations) {
            var finalRanking = [];
            for (var id in stabilityCounts) {
                var counts = stabilityCounts[id];
                finalRanking.push({
                    label: counts.label,
                    top1: (counts.top1 / iterations) * 100,
                    top3: (counts.top3 / iterations) * 100,
                    top5: (counts.top5 / iterations) * 100
                });
            }
            finalRanking.sort(function(a, b) { return b.top1 - a.top1; });
            
            NIRA.running = false;
            onComplete(finalRanking);
            return;
        }

        var limit = Math.min(currentIter + batchSize, iterations);
        for (var i = currentIter; i < limit; i++) {
            var singleRunResults = NIRA._runSinglePass(loopy);
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
