(function(exports){

    var Panner = function(loopy){

        var self = this;
        self.loopy = loopy;

        var canvasses = document.getElementById('canvasses');
        var MIN_SCALE = 0.55;
        var MAX_SCALE = 2.0;

        // Prevent context menu to allow right-click panning
        canvasses.addEventListener('contextmenu', function(e) {
            e.preventDefault();
        });

        var isPanning = false;
        var lastCanvasX, lastCanvasY;

        var _onmousedown = function(){
            
            var shouldPan = false;

            // 1. Space + Left Click
            if(Key.space && Mouse.button === 0) shouldPan = true;

            // 2. Middle Click (button 1) only - right click no longer pans
            if(Mouse.button === 1) shouldPan = true;
            
            if(shouldPan){
                isPanning = true;
                lastCanvasX = Mouse.canvasX;
                lastCanvasY = Mouse.canvasY;
            } else {
                isPanning = false;
            }
        };

        var _onmousemove = function(){
            if(isPanning){
                var dx = Mouse.canvasX - lastCanvasX;
                var dy = Mouse.canvasY - lastCanvasY;

                loopy.offsetX += dx;
                loopy.offsetY += dy;

                lastCanvasX = Mouse.canvasX;
                lastCanvasY = Mouse.canvasY;

                publish("view/changed");
            }
        };

        var _onmouseup = function(){
            isPanning = false;
        };

        subscribe("mousedown", _onmousedown);
        subscribe("mousemove", _onmousemove);
        subscribe("mouseup", _onmouseup);

        // Also stop panning if window loses focus
        window.addEventListener('blur', function() {
            isPanning = false;
        });

        // Global mouseup/touchend ensures panning stops even if mouse is released outside canvas
        window.addEventListener('mouseup', function() {
            isPanning = false;
        });
        window.addEventListener('touchend', function() {
            isPanning = false;
        });


    // --- ZOOM LOGIC ---
    // Scroll wheel zoom (PC) - SOLO con Ctrl/Cmd
canvasses.addEventListener('wheel', function(e) {
    // if (!e.ctrlKey && !e.metaKey) return; // sin Ctrl/Cmd, no hacer nada
    e.preventDefault();

    var delta = e.deltaY || e.detail || -e.wheelDelta;
    var zoomFactor = delta > 0 ? 0.9 : 1.1;
    var newScale = loopy.offsetScale * zoomFactor;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    // Zoom siempre centrado en el medio del canvas,
    // sin importar dónde esté el mouse.
    var rect = canvasses.getBoundingClientRect();
    var centerX = rect.width / 2;
    var centerY = rect.height / 2;

    var scaleChange = newScale / loopy.offsetScale;

    loopy.offsetX = centerX - (centerX - loopy.offsetX) * scaleChange;
    loopy.offsetY = centerY - (centerY - loopy.offsetY) * scaleChange;
    loopy.offsetScale = newScale;

    publish("view/changed");
}, { passive: false });

        // --- MOBILE PAN & PINCH ---
        var startTouchDistance = 0;
        var initialPinchScale = 1;
        var lastTouchCenter = null;
        var cachedRect = null;

        function getTouchDistance(touch1, touch2) {
            var dx = touch1.clientX - touch2.clientX;
            var dy = touch1.clientY - touch2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function getTouchCenter(touch1, touch2) {
            return {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };
        }

        canvasses.addEventListener('touchstart', function(e) {
            if (e.touches.length === 2) {
                e.preventDefault();
                startTouchDistance = getTouchDistance(e.touches[0], e.touches[1]);
                initialPinchScale = loopy.offsetScale;
                lastTouchCenter = getTouchCenter(e.touches[0], e.touches[1]);
                cachedRect = canvasses.getBoundingClientRect();
            }
        }, { passive: false });

        canvasses.addEventListener('touchmove', function(e) {
            if (e.touches.length === 2 && cachedRect) {
                e.preventDefault();
                
                var currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
                var currentCenter = getTouchCenter(e.touches[0], e.touches[1]);
                
                // Center point relative to canvas
                var touchCenterX = currentCenter.x - cachedRect.left;
                var touchCenterY = currentCenter.y - cachedRect.top;
                var lastCenterX = lastTouchCenter.x - cachedRect.left;
                var lastCenterY = lastTouchCenter.y - cachedRect.top;

                // 1. Panning (2-finger)
                var dx = touchCenterX - lastCenterX;
                var dy = touchCenterY - lastCenterY;
                loopy.offsetX += dx;
                loopy.offsetY += dy;

                // 2. Pinch Zoom
                if(startTouchDistance > 0){
                    var scaleFactor = currentDistance / startTouchDistance;
                    var newScale = initialPinchScale * scaleFactor;
                    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
                    
                    var scaleChange = newScale / loopy.offsetScale;
                    loopy.offsetX = touchCenterX - (touchCenterX - loopy.offsetX) * scaleChange;
                    loopy.offsetY = touchCenterY - (touchCenterY - loopy.offsetY) * scaleChange;
                    loopy.offsetScale = newScale;
                }
                
                lastTouchCenter = currentCenter;

                publish("view/changed");
            }
        }, { passive: false });

// ==========================================
// TAP EN CANVAS VACÍO → CERRAR SIDEBAR (móvil/tablet)
// ==========================================
// Comportamiento deseado:
// - Solo en pantallas chicas/táctiles.
// - Solo si el sidebar está abierto.
// - Solo si el tap fue limpio: sin arrastre, sin pan, sin pinch.
// - Solo si el tap NO cayó sobre un nodo, arista ni label.
// - No interfiere con la herramienta LABEL.
// - No interfiere durante NIRA ni con modales abiertos.

var _tapDismiss = {
    active: false,
    id: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    moved: false,
    multiTouch: false
};

function _isSidebarOpen() {
    var sidebar = document.getElementById("sidebar");
    return sidebar && sidebar.classList.contains("show");
}

function _closeSidebarMobile() {
    var toggle = document.getElementById("sidebar-toggle");

    if (toggle) {
        toggle.click();
        return;
    }

    // Fallback por si el botón no existe en algún modo embebido.
    var sidebar = document.getElementById("sidebar");
    if (sidebar) {
        sidebar.classList.remove("show");
    }
}

canvasses.addEventListener("touchstart", function(e) {
    // Solo móvil/tablet según el breakpoint que ya usa Loopy.
    if (window.innerWidth > 768) {
        _tapDismiss.active = false;
        return;
    }

    // No interferir si está corriendo NIRA.
    if (loopy._niraRunning) {
        _tapDismiss.active = false;
        return;
    }

    // No interferir si hay un modal abierto.
    if (loopy.modal && loopy.modal.isShowing) {
        _tapDismiss.active = false;
        return;
    }

    // Solo tiene sentido si el sidebar está abierto.
    if (!_isSidebarOpen()) {
        _tapDismiss.active = false;
        return;
    }

    // Si hay dos dedos, cancelamos: es pan/pinch, no tap para cerrar.
    if (e.touches.length > 1) {
        _tapDismiss.active = false;
        _tapDismiss.multiTouch = true;
        return;
    }

    var touch = e.touches[0];

    _tapDismiss.active = true;
    _tapDismiss.id = touch.identifier;
    _tapDismiss.startX = touch.clientX;
    _tapDismiss.startY = touch.clientY;
    _tapDismiss.startTime = Date.now();
    _tapDismiss.moved = false;
    _tapDismiss.multiTouch = false;
}, { passive: true });

canvasses.addEventListener("touchmove", function(e) {
    if (!_tapDismiss.active) return;

    // Si aparece un segundo dedo, ya no es un tap limpio.
    if (e.touches.length > 1) {
        _tapDismiss.active = false;
        _tapDismiss.multiTouch = true;
        return;
    }

    // Buscar el mismo touch por identifier.
    var touch = null;
    for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === _tapDismiss.id) {
            touch = e.touches[i];
            break;
        }
    }

    if (!touch) return;

    var dx = Math.abs(touch.clientX - _tapDismiss.startX);
    var dy = Math.abs(touch.clientY - _tapDismiss.startY);

    // Si se movió demasiado, fue arrastre/pan, no tap.
    if (dx > 15 || dy > 15) {
        _tapDismiss.moved = true;
    }
}, { passive: true });

canvasses.addEventListener("touchend", function(e) {
    if (!_tapDismiss.active) return;

    _tapDismiss.active = false;

    // Solo móvil/tablet.
    if (window.innerWidth > 768) return;

    // Si hubo segundo dedo, no cerrar.
    if (_tapDismiss.multiTouch) return;

    // Si hubo movimiento, no cerrar.
    if (_tapDismiss.moved) return;

    // Si fue long press, no cerrar.
    // 450 ms es generoso pero evita confundirse con presión prolongada.
    if (Date.now() - _tapDismiss.startTime > 450) return;

    // Re-checks por si algo cambió entre touchstart y touchend.
    if (loopy._niraRunning) return;
    if (loopy.modal && loopy.modal.isShowing) return;
    if (!_isSidebarOpen()) return;

    // Si estamos en herramienta LABEL, un tap vacío crea label.
    // No queremos cerrar el menú en ese caso.
    if (loopy.tool === Loopy.TOOL_LABEL) return;

    // Obtener el touch que terminó.
    var changed = null;
    for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === _tapDismiss.id) {
            changed = e.changedTouches[i];
            break;
        }
    }

    if (!changed) changed = e.changedTouches[0];
    if (!changed) return;

    // Convertir coordenadas de pantalla a coordenadas de canvas.
    var rect = canvasses.getBoundingClientRect();
    var canvasX = changed.clientX - rect.left;
    var canvasY = changed.clientY - rect.top;

    // Convertir coordenadas de canvas a coordenadas de mundo.
    var worldX = (canvasX - loopy.offsetX) / loopy.offsetScale;
    var worldY = (canvasY - loopy.offsetY) / loopy.offsetScale;

    // Si el tap cayó sobre un nodo, arista o label, NO cerrar.
    // Eso debe seguir seleccionando/editando el objeto.
    if (loopy.model.getNodeByPoint(worldX, worldY)) return;
    if (loopy.model.getLabelByPoint(worldX, worldY)) return;
    if (loopy.model.getEdgeByPoint(worldX, worldY)) return;

    // Era canvas vacío: cerrar el menú.
    _closeSidebarMobile();
}, { passive: true });

canvasses.addEventListener("touchcancel", function() {
    _tapDismiss.active = false;
    _tapDismiss.multiTouch = false;
    _tapDismiss.moved = false;
}, { passive: true });


    };

    exports.Panner = Panner;

})(window);
