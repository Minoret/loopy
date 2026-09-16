window.Mouse = {};
Mouse.init = function(target){

    // Double-click detection
    var _lastClickTime = 0;
    var _DOUBLE_CLICK_THRESHOLD = 350;

    // Events!
    var _onmousedown = function(event){
        Mouse.moved = false;
        Mouse.pressed = true;
        Mouse.button = event.button;
        Mouse.originalEvent = event.originalEvent;
        Mouse.startedOnTarget = true;
        Mouse.startX = event.x;
        Mouse.startY = event.y;
        publish("mousedown");
    };
    var _onmousemove = function(event){

        // CANVAS COORDS
        Mouse.canvasX = event.x;
        Mouse.canvasY = event.y;

        // DO THE INVERSE
        var mx = (event.x - loopy.offsetX) / loopy.offsetScale;
        var my = (event.y - loopy.offsetY) / loopy.offsetScale;

        // Mouse!
        Mouse.x = mx;
        Mouse.y = my;

        // Movement threshold (slop) to avoid accidental drags from finger jitter
        var dx = event.x - Mouse.startX;
        var dy = event.y - Mouse.startY;
        var dist = Math.sqrt(dx*dx + dy*dy);
        if(dist > 8){
            Mouse.moved = true;
        }
        publish("mousemove");

    };
    var _onmouseup = function(){
        Mouse.pressed = false;
        Mouse.button = -1;
        if(Mouse.startedOnTarget){
            publish("mouseup");
            if(!Mouse.moved){
                publish("mouseclick");
                // Double-click detection: if two clicks within 350ms, emit mousedblclick
                var now = Date.now();
                if(now - _lastClickTime <= _DOUBLE_CLICK_THRESHOLD){
                    publish("mousedblclick", [Mouse.x, Mouse.y]);
                }
                _lastClickTime = now;
            }
        }
        Mouse.moved = false;
        Mouse.startedOnTarget = false;
    };

    // Add mouse & touch events!
    _addMouseEvents(target, _onmousedown, _onmousemove, _onmouseup);

    // Cursor & Update
    Mouse.target = target;
    Mouse.showCursor = function(cursor){
        Mouse.target.style.cursor = cursor;
    };
    Mouse.update = function(){
        Mouse.showCursor("");
    };

};