/**********************************

LOOPY!
- with edit & play mode

**********************************/

Loopy.MODE_EDIT = 0;
Loopy.MODE_PLAY = 1;

Loopy.TOOL_INK = 0;
Loopy.TOOL_DRAG = 1;
Loopy.TOOL_ERASE = 2;
Loopy.TOOL_LABEL = 3;

function Loopy(config){

    var self = this;
    self.config = config;
    self.id = null;

    // Application base path (absolute from domain root)
    var path = window.location.pathname.replace(/index\.html$/, "");
    self.base = path.replace(/\/([a-zA-Z0-9]{8})\/?$/, "/");
    if(self.base.charAt(self.base.length-1) != "/") self.base += "/";

    // Loopy: EMBED???
    self.embedded = _getParameterByName("embed");
    self.embedded = !!parseInt(self.embedded); // force to Boolean

    // Offset & Scale?!?!
    self.offsetX = 0;
    self.offsetY = 0;
    self.offsetScale = 1;

    // Mouse
    Mouse.init(document.getElementById("canvasses")); // TODO: ugly fix, ew
    self.panner = new Panner(self);

    // Grid state
    self.showGrid = false;

    // Model
    self.model = new Model(self);

    // Loopy: SPEED!
    self.signalSpeed = 3;

    // Sidebar
    self.sidebar = new Sidebar(self);
    self.sidebar.showPage("Edit"); // start here

    // Play/Edit mode
    self.mode = Loopy.MODE_EDIT;

    // Centrality
    self.showCentrality = false;

    // NIRA: impacto y estado de análisis
    self.showImpact = false;     // pinta auras de impacto en los nodos
    self._niraRunning = false;   // true mientras corre un análisis
    
    self.niraCache = {
        hash: null,
        simulaciones: 0,
        results: null
    };
    
    // Tools
    self.toolbar = new Toolbar(self);
    self.tool = Loopy.TOOL_INK;
    self.ink = new Ink(self);
    self.drag = new Dragger(self);
    self.erase = new Eraser(self);
    self.label = new Labeller(self);

    // Play Controls
    self.playbar = new PlayControls(self);
    self.playbar.showPage("Editor"); // start here

    // Modal
    self.modal = new Modal(self);

    // Undo stack
    self.undoStack = [];
    self.isUndoing = false;

    //////////
    // INIT //
    //////////

    self.init = function(){
        self.loadFromURL(); // try it.
    };

    ///////////////////
    // UPDATE & DRAW //
    ///////////////////

    // Update
    self.update = function(){
        Mouse.update();
        if(self.wobbleControls>=0) self.wobbleControls--; // wobble
        if(!self.modal.isShowing){ // modAl
            self.model.update(); // modEl
        }
    };
    setInterval(self.update, 1000/30); // 30 FPS, why not.

    // Draw
    self.draw = function(){
        if(!self.modal.isShowing){ // modAl
            self.model.draw(); // modEl
        }
        requestAnimationFrame(self.draw);
    };

    // TODO: Smarter drawing of Ink, Edges, and Nodes
    // (only Nodes need redrawing often. And only in PLAY mode.)

    //////////////////////
    // PLAY & EDIT MODE //
    //////////////////////

    self.showPlayTutorial = false;
    self.wobbleControls = -1;
    self.setMode = function(mode){

        self.mode = mode;
        publish("loopy/mode");

        // Play mode!
        if(mode==Loopy.MODE_PLAY){
            self.showPlayTutorial = true; // show once!
            if(!self.embedded) self.wobbleControls=45; // only if NOT embedded
            self.sidebar.showPage("Edit");
            self.playbar.showPage("Player");
            self.sidebar.dom.setAttribute("mode","play");
            self.toolbar.dom.setAttribute("mode","play");
            document.getElementById("canvasses").removeAttribute("cursor"); // TODO: EVENT BASED
        }else{
            publish("model/reset");
        }

        // Edit mode!
        if(mode==Loopy.MODE_EDIT){
            self.showPlayTutorial = false; // donezo
            self.wobbleControls = -1; // donezo
            self.sidebar.showPage("Edit");
            self.playbar.showPage("Editor");
            self.sidebar.dom.setAttribute("mode","edit");
            self.toolbar.dom.setAttribute("mode","edit");
            document.getElementById("canvasses").setAttribute("cursor", self.toolbar.currentTool); // TODO: EVENT BASED
        }

    };

    /////////////////
    // SAVE & LOAD //
    /////////////////

    self.dirty = false;

    // YOU'RE A DIRTY BOY
    var _autosaveTimeout = null;
    var _serverAutosaveTimeout = null;
    subscribe("model/changed", function(){
        if(!self.embedded) self.dirty = true;
        self.invalidateNiraCache(); 
        
        if(!self.embedded){

            // Local autosave
            clearTimeout(_autosaveTimeout);
            _autosaveTimeout = setTimeout(function(){
                localStorage.setItem("loopy_autosave", self.model.serialize());
                if(self.id) localStorage.setItem("loopy_id", self.id);
                else localStorage.removeItem("loopy_id");
            }, 500);

            // Server autosave
            if(self.id){
                clearTimeout(_serverAutosaveTimeout);
                _serverAutosaveTimeout = setTimeout(function(){
                    if(self.id && self.dirty){
                        var data = self.model.serialize();
                        fetch(self.base + "save.php?id=" + self.id, {
                            method: "POST",
                            body: data
                        });
                    }
                }, 2000);
            }
        }
    });

    subscribe("model/new/confirm", function(){
        publish("modal", ["model/new/confirm"]);
    });

    subscribe("model/new", function(){
        // 1. Borrar autosave de localStorage
        localStorage.removeItem("loopy_autosave");
        localStorage.removeItem("loopy_id");

        // 2. Cancelar autosaves pendientes y limpiar ID local
        self.id = null;
        clearTimeout(_autosaveTimeout);
        clearTimeout(_serverAutosaveTimeout);

        // 3. Verificar si hay ID en la URL (query param o path)
        var search = window.location.search;
        var hasQueryId = (search.indexOf("id=") !== -1);

        var hasPathId = false;
        var path = window.location.pathname;
        if(path.length > self.base.length){
            var relative = path.substring(self.base.length);
            hasPathId = /^([a-zA-Z0-9]{8})/.test(relative);
        }

        if(hasQueryId || hasPathId){
            // Redirigir a la URL base sin ID
            var baseUrl = window.location.origin + self.base;
            window.location.href = baseUrl;
        }else{
            // Limpiar canvas en el lugar
            self.model.newModel();
        }
    });

    subscribe("export/file", function(){
        publish("modal", ["save_file"]);
    });

    subscribe("save/png", function(){
        var modelCanvas = self.model.canvas;
        var inkCanvas = self.ink.canvas;
        
        // Use the actual displayed size based on viewport and transform
        var canvasses = document.getElementById('canvasses');
        var canvasWidth = modelCanvas.width;
        var canvasHeight = modelCanvas.height;
        
        // Create a temporary canvas for compositing
        var tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasWidth;
        tempCanvas.height = canvasHeight;
        var tempCtx = tempCanvas.getContext('2d');
        
        // 1. Fill with white background
        tempCtx.fillStyle = "#fff";
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // 2. Draw the model (and ink)
        // They already have the transform applied in their own draw methods
        tempCtx.drawImage(modelCanvas, 0, 0);
        tempCtx.drawImage(inkCanvas, 0, 0);

        // 3. Draw the analysis grid if it's visible
        var gridOverlay = document.getElementById('grid-overlay');
        if (gridOverlay && gridOverlay.classList.contains('show')) {
            // Grid covers the whole canvas
            var gridLeft = 0;
            var gridTop = 0;
            var gridWidth = tempCanvas.width;
            var gridHeight = tempCanvas.height;
            
            var cellWidth = gridWidth / 3;
            var cellHeight = gridHeight / 3;
            
            // Grid labels based on the HTML structure
            var gridLabels = [
                'Atención', 'Cognición', 'Self',
                'Afecto', 'Conducta', 'Motivación',
                'Biofisiológico', 'Contexto', 'Sociocultural'
            ];
            
            // Draw grid lines
            tempCtx.strokeStyle = '#cccccc';
            tempCtx.lineWidth = 1;
            tempCtx.setLineDash([5, 5]);
            
            // Vertical lines
            for (var i = 1; i < 3; i++) {
                tempCtx.beginPath();
                tempCtx.moveTo(gridLeft + i * cellWidth, gridTop);
                tempCtx.lineTo(gridLeft + i * cellWidth, gridTop + gridHeight);
                tempCtx.stroke();
            }
            
            // Horizontal lines
            for (var i = 1; i < 3; i++) {
                tempCtx.beginPath();
                tempCtx.moveTo(gridLeft, gridTop + i * cellHeight);
                tempCtx.lineTo(gridLeft + gridWidth, gridTop + i * cellHeight);
                tempCtx.stroke();
            }
            
            tempCtx.setLineDash([]);
            
            // Calculate font size that scales with grid cell
            var fontSize = 48; // Legible on retina
            
            // Draw labels
            tempCtx.font = "bold " + fontSize + "px 'Figtree', sans-serif";
            tempCtx.textAlign = "center";
            tempCtx.textBaseline = "middle";
            tempCtx.fillStyle = "rgba(136, 136, 136, 0.5)";
            
            for (var row = 0; row < 3; row++) {
                for (var col = 0; col < 3; col++) {
                    var label = gridLabels[row * 3 + col];
                    var x = gridLeft + cellWidth * col + cellWidth / 2;
                    var y = gridTop + cellHeight * row + cellHeight / 2;
                    tempCtx.fillText(label, x, y);
                }
            }
        }

        // 4. Trigger download
        var link = document.createElement('a');
        link.setAttribute('download', "system_model.png");
        link.setAttribute('href', tempCanvas.toDataURL("image/png"));
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    subscribe("import/file", function(){
        let input = document.createElement('input');
        input.type = 'file';
        input.onchange = e => {
            var file = e.target.files[0];
            var reader = new FileReader();
            reader.readAsText(file,'UTF-8');
            reader.onload = readerEvent => {
                var content = readerEvent.target.result;
                self.model.deserialize(content);
            }
        };
        input.click();
    });

    // Delete key: remove selected element
    subscribe("key/delete", function(){
        var active = document.activeElement;
        if(active.tagName === "INPUT" || active.tagName === "TEXTAREA") return;
        var page = self.sidebar.currentPage;
        if(page && page.target && page.target.kill){
            page.target.kill();
            self.sidebar.showPage("Edit");
        }
    });

    // Undo
    self.saveUndo = function(){

        // Only if in edit mode and not currently undoing
        if(self.mode != Loopy.MODE_EDIT) return;
        if(self.isUndoing) return;

        // Coalesce multiple calls (e.g. killing node kills its edges)
        if(self._undoTimeout) return;
        var state = self.model.serialize();
        self._undoTimeout = setTimeout(function(){
            self._undoTimeout = null;
            self.undoStack.push(state);
            if(self.undoStack.length > 10){
                self.undoStack.shift();
            }
        }, 10);

    };
    self.undo = function(){

        // Only if in edit mode
        if(self.mode != Loopy.MODE_EDIT) return;

        // Get last state
        var state = self.undoStack.pop();
        if(!state) return;

        // Restore state
        self.isUndoing = true;
        self.model.deserialize(decodeURIComponent(state));
        self.isUndoing = false;

    };
    subscribe("key/undo", function(){
        if(Key.control){
            self.undo();
        }
    });

    self.saveToURL = function(embed){

        // Create link
        var dataString = self.model.serialize();
        var uri = dataString; // encodeURIComponent(dataString);
        var base = window.location.origin + self.base;
        var historyLink = base+"?data="+uri;
        var link;
        if(embed){
            link = base+"?embed=1&data="+uri;
        }else{
            link = historyLink;
        }

        // NO LONGER DIRTY!
        self.dirty = false;

        // PUSH TO HISTORY
        window.history.replaceState(null, null, historyLink);

        return link;
    };
    
    // "BLANK START" DATA:
    var _blankData = "[[[1,459,609,0,%22Ansiedad%22,4],[2,293,773,0,%22Evitaci%25C3%25B3n%22,0]],[[2,1,100,1,0],[1,2,100,1,0]],[[364,944,%22Russ%2520Harris%2520(2019)%2520-%2520Diagrama%2520DOTS%253A%250A%2520%2520Ansiedad%2520-%253E%2520Evitaci%25C3%25B3n%2520-%253E%2520Alivio%2520temporal%2520-%253E%2520Ansiedad.%250A%250A%2520En%2520Loopy%253A%250A%2520Ansiedad%2520%253C-%253E%2520Evitaci%25C3%25B3n%2520experiencial%2520%250A%2520(se%2520refuerzan%2520mutuamente).%22]],3%5D";


    self.loadFromURL = function(){
        // 1. Load from URL data parameter (long URL)
        var data = _getParameterByName("data");
        if(data){
            self.model.deserialize(data);
            return;
        }

        // 2. Load from short ID
        var id = _getParameterByName("id");
        if(!id){
            // Try to get from pathname (8-char alphanumeric after the base path)
            var path = window.location.pathname;
            if(path.length > self.base.length){
                var relative = path.substring(self.base.length);
                var match = relative.match(/^([a-zA-Z0-9]{8})/);
                if(match) id = match[1];
            }
        }

        if(id){
            fetch(self.base + "save.php?id="+id)
                .then(function(response){
                    if(response.ok) return response.text();
                    throw new Error("Model not found");
                })
                .then(function(text){
                    self.id = id;
                    self.model.deserialize(decodeURIComponent(text));
                    self.model.center();
                    self.dirty = false;
                })
                .catch(function(err){
                    console.error(err);
                    // Fallback to blank
                    self.model.deserialize(decodeURIComponent(_blankData));
                });
            return;
        }

        // 3. Autosave or blank start
        var autosaved = localStorage.getItem("loopy_autosave");
        if(autosaved){
            try{
                self.id = null;
                self.model.deserialize(decodeURIComponent(autosaved));
            }catch(e){
                localStorage.removeItem("loopy_autosave");
                localStorage.removeItem("loopy_id");
                self.model.deserialize(decodeURIComponent(_blankData));
            }
        }else{
            self.model.deserialize(decodeURIComponent(_blankData));
        }
    };

        // ==========================================
    // NIRA: Funciones de Caché
    // ==========================================
    self.getModelHash = function() {
        var model = self.model;
        var nodes = model.nodes.map(function(n) {
            return { id: n.id, label: n.label, init: n.init };
        }).sort(function(a, b) { return a.id - b.id; });

        var edges = model.edges.map(function(e) {
            return { from: e.from.id, to: e.to.id, signal: e.signal };
        }).sort(function(a, b) {
            return (a.from - b.from) || (a.to - b.to);
        });

        return JSON.stringify({ nodes: nodes, edges: edges });
    };

    self.invalidateNiraCache = function() {
        self.niraCache.hash = null;
        self.niraCache.results = null;
    };
    
    ///////////////////////////
    //////// EMBEDDED? ////////
    ///////////////////////////

    self.init();

    if(self.embedded){

        // Hide all that UI
        self.toolbar.dom.style.display = "none";
        self.sidebar.dom.style.display = "none";
        document.body.classList.add("embed-mode");

        // If *NO UI AT ALL*
        var noUI = !!parseInt(_getParameterByName("no_ui")); // force to Boolean
        if(noUI){
            _PADDING_BOTTOM = _PADDING;
            self.playbar.dom.style.display = "none";
        }

        // Fullscreen canvas
        document.getElementById("canvasses").setAttribute("fullscreen","yes");
        self.playbar.dom.setAttribute("fullscreen","yes");
        publish("resize");

        // Center & SCALE The Model
        self.model.center(true);
        subscribe("resize",function(){
            self.model.center(true);
        });

        // Autoplay!
        self.setMode(Loopy.MODE_PLAY);

        // Also, HACK: auto signal
        var signal = _getParameterByName("signal");
        if(signal){
            signal = JSON.parse(signal);
            var node = self.model.getNode(signal[0]);
            node.takeSignal({
                delta: signal[1]*0.33
            });
        }

    }else{
        // Center all the nodes & labels
        self.model.center();
    }

    // NOT DIRTY, THANKS
    self.dirty = false;

    // SHOW ME, THANKS
    document.body.style.opacity = "";

    // GO.
    requestAnimationFrame(self.draw);


}
