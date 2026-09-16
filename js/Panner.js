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
            if (!e.ctrlKey && !e.metaKey) return; // sin Ctrl, no hacer nada
            e.preventDefault();
            var delta = e.deltaY || e.detail || -e.wheelDelta;
            var zoomFactor = delta > 0 ? 0.9 : 1.1;
            var newScale = loopy.offsetScale * zoomFactor;
            newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

            // Zoom toward mouse position
            var mouseX = Mouse.canvasX; 
            var mouseY = Mouse.canvasY;

            var scaleChange = newScale / loopy.offsetScale;
            loopy.offsetX = mouseX - (mouseX - loopy.offsetX) * scaleChange;
            loopy.offsetY = mouseY - (mouseY - loopy.offsetY) * scaleChange;
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

    };

    exports.Panner = Panner;

})(window);
