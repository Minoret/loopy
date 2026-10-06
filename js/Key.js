(function(exports){

    // Singleton
    var Key = {};
    exports.Key = Key;

    // Keycodes to words mapping
    var KEY_CODES = {
        17: "control",
        91: "control", // macs (Command)
        13: "enter", // enter
        32: "space", // space
        68: "ink", // (D)ibujar
        86: "drag", // Mo(v)e
        69: "erase", // (E)rase
        84: "label", // (T)ext
        83: "save", // (S)ave
        46: "delete", // Delete key
        90: "undo" // (Z) Undo
        // Nota: La tecla 'Y' (89) se maneja manualmente más abajo para Ctrl+Y
    };

    // Event Handling
    Key.onKeyDown = function(event){
        if(window.loopy && loopy.modal && loopy.modal.isShowing) return;
        
        // ==========================================
        // 1. MANEJO ESPECIAL PARA REHACER (REDO)
        // ==========================================
        // Opción A: Ctrl + Y (o Cmd + Y en Mac)
        if (event.keyCode === 89 && Key.control) {
            publish("key/redo");
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // Opción B: Ctrl + Shift + Z (o Cmd + Shift + Z en Mac)
        if (event.keyCode === 90 && Key.control && event.shiftKey) {
            publish("key/redo");
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        // ==========================================
        // 2. MANEJO NORMAL DE TECLAS
        // ==========================================
        var code = KEY_CODES[event.keyCode];
        if (code) {
            Key[code] = true;
            publish("key/"+code);
            event.stopPropagation();
            event.preventDefault();
        }
    }

    Key.onKeyUp = function(event){
        if(window.loopy && loopy.modal && loopy.modal.isShowing) return;
        var code = KEY_CODES[event.keyCode];
        if (code) {
            Key[code] = false;
        }
        // No prevenimos el default en keyup para no interferir con el navegador
    }

    window.addEventListener("keydown", Key.onKeyDown, false);
    window.addEventListener("keyup", Key.onKeyUp, false);

})(window);
