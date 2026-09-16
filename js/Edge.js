/**********************************

EDGE!

**********************************/

Edge.allSignals = [];
Edge.MAX_SIGNALS = 100;
Edge.MAX_SIGNALS_PER_EDGE = 10;
Edge.defaultStrength = 0.1;

function Edge(model, config){

    var self = this;
    self._CLASS_ = "Edge";

    // Mah Parents!
    self.loopy = model.loopy;
    self.model = model;
    self.config = config;

    // Default values...
    _configureProperties(self, config, {
        from: _makeErrorFunc("CAN'T LEAVE 'FROM' BLANK"),
        to: _makeErrorFunc("CAN'T LEAVE 'TO' BLANK"),
        arc: 100,
        rotation: 0,
        strength: Edge.defaultStrength
    });

    // Get my NODES
    self.from = model.getNode(self.from);
    self.to = model.getNode(self.to);

    // We have signals!
    self.signals = [];
    self.signalSpeed = 0;
    self.addSignal = function(signal){

        // IF ALREADY TOO MANY, FORGET IT
        if(Edge.allSignals.length>Edge.MAX_SIGNALS){
            return;
        }

        // IF TOO MANY *ON THIS EDGE*, FORGET IT
        if(self.signals.length>Edge.MAX_SIGNALS_PER_EDGE){
            return;
        }

        // Re-create signal
        var delta = signal.delta;
        var age;
        if(signal.age===undefined){
            // age = 13; // cos divisible by 1,2,3,4 + 1
            age = 1000000; // actually just make signals last "forever".
        }else{
            age = signal.age-1;
        }
        var newSignal = {
            delta: delta,
            position: 0,
            scaleX: Math.abs(delta),
            scaleY: delta,
            age: age
        };

        // If it's expired, forget it.
        if(age<=0) return;

        self.signals.unshift(newSignal); // it's a queue!

        // ALL signals.
        Edge.allSignals.push(newSignal);

    };
    self.updateSignals = function(){

        // Speed?
        var speed = Math.pow(2,self.loopy.signalSpeed);
        self.signalSpeed = speed/self.getArrowLength();

        // Move all signals along
        for(var i=0; i<self.signals.length; i++){
            
            var signal = self.signals[i];
            var lastPosition = signal.position;
            signal.position += self.signalSpeed;

            // If crossed the 0.5 mark...
            /*
            if(lastPosition<0.5 && signal.position>=0.5){

                // Multiply by this edge's strength!
                signal.delta *= self.strength;

            }

            // And also TWEEN the scale.
            var gotoScaleX = Math.abs(signal.delta);
            var gotoScaleY = signal.delta;
            signal.scaleX = signal.scaleX*0.8 + gotoScaleX*0.2;
            signal.scaleY = signal.scaleY*0.8 + gotoScaleY*0.2;
            */

        }

        // If any signals reach >=1, pass 'em along
        var lastSignal = self.signals[self.signals.length-1];
        while(lastSignal && lastSignal.position>=1){

            // Actually pass it along
            var effectiveStrength = Math.sign(self.strength) * (0.3 + 0.7 * Math.abs(self.strength));
            lastSignal.delta *= effectiveStrength; // flip at the end only!
            self.to.takeSignal(lastSignal);
            
            // Pop it, move on down
            self.removeSignal(lastSignal);
            lastSignal = self.signals[self.signals.length-1];

        }

    };
    self.removeSignal = function(signal){
        self.signals.splice( self.signals.indexOf(signal), 1 );
        Edge.allSignals.splice( Edge.allSignals.indexOf(signal), 1 );
    };
    self.drawSignals = function(ctx){
    
        // Draw each one
        for(var i=0; i<self.signals.length; i++){

            // Get position to draw at
            var signal = self.signals[i];
            var signalPosition = self.getPositionAlongArrow(signal.position);
            var signalX = signalPosition.x;
            var signalY = signalPosition.y;

            // Transform
            ctx.save();
            ctx.translate(signalX, signalY);
            ctx.rotate(-a);

            // Signal's direction & size
            var size = 18;
            var sX = signal.direction >= 0 ? 1.0 : -1.0;
            var sY = signal.direction >= 0 ? 1.0 : -1.0;
            ctx.scale(sX, sY);
            ctx.scale(size, size);

            // Signal's COLOR, BLENDING
            var fromColor = Node.COLORS[self.from.hue];
            var toColor = Node.COLORS[self.to.hue];
            var blend;
            var bStart=0.4, bEnd=0.6;
            if(signal.position<bStart){
                blend = 0;
            }else if(signal.position<bEnd){
                blend = (signal.position-bStart)/(bEnd-bStart);
            }else{
                blend = 1;
            }
            var signalColor = _blendColors(fromColor, toColor, blend);

            // Also, tween the scaleY, flipping, IF STRENGTH<0
            if(self.strength<0){
                // sin/cos-animate it for niceness.
                var flip = Math.cos(blend*Math.PI); // (0,1) -> (1,-1)
                ctx.scale(1, flip);
            }

            // Signal's age = alpha.
            if(signal.age==2){
                ctx.globalAlpha = 0.5;
            }else if(signal.age==1){
                ctx.globalAlpha = 0.25;
            }

            // Draw an arrow
            ctx.beginPath();
            ctx.moveTo(-2,0);
            ctx.lineTo(0,-2);
            ctx.lineTo(2,0);
            ctx.lineTo(1,0);
            ctx.lineTo(1,2);
            ctx.lineTo(-1,2);
            ctx.lineTo(-1,0);
            ctx.fillStyle = signalColor;
            ctx.fill();

            // Restore
            ctx.restore();

        }

    };
    var _listenerReset = subscribe("model/reset", function(){
        self.signals = [];
        Edge.allSignals = [];
    });


    //////////////////////////////////////
    // UPDATE & DRAW /////////////////////
    //////////////////////////////////////

    // Update!
    self.labelX = 0;
    self.labelY = 0;
    var fx, fy, tx, ty,
        r, dx, dy, w, a, h,
        y, a2,
        arrowBuffer, arrowDistance, arrowAngle, beginDistance, beginAngle,
        startAngle, endAngle,
        y2, begin, end,
        arrowLength, ax, ay, aa,
        labelAngle, lx, ly, labelBuffer; // BECAUSE I'VE LOST CONTROL OF MY LIFE.
    self.update = function(speed){

        ////////////////////////////////////////////////
        // PRE-CALCULATE THE MATH (for retina canvas) //
        ////////////////////////////////////////////////

        // Edge case: if arc is EXACTLY zero, whatever, add 0.1 to it.
        if(self.arc==0) self.arc=0.1;

        // Mathy calculations: (all retina, btw)
        fx=self.from.x*2;
        fy=self.from.y*2;
        tx=self.to.x*2;
        ty=self.to.y*2;    
        if(self.from==self.to){
            var rotation = self.rotation;
            rotation *= Math.TAU/360;
            tx += Math.cos(rotation);
            ty += Math.sin(rotation);
        }
        dx = tx-fx;
        dy = ty-fy;
        w = Math.sqrt(dx*dx+dy*dy);
        a = Math.atan2(dy,dx);
        h = Math.abs(self.arc*2);

        // From: http://www.mathopenref.com/arcradius.html
        r = (h/2) + ((w*w)/(8*h));
        y = r-h; // the circle's y-pos is radius - given height.
        a2 = Math.acos((w/2)/r); // angle from x axis, arc-cosine of half-width & radius

        // Arrow buffer...
        arrowBuffer = 15;
        arrowDistance = (self.to.getDisplayRadius()+arrowBuffer)*2;
        arrowAngle = arrowDistance/r; // (distance/circumference)*TAU, close enough.
        beginDistance = (self.from.getDisplayRadius()+arrowBuffer)*2;
        beginAngle = beginDistance/r;

        // Arc it!
        startAngle = a2 - Math.TAU/2;
        endAngle = -a2;
        if(h>r){
            startAngle *= -1;
            endAngle *= -1;
        }
        if(self.arc>0){
            y2 = y;
            begin = startAngle+beginAngle;
            end = endAngle-arrowAngle;
        }else{
            y2 = -y;
            begin = -startAngle-beginAngle;
            end = -endAngle+arrowAngle;
        }

        // Persist arc geometry params for hit-testing
        self.r = r;
        self.y2 = y2;
        self.begin = begin;
        self.end = end;
        self.a = a;
        self.w = w;
        self.y = y;

        // Arrow HEAD!
        arrowLength = 10*2;
        ax = w/2 + Math.cos(end)*r;
        ay = y2 + Math.sin(end)*r;
        aa = end + Math.TAU/4;

        // Label position
        var labelPosition = self.getPositionAlongArrow(0.5);
        lx = labelPosition.x;
        ly = labelPosition.y;

        // ACTUAL label position, for grabbing purposes
        self.labelX = (fx + Math.cos(a)*lx - Math.sin(a)*ly)/2; // un-retina
        self.labelY = (fy + Math.sin(a)*lx + Math.cos(a)*ly)/2; // un-retina

        // ...add offset to label
        labelBuffer = 18*2; // retina
        if(self.arc<0) labelBuffer*=-1;
        ly += labelBuffer;

        ///////////////////////////////////////
        // AND THEN UPDATE OTHER STUFF AFTER //
        // THE CALCULATIONS ARE DONE I GUESS //
        ///////////////////////////////////////

        // When actually playing the simulation...
        /*if(self.loopy.mode==Loopy.MODE_PLAY){
            self.to.nextValue += self.from.value * self.strength * speed;
        }*/

        // Update signals
        self.updateSignals();

    };

    // Get position along arrow, on what parameter?
    self.getArrowLength = function(){
        var angle;
        if(self.from==self.to){
            // angle = Math.TAU;
            return r*Math.TAU - 2*self.from.getDisplayRadius();
        }else{
            //debugger;
            if(y<0){
                // arc's center is above the horizon
                if(self.arc<0){ // ccw
                    angle = Math.TAU + begin - end;
                }else{ // cw
                    angle = Math.TAU + end - begin;
                }
            }else{
                // arc's center is below the horizon
                angle = Math.abs(end-begin);
            }
        }
        return r*angle;
    };
    self.getPositionAlongArrow = function(param){

        param = -0.05 + param*1.1; // (0,1) --> (-0.05, 1.05)

        // If the arc's circle is actually BELOW the line...
        var begin2 = begin;
        if(y<0){
            // DON'T KNOW WHY THIS WORKS, BUT IT DOES.
            if(begin2>0){
                begin2-=Math.TAU;
            }else{
                begin2+=Math.TAU;
            }
        }

        // Get angle!
        var angle = begin2 + (end-begin2)*param;
        
        // return x & y
        return{
            x: w/2 + Math.cos(angle)*r,
            y: y2 + Math.sin(angle)*r
        };

    };

    // Draw
    self.draw = function(ctx){

        // Width & Color
        ctx.lineWidth = 2 + 8 * Math.abs(self.strength);
        ctx.strokeStyle = "#666";

        // Translate & Rotate!
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(a);

        // Highlight!
        if(self.loopy.sidebar.currentPage.target == self){
            ctx.save();
            ctx.translate(lx, ly);
            ctx.rotate(-a);
            ctx.beginPath();
            ctx.arc(0, 5, 60, 0, Math.TAU, false);
            ctx.fillStyle = HIGHLIGHT_COLOR;
            ctx.fill();
            ctx.restore();
        }

        // Arc it!
        var headSize = 10 + 10 * Math.abs(self.strength); // move this up
        var endAngleOffset = (headSize*1.0) / r;
        ctx.beginPath();
        if(self.arc>0){
            ctx.arc(w/2, y2, r, startAngle, end - endAngleOffset, false);
        }else{
            ctx.arc(w/2, y2, r, -startAngle, end + endAngleOffset, true);
        }
        ctx.stroke();

        // Arrow HEAD!
        ctx.save();
        ctx.translate(ax, ay);
        if(self.arc<0) ctx.scale(-1,-1);
        ctx.rotate(aa);

        // Arrow Head Size
        // var headSize = 10 + 10 * Math.abs(self.strength); // already moved up
        ctx.beginPath();
        ctx.moveTo(-headSize, -headSize);
        ctx.lineTo(0,0);
        ctx.lineTo(-headSize, headSize);
        ctx.closePath();

        // Fill or Stroke
        if(self.strength > 0){
            ctx.fillStyle = "#000";
            ctx.fill();
        } else {
            ctx.fillStyle = "#fff";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#000";
            ctx.stroke();
        }
        ctx.restore();

        // DRAW SIGNALS
        self.drawSignals(ctx);

        // Restore
        ctx.restore();

    };

    //////////////////////////////////////
    // KILL EDGE /////////////////////////
    //////////////////////////////////////

    self.kill = function(){

        // SAVE UNDO
        self.loopy.saveUndo();

        // Kill Listeners!
        unsubscribe("model/reset",_listenerReset);

        // Remove from parent!
        model.removeEdge(self);

        // Killed!
        publish("kill",[self]);

    };

    //////////////////////////////////////
    // HELPER METHODS ////////////////////
    //////////////////////////////////////

    var HIT_THRESHOLD = 20;

    self.isPointOnLabel = function(x, y){
        // TOTAL HACK: radius based on TOOL BEING USED.
        var radius;
        if(self.loopy.tool==Loopy.TOOL_DRAG || self.loopy.tool==Loopy.TOOL_INK) radius=40; // selecting, wide radius!
        else if(self.loopy.tool==Loopy.TOOL_ERASE) radius=25; // no accidental erase
        else radius = 15; // you wanna label close to edges
        return _isPointInCircle(x, y, self.labelX, self.labelY, radius);
    };

    self.isPointInHitbox = function(x, y){
        if(self.r === undefined || self.y2 === undefined ||
           self.begin === undefined || self.end === undefined ||
           self.a === undefined || self.w === undefined){
            return false;
        }

        var adaptiveThreshold = Math.min(HIT_THRESHOLD * Math.sqrt(self.r / 200), HIT_THRESHOLD * 2);

        var bbox = self.getBoundingBox();
        var margin = adaptiveThreshold;
        if(x < bbox.left - margin || x > bbox.right + margin ||
           y < bbox.top - margin || y > bbox.bottom + margin){
            return false;
        }
        var px = x * 2;
        var py = y * 2;
        var dx = px - self.from.x * 2;
        var dy = py - self.from.y * 2;
        var cosA = Math.cos(-self.a);
        var sinA = Math.sin(-self.a);
        var localX = dx * cosA - dy * sinA;
        var localY = dx * sinA + dy * cosA;
        var cx = self.w / 2;
        var cy = self.y2;
        var dist = Math.sqrt((localX - cx) * (localX - cx) + (localY - cy) * (localY - cy));

        // Check proximity to arc radius
        if(Math.abs(dist - self.r) > adaptiveThreshold){  // era HIT_THRESHOLD * 2
            return false;
        }
    
        if(Math.abs(dist - self.r) > adaptiveThreshold) return false;
    
        var pointAngle = Math.atan2(localY - cy, localX - cx);

        // Angular padding to include arrow head and base
        var angularPadding = adaptiveThreshold / self.r;  // era HIT_THRESHOLD * 2

        // Normalize begin/end to [0, 2*PI) for angular range check
        var b_corrected = self.begin;
        if(self.y < 0){
            if(b_corrected > 0) b_corrected -= Math.TAU;
            else b_corrected += Math.TAU;
        }
        var b = ((b_corrected % Math.TAU) + Math.TAU) % Math.TAU;
        var e = ((self.end % Math.TAU) + Math.TAU) % Math.TAU;
        var p = ((pointAngle % Math.TAU) + Math.TAU) % Math.TAU;
        var pad = angularPadding;
    
        if(self.arc > 0){
            // CW: ángulo crece de b a e
            b = ((b - pad) % Math.TAU + Math.TAU) % Math.TAU;
            e = ((e + pad) % Math.TAU + Math.TAU) % Math.TAU;
            if(b <= e){ if(p < b || p > e) return false; }
            else       { if(p < b && p > e) return false; }
        }else{
            // CCW (arc < 0): ángulo decrece de b a e, rango válido es [e, b]
            b = ((b + pad) % Math.TAU + Math.TAU) % Math.TAU;
            e = ((e - pad) % Math.TAU + Math.TAU) % Math.TAU;
            if(e <= b){ if(p < e || p > b) return false; }
            else      { if(p < e && p > b) return false; }
        }
    
        return true;
    };

    self.getBoundingBox = function(){

        // SPECIAL CASE: SELF-ARC
        if(self.from==self.to){

            var perpendicular = a-Math.TAU/4;
            var cx = fx + Math.cos(perpendicular)*-y2;
            var cy = fy + Math.sin(perpendicular)*-y2;
            cx = cx/2; // un-retina
            cy = cy/2; // un-retina

            var _radius = r/2; // un-retina

            return {
                left: cx - _radius,
                top: cy - _radius,
                right: cx + _radius,
                bottom: cy + _radius
            };

        }

        // THREE POINTS: start, end, and perpendicular with r
        var from = {x:self.from.x, y:self.from.y};
        var to = {x:self.to.x, y:self.to.y};
        var mid = {
            x:(from.x+to.x)/2,
            y:(from.y+to.y)/2
        };

        var perpendicular = a-Math.TAU/4;
        mid.x += Math.cos(perpendicular)*self.arc;
        mid.y += Math.sin(perpendicular)*self.arc;

        // TEST ALL POINTS

        var left = Infinity;
        var top = Infinity;
        var right = -Infinity;
        var bottom = -Infinity;
        var points = [from, to, mid];
        for(var i=0; i<points.length; i++){
            var point = points[i];
            var x = point.x;
            var y = point.y;
            if(left>x) left=x;
            if(top>y) top=y;
            if(right<x) right=x;
            if(bottom<y) bottom=y;
        }

        return {
            left: left,
            top: top,
            right: right,
            bottom: bottom
        };
    };


}
