/**********************************

MODEL!

**********************************/

// MOLAR: Variable global infalible para detectar CTRL en el momento exacto del click
window._isCtrlPressedDuringClick = false;
document.addEventListener("mousedown", function(e) {
    window._isCtrlPressedDuringClick = e.ctrlKey || e.metaKey;
});

function Model(loopy){

    var self = this;
    self.loopy = loopy;

    // Properties
    self.speed = 0.05;
    self.tickCount = 0; // ←
    // MOLAR: Historial de molares desagrupados (para resolver referencias rotas)
    self.molarHistory = {};

    // Create canvas & context
    var canvas = _createCanvas();
    var ctx = canvas.getContext("2d");
    self.canvas = canvas;
    self.context = ctx;

    // MOLAR: Capturar información de teclas modificadoras en cada click
    var _lastMouseEvent = null;
    document.addEventListener("mousedown", function(event) {
        window._isCtrlPressedDuringClick = event.ctrlKey || event.metaKey;
    });
    document.addEventListener("mouseup", function() {
        window._isCtrlPressedDuringClick = false; // Limpiar al soltar
    });

    ///////////////////
    // NODES //////////
    ///////////////////

    // Nodes
    self.nodes = [];
    self.nodeByID = {};
    self.getNode = function(id){
        return self.nodeByID[id];
    };

    // Remove Node
    self.addNode = function(config){

        // Model's been changed!
        publish("model/changed");

        // Add Node
        var node = new Node(self,config);
        self.nodeByID[node.id] = node;
        self.nodes.push(node);
        self.update();
        return node;

    };

    // Remove Node
    self.removeNode = function(node){

        // Model's been changed!
        publish("model/changed");

        // Remove from array
        self.nodes.splice(self.nodes.indexOf(node),1);

        // Remove from object
        delete self.nodeByID[node.id];

        // Remove all associated TO and FROM edges
        for(var i=0; i<self.edges.length; i++){
            var edge = self.edges[i];
            if(edge.to==node || edge.from==node){
                edge.kill();
                i--; // move index back, coz it's been killed
            }
        }
        
    };

// ==========================================
// MOLAR: Resolver referencias a nodos que fueron molares ya desagrupados
// y redirigir aristas si los nodos originales siguen ocultos en otros molares.
// ==========================================
self._resolveEdgeRef = function(saved) {
    var fromNode = self.getNode(saved.from);
    var toNode = self.getNode(saved.to);
    
    // Función auxiliar: si un nodo está oculto, encontrar el ID del molar que lo contiene
    var _redirectIfHidden = function(nodeId) {
        var node = self.getNode(nodeId);
        if (node && node.hidden) {
            for (var i = 0; i < self.nodes.length; i++) {
                var n = self.nodes[i];
                if (n.isMolar && n.children && n.children.indexOf(nodeId) !== -1) {
                    return n.id; // Redirigir al molar activo
                }
            }
        }
        return nodeId; // No está oculto, devolver el ID tal cual
    };
    
    // Caso 1: ambos nodos existen en el modelo → redirigir si están ocultos
    if (fromNode && toNode) {
        var actualFrom = _redirectIfHidden(saved.from);
        var actualTo = _redirectIfHidden(saved.to);
        if (actualFrom !== actualTo) {
            return [{ from: actualFrom, to: actualTo, strength: saved.strength, arc: saved.arc, rotation: saved.rotation }];
        }
        return [];
    }
    
    // Caso 2: 'from' existe, 'to' fue un molar ya desagrupado
    if (fromNode && !toNode && self.molarHistory[saved.to]) {
        var history = self.molarHistory[saved.to];
        var results = [];
        history.savedEdges.forEach(function(he) {
            if (he.from === saved.from && history.children.indexOf(he.to) !== -1) {
                var actualFrom = _redirectIfHidden(he.from);
                var actualTo = _redirectIfHidden(he.to);
                if (actualFrom !== actualTo) {
                    results.push({ from: actualFrom, to: actualTo, strength: he.strength, arc: he.arc, rotation: he.rotation || 0 });
                }
            }
        });
        return results;
    }
    
    // Caso 3: 'from' fue un molar ya desagrupado, 'to' existe
    if (!fromNode && toNode && self.molarHistory[saved.from]) {
        var history = self.molarHistory[saved.from];
        var results = [];
        history.savedEdges.forEach(function(he) {
            if (history.children.indexOf(he.from) !== -1 && he.to === saved.to) {
                var actualFrom = _redirectIfHidden(he.from);
                var actualTo = _redirectIfHidden(he.to);
                if (actualFrom !== actualTo) {
                    results.push({ from: actualFrom, to: actualTo, strength: he.strength, arc: he.arc, rotation: he.rotation || 0 });
                }
            }
        });
        return results;
    }
    
    // Caso 4: ambos fueron molares ya desagrupados
    if (!fromNode && !toNode && self.molarHistory[saved.from] && self.molarHistory[saved.to]) {
        var fromHistory = self.molarHistory[saved.from];
        var toHistory = self.molarHistory[saved.to];
        var results = [];
        fromHistory.savedEdges.forEach(function(he) {
            if (fromHistory.children.indexOf(he.from) !== -1 && toHistory.children.indexOf(he.to) !== -1) {
                var actualFrom = _redirectIfHidden(he.from);
                var actualTo = _redirectIfHidden(he.to);
                if (actualFrom !== actualTo) {
                    results.push({ from: actualFrom, to: actualTo, strength: he.strength, arc: he.arc, rotation: he.rotation || 0 });
                }
            }
        });
        return results;
    }
    
    // Si no se puede resolver de ninguna manera, devolver array vacío
    return [];
};

// ==========================================
// MOLAR: Agrupación de Nodos (Versión Corregida y Blindada)
// ==========================================

self.groupNodes = function(nodeArray) {
    if (!nodeArray || nodeArray.length < 2) return;
    if(loopy.saveUndo) loopy.saveUndo();
    
    // 1. APLANAMIENTO: Evita grupos anidados como ((AB)C)
    var finalNodesToGroup = [];
    var molarsToDestroy = [];
    
    nodeArray.forEach(function(n) {
        if (n.isMolar && n.children) {
            molarsToDestroy.push(n);
            n.children.forEach(function(childId) {
                var child = self.getNode(childId);
                if (child && !child.hidden) {
                    finalNodesToGroup.push(child);
                }
            });
        } else {
            finalNodesToGroup.push(n);
        }
    });
    
    // Eliminar duplicados
    finalNodesToGroup = finalNodesToGroup.filter(function(item, pos) {
        return finalNodesToGroup.indexOf(item) == pos;
    });
    
    if (finalNodesToGroup.length < 2) return;

    // 2. Calcular centroide
    var sumX = 0, sumY = 0;
    finalNodesToGroup.forEach(function(n) { sumX += n.x; sumY += n.y; });
    
    // 3. Crear el nodo molar USANDO addNode (que devuelve el nodo real del modelo)
    var molar = self.addNode({
        x: sumX / finalNodesToGroup.length,
        y: sumY / finalNodesToGroup.length,
        label: "?",
        hue: finalNodesToGroup[0].hue,
        borderWidth: 12
    });
    
    // 4. ASIGNAR PROPIEDADES PERSONALIZADAS AL NODO REAL DEVUELTO POR addNode
    molar.isMolar = true;
    molar.children = [];
    molar.savedEdges = [];
    
    // 5. Ocultar hijos y registrar sus IDs en el molar real
    var childIds = finalNodesToGroup.map(function(n) { 
        n.hidden = true; 
        return n.id; 
    });
    molar.children = childIds.slice(); // ¡Ahora sí se guarda en el nodo correcto!
    
    // 6. GESTIONAR ARISTAS: Preservar internas, agregar Interruptor Maestro, y eliminar externas
    var edgesToKill = [];
    
    self.edges.forEach(function(edge) {
        var fromIsChild = childIds.indexOf(edge.from.id) !== -1;
        var toIsChild = childIds.indexOf(edge.to.id) !== -1;
        
        // A. Guardamos TODA arista que toque un hijo en el historial (para desagrupar después)
        if (fromIsChild || toIsChild) {
            molar.savedEdges.push({
                from: edge.from.id,
                to: edge.to.id,
                strength: edge.strength,
                arc: edge.arc,
                rotation: edge.rotation || 0
            });
        }
        
        // B. PERO solo marcamos para eliminar las que van HACIA AFUERA del grupo.
        // Si ambas son hijos (fromIsChild && toIsChild), NO la matamos. Se preserva la resonancia interna.
        if (fromIsChild !== toIsChild) {
            edgesToKill.push(edge);
        }
    });

    // 7. EL INTERRUPTOR MAESTRO (NUEVO): Conectar el Molar a sus hijos para activarlos
    // Esto asegura que cuando NIRA interviene el molar, la señal se distribuya a los hijos
    childIds.forEach(function(childId) {
        self.addEdge({
            from: molar.id,
            to: childId,
            strength: 1.0, // Fuerza máxima para asegurar que el hijo se active
            signal: 1.0,   // ¡Clave para que la señal viaje del molar al hijo!
            arc: 0,
            rotation: 0
        });
    });

    // 8. Ejecutar eliminaciones y aplanamiento
    edgesToKill.forEach(function(e) { e.kill(); });
    
    molarsToDestroy.forEach(function(oldMolar) {
        oldMolar.kill();
    });
    
    // 9. Crear aristas simplificadas VISUALES hacia el exterior
    var edgeMap = {};
    molar.savedEdges.forEach(function(se) {
        var isChildOutgoing = (childIds.indexOf(se.from) !== -1);
        var externalId = isChildOutgoing ? se.to : se.from;
        
        // Solo nos interesan las conexiones hacia fuera del grupo
        if (childIds.indexOf(externalId) === -1) {
            var key = externalId + '_' + (isChildOutgoing ? 'out' : 'in');
            if (!edgeMap[key]) {
                edgeMap[key] = { externalId: externalId, isOutgoing: isChildOutgoing, totalStrength: 0, count: 0 };
            }
            edgeMap[key].totalStrength += se.strength;
            edgeMap[key].count += 1;
        }
    });
    
    var arcCounter = {};
    for (var key in edgeMap) {
        var group = edgeMap[key];
        var pairKey = Math.min(molar.id, group.externalId) + '_' + Math.max(molar.id, group.externalId);
        if (!arcCounter[pairKey]) arcCounter[pairKey] = 0;
        
        var safeArc = 0;
        if (arcCounter[pairKey] === 0) safeArc = 1;
        else if (arcCounter[pairKey] === 1) safeArc = -1;
        else safeArc = arcCounter[pairKey];
        arcCounter[pairKey]++;
        
        var clampedStrength = Math.max(-2, Math.min(2, group.totalStrength));
        
        self.addEdge({
            from: group.isOutgoing ? molar.id : group.externalId,
            to: group.isOutgoing ? group.externalId : molar.id,
            strength: clampedStrength,
            signal: clampedStrength, // <-- Esto ya lo tenías, ¡perfecto!
            arc: safeArc,
            rotation: 0
        });
    }
    
    publish("model/changed");
    return molar;
};

// ==========================================
// FUNCIONES FALTANTES DE AGRUPACIÓN
// ==========================================

// ==========================================
// MOLAR: Quitar un solo nodo de un grupo (Botón "X" en el Sidebar)
// ==========================================
self.removeNodeFromGroup = function(molarNode, childNode) {
    if (!molarNode || !molarNode.isMolar || !childNode) return;
    if(loopy.saveUndo) loopy.saveUndo();
    
    var idx = molarNode.children.indexOf(childNode.id);
    if (idx === -1) return;
    
    // 1. Quitar el hijo del array del molar
    molarNode.children.splice(idx, 1);
    
    // 2. Hacer visible al hijo y resetear su valor
    childNode.hidden = false;
    childNode.value = childNode.init;
    
    // 3. Si el molar queda con 0 o 1 hijo, se auto-destruye (desagrupa todo)
    if (molarNode.children.length <= 1) {
        if (molarNode.children.length === 1) {
            var lastChildId = molarNode.children[0];
            var lastChild = self.getNode(lastChildId);
            if (lastChild) {
                lastChild.hidden = false;
                lastChild.value = lastChild.init;
            }
            molarNode.children = [];
        }
        self.ungroupNode(molarNode);
        return;
    }
    
    // 4. Si aún quedan 2 o más hijos, debemos recalcular las aristas
    // Matamos las aristas actuales del molar para recalcularlas
    var edgesToRemove = self.edges.filter(function(edge) {
        return edge.from.id === molarNode.id || edge.to.id === molarNode.id;
    });
    edgesToRemove.forEach(function(edge) { edge.kill(); });
    
    // Filtramos las aristas guardadas: separamos las que eran del hijo que sacamos
    var newSavedEdges = [];
    var restoredEdgesForChild = [];
    
    molarNode.savedEdges.forEach(function(se) {
        var involvesExtractedChild = (se.from === childNode.id || se.to === childNode.id);
        var involvesOtherChild = (molarNode.children.indexOf(se.from) !== -1 || molarNode.children.indexOf(se.to) !== -1);
        
        if (involvesExtractedChild && !involvesOtherChild) {
            // Era una arista externa exclusiva del hijo que sacamos. La restauramos directamente.
            restoredEdgesForChild.push(se);
        } else {
            // Sigue siendo parte del molar (interna entre los restantes, o externa de otro hijo)
            newSavedEdges.push(se);
        }
    });
    
    molarNode.savedEdges = newSavedEdges;
    
    // Restaurar las aristas del hijo liberado
    restoredEdgesForChild.forEach(function(se) {
        var fromNode = self.getNode(se.from);
        var toNode = self.getNode(se.to);
        if (fromNode && toNode) {
            // Si el otro extremo está oculto (en otro molar), redirigir
            var actualFrom = fromNode.hidden ? (self._findMolarContaining(fromNode.id) || fromNode).id : fromNode.id;
            var actualTo = toNode.hidden ? (self._findMolarContaining(toNode.id) || toNode).id : toNode.id;
            
            if (actualFrom !== actualTo) {
                var edgeExists = self.edges.some(function(e) {
                    return e.from.id === actualFrom && e.to.id === actualTo;
                });
                if (!edgeExists) {
                    self.addEdge({
                        from: actualFrom, to: actualTo,
                        strength: se.strength, arc: se.arc, rotation: se.rotation || 0
                    });
                }
            }
        }
    });
    
    // Recrear las aristas externas del MOLAR (con los hijos restantes)
    var edgeMap = {};
    molarNode.savedEdges.forEach(function(se) {
        var fromIsChild = molarNode.children.indexOf(se.from) !== -1;
        var toIsChild = molarNode.children.indexOf(se.to) !== -1;
        
        if (fromIsChild !== toIsChild) {
            var isChildOutgoing = fromIsChild;
            var externalId = isChildOutgoing ? se.to : se.from;
            var key = externalId + '_' + (isChildOutgoing ? 'out' : 'in');
            if (!edgeMap[key]) {
                edgeMap[key] = { externalId: externalId, isOutgoing: isChildOutgoing, totalStrength: 0 };
            }
            edgeMap[key].totalStrength += se.strength;
        }
    });
    
    var arcCounter = {};
    for (var key in edgeMap) {
        var group = edgeMap[key];
        var pairKey = Math.min(molarNode.id, group.externalId) + '_' + Math.max(molarNode.id, group.externalId);
        if (!arcCounter[pairKey]) arcCounter[pairKey] = 0;
        
        var safeArc = 0;
        if (arcCounter[pairKey] === 0) safeArc = 1;
        else if (arcCounter[pairKey] === 1) safeArc = -1;
        else safeArc = arcCounter[pairKey];
        arcCounter[pairKey]++;
        
        var clampedStrength = Math.max(-2, Math.min(2, group.totalStrength));
        
        self.addEdge({
            from: group.isOutgoing ? molarNode.id : group.externalId,
            to: group.isOutgoing ? group.externalId : molarNode.id,
            strength: clampedStrength,
            arc: safeArc,
            rotation: 0
        });
    }
    
    // 5. Restaurar el Interruptor Maestro para los hijos restantes
    molarNode.children.forEach(function(cId) {
        var exists = self.edges.some(function(e) {
            return e.from.id === molarNode.id && e.to.id === cId;
        });
        if (!exists) {
            self.addEdge({
                from: molarNode.id,
                to: cId,
                strength: 1.0,
                arc: 0,
                rotation: 0
            });
        }
    });

    publish("model/changed");
};

self.ungroupNode = function(molarNode) {
    if (!molarNode || !molarNode.isMolar) return;
    if(loopy.saveUndo) loopy.saveUndo();
    
    // GUARDAR EN HISTORIAL antes de eliminar (para resolver referencias rotas futuras)
    if (!self.molarHistory) self.molarHistory = {};
    self.molarHistory[molarNode.id] = {
        children: molarNode.children ? molarNode.children.slice() : [],
        savedEdges: molarNode.savedEdges ? molarNode.savedEdges.slice() : []
    };
    
    // 1. Hacer visibles los hijos
    if (molarNode.children && molarNode.children.length > 0) {
        molarNode.children.forEach(function(childId) {
            var child = self.getNode(childId);
            if (child) {
                child.hidden = false;
                child.value = child.init;
            }
        });
    }
    
    // 2. Eliminar las aristas actuales del molar
    var edgesToRemove = self.edges.filter(function(edge) {
        return edge.from.id === molarNode.id || edge.to.id === molarNode.id;
    });
    edgesToRemove.forEach(function(edge) { edge.kill(); });
    
    // 3. Restaurar aristas usando el resolvedor de referencias
    if (molarNode.savedEdges && molarNode.savedEdges.length > 0) {
       molarNode.savedEdges.forEach(function(saved) {
           var resolvedEdges = self._resolveEdgeRef(saved);
           resolvedEdges.forEach(function(re) {
               var edgeExists = self.edges.some(function(e) {
                   return e.from.id === re.from && e.to.id === re.to;
               });
               if (!edgeExists) {
                   var safeArc = re.arc;
                   if (Math.abs(safeArc) < 2) safeArc = safeArc >= 0 ? 2 : -2;
                   self.addEdge({
                       from: re.from, to: re.to,
                       strength: re.strength, arc: safeArc, rotation: re.rotation || 0
                   });
               }
           });
       });
   }
    
    // 4. Limpiar selección del molar
    self.loopy.selectedNodes = self.loopy.selectedNodes.filter(function(n) {
        return n && n.id !== molarNode.id;
    });
    
    // 5. Eliminar el molar
    molarNode.kill();
    publish("model/changed");
};

// Función auxiliar
self._findMolarContaining = function(nodeId) {
    for (var i = 0; i < self.nodes.length; i++) {
        var n = self.nodes[i];
        if (n.isMolar && n.children && n.children.indexOf(nodeId) !== -1) {
            return n;
        }
    }
    return null;
};

// ==========================================

    ///////////////////
    // EDGES //////////
    ///////////////////

    // Edges
    self.edges = [];

    // Remove edge
    self.addEdge = function(config){

        // Model's been changed!
        publish("model/changed");

        // Add Edge
        var edge = new Edge(self,config);
        self.edges.push(edge);
        self.update();
        return edge;
    };

    // Remove edge
    self.removeEdge = function(edge){

        // Model's been changed!
        publish("model/changed");

        // Remove edge
        self.edges.splice(self.edges.indexOf(edge),1);

    };

    // Get all edges with start node
    self.getEdgesByStartNode = function(startNode){
        return self.edges.filter(function(edge){
            return(edge.from==startNode);
        });
    };




    ///////////////////
    // LABELS /////////
    ///////////////////

    // Labels
    self.labels = [];

    // Remove label
    self.addLabel = function(config){

        // Model's been changed!
        publish("model/changed");

        // Add label
        var label = new Label(self,config);
        self.labels.push(label);
        self.update();
        return label;
    };

    // Remove label
    self.removeLabel = function(label){

        // Model's been changed!
        publish("model/changed");

        // Remove label
        self.labels.splice(self.labels.indexOf(label),1);
        
    };



    ///////////////////
    // UPDATE & DRAW //
    ///////////////////

    var _canvasDirty = false;
    self.update = function(){

        // Update edges THEN nodes
        for(var i=0;i<self.edges.length;i++) self.edges[i].update(self.speed);
        for(var i=0;i<self.nodes.length;i++) self.nodes[i].update(self.speed);

        // Dirty!
        _canvasDirty = true;

    };

    // SHOULD WE DRAW?
    var drawCountdownFull = 60; // two-second buffer!
    var drawCountdown = drawCountdownFull; 
    
    // ONLY IF MOUSE MOVE / CLICK
    subscribe("mousemove", function(){ drawCountdown=drawCountdownFull; });
    subscribe("mousedown", function(){ drawCountdown=drawCountdownFull; });

    // OR INFO CHANGED
    subscribe("model/changed", function(){
        if(self.loopy.mode==Loopy.MODE_EDIT) drawCountdown=drawCountdownFull;
        if(self.loopy.showCentrality){
            self.calculateCentrality();
            drawCountdown=drawCountdownFull;
        }
    });

    // OR RESIZE or RESET
    subscribe("view/changed", function(){
        _canvasDirty = true;
        drawCountdown = drawCountdownFull;
    });
    subscribe("resize", function(){
        _canvasDirty = true;
        drawCountdown = drawCountdownFull;
    });
    subscribe("model/reset",function(){ drawCountdown=drawCountdownFull; });
    subscribe("loopy/mode",function(){
        if(loopy.mode==Loopy.MODE_PLAY){
            drawCountdown=drawCountdownFull*2;
        }else{
            drawCountdown=drawCountdownFull;
        }
    });

    self.draw = function(){

        // SHOULD WE DRAW?
        // ONLY IF ARROW-SIGNALS ARE MOVING
        for(var i=0;i<self.edges.length;i++){
            if(self.edges[i].signals.length>0){
                drawCountdown = drawCountdownFull;
                break;
            }
        }

        // DRAW???????
        drawCountdown--;
        if(drawCountdown<=0) return;

        // Also only draw if last updated...
        if(!_canvasDirty) return;
        _canvasDirty = false;

        // Clear!
        ctx.clearRect(0,0,self.canvas.width,self.canvas.height);

        // Translate
        ctx.save();

        // Simple transform
        var s = loopy.offsetScale;
        ctx.setTransform(s, 0, 0, s, loopy.offsetX*2, loopy.offsetY*2);

        // Draw labels THEN edges THEN nodes
        for(var i=0;i<self.labels.length;i++) self.labels[i].draw(ctx);
        
        for(var i=0;i<self.edges.length;i++){
            var edge = self.edges[i];
            // === AGREGAR ESTA LÍNEA: No dibujar aristas si alguno de los nodos está oculto ===
            if (edge.from.hidden || edge.to.hidden) continue;
            edge.draw(ctx);
        }
        
        for(var i=0;i<self.nodes.length;i++){
            var node = self.nodes[i];
            if(node.hidden) continue; // MOLAR: no dibujar nodos ocultos
            node.draw(ctx);
        }

        // Restore
        ctx.restore();
    };




    //////////////////////////////
    // SERIALIZE & DE-SERIALIZE //
    //////////////////////////////

    self.serialize = function(){

        var data = [];
        // 0 - nodes
        // 1 - edges
        // 2 - labels
        // 3 - UID

        // Nodes
        var nodes = [];
        for(var i=0;i<self.nodes.length;i++){
            var node = self.nodes[i];
            // 0 - id
            // 1 - x
            // 2 - y
            // 3 - init value
            // 4 - label
            // 5 - hue
            // 6 - shape
            // 7 - hidden (1/0)
            // 8 - isMolar (1/0)
            // 9 - children (ids de nodos) o null
            // 10 - savedEdges o null
            // 11 - borderWidth (2 = normal)
            nodes.push([
                node.id,
                Math.round(node.x),
                Math.round(node.y),
                node.init,
                encodeURIComponent(encodeURIComponent(node.label)),
                node.hue,
                node.shape,
                node.hidden ? 1 : 0,
                node.isMolar ? 1 : 0,
                node.children ? node.children.map(function(c){ return (c && c.id!==undefined) ? c.id : c; }) : null,
                node.savedEdges || null,
                node.borderWidth || 2
            ]);
        }
        data.push(nodes);

        // Edges
        var edges = [];
        for(var i=0;i<self.edges.length;i++){
            var edge = self.edges[i];
            // 0 - from
            // 1 - to
            // 2 - arc
            // 3 - strength
            // 4 - rotation (optional)
            var dataEdge = [
                edge.from.id,
                edge.to.id,
                Math.round(edge.arc),
                edge.strength
            ];
            if(dataEdge.f==dataEdge.t){
                dataEdge.push(Math.round(edge.rotation));
            }
            edges.push(dataEdge);
        }
        data.push(edges);

        // Labels
        var labels = [];
        for(var i=0;i<self.labels.length;i++){
            var label = self.labels[i];
            // 0 - x
            // 1 - y
            // 2 - text
            labels.push([
                Math.round(label.x),
                Math.round(label.y),
                encodeURIComponent(encodeURIComponent(label.text))
            ]);
        }
        data.push(labels);

        // META.
        data.push(Node._UID);

        // GRID.
        data.push(self.loopy.showGrid ? 1 : 0);

        // Return as string!
        var dataString = JSON.stringify(data);
        dataString = dataString.replace(/"/gi, "%22"); // and ONLY URIENCODE THE QUOTES
        dataString = dataString.substr(0, dataString.length-1) + "%5D";// also replace THE LAST CHARACTER
        return dataString;

    };

    self.deserialize = function(dataString){

        self.clear();

        var data = JSON.parse(dataString);

        // Get from array!
        var nodes = data[0];
        var edges = data[1];
        var labels = data[2];
        var UID = data[3];
        var showGrid = data[4];

        // Nodes
        for(var i=0;i<nodes.length;i++){
            var node = nodes[i];
            self.addNode({
                id: node[0],
                x: node[1],
                y: node[2],
                init: node[3],
                label: decodeURIComponent(node[4]),
                hue: node[5],
                shape: node[6] || "circle",
                // MOLAR (Fase 1): campos nuevos, con defaults si no existen
                // (compatibilidad hacia atrás con archivos de 7 posiciones).
                hidden: !!node[7],
                isMolar: !!node[8],
                children: node[9] || null,
                savedEdges: node[10] || null,
                borderWidth: (node[11]===undefined) ? 2 : node[11]
            });
        }

        // MOLAR: pos-proceso con TODOS los nodos ya creados.
        // Sanear datos y asegurar que 'children' sea SIEMPRE un array de IDs.
        for(var i=0;i<self.nodes.length;i++){
            var n = self.nodes[i];
            if(n.isMolar && n.children && n.children.length>0){
                var resolved = [];
                var allAlive = true;
                for(var j=0;j<n.children.length;j++){
                    var child = self.nodeByID[n.children[j]];
                    if(!child){ allAlive = false; break; }
                    resolved.push(child);
                }
                if(!allAlive){
                    n.isMolar = false;
                    n.children = null;
                    n.savedEdges = null;
                    n.borderWidth = 2;
                }else{
                    // CLAVE: Mantener como array de IDs, no de objetos
                    n.children = resolved.map(function(childNode){ return childNode.id; });
                }
            }
        }
        for(var i=0;i<self.nodes.length;i++){
            var n = self.nodes[i];
            if(n.hidden){
                var ownedByMolar = false;
                for(var j=0;j<self.nodes.length;j++){
                    var m = self.nodes[j];
                    // CLAVE: buscar por n.id, no por el objeto n
                    if(m.isMolar && m.children && m.children.indexOf(n.id)!==-1){
                        ownedByMolar = true;
                        break;
                    }
                }
                if(!ownedByMolar) n.hidden = false;
            }
        }

        // Edges
        for(var i=0;i<edges.length;i++){
            var edge = edges[i];
            var edgeConfig = {
                from: edge[0],
                to: edge[1],
                arc: edge[2],
                strength: edge[3]
            };
            if(edge[4]) edgeConfig.rotation=edge[4];
            self.addEdge(edgeConfig);
        }

        // Labels
        for(var i=0;i<labels.length;i++){
            var label = labels[i];
            self.addLabel({
                x: label[0],
                y: label[1],
                text: decodeURIComponent(label[2])
            });
        }

        // META.
        Node._UID = UID;

        // GRID.
        self.loopy.showGrid = !!showGrid;
        publish("grid/toggle", [self.loopy.showGrid]);

    };

    self.clear = function(){
        // Just kill ALL nodes.
        while(self.nodes.length>0){
            self.nodes[0].kill();
        }
        // Just kill ALL labels.
        while(self.labels.length>0){
            self.labels[0].kill();
        }
        // MOLAR: Limpiar historial
        self.molarHistory = {};
    };

    self.newModel = function(){
        self.clear();
        Node._UID = 0;
        self.loopy.showGrid = false;
        self.molarHistory = {};
        publish("model/changed");
    };


    ////////////////////
    // HELPER METHODS //
    ////////////////////

    self.getNodeByPoint = function(x,y,buffer){
        var result;
        for(var i=self.nodes.length-1; i>=0; i--){ // top-down
            var node = self.nodes[i];
            if(node.hidden) continue; // MOLAR: nodos ocultos no son clicables
            if(node.isPointInNode(x,y,buffer)) return node;
        }
        return null;
    };

    self.getEdgeByPoint = function(x, y, wholeArrow){
        for(var i=self.edges.length-1; i>=0; i--){ // top-down
            var edge = self.edges[i];
            // First, check if the point is on the edge's label (existing behavior)
            if(edge.isPointOnLabel(x,y)) return edge;
            // Next, check if the point is on the edge's arc body via precise hitbox
            // Falls back gracefully if isPointInHitbox is unavailable on older edge objects
            if(typeof edge.isPointInHitbox === 'function' && edge.isPointInHitbox(x,y)) return edge;
        }
        return null;
    };

    self.getLabelByPoint = function(x, y){
        var result;
        for(var i=self.labels.length-1; i>=0; i--){ // top-down
            var label = self.labels[i];
            if(label.isPointInLabel(x,y)) return label;
        }
        return null;
    };

// Click/Double-click to edit!
var _editCallback = function(){

    // ONLY WHEN EDITING (and NOT erase)
    if(self.loopy.mode!=Loopy.MODE_EDIT) return;
    if(self.loopy.tool==Loopy.TOOL_ERASE) return;
    if(Key.space) return; // DON'T EDIT IF PANNING

    var isCtrlPressed = window._isCtrlPressedDuringClick || false;

    // Did you click on a node?
    var clickedNode = self.getNodeByPoint(Mouse.x, Mouse.y);
    if(clickedNode){
        // 1. Si es CTRL+Click: solo toggle, no abrir sidebar
        if (isCtrlPressed) {
            loopy.toggleSelected(clickedNode);
            return; 
        }
        
        // 2. Si el nodo YA ESTÁ seleccionado y hay más de 1 en total:
        // NO deseleccionamos nada. Solo abrimos el sidebar para editar el grupo.
        var isAlreadySelected = loopy.selectedNodes.indexOf(clickedNode) !== -1;
        if (isAlreadySelected && loopy.selectedNodes.length > 1) {
            loopy.sidebar.edit(clickedNode);
            return;
        }
        
        // 3. Si es un click normal en un nodo que NO está seleccionado (o es el único):
        // Comportamiento estándar: limpiamos todo, seleccionamos este y abrimos su sidebar.
        loopy.deselectAll();
        loopy.selectNode(clickedNode);
        loopy.sidebar.edit(clickedNode);
        return;
    }

    // Did you click on a label?
    var clickedLabel = self.getLabelByPoint(Mouse.x, Mouse.y);
    if(clickedLabel){
        loopy.deselectAll();
        loopy.sidebar.edit(clickedLabel);
        return;
    }

    // Did you click on an edge?
    var clickedEdge = self.getEdgeByPoint(Mouse.x, Mouse.y);
    if(clickedEdge){
        loopy.deselectAll();
        loopy.sidebar.edit(clickedEdge);
        return;
    }

    // Tool LABEL?
    if(self.loopy.tool==Loopy.TOOL_LABEL){
        loopy.deselectAll();
        loopy.label.tryMakingLabel();
        return;
    }

    // Click en canvas vacío
    loopy.deselectAll();
    loopy.sidebar.showPage("Edit");

};

    subscribe("mouseclick", function(){
        if(window.innerWidth > 768){
            _editCallback();
        } else {
            if(self.loopy.tool == Loopy.TOOL_LABEL || self.loopy.tool == Loopy.TOOL_DRAG || self.loopy.tool == Loopy.TOOL_INK) _editCallback();
        }
    });
    subscribe("mousedblclick", function(){
        if(window.innerWidth <= 768) _editCallback();
    });

    // Centering & Scaling
    self.getBounds = function(){

        // If no nodes & no labels, forget it.
        if(self.nodes.length==0 && self.labels.length==0) return;

        // Get bounds of ALL objects...
        var left = Infinity;
        var top = Infinity;
        var right = -Infinity;
        var bottom = -Infinity;
        var _testObjects = function(objects){
            for(var i=0; i<objects.length; i++){
                var obj = objects[i];
                var bounds = obj.getBoundingBox();
                if(left>bounds.left) left=bounds.left;
                if(top>bounds.top) top=bounds.top;
                if(right<bounds.right) right=bounds.right;
                if(bottom<bounds.bottom) bottom=bounds.bottom;
            }
        };
        _testObjects(self.nodes);
        _testObjects(self.edges);
        _testObjects(self.labels);

        // Return
            return {
                left:left,
                top:top,
                right:right,
                bottom:bottom
            };

        };

        self.maxCentrality = 0;
        self.centralityThreshold = 0;
        self.calculateCentrality = function(){

            // Reset node scores
            for(var i=0; i<self.nodes.length; i++){
                if(self.nodes[i].hidden) continue; // MOLAR: los ocultos no participan
                self.nodes[i].centrality = 0;
            }

            // Sum absolute edge strengths
            var maxCentrality = 0;
            for(var i=0; i<self.edges.length; i++){
                var edge = self.edges[i];
                if(edge.from.hidden || edge.to.hidden) continue; // MOLAR: aristas de/para ocultos no suman
                var strength = Math.abs(edge.strength);
                edge.from.centrality += strength;
                edge.to.centrality += strength;
            }

            // Find max centrality
            var scores = [];
            for(var i=0; i<self.nodes.length; i++){
                if(self.nodes[i].hidden) continue; // MOLAR: los ocultos no participan
                var c = self.nodes[i].centrality;
                scores.push(c);
                if(c > maxCentrality){
                    maxCentrality = c;
                }
            }
            self.maxCentrality = maxCentrality;

            // Find 80th percentile threshold
            if(scores.length > 0){
                scores.sort(function(a,b){ return a-b; });
                var index = Math.floor(scores.length * 0.8);
                self.centralityThreshold = scores[index];
            } else {
                self.centralityThreshold = 0;
            }

        };

        self.center = function(andScale){

        // If no nodes & no labels, forget it.
        if(self.nodes.length==0 && self.labels.length==0) return;

        // Get bounds of ALL objects...
        var bounds = self.getBounds();
        var left = bounds.left;
        var top = bounds.top;
        var right = bounds.right;
        var bottom = bounds.bottom;

        // Re-center!
        var canvasses = document.getElementById("canvasses");
        var sw = canvasses.clientWidth;
        var sh = canvasses.clientHeight;

        var cx = (left+right)/2;
        var cy = (top+bottom)/2;

        // SCALE.
        if(andScale){
            var w = right-left;
            var h = bottom-top;
            var fitWidth = sw - _PADDING*4;
            var fitHeight = sh - _PADDING*4;
            var scaleRatio = Math.min(fitWidth/w, fitHeight/h);
            loopy.offsetScale = scaleRatio;
        }

        loopy.offsetX = sw/2 - cx*loopy.offsetScale;
        loopy.offsetY = sh/2 - cy*loopy.offsetScale;

    };

}
