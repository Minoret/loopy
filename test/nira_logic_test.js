// Test lógico headless de js/NIRA.js con stubs fieles de Node/Edge/Model/Loopy.
// Carga los módulos reales con vm.runInThisContext (top-level var -> global),
// como en el navegador.
"use strict";
const fs = require("fs");
const vm = require("vm");

// ---------- Globals estilo navegador ----------
global.window = global;
Math.TAU = Math.PI * 2;

// setTimeout síncrono para que NIRA.analyze complete inline
const realSetTimeout = setTimeout;
global.setTimeout = function(fn, ms){ fn(); return 0; };

function load(file){
    const code = fs.readFileSync(file, "utf8");
    vm.runInThisContext(code, { filename: file });
}

// minpubsub (publica publish/subscribe globales)
load("js/minpubsub.js");
if(typeof publish !== "function") throw new Error("publish no cargó");

// ---------- Stubs fieles de la física ----------
global.Loopy = { MODE_EDIT: 0, MODE_PLAY: 1 };

// Constructor Loopy stub (solo lo que NIRA usa)
global.Loopy._ctor = function(){
    this.mode = Loopy.MODE_EDIT;
    this.signalSpeed = 3;
    this.showImpact = false;
    this._niraRunning = false;
    this.toolbar = { dom: { style: {} } };
    this.playbar = { dom: { style: {} } };
    this.sidebar = { dom: { style: {} } };
    this.model = null;
};

global.Node = {};
Node.COLORS = ["#FF6B6B","#FF83C1","#EA9D51","#FEEE43","#BFEE3F","#7FD4FF","#79B8FF","#C3A6FF"];
Node.DEFAULT_RADIUS = 60;
Node.defaultValue = 0;
function StubNode(model, config){
    var self = this;
    self.loopy = model.loopy;
    self.model = model;
    self.id = config.id;
    self.x = config.x || 0;
    self.y = config.y || 0;
    self.init = (config.init===undefined) ? 0 : config.init;
    self.label = config.label || "n"+self.id;
    self.hue = config.hue || 0;
    self.radius = Node.DEFAULT_RADIUS;
    self.shape = "circle";
    self.value = self.init;
    self.centrality = 0;
    self.impact = 0;
    self.sendSignal = function(signal){
        var myEdges = model.getEdgesByStartNode(self);
        for(var i=0;i<myEdges.length;i++) myEdges[i].addSignal(signal);
    };
    self.takeSignal = function(signal){
        self.value += signal.delta;
        self.sendSignal({ delta: self.value * 0.3 });
    };
    self.update = function(speed){
        // Mismo comportamiento que Node.js:162-164
        if(self.loopy.mode == Loopy.MODE_EDIT) self.value = self.init;
    };
}
global.StubNode = StubNode;

global.Edge = {};
Edge.allSignals = [];
Edge.MAX_SIGNALS = 100;
Edge.MAX_SIGNALS_PER_EDGE = 10;
Edge.defaultStrength = 0.1;
function StubEdge(model, config){
    var self = this;
    self.loopy = model.loopy;
    self.model = model;
    self.from = config.from;
    self.to = config.to;
    self.strength = (config.strength===undefined) ? 0.1 : config.strength;
    self.arc = 100;
    self.signals = [];
    self.signalSpeed = 0;
    // Longitud de flecha simplificada para el test
    self.arrowLength = 200;
    self.getArrowLength = function(){ return self.arrowLength; };
    self.addSignal = function(signal){
        if(Edge.allSignals.length > Edge.MAX_SIGNALS) return;
        if(self.signals.length > Edge.MAX_SIGNALS_PER_EDGE) return;
        var delta = signal.delta;
        var age;
        if(signal.age === undefined){ age = 1000000; }else{ age = signal.age - 1; }
        var newSignal = { delta: delta, position: 0, scaleX: Math.abs(delta), scaleY: delta, age: age };
        if(age <= 0) return;
        self.signals.unshift(newSignal);
        Edge.allSignals.push(newSignal);
    };
    self.updateSignals = function(){
        var speed = Math.pow(2, self.loopy.signalSpeed);
        self.signalSpeed = speed / self.getArrowLength();
        for(var i=0;i<self.signals.length;i++){
            self.signals[i].position += self.signalSpeed;
        }
        var lastSignal = self.signals[self.signals.length-1];
        while(lastSignal && lastSignal.position >= 1){
            var effectiveStrength = Math.sign(self.strength) * (0.3 + 0.7 * Math.abs(self.strength));
            lastSignal.delta *= effectiveStrength;
            self.to.takeSignal(lastSignal);
            self.removeSignal(lastSignal);
            lastSignal = self.signals[self.signals.length-1];
        }
    };
    self.removeSignal = function(signal){
        self.signals.splice(self.signals.indexOf(signal), 1);
        Edge.allSignals.splice(Edge.allSignals.indexOf(signal), 1);
    };
    self.update = function(speed){ self.updateSignals(); };
}
global.StubEdge = StubEdge;

function StubModel(loopy){
    var self = this;
    self.loopy = loopy;
    // Modelo nuevo => sin señales (invariante del sistema real)
    Edge.allSignals = [];
    self.nodes = [];
    self.edges = [];
    self.nodeByID = {};
    self.addNode = function(config){
        var node = new StubNode(self, config);
        self.nodeByID[node.id] = node;
        self.nodes.push(node);
        return node;
    };
    self.addEdge = function(config){
        var edge = new StubEdge(self, config);
        self.edges.push(edge);
        return edge;
    };
    self.getEdgesByStartNode = function(startNode){
        return self.edges.filter(function(e){ return e.from == startNode; });
    };
    self.update = function(){
        var i;
        for(i=0;i<self.edges.length;i++) self.edges[i].update(0.05);
        for(i=0;i<self.nodes.length;i++) self.nodes[i].update(0.05);
    };
}
global.StubModel = StubModel;

// ---------- Cargar NIRA.js real ----------
load("js/NIRA.js");
if(typeof NIRA !== "object") throw new Error("NIRA no cargó");

var failures = 0;
function check(cond, msg){
    if(cond){ console.log("  OK  - " + msg); }
    else { failures++; console.log("  FAIL - " + msg); }
}
function closeTo(a, b, eps, msg){
    check(Math.abs(a-b) <= (eps||1e-9), msg + " (" + a + " vs " + b + ")");
}

// ============================================================
// TEST 1: snapshot/restore roundtrip
// ============================================================
console.log("\n[TEST 1] snapshot/restore roundtrip");
(function(){
    var loopy = new Loopy._ctor();
    var model = new StubModel(loopy);
    loopy.model = model;
    var a = model.addNode({id:1, label:"A", init:0.5});
    var b = model.addNode({id:2, label:"B", init:0});
    model.addEdge({from:a, to:b, strength:0.5});
    model.addEdge({from:b, to:a, strength:0.2});

    // Simular un poco para generar señales en vuelo
    loopy.mode = Loopy.MODE_PLAY;
    a.takeSignal({delta: 0.5}); // intervenir: genera señal en vuelo
    for(var t=0;t<5;t++) model.update(); // aún sin aterrizar (25 ticks de tránsito)
    var preSignalCount = Edge.allSignals.length;
    check(preSignalCount > 0, "hay señales en vuelo antes del snapshot (" + preSignalCount + ")");

    var snap = NIRA.snapshot(loopy);

    // Destruir el estado: valores random + señales basura
    a.value = 99; b.value = -77;
    Edge.allSignals = [];
    a.signals = [];
    b.signals = [];
    a.sendSignal({delta: 5});
    a.sendSignal({delta: -3});
    check(Edge.allSignals.length > 0, "estado destruido (señales nuevas)");

    // Restaurar
    NIRA.restore(loopy, snap);

    // Comparar contra el estado guardado en el snapshot
    closeTo(a.value, snap.nodeValues[0], 0, "value A == valor del snapshot");
    closeTo(b.value, snap.nodeValues[1], 0, "value B == valor del snapshot");
    check(model.edges[1].signals.length === snap.edgeSignals[1].length, "signals de B→A restauradas en cantidad");
    check(model.edges[0].signals.length === snap.edgeSignals[0].length, "signals de A→B restauradas en cantidad");
    check(Edge.allSignals.length === preSignalCount, "Edge.allSignals reconstruido (" + Edge.allSignals.length + ")");
    // Consistencia de referencias: allSignals contiene exactamente los objetos de los edges
    var refsOK = true;
    var count = 0;
    for(var i=0;i<model.edges.length;i++){
        for(var j=0;j<model.edges[i].signals.length;j++){
            count++;
            if(Edge.allSignals.indexOf(model.edges[i].signals[j]) === -1) refsOK = false;
        }
    }
    check(refsOK && count === Edge.allSignals.length, "allSignals = union de señales de edges (refs idénticas)");
})();

// ============================================================
// TEST 2: runSimulationUntilStable converge en cadena simple
// ============================================================
console.log("\n[TEST 2] runSimulationUntilStable");
(function(){
    var loopy = new Loopy._ctor();
    var model = new StubModel(loopy);
    loopy.model = model;
    var a = model.addNode({id:1, label:"A", init:0});
    var b = model.addNode({id:2, label:"B", init:0});
    var c = model.addNode({id:3, label:"C", init:0});
    model.addEdge({from:a, to:b, strength:0.1});
    model.addEdge({from:b, to:c, strength:0.1});

    loopy.mode = Loopy.MODE_PLAY;
    a.takeSignal({delta:1}); // intervención +1 en A
    var used = NIRA.runSimulationUntilStable(loopy, 2000, 0.001, 5);
    check(used < 2000, "convergió antes del tope (ticks=" + used + ")");
    var totals = NIRA.totalScore(model);
    check(totals > 1.0 && totals < 5.0, "puntaje total coherente (" + totals.toFixed(3) + ")");
    check(Edge.allSignals.length === 0, "señales todas entregadas al converger");

    // (a) clamp: todos los valores quedan dentro de [VALUE_MIN, VALUE_MAX]
    var inBounds = true;
    for(var i=0;i<model.nodes.length;i++){
        var v = model.nodes[i].value;
        if(v < NIRA.VALUE_MIN || v > NIRA.VALUE_MAX) inBounds = false;
    }
    check(inBounds, "valores acotados tras convergencia ([VALUE_MIN,VALUE_MAX]=" +
                    NIRA.VALUE_MIN + ".." + NIRA.VALUE_MAX + ")");

    // (b) totalScore usa el ESTADO FINAL (suma actual), no un acumulado
    var s1 = NIRA.totalScore(model);
    var manual1 = a.value + b.value + c.value;
    closeTo(s1, manual1, 0, "totalScore == suma actual de values (" + s1 + ")");
    a.value += 5; // mutar: el puntaje debe reflejarlo de inmediato
    var s2 = NIRA.totalScore(model);
    closeTo(s2, manual1 + 5, 0, "totalScore refleja el estado actual (no acumulado)");
    a.value -= 5;

    // Segunda corrida: reusar el mismo array prev no rompe
    var used2 = NIRA.runSimulationUntilStable(loopy, 200, 0.001, 5);
    check(used2 <= 200, "segunda corrida sin error");
})();

// ============================================================
// TEST 3: analyze completo (red 8 nodos con ciclos)
// ============================================================
console.log("\n[TEST 3] NIRA.analyze completo");
(function(){
    var loopy = new Loopy._ctor();
    var model = new StubModel(loopy);
    loopy.model = model;
    var labels = ["Ansiedad","Evitación","Rumia","Insomnio","Dolor","Fatiga","Ánimo","Motivación"];
    var nodes = [];
    for(var i=0;i<8;i++){
        nodes.push(model.addNode({id:i+1, label:labels[i], init:(i%3===0)?0.2:0, hue:i}));
    }
    // Red conectada con ciclos y fuerzas variadas
    model.addEdge({from:nodes[0], to:nodes[1], strength:0.8});
    model.addEdge({from:nodes[1], to:nodes[0], strength:0.5});
    model.addEdge({from:nodes[0], to:nodes[2], strength:0.6});
    model.addEdge({from:nodes[2], to:nodes[3], strength:0.4});
    model.addEdge({from:nodes[3], to:nodes[4], strength:0.3});
    model.addEdge({from:nodes[4], to:nodes[5], strength:0.5});
    model.addEdge({from:nodes[5], to:nodes[6], strength:0.4});
    model.addEdge({from:nodes[6], to:nodes[7], strength:0.3});
    model.addEdge({from:nodes[7], to:nodes[0], strength:0.2});
    model.addEdge({from:nodes[1], to:nodes[3], strength:0.3});
    model.addEdge({from:nodes[3], to:nodes[1], strength:0.2});

    // Estado previo del usuario: en EDIT con valores=init y algunas señales
    var preValues = model.nodes.map(function(n){ return n.value; });
    var preAllSignals = Edge.allSignals.length;
    var done = false;
    var progressCalls = 0;
    var lastProgress = -1;
    var boundViolations = 0;

    var results = null;
    NIRA.analyze(loopy, {
        onProgress: function(p){
            progressCalls++;
            check(p >= lastProgress - 1e-9, "progreso monótono (" + p.toFixed(3) + ")");
            lastProgress = p;
            // (a) en TODO el batch (control + cada intervención) los valores
            //     de nodo deben permanecer dentro de [VALUE_MIN, VALUE_MAX].
            for(var i=0;i<model.nodes.length;i++){
                var v = model.nodes[i].value;
                if(v < NIRA.VALUE_MIN - 1e-9 || v > NIRA.VALUE_MAX + 1e-9) boundViolations++;
            }
        },
        onComplete: function(r){
            results = r;
            done = true;
        },
        onError: function(m){
            console.log("  ERROR: " + m);
            done = true; // marcar para no colgar
        }
    });
    check(done, "analyze completó sincrónicamente");
    if(!done || !results){
        console.log("  ABORT: sin resultados");
        return;
    }
    check(results.length === 8, "un resultado por nodo (" + results.length + ")");
    console.log("  ranking (label: impact): " + results.map(function(r){ return r.label + ":" + r.impact.toFixed(3); }).join("  "));

    // Orden desc por impacto
    var sortedOK = true;
    for(var i=1;i<results.length;i++){
        if(results[i].impact > results[i-1].impact) sortedOK = false;
    }
    check(sortedOK, "ranking ordenado desc");

    // impactNormalized en 0..1
    var normOK = true;
    for(var i=0;i<results.length;i++){
        if(results[i].impactNormalized < 0 || results[i].impactNormalized > 1) normOK = false;
    }
    check(normOK, "impactNormalized en [0,1]");

    // (a) valores de nodo nunca excedieron [VALUE_MIN, VALUE_MAX] en el batch
    check(boundViolations === 0, "valores nunca excedieron [VALUE_MIN,VALUE_MAX] durante el batch (violaciones=" + boundViolations + ")");

    // (c) Opción A con signo correcto: red con todas las aristas de fuerza
    //     positiva => intervenir +1 a la alta nunca baja el puntaje total,
    //     luego impacto = post - control debe ser >= 0 para cada nodo.
    var signOK = true;
    for(var i=0;i<results.length;i++){
        if(results[i].impact < -1e-9) signOK = false;
    }
    check(signOK, "impacto >= 0 con aristas positivas (post >= control, Opción A)");

    // (nuevo núcleo) impactos acotados y clínicamente significativos:
    // con clamp [VALUE_MIN, VALUE_MAX] = [0,1] el |impacto| está acotado
    // por una fórmula PROPORCIONAL a la red: cada nodo vale a lo sumo 1,
    // el máximo total (Σ values) es N, y por tanto |impacto| <= N
    // (post - control). La cota práctica incluye el margen de seguridad:
    //     |impact| <= N * (VALUE_MAX - VALUE_MIN) * IMPACT_SAFETY_FACTOR
    //              = N * 1 * 1.05  (ver NIRA.impactRangeBound).
    // La razón de no usar un número fijo (p. ej. 10): en una red larga
    // saturada el impacto ESCALA con N y la cota debe acompañarlo.
    var maxAbs = Math.max.apply(null, results.map(function(r){ return Math.abs(r.impact); }));
    var impactBound = NIRA.impactRangeBound(results.length); // resultados = 1 por nodo
    check(maxAbs <= impactBound, "|impact| <= N*(VALUE_MAX-VALUE_MIN)*1.05 = " + impactBound.toFixed(2) +
                                 " (N=" + results.length + ", maxAbs=" + maxAbs.toFixed(3) + ")");
    check(maxAbs <= results.length * 1.05, "|impact| <= N*1.05 (N=" + results.length +
                                            ", maxAbs=" + maxAbs.toFixed(3) + ")");
    check(maxAbs > 0.01, "ranking conserva discriminación tras el clamp (maxAbs=" + maxAbs.toFixed(3) + " > 0.01)");

    // (c) Opción A (derrame): recomputar manualmente el impacto del mejor
    //     nodo y compararlo con el reportado, usando la métrica de derrame
    //     (excluye el nodo diana del puntaje, en post y en control):
    //       impact = (Σ_post - postValue_diana) - (Σ_control - controlValue_diana)
    var userState = NIRA.snapshot(loopy); // estado del usuario (ya restaurado)
    var target = results[0];
    var targetIdx = model.nodes.indexOf(target.node);
    loopy.mode = Loopy.MODE_PLAY;
    NIRA._resetSimState();
    NIRA.runSimulationUntilStable(loopy, 2000, 0.001, 5); // control
    var baseScore = NIRA.totalScore(model);                 // Σ_control (todos)
    var controlValueDiana = model.nodes[targetIdx].value;   // controlValue_diana
    NIRA.restore(loopy, userState);
    loopy.mode = Loopy.MODE_PLAY;
    NIRA._resetSimState();
    target.node.takeSignal({ delta: 1 }); // misma intervención que el batch
    NIRA.runSimulationUntilStable(loopy, 2000, 0.001, 5);
    var postScore = NIRA.totalScore(model);                 // Σ_post (todos)
    var postValueDiana = model.nodes[targetIdx].value;      // postValue_diana
    var recomputed = (postScore - postValueDiana) - (baseScore - controlValueDiana);
    closeTo(recomputed, target.impact, 1e-9, "impacto de derrame recomputado == impacto reportado (excluye diana)");
    // Devolver el estado del usuario exactamente
    NIRA.restore(loopy, userState);
    loopy.mode = Loopy.MODE_EDIT;

    // (c) DERARAME discrimina por topología: los impactos NO son todos
    //     idénticos. Este es el fix del ranking plano: antes, en una red
    //     conectada, +1 en cualquier nodo saturaba toda la componente y
    //     todos daban el mismo impacto; al excluir el nodo diana queda
    //     solo la propagación al resto, que sí difiere por conectividad.
    //     Comprobamos que el rango (max - min) de los derrames supera un
    //     umbral pequeño.
    var minImp = Math.min.apply(null, results.map(function(r){ return r.impact; }));
    var spread = maxAbs - minImp;
    check(spread > 0.05, "derrames discriminan por topología (rango max-min=" + spread.toFixed(3) + " > 0.05)");

    // Estado restaurado exactamente
    closeTo(model.nodes[0].value, preValues[0], 0, "value[0] restaurado");
    closeTo(model.nodes[7].value, preValues[7], 0, "value[7] restaurado");
    check(loopy.mode === Loopy.MODE_EDIT, "modo restaurado a EDIT");
    check(loopy._niraRunning === false, "_niraRunning limpiado");
    check(NIRA.running === false, "NIRA.running limpiado");
    check(loopy.showImpact === true, "showImpact activado tras completar");
    check(loopy.toolbar.dom.style.pointerEvents !== "none", "pointer events restaurados");
    check(Edge.allSignals.length === preAllSignals, "señales restauradas exactas (" + preAllSignals + ")");

    // node.impact (auras) SOLO en el top 5 del ranking: los 5 primeros
    // llevan su impactNormalized, el resto queda en 0. El ranking (results
    // con impactNormalized) sigue incluyendo TODOS los nodos.
    var impactOK = true;
    for(var i=0;i<nodes.length;i++){
        var ci = nodes[i].impact;
        if(ci === undefined || isNaN(ci) || ci < 0 || ci > 1) impactOK = false;
    }
    for(var j=0;j<results.length;j++){
        var expected = (j < 5) ? results[j].impactNormalized : 0;
        if(Math.abs(results[j].node.impact - expected) > 1e-9) impactOK = false;
    }
    // El nodo con |impact| máximo debe normalizar a 1
    var topPerNode = results.filter(function(r){ return Math.abs(r.impact) === maxAbs; });
    for(var k=0;k<topPerNode.length;k++){
        if(topPerNode[k].impactNormalized < 0.999) impactOK = false;
    }
    check(impactOK, "node.impact asignado 0..1 coherente con el ranking");
    // Auras top-5: exactamente 5 nodos con impact > 0 (los 5 primeros del
    // ranking) y el resto con impact === 0; los no nulos corresponden a los
    // top-5 por impactNormalized.
    var withAura = nodes.filter(function(n){ return n.impact > 0; });
    check(withAura.length === 5, "exactamente 5 nodos con aura (impact > 0) (" + withAura.length + ")");
    var auraSetOK = true;
    for(var m=0;m<5;m++){
        if(results[m].node.impact <= 0) auraSetOK = false;
        if(Math.abs(results[m].node.impact - results[m].impactNormalized) > 1e-9) auraSetOK = false;
    }
    for(var m=5;m<results.length;m++){
        if(results[m].node.impact !== 0) auraSetOK = false;
    }
    check(auraSetOK, "auras = top-5 del ranking (resto impact === 0)");

    // Snapshot del usuario (un segundo analyze sobre estado limpio) funciona
    check(progressCalls > 5, "callback de progreso llamado (" + progressCalls + ")");
})();

// ============================================================
// TEST 4: antirreentrada + red vacía
// ============================================================
console.log("\n[TEST 4] antirreentrada y red vacía");
(function(){
    var loopy = new Loopy._ctor();
    var model = new StubModel(loopy);
    loopy.model = model;
    var a = model.addNode({id:1, label:"A"});
    var b = model.addNode({id:2, label:"B"});
    model.addEdge({from:a, to:b, strength:0.5});

    var callCount = 0;
    NIRA.running = true; // simular análisis en curso
    NIRA.analyze(loopy, { onComplete: function(){ callCount++; } });
    check(callCount === 0, "analyze rehusado mientras NIRA.running==true");
    NIRA.running = false;

    // Red vacía -> onError
    var empty = new Loopy._ctor();
    empty.model = new StubModel(empty);
    var errMsg = null;
    NIRA.running = false;
    NIRA.analyze(empty, { onError: function(m){ errMsg = m; } });
    check(errMsg !== null, "red vacía -> onError: " + errMsg);
    check(NIRA.running === false, "flag limpio tras red vacía");
})();

// ============================================================
// TEST 5: clamp mantiene valores acotados en red explosiva
// ============================================================
console.log("\n[TEST 5] clamp en red explosiva (realimentación fuerte)");
(function(){
    var loopy = new Loopy._ctor();
    var model = new StubModel(loopy);
    loopy.model = model;
    var labels = ["A","B","C","D","E"];
    var nodes = [];
    for(var i=0;i<5;i++){
        nodes.push(model.addNode({id:i+1, label:labels[i], init:0.1, hue:i}));
    }
    // Bucles fuertes: self-loop (realimentación propia) + aristas
    // bidireccionales con fuerza máxima. Sin clamp esto explotaría a
    // impactos de cientos de miles (Node.bound() es no-op).
    for(var i=0;i<5;i++){
        model.addEdge({from:nodes[i], to:nodes[i], strength:1.7}); // self-loop
        for(var j=i+1;j<5;j++){
            model.addEdge({from:nodes[i], to:nodes[j], strength:1.0});
            model.addEdge({from:nodes[j], to:nodes[i], strength:1.0});
        }
    }
    var done = false;
    var boundViolations = 0;
    var results = null;
    NIRA.analyze(loopy, {
        onProgress: function(){
            for(var i=0;i<model.nodes.length;i++){
                var v = model.nodes[i].value;
                if(v < NIRA.VALUE_MIN - 1e-9 || v > NIRA.VALUE_MAX + 1e-9) boundViolations++;
            }
        },
        onComplete: function(r){ results = r; done = true; },
        onError: function(m){ console.log("  ERROR: " + m); done = true; }
    });
    check(done && !!results, "analyze completó en red explosiva");
    if(!results){
        console.log("  ABORT: sin resultados");
        return;
    }
    // (a) jamás se excede el rango durante todo el batch
    check(boundViolations === 0, "valores nunca excedieron [VALUE_MIN,VALUE_MAX] (violaciones=" + boundViolations + ")");
    // Impactos finitos (nada de Infinity/NaN)
    var finiteImpacts = true;
    for(var i=0;i<results.length;i++){
        if(!isFinite(results[i].impact) || isNaN(results[i].impact)) finiteImpacts = false;
    }
    check(finiteImpacts, "todos los impactos finitos (sin Infinity/NaN)");
    // Límite teórico del clamp: cada nodo en [VALUE_MIN, VALUE_MAX] = [0,1]
    // => por nodo |post - control| <= (VALUE_MAX - VALUE_MIN) = 1;
    // 5 nodos => cota práctica NIRA.impactRangeBound(5) = 5*1*1.05 = 5.25
    // (y |impacto| <= N = 5 por el techo de Σ values con nodos en [0,1]).
    var maxAbs = Math.max.apply(null, results.map(function(r){ return Math.abs(r.impact); }));
    var impactBound = NIRA.impactRangeBound(nodes.length);
    check(maxAbs <= impactBound, "|impact| <= NIRA.impactRangeBound(N) = " + impactBound.toFixed(2) +
                                 " (N=" + nodes.length + ", maxAbs=" + maxAbs.toFixed(3) + ")");
    check(maxAbs <= nodes.length * 1.05, "|impact| <= N*1.05 (N=" + nodes.length +
                                          ", maxAbs=" + maxAbs.toFixed(3) + ")");
    // (d) estado del usuario restaurado exacto
    var valsOK = true;
    for(var j=0;j<model.nodes.length;j++){
        if(Math.abs(model.nodes[j].value - 0.1) > 1e-9) valsOK = false;
    }
    check(valsOK, "valores restaurados exactos (init 0.1)");
    check(Edge.allSignals.length === 0, "sin señales residuales");
    check(loopy.mode === Loopy.MODE_EDIT, "modo restaurado a EDIT");
    check(NIRA.running === false, "NIRA.running limpiado");
})();

// ============================================================
// TEST 6: el derrame discrimina por topología (cadena dirigida)
// ============================================================
console.log("\n[TEST 6] derrame discrimina por topología (cadena dirigida)");
(function(){
    var loopy = new Loopy._ctor();
    var model = new StubModel(loopy);
    loopy.model = model;
    // Cadena DIRIGIDA A->B->C->D->E con rama C->F. In all init 0.1.
    // En la física de LOOPY un nodo solo cambia cuando RECIBE una señal
    // (takeSignal) y no hay aristas de retorno => no hay realimentación.
    // Por tanto, intervenir un nodo aguas arriba satura solo a los nodos
    // DESCENDIENTES: el derrame depende de cuánta "cuenca" queda debajo.
    // Un nodo SUMIDERO (E, F: sin aristas salientes) no propaga a nadie:
    // su derrame es ~0. El nodo de ramificación C alcanza a D, E y F
    // (más cuenca), así que su derrame es el mayor. Esto legitima el fix
    // del ranking plano: era pura topología, no el +1 ni el init.
    var A = model.addNode({id:1, label:"A", init:0.1, hue:0});
    var B = model.addNode({id:2, label:"B", init:0.1, hue:1});
    var C = model.addNode({id:3, label:"C", init:0.1, hue:2});
    var D = model.addNode({id:4, label:"D", init:0.1, hue:3});
    var E = model.addNode({id:5, label:"E", init:0.1, hue:4});
    var F = model.addNode({id:6, label:"F", init:0.1, hue:5});
    model.addEdge({from:A, to:B, strength:0.5});
    model.addEdge({from:B, to:C, strength:0.5});
    model.addEdge({from:C, to:D, strength:0.5});
    model.addEdge({from:D, to:E, strength:0.5});
    model.addEdge({from:C, to:F, strength:0.5});

    var done = false;
    var results = null;
    NIRA.analyze(loopy, {
        onComplete: function(r){ results = r; done = true; },
        onError: function(m){ console.log("  ERROR: " + m); done = true; }
    });
    check(done && !!results, "analyze completó en cadena dirigida");
    if(!results){
        console.log("  ABORT: sin resultados");
        return;
    }
    console.log("  ranking (label: impact): " + results.map(function(r){ return r.label + ":" + r.impact.toFixed(3); }).join("  "));

    var byNode = {};
    for(var j=0;j<results.length;j++) byNode[results[j].label] = results[j];
    // Los nodos sumidero E y F (sin aristas salientes) NO propagan a nadie:
    // intervenir +1 en ellos no cambia el resto del sistema => derrame ~0.
    closeTo(byNode["E"].impact, 0, 1e-6, "derrame(E) ~ 0 (sumidero sin aristas salientes)");
    closeTo(byNode["F"].impact, 0, 1e-6, "derrame(F) ~ 0 (sumidero sin aristas salientes)");
    // El nodo de ramificación C alcanza la mayor cuenca descendente: debe
    // ser estrictamente el de mayor derrame de todos.
    var maxImp = Math.max.apply(null, results.map(function(r){ return r.impact; }));
    check(byNode["C"] && Math.abs(byNode["C"].impact - maxImp) < 1e-9 &&
          results[0].node === C, "derrame(C) es el mayor (ramificación, mayor cuenca)");

    // Los derrames NO son todos idénticos: el fix del ranking plano. Antes,
    // en una red conectada, +1 saturaba toda la componente y todos daban el
    // mismo impacto; ahora la exclusión del nodo diana deja solo la
    // propagación al resto, que difiere por conectividad (rango amplio).
    var minImp = Math.min.apply(null, results.map(function(r){ return r.impact; }));
    check(maxImp - minImp > 0.05, "derrames discriminan por topología (rango max-min=" + (maxImp-minImp).toFixed(3) + " > 0.05)");
    var distinct = true;
    for(var k=1;k<results.length;k++){
        if(Math.abs(results[k].impact - results[0].impact) < 1e-6) distinct = false;
    }
    check(distinct, "derrames no todos idénticos (hay separación real entre valores)");

    // Estado restaurado exacto + sin señales
    check(loopy.mode === Loopy.MODE_EDIT, "modo restaurado a EDIT");
    check(NIRA.running === false, "NIRA.running limpiado");
    check(Edge.allSignals.length === 0, "sin señales residuales");
})();

// ============================================================
console.log("\n==================================");
if(failures > 0){
    console.log("RESULTADO: " + failures + " FALLOS");
    process.exit(1);
}else{
    console.log("RESULTADO: TODO OK");
}