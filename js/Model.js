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

// ------------------------------------------
// MOLAR: Sugerencia automática de nombre
// ------------------------------------------
// Al agrupar, el molar nace con un nombre sugerido (el clínico puede renombrarlo):
// primera palabra significativa de cada hijo, unidas por " / ". Si hay más de 3
// hijos, o si las palabras no alcanzan a distinguir al menos 2 elementos, "Grupo de N".
var _MOLAR_STOPWORDS = {};
("el la los las un una unos unas lo al del de y e o u ni no me mi mis tu tus su sus se te le les nos " +
 "que en con por para sin sobre ante hacia desde como muy mas es soy estoy hay yo a")
    .split(" ").forEach(function(w) { _MOLAR_STOPWORDS[w] = true; });

// Minúsculas y sin tildes, para comparar palabras ("Más" == "mas").
function _molarNormWord(w) {
    w = String(w).toLowerCase();
    return w.normalize ? w.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : w;
}

// Primera palabra significativa de un label ("" si no hay ninguna).
function _molarFirstWord(label) {
    var tokens = String(label == null ? "" : label).split(/\s+/);
    var firstAny = "";
    for (var i = 0; i < tokens.length; i++) {
        // Quita comillas, signos y símbolos de los bordes (conserva letras con tilde y ñ)
        var t = tokens[i].replace(/^[^A-Za-z0-9\u00C0-\u024F]+|[^A-Za-z0-9\u00C0-\u024F]+$/g, "");
        if (!t) continue;
        if (!firstAny) firstAny = t;
        if (t.length > 1 && !_MOLAR_STOPWORDS[_molarNormWord(t)]) return t;
    }
    return firstAny; // todas eran conectores: mejor la primera palabra que nada
}

self._suggestMolarLabel = function(nodes) {
    var n = nodes ? nodes.length : 0;
    var fallback = "Grupo de " + n;
    if (n > 3) return fallback;
    var parts = [], seen = {};
    for (var i = 0; i < n; i++) {
        var word = _molarFirstWord(nodes[i].label);
        if (!word) continue;
        var key = _molarNormWord(word);
        if (seen[key]) continue; // dos hijos que empiezan igual no suman información
        seen[key] = true;
        parts.push(word.charAt(0).toUpperCase() + word.slice(1));
    }
    return parts.length >= 2 ? parts.join(" / ") : fallback;
};

self.groupNodes = function(nodeArray) {
    if (!nodeArray || nodeArray.length < 2) return;
    if(loopy.saveUndo) loopy.saveUndo();
    
    // 1. APLANAMIENTO: Evita grupos anidados como ((AB)C).
    // Si la selección incluye un molar, se lo DISUELVE y sus hijos pasan al grupo nuevo.
    // OJO: los hijos de un molar están OCULTOS por diseño (hidden = true), así que
    // acá NO se puede filtrar por !child.hidden (antes el aplanamiento nunca juntaba
    // a los hijos: {AB}+C quedaba como [C] y no hacía nada, o peor, destruía el molar
    // y dejaba A y B ocultos para siempre).
    var finalNodesToGroup = [];
    var molarsToDestroy = [];
    
    nodeArray.forEach(function(n) {
        if (n.isMolar && n.children) {
            molarsToDestroy.push(n);
            n.children.forEach(function(childId) {
                var child = self.getNode(childId);
                if (child) finalNodesToGroup.push(child);
            });
        } else if (!n.hidden) {
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
        label: self._suggestMolarLabel(finalNodesToGroup), // antes: "?"
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
    molar.children = childIds.slice();
    
    // 6. GESTIONAR ARISTAS: Preservar internas, y eliminar externas.
    // Las aristas que tocan a un molar que se está disolviendo (interruptor maestro
    // viejo y aristas consolidadas viejas) son DERIVADAS: se ignoran acá y desaparecen
    // con oldMolar.kill() (removeNode mata sus aristas). Si se las guardara, el molar
    // nuevo heredaría aristas "desde" un nodo muerto.
    var destroyedIds = molarsToDestroy.map(function(m) { return m.id; });
    var edgesToKill = [];
    
    self.edges.forEach(function(edge) {
        if (destroyedIds.indexOf(edge.from.id) !== -1 || destroyedIds.indexOf(edge.to.id) !== -1) return;
        
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

    // 6.5 HEREDAR las aristas guardadas de los molares disueltos.
    // Las aristas externas ORIGINALES de los hijos viejos ya no existen en el modelo
    // (se mataron al agrupar la primera vez): solo viven en oldMolar.savedEdges. Sin
    // esta herencia, el grupo nuevo perdería toda la conectividad de A y B.
    var sameSaved = function(a, b) {
        return a.from === b.from && a.to === b.to && a.strength === b.strength && a.arc === b.arc;
    };
    molarsToDestroy.forEach(function(oldMolar) {
        (oldMolar.savedEdges || []).forEach(function(se) {
            // Referencias a un molar disuelto (aristas derivadas) o a nodos que ya no existen
            if (destroyedIds.indexOf(se.from) !== -1 || destroyedIds.indexOf(se.to) !== -1) return;
            if (!self.getNode(se.from) || !self.getNode(se.to)) return;
            
            var fromIsChild = childIds.indexOf(se.from) !== -1;
            var toIsChild = childIds.indexOf(se.to) !== -1;
            if (!fromIsChild && !toIsChild) return; // no toca al grupo nuevo
            
            // Ya capturada en el paso 6 (p. ej. una arista interna vieja que sigue viva)
            var dup = molar.savedEdges.some(function(x) { return sameSaved(x, se); });
            if (dup) return;
            
            var rec = { from: se.from, to: se.to, strength: se.strength, arc: se.arc, rotation: se.rotation || 0 };
            molar.savedEdges.push(rec);
            
            // Una arista que era EXTERNA al molar viejo (p. ej. A→C) y ahora queda
            // INTERNA al grupo nuevo debe volver a estar VIVA: las internas se preservan.
            if (fromIsChild && toIsChild) {
                var live = self.edges.some(function(e) { return e.from.id === rec.from && e.to.id === rec.to; });
                if (!live) self.addEdge({ from: rec.from, to: rec.to, strength: rec.strength, arc: rec.arc, rotation: rec.rotation });
            }
        });
    });

    // 7. Historial de los molares disueltos (igual que ungroupNode): permite que
    // _resolveEdgeRef resuelva referencias que otros molares aún tengan hacia ellos.
    if (!self.molarHistory) self.molarHistory = {};
    molarsToDestroy.forEach(function(oldMolar) {
        self.molarHistory[oldMolar.id] = {
            children: oldMolar.children ? oldMolar.children.slice() : [],
            savedEdges: oldMolar.savedEdges ? oldMolar.savedEdges.slice() : []
        };
    });

    // 8. Ejecutar eliminaciones. Cada arista se mata UNA sola vez: removeEdge hace
    // splice(indexOf(edge), 1), y con una arista ya muerta (indexOf = -1) borraría
    // la ÚLTIMA arista del modelo. Las aristas de los molares viejos las mata kill().
    edgesToKill.forEach(function(e) { e.kill(); });
    if (loopy.selectedNodes) {
        loopy.selectedNodes = loopy.selectedNodes.filter(function(n) { return n && destroyedIds.indexOf(n.id) === -1; });
    }
    molarsToDestroy.forEach(function(oldMolar) { oldMolar.kill(); });

    // 9. EL INTERRUPTOR MAESTRO: Conectar el Molar a sus hijos para activarlos
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

    // 10. Crear aristas simplificadas VISUALES hacia el exterior
    var edgeMap = {};
    molar.savedEdges.forEach(function(se) {
        var isChildOutgoing = (childIds.indexOf(se.from) !== -1);
        var externalId = isChildOutgoing ? se.to : se.from;
        
        // Solo nos interesan las conexiones hacia fuera del grupo
        if (childIds.indexOf(externalId) === -1) {
            // Si el otro extremo quedó oculto dentro de OTRO molar, la arista visual
            // va hacia ese molar; nunca hacia un nodo oculto.
            var extNode = self.getNode(externalId);
            if (!extNode) return;
            if (extNode.hidden) {
                var host = self._findMolarContaining(externalId);
                if (!host || host.id === molar.id) return;
                externalId = host.id;
            }
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
            signal: clampedStrength,
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

  // ============================================================
  // MOLAR / ZONE GEOMETRY PATCH
  // ------------------------------------------------------------
  // Implementa:
  // 1. center() visible-only.
  // 2. Zona verde dinámica sincronizada con el canvas.
  // 3. ungroupNode() condicional zona verde / zona roja.
  // 4. Una sola perilla pública de ajuste: zoneScale.
  // 5. Overlay debug opcional.
  // 6. Calibración debug opcional mediante nodos "verde" / "rojo".
  //
  // No toca NIRA, Edge, Node ni Loopy.js.
  // ============================================================
  (function(){

    var OVERLAY_ID = "molar-zone-overlay";

    // ========================================================
    // Helpers internos
    // ========================================================
    function viewScale(){
      var s = loopy.offsetScale;
      if (!isFinite(s) || s <= 0) return 1;
      return s;
    }

    function radiusOf(node){
      if (!node) return 60;

      try {
        if (typeof node.getDisplayRadius === "function") {
          var r = node.getDisplayRadius();
          if (isFinite(r) && r > 0) return r;
        }
      } catch (e) {}

      if (isFinite(node.radius) && node.radius > 0) return node.radius;

      return 60;
    }

    function normalizeLabel(label){
      return String(label || "").trim().toLowerCase();
    }

    function applyStyles(el, styles){
      for (var prop in styles) {
        if (styles.hasOwnProperty(prop)) {
          el.style[prop] = styles[prop];
        }
      }
    }

    //     // ========================================================
    // 1. CENTER VISIBLE-ONLY
    // ------------------------------------------------------------
    // Parchea self.center para que los nodos hidden no afecten
    // el bounding box de centrado/zoom.
    //
    // IMPORTANTE:
    // Usa getBoundingBox() de nodos/aristas/labels visibles,
    // no solo node.x/node.y. Esto evita que el centrado corte
    // parte del círculo del nodo por calcular el zoom como si
    // los nodos fueran puntos.
    // ========================================================
    var _origCenter = self.center;

    self.center = function(andScale){

      // If no nodes & no labels, forget it.
      if (self.nodes.length === 0 && self.labels.length === 0) {
        return;
      }

      var left = Infinity;
      var top = Infinity;
      var right = -Infinity;
      var bottom = -Infinity;

      function addBounds(obj){
        if (!obj || typeof obj.getBoundingBox !== "function") {
          return;
        }

        var b = obj.getBoundingBox();

        if (!b) {
          return;
        }

        if (isFinite(b.left) && b.left < left) {
          left = b.left;
        }

        if (isFinite(b.top) && b.top < top) {
          top = b.top;
        }

        if (isFinite(b.right) && b.right > right) {
          right = b.right;
        }

        if (isFinite(b.bottom) && b.bottom > bottom) {
          bottom = b.bottom;
        }
      }

      // 1. Nodos visibles: usar bounding box real, no solo centro.
      for (var i = 0; i < self.nodes.length; i++) {
        var node = self.nodes[i];

        if (node.hidden) {
          continue;
        }

        addBounds(node);
      }

      // 2. Aristas visibles: solo si ambos extremos son visibles.
      // Las aristas hacia/desde hijos ocultos no deben afectar la cámara.
      for (var e = 0; e < self.edges.length; e++) {
        var edge = self.edges[e];

        if (!edge || !edge.from || !edge.to) {
          continue;
        }

        if (edge.from.hidden || edge.to.hidden) {
          continue;
        }

        addBounds(edge);
      }

      // 3. Labels: mantener comportamiento original.
      // Si más adelante querés que los labels no afecten el centrado,
      // se puede comentar este loop.
      for (var l = 0; l < self.labels.length; l++) {
        addBounds(self.labels[l]);
      }

      // Si nada produjo bounds, delegar al center original como fallback.
      if (
        left === Infinity ||
        top === Infinity ||
        right === -Infinity ||
        bottom === -Infinity
      ) {
        return _origCenter.call(self, andScale);
      }

      // Re-center!
      var canvasses = document.getElementById("canvasses");
      var sw = canvasses ? canvasses.clientWidth : window.innerWidth;
      var sh = canvasses ? canvasses.clientHeight : window.innerHeight;

      sw = Math.max(1, sw || 1);
      sh = Math.max(1, sh || 1);

      var cx = (left + right) / 2;
      var cy = (top + bottom) / 2;

      // SCALE.
      if (andScale) {
        var w = Math.max(1, right - left);
        var h = Math.max(1, bottom - top);

        var pad = (typeof _PADDING !== "undefined" ? _PADDING : 40) * 4;

        var fitWidth = Math.max(1, sw - pad);
        var fitHeight = Math.max(1, sh - pad);

        loopy.offsetScale = Math.min(fitWidth / w, fitHeight / h);
      }

      loopy.offsetX = sw / 2 - cx * loopy.offsetScale;
      loopy.offsetY = sh / 2 - cy * loopy.offsetScale;
    };

    // ========================================================
    // 2. ZONAS DINÁMICAS
    // ========================================================
    self.zones = {

      settings: {
        // Única variable que el usuario debe tocar para ajustar la zona.
        // zoneScale = 1.0  -> zona base.
        // zoneScale > 1.0  -> zona verde más chica, zona roja más grande.
        // zoneScale < 1.0  -> zona verde más grande, zona roja más chica.
        zoneScale: 1.0,

        // Margen proporcional automático si no hay calibración guardada.
        autoMarginFrac: 0.048,

        // Padding mínimo extra respecto del radio visual del nodo.
        nodePadPx: 20,

        // Separación extra entre hijos reubicados en anillo.
        gap: 35,

        // Si true, usa el margen más exigente en X e Y.
        // Esto suele verse más estable visualmente.
        isotropic: true,
        ignoreMinRadius: true,

        storageKey: "niraLoopy.zoneCalibration",

        debugLabels: {
          green: "verde",
          red: "rojo"
        }
      },

      calibration: null,

      canvasSize: function(){
        var c = document.getElementById("canvasses");

        var sw = null;
        var sh = null;

        if (c) {
          sw = c.clientWidth;
          sh = c.clientHeight;

          if (!sw || !sh) {
            var box = c.getBoundingClientRect();
            sw = box.width;
            sh = box.height;
          }
        }

        if (!sw || !isFinite(sw)) sw = window.innerWidth;
        if (!sh || !isFinite(sh)) sh = window.innerHeight;

        sw = Math.max(1, Math.round(sw));
        sh = Math.max(1, Math.round(sh));

        return { sw: sw, sh: sh };
      },

      screenOf: function(obj){
        var p = (obj && obj.id !== undefined)
          ? { x: obj.x, y: obj.y }
          : obj;

        var s = viewScale();

        return {
          x: p.x * s + loopy.offsetX,
          y: p.y * s + loopy.offsetY
        };
      },

      modelFromScreen: function(point){
        var s = viewScale();

        return {
          x: (point.x - loopy.offsetX) / s,
          y: (point.y - loopy.offsetY) / s
        };
      },

      safeRect: function(){
        var size = self.zones.canvasSize();
        var settings = self.zones.settings;
        var cal = self.zones.calibration;

        var fracX = (cal && isFinite(cal.marginFracX))
          ? cal.marginFracX
          : settings.autoMarginFrac;

        var fracY = (cal && isFinite(cal.marginFracY))
          ? cal.marginFracY
          : settings.autoMarginFrac;

        var zoneScale = Number(settings.zoneScale);

        if (!isFinite(zoneScale) || zoneScale <= 0) {
          zoneScale = 1.0;
          settings.zoneScale = 1.0;
        }

        var mX = fracX * size.sw * zoneScale;
        var mY = fracY * size.sh * zoneScale;

        if (settings.isotropic) {
          var iso = Math.max(mX, mY);
          mX = iso;
          mY = iso;
        }

        // Margen mínimo visual basado en el radio de los nodos visibles.
        var s = viewScale();
        var maxRadiusScreen = 0;

        for (var i = 0; i < self.nodes.length; i++) {
          var n = self.nodes[i];

          if (!n.hidden) {
            var r = radiusOf(n) * s;
            if (r > maxRadiusScreen) maxRadiusScreen = r;
          }
        }

        if (!(maxRadiusScreen > 0)) {
          maxRadiusScreen = 60 * s;
        }

        var minMargin = Math.ceil(maxRadiusScreen + settings.nodePadPx);

	if (!settings.ignoreMinRadius) {
        mX = Math.max(mX, minMargin);
        mY = Math.max(mY, minMargin);
	}

        // Evitar que la zona segura desaparezca en canvas muy chicos.
        var maxMargin = Math.max(
          0,
          Math.floor(Math.min(size.sw, size.sh) / 2) - 10
        );

        mX = Math.min(mX, maxMargin);
        mY = Math.min(mY, maxMargin);

        mX = Math.max(0, Math.round(mX));
        mY = Math.max(0, Math.round(mY));

        return {
          left: mX,
          top: mY,
          right: size.sw - mX,
          bottom: size.sh - mY,
          sw: size.sw,
          sh: size.sh,
          margin: Math.min(mX, mY),
          marginX: mX,
          marginY: mY,
          zoneScale: zoneScale,
          source: cal ? "calibración" : "auto",
          isotropic: !!settings.isotropic,
          nodePadPx: settings.nodePadPx,
          minRadiusMargin: minMargin
        };
      },

      isInsideRect: function(point, rect){
        return (
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom
        );
      },

      clampPointToRect: function(point, rect){
        return {
          x: Math.min(Math.max(point.x, rect.left), rect.right),
          y: Math.min(Math.max(point.y, rect.top), rect.bottom)
        };
      },

      landingModelPoint: function(molarPoint, rect){
        var screen = self.zones.screenOf(molarPoint);

        if (self.zones.isInsideRect(screen, rect)) {
          return {
            x: molarPoint.x,
            y: molarPoint.y,
            used: "molar"
          };
        }

        var safeScreen = self.zones.clampPointToRect(screen, rect);
        var safeModel = self.zones.modelFromScreen(safeScreen);

        return {
          x: safeModel.x,
          y: safeModel.y,
          used: "safe-border"
        };
      },

      ringPositionsAroundPoint: function(center, children, gap){
        var k = Math.max(1, children.length);
        var s = viewScale();

        var maxRScreen = 0;

        for (var i = 0; i < children.length; i++) {
          var r = radiusOf(children[i]) * s;
          if (r > maxRScreen) maxRScreen = r;
        }

        if (!(maxRScreen > 0)) {
          maxRScreen = 60 * s;
        }

        var gapPx = (gap == null) ? self.zones.settings.gap : gap;
        var desiredScreenSeparation = 2 * maxRScreen + gapPx;

        var radiusScreen = (k === 1)
          ? 0
          : desiredScreenSeparation / (2 * Math.sin(Math.PI / k));

        var radiusModel = radiusScreen / s;

        var out = [];

        for (var j = 0; j < k; j++) {
          var angle = (j / k) * Math.PI * 2 - Math.PI / 2;

          out.push({
            x: center.x + Math.cos(angle) * radiusModel,
            y: center.y + Math.sin(angle) * radiusModel,
            angle: angle,
            radiusModel: radiusModel,
            radiusScreen: radiusScreen
          });
        }

        return out;
      },

      showOverlay: function(){
        self.zones.hideOverlay();

        var rect = self.zones.safeRect();
        var canvas = document.getElementById("canvasses");
        var box = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };

        var div = document.createElement("div");
        div.id = OVERLAY_ID;

        applyStyles(div, {
          position: "fixed",
          left: (box.left + rect.left) + "px",
          top: (box.top + rect.top) + "px",
          width: (rect.right - rect.left) + "px",
          height: (rect.bottom - rect.top) + "px",
          border: "3px solid rgba(0, 255, 120, 0.9)",
          boxShadow: "0 0 0 9999px rgba(255, 0, 0, 0.12)",
          pointerEvents: "none",
          zIndex: 999999,
          boxSizing: "border-box"
        });

        document.body.appendChild(div);

        console.log("Zona verde mostrada:", rect);
      },

      hideOverlay: function(){
        var old = document.getElementById(OVERLAY_ID);
        if (old) old.remove();
      },

      setZoneScale: function(value){
        var x = Number(value);

        if (!isFinite(x) || x <= 0) {
          console.warn("zoneScale inválido. Usá un número positivo, por ejemplo 1.0, 1.2 o 0.8.");
          return null;
        }

        self.zones.settings.zoneScale = x;

        if (document.getElementById(OVERLAY_ID)) {
          self.zones.showOverlay();
        }

        var rect = self.zones.safeRect();

        console.log("zoneScale ajustado:", {
          zoneScale: x,
          canvas: self.zones.canvasSize(),
          safeRect: rect
        });

        return rect;
      },

      debugZone: function(){
        var out = {
          canvas: self.zones.canvasSize(),
          zoneScale: self.zones.settings.zoneScale,
          calibration: self.zones.calibration,
          safeRect: self.zones.safeRect()
        };

        console.log("Debug de zona dinámica:", out);
        return out;
      },

      saveCalibration: function(){
        try {
          if (!self.zones.calibration) {
            console.warn("No hay calibración para guardar.");
            return false;
          }

          localStorage.setItem(
            self.zones.settings.storageKey,
            JSON.stringify(self.zones.calibration)
          );

          console.log("Calibración guardada en localStorage.");
          return true;
        } catch (e) {
          console.warn("No se pudo guardar calibración:", e);
          return false;
        }
      },

      loadCalibration: function(){
        try {
          var raw = localStorage.getItem(self.zones.settings.storageKey);

          if (!raw) {
            console.log("No hay calibración guardada.");
            return null;
          }

          var parsed = JSON.parse(raw);

          if (
            parsed &&
            isFinite(parsed.marginFracX) &&
            isFinite(parsed.marginFracY)
          ) {
            self.zones.calibration = parsed;
            console.log("Calibración cargada:", parsed);
            return parsed;
          }

          console.warn("Calibración guardada inválida. Se ignora.");
          return null;
        } catch (e) {
          console.warn("No se pudo cargar calibración:", e);
          return null;
        }
      },

      clearCalibration: function(){
        try {
          localStorage.removeItem(self.zones.settings.storageKey);
        } catch (e) {}

        self.zones.calibration = null;
        console.log("Calibración limpiada.");
      },

      // ======================================================
      // Herramienta debug opcional:
      // creá nodos llamados "verde" y/o "rojo" y calibrá.
      // No es necesario para el comportamiento productivo.
      // ======================================================
      calibrateFromLabels: function(opts){
        opts = opts || {};

        var greenTerm = opts.green || self.zones.settings.debugLabels.green;
        var redTerm = opts.red || self.zones.settings.debugLabels.red;

        var size = self.zones.canvasSize();
        var maxMargin = Math.max(
          0,
          Math.floor(Math.min(size.sw, size.sh) / 2) - 10
        );

        function collect(term){
          var t = normalizeLabel(term);
          var list = [];

          for (var i = 0; i < self.nodes.length; i++) {
            var n = self.nodes[i];

            if (!n.hidden && normalizeLabel(n.label).indexOf(t) !== -1) {
              var s = self.zones.screenOf(n);

              list.push({
                id: n.id,
                label: n.label,
                screenX: +s.x.toFixed(2),
                screenY: +s.y.toFixed(2),
                minEdge: Math.min(s.x, size.sw - s.x, s.y, size.sh - s.y)
              });
            }
          }

          return list;
        }

        function minEdge(list){
          if (!list.length) return Infinity;

          var m = Infinity;

          for (var i = 0; i < list.length; i++) {
            if (list[i].minEdge < m) m = list[i].minEdge;
          }

          return m;
        }

        function maxEdge(list){
          if (!list.length) return -1;

          var m = -1;

          for (var i = 0; i < list.length; i++) {
            if (list[i].minEdge > m) m = list[i].minEdge;
          }

          return m;
        }

        var green = collect(greenTerm);
        var red = collect(redTerm);

        var marginPx;
        var status = "ok";
        var conflicts = [];

        if (!green.length && !red.length) {
          var auto = Math.min(140, Math.max(60, 0.12 * Math.min(size.sw, size.sh)));
          marginPx = Math.round(auto);
          status = "sin-etiquetas";
        } else {
          var minGreen = green.length ? minEdge(green) : maxMargin;
          var maxRed = red.length ? maxEdge(red) : -1;

          var low = Math.floor(maxRed) + 1;
          var high = Math.floor(minGreen);

          if (low <= high) {
            marginPx = Math.min(high, maxMargin);
            status = "ok";
          } else {
            marginPx = Math.max(0, Math.min(high, maxMargin));
            status = "conflicto";

            conflicts.push({
              detail: "No existe un margen rectangular que incluya todos los nodos verde y excluya todos los rojo.",
              lowRequired: low,
              highAllowed: high
            });
          }
        }

        marginPx = Math.max(0, Math.min(Math.round(marginPx), maxMargin));

        self.zones.calibration = {
          version: 1,
          marginPxAtCalibration: marginPx,
          marginFracX: marginPx / size.sw,
          marginFracY: marginPx / size.sh,
          canvasWidthAtCalibration: size.sw,
          canvasHeightAtCalibration: size.sh,
          timestamp: new Date().toISOString(),
          greenCount: green.length,
          redCount: red.length,
          status: status,
          conflicts: conflicts
        };

        self.zones.saveCalibration();

        console.log("Calibración desde labels:", self.zones.calibration);
        console.table(green.concat(red).map(function(p){
          return {
            label: p.label,
            screenX: p.screenX,
            screenY: p.screenY,
            minEdge: +p.minEdge.toFixed(2)
          };
        }));

        if (conflicts.length) {
          console.warn("Conflictos de calibración:", conflicts);
        }

        return self.zones.calibration;
      },

      deleteCalibrationNodes: function(){
        var greenTerm = normalizeLabel(self.zones.settings.debugLabels.green);
        var redTerm = normalizeLabel(self.zones.settings.debugLabels.red);

        var toKill = [];

        for (var i = 0; i < self.nodes.length; i++) {
          var n = self.nodes[i];
          var lab = normalizeLabel(n.label);

          if (!n.hidden && (lab.indexOf(greenTerm) !== -1 || lab.indexOf(redTerm) !== -1)) {
            toKill.push(n);
          }
        }

        for (var j = toKill.length - 1; j >= 0; j--) {
          try {
            toKill[j].kill();
          } catch (e) {}
        }

        publish("model/changed");
        publish("view/changed");

        console.log("Nodos de calibración eliminados:", toKill.length);
        return toKill.length;
      }

    };

    // Atajo conveniente desde la consola:
    // loopy.zones.setZoneScale(1.2)
    loopy.zones = self.zones;

    // Cargar calibración persistida si existe.
    self.zones.loadCalibration();

    // ========================================================
    // 3. UNGROUP CONDICIONAL ZONA VERDE / ZONA ROJA
    // ------------------------------------------------------------
    // Desagrupar NO debe mover la cámara.
    // Si los hijos caen en zona verde, quedan donde estaban.
    // Si alguno cae en zona roja, se reubican en anillo seguro.
    // ========================================================
    var _origUngroup = self.ungroupNode;

    self.ungroupNode = function(molarNode){
      if (!molarNode || !molarNode.isMolar) {
        return _origUngroup.apply(this, arguments);
      }

      var childIds = (molarNode.children || []).slice();
      var molarPoint = {
        x: molarNode.x,
        y: molarNode.y
      };

      // Desagrupado original: hace visibles los hijos, restaura aristas, mata molar.
      var result = _origUngroup.apply(this, arguments);

      var children = [];

      for (var i = 0; i < childIds.length; i++) {
        var c = self.getNode(childIds[i]);
        if (c) children.push(c);
      }

      if (!children.length) {
        return result;
      }

      var rect = self.zones.safeRect();
      var allSafe = true;

      for (var j = 0; j < children.length; j++) {
        var screen = self.zones.screenOf(children[j]);

        if (!self.zones.isInsideRect(screen, rect)) {
          allSafe = false;
          break;
        }
      }

      if (allSafe) {
        console.log("ZONA VERDE: desagrupado antiguo. Los hijos quedan donde estaban. No se movió la cámara.", {
          molar: molarNode.label,
          marginX: rect.marginX,
          marginY: rect.marginY,
          children: children.map(function(c){ return c.label; })
        });

        publish("view/changed");
        return result;
      }

      // ZONA ROJA: reubicar hijos alrededor de un punto seguro.
      var landing = self.zones.landingModelPoint(molarPoint, rect);
      var ring = self.zones.ringPositionsAroundPoint(
        landing,
        children,
        self.zones.settings.gap
      );

      for (var k = 0; k < children.length; k++) {
        children[k].hidden = false;
        children[k].value = children[k].init;
        children[k].x = ring[k].x;
        children[k].y = ring[k].y;
      }

      console.log("ZONA ROJA: desagrupado con reubicación segura. No se movió la cámara.", {
        molar: molarNode.label,
        marginX: rect.marginX,
        marginY: rect.marginY,
        gap: self.zones.settings.gap,
        landing: landing,
        children: children.map(function(c){
          return {
            label: c.label,
            screen: self.zones.screenOf(c)
          };
        })
      });

      publish("view/changed");
      publish("model/changed");

      return result;
    };

    // ========================================================
    // 4. REFRESCO AUTOMÁTICO DEL OVERLAY AL CAMBIAR TAMAÑO
    // ========================================================
    self.zones._refreshOverlay = function(){
      if (document.getElementById(OVERLAY_ID)) {
        self.zones.showOverlay();
      }
    };

    window.addEventListener("resize", self.zones._refreshOverlay);

    if (window.ResizeObserver) {
      var canvas = document.getElementById("canvasses");

      if (canvas) {
        self.zones._resizeObserver = new ResizeObserver(function(){
          self.zones._refreshOverlay();
        });

        self.zones._resizeObserver.observe(canvas);
      }
    }

    console.log("MOLAR zone geometry patch cargado.");
    console.log("Ajustá la zona con: loopy.zones.setZoneScale(1.2)");
    console.log("Mostrá la zona con: loopy.zones.showOverlay()");
    console.log("Debugueá con: loopy.zones.debugZone()");

  })();


}