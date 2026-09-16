/**********************************

NODE!

**********************************/

Node.COLORS = [
    "#FF6B6B", // 0: Rojo
    "#FF83C1", // 1: Rosa
    "#EA9D51", // 2: Naranja
    "#FEEE43", // 3: Amarillo
    "#BFEE3F", // 4: Verde
    "#7FD4FF", // 5: Celeste
    "#79B8FF", // 6: Azul
    "#C3A6FF"  // 7: Violeta
];

Node.defaultValue = 0;
Node.defaultHue = 0;

Node.DEFAULT_RADIUS = 60;
Node.DIAMOND_MULTIPLIER = 1.2;

function Node(model, config){

    var self = this;
    self._CLASS_ = "Node";

    // Mah Parents!
    self.loopy = model.loopy;
    self.model = model;
    self.config = config;

    // Default values...
    _configureProperties(self, config, {
        id: Node._getUID,
        x: 0,
        y: 0,
        init: Node.defaultValue, // initial value!
        label: "?",
        hue: Node.defaultHue,
        radius: Node.DEFAULT_RADIUS,
        shape: "circle"
    });

    self.getDisplayRadius = function() {
        if(self.shape === "diamond") {
            return self.radius * Node.DIAMOND_MULTIPLIER;
        }
        return self.radius;
    };

    // Centrality
    self.centrality = 0;

    // Impact (NIRA): 0..1, proporcional al impacto de intervención
    self.impact = 0;

    // Value: from 0 to 1
    self.value = self.init;
    // TODO: ACTUALLY VISUALIZE AN INFINITE RANGE
    self.bound = function(){ // bound ONLY when changing value.
        /*var buffer = 1.2;
        if(self.value<-buffer) self.value=-buffer;
        if(self.value>1+buffer) self.value=1+buffer;*/
    };

    // MOUSE.
    var _controlsVisible = false;
    var _controlsAlpha = 0;
    var _controlsDirection = 0;
    var _controlsSelected = false;
    var _controlsPressed = false;    
    var _listenerMouseMove = subscribe("mousemove", function(){

        // ONLY WHEN PLAYING
        if(self.loopy.mode!=Loopy.MODE_PLAY) return;
        // NIRA: no mostrar controles de edición durante el análisis
        if(self.loopy._niraRunning) return;

        // If moused over this, show it, or not.
        _controlsSelected = self.isPointInNode(Mouse.x, Mouse.y);
        if(_controlsSelected){
            _controlsVisible = true;
            self.loopy.showPlayTutorial = false;
            _controlsDirection = (Mouse.y<self.y) ? 1 : -1;
        }else{
            _controlsVisible = false;
            _controlsDirection = 0;
        }

    });
    var _listenerMouseDown = subscribe("mousedown",function(){

        if(self.loopy.mode!=Loopy.MODE_PLAY) return; // ONLY WHEN PLAYING
        if(self.loopy._niraRunning) return; // NIRA: sin edición durante el análisis
        if(_controlsSelected) _controlsPressed = true;

        // IF YOU CLICKED ME...
        if(_controlsPressed){

            // Change my value
            var delta = _controlsDirection*0.33; // HACK: hard-coded 0.33
            self.value += delta;

            // And also PROPAGATE THE DELTA
            self.sendSignal({
                delta: delta
            });

        }

    });
    var _listenerMouseUp = subscribe("mouseup",function(){
        _controlsPressed = false;
    });
var _listenerReset = subscribe("model/reset", function(){
    self.value = self.init;

    // Limpiar agregación pendiente
    if(self.aggregate){
        clearTimeout(self.aggregate);
        self.aggregate = null;
    }
    self.deltaPool = 0;
});
    var _listenerMode = subscribe("loopy/mode", function(){
        _controlsVisible = false;
        _controlsAlpha = 0;
        _controlsDirection = 0;
        _controlsSelected = false;
        _controlsPressed = false;
    });

    //////////////////////////////////////
    // SIGNALS ///////////////////////////
    //////////////////////////////////////

    var shiftIndex = 0;
    self.sendSignal = function(signal){
        var myEdges = self.model.getEdgesByStartNode(self);
        myEdges = _shiftArray(myEdges, shiftIndex);
        shiftIndex = (shiftIndex+1)%myEdges.length;
        for(var i=0; i<myEdges.length; i++){
            myEdges[i].addSignal(signal);
        }
    };

    // Agregación: acumula señales entrantes y emite UNA sola por ráfaga.
    // Latencia en segundos. 0 = sin agregación.
    self.aggregationLatency = 0.1;
    self.deltaPool = 0;
    self.aggregate = null;

    self.takeSignal = function(signal){

        // Animación visual (siempre)
        if(signal.delta !== 0){
            _offsetVel -= 6 * (signal.delta / Math.abs(signal.delta));
        }

        // Acumular en el pool
        self.deltaPool += signal.delta;

        // Actualizar value inmediatamente → el círculo crece con cada señal
        self.value += signal.delta;
        self.bound();

        // Si ya hay un timeout pendiente, solo acumulamos y salimos
        if(self.aggregate) return;

        var myAge = signal.age;
        self.aggregate = setTimeout(function(){
            // Solo emitir si seguimos en PLAY
            if(self.loopy.mode === Loopy.MODE_PLAY){
                self.sendSignal({
                    delta: self.value * 0.3,   // ← value, no deltaPool
                    age: myAge
                });
            }
            self.deltaPool = 0;
            self.aggregate = null;
        }, self.aggregationLatency * 1000);
    };

    // Limpiar agregación pendiente en reset
    var _listenerReset = subscribe("model/reset", function(){
        if(self.aggregate){
            clearTimeout(self.aggregate);
            self.aggregate = null;
        }
        self.deltaPool = 0;
    });

    //////////////////////////////////////
    // UPDATE & DRAW /////////////////////
    //////////////////////////////////////

    // Update!
    var _offset = 0;
    var _offsetGoto = 0;
    var _offsetVel = 0;
    var _offsetAcc = 0;
    var _offsetDamp = 0.3;
    var _offsetHookes = 0.8;
    self.update = function(speed){

        // When actually playing the simulation...
        var _isPlaying = (self.loopy.mode==Loopy.MODE_PLAY);

        // Otherwise, value = initValue exactly
        if(self.loopy.mode==Loopy.MODE_EDIT){
            self.value = self.init;
        }

        // Cursor!
        if(_controlsSelected) Mouse.showCursor("pointer");

        // Keep value within bounds!
        self.bound();

        // Visually & vertically bump the node
        var gotoAlpha = (_controlsVisible || self.loopy.showPlayTutorial) ? 1 : 0;
        _controlsAlpha = _controlsAlpha*0.5 + gotoAlpha*0.5;
        if(_isPlaying && _controlsPressed){
            _offsetGoto = -_controlsDirection*20; // by 20 pixels
            // _offsetGoto = _controlsDirection*0.2; // by scale +/- 0.1
        }else{
            _offsetGoto = 0;
        }
        _offset += _offsetVel;
        if(_offset>40) _offset=40
        if(_offset<-40) _offset=-40;
        _offsetVel += _offsetAcc;
        _offsetVel *= _offsetDamp;
        _offsetAcc = (_offsetGoto-_offset)*_offsetHookes;

    };

    // Draw
    var _circleRadius = 0;
    self.getPath = function(ctx, r){
        var shape = self.shape || "circle";
        if(shape=="circle"){
            ctx.arc(0, 0, r, 0, Math.TAU, false);
        }
        if(shape=="square"){
            ctx.rect(-r, -r, r*2, r*2);
        }
        if(shape=="diamond"){
            ctx.moveTo(0, -r);
            ctx.lineTo(r, 0);
            ctx.lineTo(0, r);
            ctx.lineTo(-r, 0);
            ctx.closePath();
        }
    };
    self.draw = function(ctx){

        // Retina
        var x = self.x*2;
        var y = self.y*2;
        var r = self.getDisplayRadius()*2;
        var color = Node.COLORS[self.hue];

        // Translate!
        ctx.save();
        ctx.translate(x,y+_offset);

        // CENTRALITY HALO
        if(self.loopy.showCentrality && self.centrality >= self.model.centralityThreshold && self.centrality > 0){
            var ratio = 0;
            if(self.model.maxCentrality > 0){
                ratio = self.centrality / self.model.maxCentrality;
            }

            var haloColor;
            if(ratio > 0.66){
                haloColor = "rgba(234, 62, 62, 0.8)"; // Red
            } else if(ratio > 0.33){
                haloColor = "rgba(234, 157, 81, 0.8)"; // Orange/Yellow
            } else {
                haloColor = "rgba(127, 212, 255, 0.8)"; // Blue
            }

            var haloSize = r * (1 + ratio * 0.5) + 20;
            var gradient = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, haloSize);
            gradient.addColorStop(0, haloColor);
            gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

            ctx.beginPath();
            ctx.arc(0, 0, haloSize, 0, Math.TAU, false);
            ctx.fillStyle = gradient;
            ctx.fill();
        }

        // IMPACT HALO (NIRA)
        // Aura plana del color propio del nodo, proporcional a su impacto.
        // Se pinta antes de la burbuja blanca y coexiste con el halo de
        // centralidad (tiene prioridad visual si showImpact está activo).
        if(self.loopy.showImpact && self.impact > 0){
            var impactRatio = self.impact; // 0..1 (normalizado en NIRA)
            var impactHaloSize = r * (1.4 + impactRatio * 0.8);
            var impactHex = color.replace('#', '');
            var impactR = parseInt(impactHex.substring(0, 2), 16);
            var impactG = parseInt(impactHex.substring(2, 4), 16);
            var impactB = parseInt(impactHex.substring(4, 6), 16);
            var impactAlpha = 0.15 + impactRatio * 0.20;

            ctx.beginPath();
            self.getPath(ctx, impactHaloSize);
            ctx.fillStyle = "rgba(" + impactR + "," + impactG + "," + impactB + "," + impactAlpha.toFixed(2) + ")";
            ctx.fill();
        }

        // DRAW HIGHLIGHT???
        if(self.loopy.sidebar.currentPage.target == self){
            ctx.beginPath();
            // ctx.arc(0, 0, r+40, 0, Math.TAU, false);
            self.getPath(ctx, r+40);
            ctx.fillStyle = HIGHLIGHT_COLOR;
            ctx.fill();
        }

        // White-gray bubble with colored border
        ctx.beginPath();
        // ctx.arc(0, 0, r-2, 0, Math.TAU, false);
        self.getPath(ctx, r-2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = color;
        ctx.stroke();
        
        // Circle radius
        // var _circleRadiusGoto = r*(self.value+1);
        // _circleRadius = _circleRadius*0.75 + _circleRadiusGoto*0.25;

        // RADIUS IS (ATAN) of VALUE?!?!?!
        var _r = Math.atan(self.value*5);
        _r = _r/(Math.PI/2);
        _r = (_r+1)/2;

        // INFINITE RANGE FOR RADIUS
        // linear from 0 to 1, asymptotic otherwise.
        var _value;
        if(self.value>=0 && self.value<=1){
            // (0,1) -> (0.0, 1.0)
            _value = 1.0 * self.value;
        }else{
            if(self.value<0){
                // asymptotically approach 0, starting at 0.1
                _value = (1/(Math.abs(self.value)+1))*0.1;
            }
            if(self.value>1){
                // asymptotically approach 1, starting at 0.9
                _value = 1 - (1/self.value)*0.1;
            }
        }

        // Colored bubble
        ctx.beginPath();
        var _circleRadiusGoto = r*_value; // radius
        _circleRadius = _circleRadius*0.8 + _circleRadiusGoto*0.2;
        // ctx.arc(0, 0, _circleRadius, 0, Math.TAU, false);
        self.getPath(ctx, _circleRadius);
        ctx.fillStyle = color;
        ctx.fill();

        // Text!
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#000";

        var fontsize = 40;
        var maxWidth = r*2 - 30;
        var lines;

        while(fontsize > 5){
            ctx.font = "normal "+fontsize+"px 'Figtree', sans-serif";
            lines = _wrapText(ctx, self.label, maxWidth);

            var maxWidthExceeded = false;
            for(var i=0; i<lines.length; i++){
                if(ctx.measureText(lines[i]).width > maxWidth){
                    maxWidthExceeded = true;
                    break;
                }
            }

            var totalHeight = lines.length * fontsize;
            if(!maxWidthExceeded && totalHeight <= maxWidth) break;
            fontsize -= 1;
        }

        for(var i=0; i<lines.length; i++){
            var line = lines[i];
            var yOff = (i - (lines.length-1)/2) * fontsize;
            ctx.fillText(line, 0, yOff);
        }

        // WOBBLE CONTROLS
        var cl = 40;
        var cy = 0;
        if(self.loopy.showPlayTutorial && self.loopy.wobbleControls>0){
            var wobble = self.loopy.wobbleControls*(Math.TAU/30);
            cy = Math.abs(Math.sin(wobble))*10;
        }

        // Controls!
        ctx.globalAlpha = _controlsAlpha;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        // top arrow
        ctx.beginPath();
        ctx.moveTo(-cl,-cy-cl);
        ctx.lineTo(0,-cy-cl*2);
        ctx.lineTo(cl,-cy-cl);
        ctx.lineWidth = (_controlsDirection>0) ? 10: 3;
        if(self.loopy.showPlayTutorial) ctx.lineWidth=6;
        ctx.stroke();
        // bottom arrow
        ctx.beginPath();
        ctx.moveTo(-cl,cy+cl);
        ctx.lineTo(0,cy+cl*2);
        ctx.lineTo(cl,cy+cl);
        ctx.lineWidth = (_controlsDirection<0) ? 10: 3;
        if(self.loopy.showPlayTutorial) ctx.lineWidth=6;
        ctx.stroke();

        // Restore
        ctx.restore();

    };

    //////////////////////////////////////
    // KILL NODE /////////////////////////
    //////////////////////////////////////

    self.kill = function(){

        // SAVE UNDO
        self.loopy.saveUndo();

        // Kill Listeners!
        unsubscribe("mousemove",_listenerMouseMove);
        unsubscribe("mousedown",_listenerMouseDown);
        unsubscribe("mouseup",_listenerMouseUp);
        unsubscribe("model/reset",_listenerReset);
        unsubscribe("loopy/mode",_listenerMode);

        // Remove from parent!
        model.removeNode(self);

        // Killed!
        publish("kill",[self]);

    };

    //////////////////////////////////////
    // HELPER METHODS ////////////////////
    //////////////////////////////////////

    self.isPointInNode = function(x, y, buffer){
        buffer = buffer || 0;
        var r = self.getDisplayRadius() + buffer;
        var dx = Math.abs(x - self.x);
        var dy = Math.abs(y - self.y);
        var shape = self.shape || "circle";
        if(shape=="circle"){
            return (dx*dx + dy*dy) <= r*r;
        }
        if(shape=="square"){
            return dx <= r && dy <= r;
        }
        if(shape=="diamond"){
            return (dx + dy) <= r;
        }
        return false;
    };

    self.getBoundingBox = function(){
        var r = self.getDisplayRadius();
        return {
            left: self.x - r,
            top: self.y - r,
            right: self.x + r,
            bottom: self.y + r
        };
    };

}

////////////////////////////
// Unique ID identifiers! //
////////////////////////////

Node._UID = 0;
Node._getUID = function(){
    Node._UID++;
    return Node._UID;
};
