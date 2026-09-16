/***********************

Use the same PAGE UI thing

************************/

function Modal(loopy){

    var self = this;
    self.loopy = loopy;
    PageUI.call(self, document.getElementById("modal_page"));

    // Is showing?
    self.isShowing = false;

    // show/hide
    self.show = function(){
        document.getElementById("modal_container").setAttribute("show","yes");
        self.isShowing = true;
    };
    self.hide = function(){
        var modalContainer = document.getElementById("modal_container");
        if (modalContainer) {
            modalContainer.setAttribute("show","no");
        }
        if(self.currentPage && self.currentPage.onhide) self.currentPage.onhide();
        self.isShowing = false;
    };

    self.showHTML = function(html, w, h) {
        var page = null;
        for (var i = 0; i < self.pages.length; i++) {
            if (self.pages[i].id === "dynamic_content") {
                page = self.pages[i];
                break;
            }
        }
        if (!page) {
            page = new Page();
            self.addPage("dynamic_content", page);
        }
        page.width  = w || 500;
        page.height = h || 320;
        page.dom.innerHTML = html;

        var dom = document.getElementById("modal");
        if (dom) {
            dom.style.width  = page.width  + "px";
            dom.style.height = page.height + "px";
        }
        self.showPage("dynamic_content");
        self.show();
    };

    // Close button
    document.getElementById("modal_bg").onclick = self.hide;
    document.getElementById("modal_close").onclick = self.hide;

    // Show... what page?
    subscribe("modal", function(pageName, data){

        self.show();
        var page = self.showPage(pageName);

        // Do something
        if(page.onshow) page.onshow(data);

        // Dimensions
        var dom = document.getElementById("modal");
        dom.style.width = self.currentPage.width+"px";
        dom.style.height = self.currentPage.height+"px";

    });

    ///////////////////
    // PAGES! /////////
    ///////////////////

    // Examples
    (function(){
        var page = new Page();
        page.width = 670;
        page.height = 570;
        var iframe = page.addComponent(new ModalIframe({
            page: page,
            src: loopy.base + "pages/examples/",
            width: 640,
            height: 520
        }));
        iframe.dom.style.background = "#f7f7f7";
        self.addPage("examples", page);
    })();

    // How To
    (function(){
        var page = new Page();
        page.width = 530;
        page.height = 430;
        page.addComponent(new ModalIframe({
            page: page,
            src: loopy.base + "pages/howto.html",
            width: 500,
            height: 350
        }));

        var label = document.createElement("div");
        label.style.fontSize = "18px";
        label.style.marginTop = "6px";
        label.style.color = "#777";
        label.innerHTML = "¿Necesitas ideas para inspirarte? fijate en <span style='text-decoration:underline; cursor:pointer' onclick='publish(\"modal\",[\"examples\"])'>este link!</span>";
        page.dom.appendChild(label);

        self.addPage("howto", page);

    })();

    // Credits
    (function(){
        var page = new Page();
        page.width = 690;
        page.height = 550;
        page.addComponent(new ModalIframe({
            page: page,
            src: loopy.base + "pages/credits/",
            width: 660,
            height: 500
        }))
        self.addPage("credits", page);
    })();

    // Save as link / Duplicate
    (function(){
        var page = new Page();
        page.width = 500;
        page.height = 250;

        // Short link section
        var labelHtml = document.createElement("div");
        page.dom.appendChild(labelHtml);

        // Autosave note (hidden by default, shown when ID exists)
        var autosaveNote = document.createElement("div");
        autosaveNote.style.fontSize = "13px";
        autosaveNote.style.color = "#888";
        autosaveNote.style.marginTop = "6px";
        autosaveNote.style.marginBottom = "12px";
        autosaveNote.innerHTML = "Los cambios se guardan automáticamente en este enlace.";
        page.dom.appendChild(autosaveNote);

        var shortOutput = page.addComponent(new ComponentOutput({}));

        // Duplicate button (hidden by default, shown when ID exists)
        var duplicateBtn = null;

        page.onshow = function(){

            if(loopy.id){
                // === TENEMOS ID: mostrar link existente + opción de duplicar ===
                labelHtml.innerHTML = "<b>Tu red está guardada en:</b>";
                autosaveNote.style.display = "block";

                var base = window.location.origin + loopy.base;
                var shortLink = base + loopy.id;
                shortOutput.output(shortLink);
                shortOutput.dom.select();

                // Mostrar botón duplicar
                if(!duplicateBtn){
                    duplicateBtn = _createButton("Duplicar red", function(){});
                    var actionsContainer = page.dom.querySelector(".modal_actions");
                    if(actionsContainer){
                        actionsContainer.appendChild(duplicateBtn);
                    }else{
                        // Fallback: crear contenedor
                        var actions = document.createElement("div");
                        actions.className = "modal_actions";
                        page.dom.appendChild(actions);
                        // Mover el copiar
                        var existingCopy = page.dom.querySelector(".component_button");
                        if(existingCopy) actions.appendChild(existingCopy);
                        actions.appendChild(duplicateBtn);
                    }
                }
                duplicateBtn.style.display = "inline-block";
                duplicateBtn.onclick = function(){
                    // Duplicar: crear nuevo ID
                    var data = loopy.model.serialize();
                    var base = window.location.origin + loopy.base;
                    fetch(loopy.base + "save.php", {
                        method: "POST",
                        body: data
                    })
                    .then(function(response){
                        if(!response.ok) throw new Error("Failed to save");
                        return response.text();
                    })
                    .then(function(id){
                        loopy.id = id;
                        loopy.dirty = false;
                        var shortLink = base + id;
                        shortOutput.output(shortLink);
                        shortOutput.dom.select();
                        window.history.replaceState(null, null, shortLink);
                        labelHtml.innerHTML = "<b>Link guardado:</b>";
                        duplicateBtn.style.display = "none";
                    })
                    .catch(function(err){
                        console.error(err);
                        shortOutput.output("Error al duplicar");
                    });
                };

            }else{
                // === NO TENEMOS ID: crear nuevo link (comportamiento actual) ===
                labelHtml.innerHTML = "<b>Link guardado:</b>";
                autosaveNote.style.display = "none";
                if(duplicateBtn) duplicateBtn.style.display = "none";
                shortOutput.output("Generando...");

                var data = loopy.model.serialize();
                fetch(loopy.base + "save.php", {
                    method: "POST",
                    body: data
                })
                .then(function(response){
                    if(!response.ok) throw new Error("Failed to save");
                    return response.text();
                })
                .then(function(id){
                    loopy.id = id;
                    loopy.dirty = false;
                    var base = window.location.origin + loopy.base;
                    var shortLink = base + id;
                    shortOutput.output(shortLink);
                    shortOutput.dom.select();
                    window.history.replaceState(null, null, shortLink);
                })
                .catch(function(err){
                    console.error(err);
                    shortOutput.output("Error al generar link corto");
                });
            }

        };

        // Botón copiar
        var actions = document.createElement("div");
        actions.className = "modal_actions";
        page.dom.appendChild(actions);

        var copyBtn = _createButton("Copiar link", function(){
            navigator.clipboard.writeText(shortOutput.dom.value)
                .then(function(){
                    copyBtn.innerHTML = "¡Copiado!";
                    setTimeout(function(){
                        copyBtn.innerHTML = "Copiar link";
                    }, 2000);
                });
        });
        actions.appendChild(copyBtn);

        self.addPage("save_link", page);
    })();


    // Embed
    (function(){
        var page = new Page();
        page.width = 700;
        page.height = 500;

        // ON UPDATE DIMENSIONS
        var iframeSRC;
        var _onUpdate = function(){
            var embedCode = '<iframe width="'+width.getValue()+'" height="'+height.getValue()+'" frameborder="0" src="'+iframeSRC+'"></iframe>';
            output.output(embedCode);
        };

        // THE SHTUFF
        var sidebar = document.createElement("div");
        sidebar.style.width = "150px";
        sidebar.style.height = "440px";
        sidebar.style.float = "left";
        page.dom.appendChild(sidebar);

        // Label
        var label = document.createElement("div");
        label.innerHTML = "<br>PREVIEW &rarr;<br><br>";
        sidebar.appendChild(label);

        // Label 2
        var label = document.createElement("div");
        label.style.fontSize = "15px";
        label.innerHTML = "what size do you want your embed to be?";
        sidebar.appendChild(label);

        // Size!
        var width = _createNumberInput(_onUpdate);
        sidebar.appendChild(width.dom);
        var label = document.createElement("div");
        label.style.display = "inline-block";
        label.style.fontSize = "15px";
        label.innerHTML = "&nbsp;×&nbsp;";
        sidebar.appendChild(label);
        var height = _createNumberInput(_onUpdate);
        sidebar.appendChild(height.dom);

        // Label 3
        var label = document.createElement("div");
        label.style.fontSize = "15px";
        label.innerHTML = "<br><br>copy this code into your website's html:";
        sidebar.appendChild(label);

        // Output!
        var output = new ComponentOutput({});
        output.dom.style.fontSize = "12px";
        sidebar.appendChild(output.dom);

        // Label 3
        var label = document.createElement("div");
        label.style.fontSize = "15px";
        label.style.textAlign = "right";
        label.innerHTML = "<br><br>(note: the REMIX button lets someone else, well, remix your model! don't worry, it'll just be a copy, it won't affect the original.)";
        sidebar.appendChild(label);

        // IFRAME
        var iframe = page.addComponent(new ModalIframe({
            page: page,
            manual: true,
            src: "",
            width: 500,
            height: 440
        })).dom;
        iframe.style.float = "right";
        page.onshow = function(){

            // Default dimensions
            width.setValue(500);
            height.setValue(440);

            // The iframe!
            iframeSRC = loopy.saveToURL(true);
            iframe.src = iframeSRC;

            // Select to copy-paste
            _onUpdate();
            output.dom.select();

        };
        page.onhide = function(){
            iframe.removeAttribute("src");
        };
        self.addPage("embed", page);


    })();

    // GIF
    (function(){
        var page = new Page();
        page.width = 530;
        page.height = 400;
        page.addComponent(new ModalIframe({
            page: page,
            src: loopy.base + "pages/gif.html",
            width: 500,
            height: 350
        }))
        self.addPage("save_gif", page);
        })();

    // model/new/confirm
    (function(){
        var page = new Page();
        page.width = 500;
        page.height = 250;
        page.addComponent(new ComponentHTML({
            html: "<b>¿Empezar una nueva red?</b><br><br>"+
            "Se abrirá un lienzo vacío. Tu red actual no se eliminará: si la guardaste con un enlace, podrás volver a acceder a él.<br><br>"
        }));

        // Actions
        var actions = document.createElement("div");
        actions.className = "modal_actions";
        page.dom.appendChild(actions);

        actions.appendChild(_createButton("Cancelar", function(){
            self.hide();
        }));
        actions.appendChild(_createButton("Crear nueva red", function(){
            self.hide();
            publish("model/new");
        }));

        self.addPage("model/new/confirm", page);
    })();

    // Save as file (ask for filename)
    (function(){
        var page = new Page();
        page.width = 500;
        page.height = 200;

        var label = document.createElement("div");
        label.innerHTML = "<b>Nombre del archivo:</b><br><br>";
        page.dom.appendChild(label);

        var filenameInput = document.createElement("input");
        filenameInput.type = "text";
        filenameInput.value = "system_model";
        filenameInput.style.width = "100%";
        filenameInput.style.padding = "8px";
        filenameInput.style.boxSizing = "border-box";
        filenameInput.style.fontSize = "16px";
        filenameInput.style.border = "1px solid #ccc";
        filenameInput.style.borderRadius = "4px";
        page.dom.appendChild(filenameInput);

        var download = function(){
            var name = filenameInput.value.trim();
            if(!name) name = "system_model";
            if(name.indexOf(".") === -1) name += ".loopy";

            var element = document.createElement('a');
            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + loopy.model.serialize());
            element.setAttribute('download', name);
            element.style.display = 'none';
            document.body.appendChild(element);
            element.click();
            document.body.removeChild(element);

            self.hide();
        };
        filenameInput.addEventListener("keydown", function(e){
            if(e.key === "Enter") download();
        });

        var actions = document.createElement("div");
        actions.className = "modal_actions";
        page.dom.appendChild(actions);

        actions.appendChild(_createButton("Cancelar", function(){
            self.hide();
        }));
        actions.appendChild(_createButton("Descargar", download));

        // Select the input when shown
        page.onshow = function(){
            setTimeout(function(){ filenameInput.select(); }, 50);
        };

        self.addPage("save_file", page);
    })();

        }

function ModalIframe(config){

    var self = this;

    // IFRAME
    var iframe = document.createElement("iframe");
    self.dom = iframe;
    iframe.width = config.width;
    iframe.height = config.height;

    // Show & Hide
    if(!config.manual){
        config.page.onshow = function(){
            iframe.src = config.src;
        };
        config.page.onhide = function(){
            iframe.removeAttribute("src");
        };
    }

}
