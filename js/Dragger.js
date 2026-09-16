/**********************************

DRAGGER
- with multi-select drag support

**********************************/

function Dragger(loopy){

    var self = this;
    self.loopy = loopy;

    // Dragging anything?
    self.dragging = null;
    self.offsetX = 0;
    self.offsetY = 0;
    
    // MOLAR: Para guardar las posiciones iniciales de los nodos seleccionados al iniciar el arrastre
    self.initialPositions = {};

    subscribe("mousedown",function(){

        // ONLY WHEN EDITING
        if(self.loopy.mode!=Loopy.MODE_EDIT) return;

        // Tool check: either TOOL_DRAG OR Right Click
        var isRightClickDrag = (Mouse.button === 2);
        if(!isRightClickDrag && self.loopy.tool!=Loopy.TOOL_DRAG) return;

        if(Key.space) return; // DON'T DRAG IF PANNING

        // Any node under here? If so, start dragging!
        var dragNode = loopy.model.getNodeByPoint(Mouse.x, Mouse.y);
        if(dragNode){
            self.dragging = dragNode;
            self.offsetX = Mouse.x - dragNode.x;
            self.offsetY = Mouse.y - dragNode.y;
            
            // MOLAR: Guardar posición INICIAL del mouse (absoluta)
            self.initialMouseX = Mouse.x;
            self.initialMouseY = Mouse.y;
            
            // MOLAR: Si el nodo está en la selección múltiple, guardar posiciones de TODOS los seleccionados
            if (loopy.selectedNodes.indexOf(dragNode) !== -1) {
                self.initialPositions = {};
                for (var i = 0; i < loopy.selectedNodes.length; i++) {
                    var n = loopy.selectedNodes[i];
                    self.initialPositions[n.id] = { x: n.x, y: n.y };
                }
            } else {
                self.initialPositions = {};
            }

            // MOLAR: Solo abrir sidebar si NO se está haciendo CTRL+Click (usando variable infalible)
            var isCtrlPressed = window._isCtrlPressedDuringClick;
            if(!isRightClickDrag && window.innerWidth > 768 && !isCtrlPressed) {
                loopy.sidebar.edit(dragNode);
            }
            return;
        }

        // Any label under here? If so, start dragging!
        var dragLabel = loopy.model.getLabelByPoint(Mouse.x, Mouse.y);
        if(dragLabel){
            self.dragging = dragLabel;
            self.offsetX = Mouse.x - dragLabel.x;
            self.offsetY = Mouse.y - dragLabel.y;
            if(!isRightClickDrag && window.innerWidth > 768 && !Key.control && !Key.meta) loopy.sidebar.edit(dragLabel);
            return;
        }

        // Any edge under here? If so, start dragging!
        var dragEdge = loopy.model.getEdgeByPoint(Mouse.x, Mouse.y);
        if(dragEdge){
            self.dragging = dragEdge;
            self.offsetX = Mouse.x - dragEdge.labelX;
            self.offsetY = Mouse.y - dragEdge.labelY;
            if(!isRightClickDrag && window.innerWidth > 768 && !Key.control && !Key.meta) loopy.sidebar.edit(dragEdge);
            return;
        }

    });
    
    subscribe("mousemove",function(){

        // ONLY WHEN EDITING
        if(self.loopy.mode!=Loopy.MODE_EDIT) return;

        // If not dragging, check tool
        if(!self.dragging && self.loopy.tool!=Loopy.TOOL_DRAG) return;

        // If you're dragging a NODE, move it around!
        if(self.dragging && self.dragging._CLASS_ == "Node"){
            // MOLAR: Delta ABSOLUTO desde el punto de inicio del mouse (no desde el nodo)
            var dx = Mouse.x - self.initialMouseX;
            var dy = Mouse.y - self.initialMouseY;

            if (Object.keys(self.initialPositions).length > 0) {
                // Mover TODOS los nodos seleccionados usando el delta absoluto
                for (var id in self.initialPositions) {
                    var n = loopy.model.getNode(parseInt(id));
                    if (n) {
                        n.x = self.initialPositions[id].x + dx;
                        n.y = self.initialPositions[id].y + dy;
                    }
                }
            } else {
                // Mover solo el nodo clickeado
                self.dragging.x = Mouse.x - self.offsetX;
                self.dragging.y = Mouse.y - self.offsetY;
            }
            
            // Publicamos el cambio UNA sola vez por frame
            publish("model/changed");
        }

        // If you're dragging an EDGE, move it around!
        if(self.dragging && self.dragging._CLASS_=="Edge"){

            // Model's been changed!
            publish("model/changed");

            var edge = self.dragging;
            var labelX = Mouse.x - self.offsetX;
            var labelY = Mouse.y - self.offsetY;

            if(edge.from!=edge.to){

                // The Arc: whatever label *Y* is, relative to angle & first node's pos
                var fx=edge.from.x, fy=edge.from.y, tx=edge.to.x, ty=edge.to.y;
                var dx=tx-fx, dy=ty-fy;
                var a = Math.atan2(dy,dx);

                // Calculate arc
                var points = [[labelX,labelY]];
                var translated = _translatePoints(points, -fx, -fy);
                var rotated = _rotatePoints(translated, -a);
                var newLabelPoint = rotated[0];

                // ooookay.
                edge.arc = -newLabelPoint[1]; // WHY NEGATIVE? I DON'T KNOW.

            }else{

                // For SELF-ARROWS: just get angle & mag for label.
                var dx = labelX - edge.from.x,
                    dy = labelY - edge.from.y;
                var a = Math.atan2(dy,dx);
                var mag = Math.sqrt(dx*dx + dy*dy);

                // Minimum mag
                var minimum = edge.from.getDisplayRadius()+25;
                if(mag<minimum) mag=minimum;

                // Update edge
                edge.arc = mag;
                edge.rotation = a*(360/Math.TAU)+90;

            }

            
        }

        // If you're dragging a LABEL, move it around!
        if(self.dragging && self.dragging._CLASS_=="Label"){

            // Model's been changed!
            publish("model/changed");
            
            var label = self.dragging;
            label.x = Mouse.x - self.offsetX;
            label.y = Mouse.y - self.offsetY;

            
        }

    });
    
    subscribe("mouseup",function(){

        // ONLY WHEN EDITING
        if(self.loopy.mode!=Loopy.MODE_EDIT) return;

        // Let go!
        self.dragging = null;
        self.offsetX = 0;
        self.offsetY = 0;
        self.initialPositions = {}; // MOLAR: Limpiar estado de arrastre múltiple

    });

    // Right-click release: contextmenu fires instead of mouseup
    document.addEventListener("contextmenu", function(event){
        if(self.dragging){
            event.preventDefault();
            self.dragging = null;
            self.offsetX = 0;
            self.offsetY = 0;
            self.initialPositions = {}; // MOLAR: Limpiar estado de arrastre múltiple
        }
    });

}