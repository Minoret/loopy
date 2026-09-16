/**********************************
SIDEBAR CODE
**********************************/
function Sidebar(loopy){
    var self = this;
    PageUI.call(self, document.getElementById("sidebar"));

    self.edit = function(object){
        self.showPage(object._CLASS_);
        self.currentPage.edit(object);
        publish("sidebar/show");
    };

    subscribe("kill",function(object){
        if(self.currentPage.target==object) self.showPage("Edit");
    });

    // Node!
    (function(){
        var page = new SidebarPage();
        page.addComponent(new ComponentButton({ header: true, label: "<b>volver al menú</b>", onclick: function(){ self.showPage("Edit"); } }));
        page.addComponent("label", new ComponentInput({ label: "<br><br>Nombre:", textarea: true }));
        page.addComponent("hue", new ComponentSlider({ bg: "color", label: "Color:", options: [0,1,2,3,4,5,6,7], oninput: function(v){ Node.defaultHue=v; } }));
        page.addComponent("shape", new ComponentChoices({ label: "Forma:", choices: [{label:"Círculo",value:"circle"},{label:"Cuadrado",value:"square"},{label:"Diamante",value:"diamond"}] }));
        page.onedit = function(){ var n=page.target.label; if(n==""||n=="?") page.getComponent("label").select(); };
        page.addComponent(new ComponentButton({ label: "Eliminar elemento", onclick: function(node){ node.kill(); self.showPage("Edit"); } }));
        self.addPage("Node", page);
    })();

    // Edge!
    (function(){
        var page = new SidebarPage();
        page.addComponent(new ComponentButton({ header: true, label: "<b>volver al menú</b>", onclick: function(){ self.showPage("Edit"); } }));
        page.addComponent("strength", new ComponentSlider({ bg: "strength", label: "<br><br>Fuerza de interacción:", options: [2.0,1.9,1.8,1.7,1.6,1.5,1.4,1.3,1.2,1.1,1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1,-0.1,-0.2,-0.3,-0.4,-0.5,-0.6,-0.7,-0.8,-0.9,-1.0,-1.1,-1.2,-1.3,-1.4,-1.5,-1.6,-1.7,-1.8,-1.9,-2.0], oninput: function(v){ Edge.defaultStrength=v; } }));
        page.addComponent(new ComponentHTML({ html: "Tip de Análisis:<br><br><b>Intensidad:</b> Usá el deslizador para ajustar la fuerza exacta. El lado (+) fortalece la relación, el lado (-) la debilita.<br><br><b>Latencia:</b> La longitud de la flecha determina el retraso; cuanto más larga sea, más tardará la señal en llegar." }));
        page.addComponent(new ComponentButton({ label: "Eliminar interacción", onclick: function(edge){ edge.kill(); self.showPage("Edit"); } }));
        self.addPage("Edge", page);
    })();

    // Label!
    (function(){
        var page = new SidebarPage();
        page.addComponent(new ComponentButton({ header: true, label: "<b>volver al menú</b>", onclick: function(){ self.showPage("Edit"); } }));
        page.addComponent("text", new ComponentInput({ label: "<br><br>Descripción:", textarea: true }));
        page.onshow = function(){ page.getComponent("text").select(); };
        page.onhide = function(){ var l=page.target; if(!l) return; if(/^\s*$/.test(l.text)){ page.target=null; l.kill(); } };
        page.addComponent(new ComponentButton({ label: "Eliminar descripción", onclick: function(label){ label.kill(); self.showPage("Edit"); } }));
        self.addPage("Label", page);
    })();

    // Edit (LAYOUT LIMPIO Y DEFINITIVO)
    (function(){
        var page = new SidebarPage();
        page.addComponent(new ComponentHTML({
            html: ""+
            "<b style='font-size:1.4em'>LOOPY español </b> (v2)<br>una herramienta para pensar sistemas complejos.<br><br>"+
            "<span class='mini_button' onclick='publish(\"model/new/confirm\")'>crear nueva red</span> "+
            "<span class='mini_button' onclick='publish(\"modal\",[\"howto\"])'>tutorial</span><br><br>"+
            "<span class='mini_button' id='centrality_button' onclick='publish(\"centrality/toggle\")'>analizar centralidad</span><br><br>"+
            
            "<div style='font-size:0.9em; margin-bottom:5px; color:#555;'>Cantidad de simulaciones: <strong id='nira-sim-val'>100</strong></div>"+
            "<input type='range' id='nira-simulaciones' min='50' max='1000' step='50' value='100' style='width:250px; margin-bottom:15px; cursor:ew-resize;'><br>"+
            "<span class='mini_button' id='nira_button' onclick='publish(\"nira/analyze\")' style='display:block; width:250px; text-align:center; margin-bottom:15px;'>analizar intervenciones (NIRA)</span>"+
            
            "<div id='nira-ranking'></div>"+
            "<hr/><br>"+
            "<span class='mini_button' onclick='publish(\"modal\",[\"save_link\"])'>guardar como link</span> <br><br>"+
            "<span class='mini_button' onclick='publish(\"export/file\")'>guardar como archivo</span> <br><br>"+
            "<span class='mini_button' onclick='publish(\"save/png\")'>guardar como imagen (.png)</span> <br><br>"+
            "<span class='mini_button' onclick='publish(\"import/file\")'>cargar archivo</span> <br><br>"+
            "<span class='mini_button' onclick='publish(\"modal\",[\"embed\"])'>insertar en tu página web</span> <br><br>"+
"<hr/>"+
"<span style='font-size:0.85em; color:#666; line-height:1.4;'>"+
"Adaptación de <a target='_blank' href='https://ncase.me/loopy/' style='color:#555;'>LOOPY</a> (original de Nicky Case) realizada por Lic. Mathias Nicolás Rojas de la Fuente."+
"</span>"
        }));
        self.addPage("Edit", page);
    })();

    subscribe("key/save",function(){ if(Key.control) publish("modal",["save_link"]); });

    subscribe("centrality/toggle", function(){
        loopy.showCentrality = !loopy.showCentrality;
        if(loopy.showCentrality){ loopy.model.calculateCentrality(); document.getElementById("centrality_button").setAttribute("active","yes"); }
        else{ document.getElementById("centrality_button").removeAttribute("active"); }
        publish("model/changed");
    });

    // Slider: invalidar caché al cambiar
    setTimeout(function(){
        var slider = document.getElementById("nira-simulaciones");
        if(slider){
            slider.oninput = function(){
                document.getElementById("nira-sim-val").innerText = this.value;
                loopy.invalidateNiraCache();
            };
        }
    }, 100);

    // ==========================================
    // NIRA: UI Helpers
    // ==========================================
    var _niraFill = null;
    var _niraBar = null;
    var _initNiraUI = function(){
        var container = document.getElementById("nira-ranking");
        if(!container) return null;
        if(container.getAttribute("data-nira-init")) return container;
        container.setAttribute("data-nira-init","yes");
        container.innerHTML = "<div class='nira-progress' style='display:none'><div class='nira-progress-fill'></div></div><div class='nira-status'></div><div class='nira-list'></div>";
        _niraFill = container.querySelector(".nira-progress-fill");
        _niraBar = container.querySelector(".nira-progress");
        return container;
    };

    function _escapeHtml(text){
        return String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    // ==========================================
    // NIRA: Disparador del Análisis
    // ==========================================
    subscribe("nira/analyze", function(){
        if(!window.NIRA || NIRA.running) return;
        var container = _initNiraUI();
        if(!container) return;

        var simulaciones = parseInt(document.getElementById("nira-simulaciones").value) || 100;
        var currentHash = loopy.getModelHash();

        document.getElementById("nira_button").setAttribute("active","yes");
        var status = container.querySelector(".nira-status");
        var list = container.querySelector(".nira-list");
        
        _niraBar.style.display = "block";
        _niraFill.style.width = "0%";
        list.innerHTML = "";
        list.style.display = "block";

        var cancelBtnHTML = "<span id='nira-cancel-btn' style='float:right; background:#EA3E3E; color:white; padding:4px 10px; border-radius:3px; font-size:12px; cursor:pointer; font-weight:bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);'>Cancelar</span>";
        
        var injectCancelBtn = function() {
            var btn = document.getElementById('nira-cancel-btn');
            if(btn) btn.onclick = function() { NIRA.cancel(); };
        };

        // 1. Revisar Caché
        if(loopy.niraCache.hash === currentHash && loopy.niraCache.simulaciones === simulaciones && loopy.niraCache.results){
            _niraFill.style.width = "100%";
            _renderNiraResults(container, loopy.niraCache.results, simulaciones);
            _runVisualAnimation(loopy.niraCache.results);
            return;
        }

        // 2. Ejecutar nuevo análisis
        status.innerHTML = "Calculando estabilidad... " + cancelBtnHTML;
        injectCancelBtn();

        NIRA.analyzeStability(loopy, simulaciones,
            function(current, total){
                var pct = Math.round((current / total) * 100);
                _niraFill.style.width = pct + "%";
                status.innerHTML = "Simulación " + current + " de " + total + " (" + pct + "%) " + cancelBtnHTML;
                injectCancelBtn();
            },
            function(stabilityResults){
                loopy.niraCache.hash = currentHash;
                loopy.niraCache.simulaciones = simulaciones;
                loopy.niraCache.results = stabilityResults;
                
                _renderNiraResults(container, stabilityResults, simulaciones);
                status.innerHTML = "Visualizando el efecto cascada en la red...";
                status.style.display = "none";
                _runVisualAnimation(stabilityResults);
            },
            function(msg){
                _niraBar.style.display = "none";
                document.getElementById("nira_button").removeAttribute("active");
                status.innerHTML = (msg === "Análisis cancelado por el usuario.") ? "Simulación detenida." : msg;
                list.innerHTML = "";
            }
        );
    });

    // ==========================================
    // NIRA: Renderizar Resultados (Diseño Opción 2 + Popover)
    // ==========================================
    function _renderNiraResults(container, results, simulaciones) {
        var list = container.querySelector(".nira-list");
        
        var html = "<div class='nira-controls-row'>";
        html += "<div class='nira-controls-left' style='position:relative;'>";
        html += "<span id='nira-toggle-arrow' class='nira-toggle-arrow'>▼</span>";
        html += "<span class='nira-title'>Impacto en el<br>resto de la red:</span>";
        html += "<span id='nira-help-btn' class='nira-help-icon'>?</span>";
        html += "<div id='nira-help-popover' class='nira-help-popover'>Mide cuánto cambian los demás nodos cuando intervienes sobre uno. Excluye el nodo intervenido para aislar el efecto cascada.<br><br><b>(Basado en " + simulaciones + " simulaciones)</b></div>";
        html += "</div>";
        
        html += "<div class='nira-controls-right'>";
        var auraIcon = loopy.showImpact ? '◉' : '◎';
        html += "<span id='nira-aura-toggle' class='nira-aura-toggle' title='Mostrar/ocultar auras en la red'>" + auraIcon + "</span>";
        html += "<span class='mini_button nira-pdf-btn' onclick='publish(\"nira/pdf\")'>PDF</span>";
        html += "</div></div>";
        
        html += "<ol id='nira-results-ol' class='nira-results-list'>";
        for(var i = 0; i < results.length; i++){
            var r = results[i];
            var node = null;
            for(var j = 0; j < loopy.model.nodes.length; j++){
                if(loopy.model.nodes[j].label === r.label){ node = loopy.model.nodes[j]; break; }
            }
            var color = node ? Node.COLORS[node.hue] : "#888";
            html += "<li><span class='nira-dot' style='background:"+color+"'></span><span class='nira-label'>"+_escapeHtml(r.label || "?")+"</span></li>";
        }
        html += "</ol>";
        
        list.innerHTML = html;

        // Lógica Toggle Lista
        document.getElementById("nira-toggle-arrow").onclick = function() {
            var ol = document.getElementById("nira-results-ol");
            if (ol.style.display === "none") { ol.style.display = "block"; this.innerHTML = "▼"; } 
            else { ol.style.display = "none"; this.innerHTML = "▶"; }
        };

        // Lógica Popover
        var helpBtn = document.getElementById("nira-help-btn");
        var popover = document.getElementById("nira-help-popover");
        
        helpBtn.onclick = function(e) {
            e.stopPropagation();
            if (popover.classList.contains("show")) { popover.classList.remove("show"); } 
            else {
                var rect = helpBtn.getBoundingClientRect();
                popover.style.top = (rect.bottom + 8) + "px";
                popover.style.left = Math.max(10, rect.left - 100) + "px";
                popover.classList.add("show");
            }
        };
        
        document.addEventListener("click", function(e) {
            if (!popover.contains(e.target) && e.target !== helpBtn) popover.classList.remove("show");
        });

        // Lógica Toggle Auras
        var auraToggle = document.getElementById("nira-aura-toggle");
        auraToggle.onclick = function() {
            publish("nira/aura/toggle");
            setTimeout(function() { auraToggle.innerHTML = loopy.showImpact ? '◉' : '◎'; }, 50);
        };
    }

    // ==========================================
    // NIRA: Animación Visual
    // ==========================================
    function _runVisualAnimation(stabilityResults){
        NIRA.analyze(loopy, {
            onProgress: function(p){ _niraFill.style.width = "100%"; },
            onComplete: function(){
                _niraBar.style.display = "none";
                document.getElementById("nira_button").removeAttribute("active");
                
                if(stabilityResults){
                    var maxTop1 = 0;
                    for(var i = 0; i < stabilityResults.length; i++) if(stabilityResults[i].top1 > maxTop1) maxTop1 = stabilityResults[i].top1;
                    
                    for(var i = 0; i < stabilityResults.length; i++){
                        var r = stabilityResults[i];
                        for(var j = 0; j < loopy.model.nodes.length; j++){
                            if(loopy.model.nodes[j].label === r.label){
                                loopy.model.nodes[j].impact = (i < 5 && maxTop1 > 0) ? (r.top1 / maxTop1) : 0;
                                break;
                            }
                        }
                    }
                    loopy.showImpact = true;
                    publish("view/changed");
                }
            },
            onError: function(){
                _niraBar.style.display = "none";
                document.getElementById("nira_button").removeAttribute("active");
            }
        });
    }

    subscribe("nira/aura/toggle", function(){
        loopy.showImpact = !loopy.showImpact;
        publish("view/changed");
    });

// ==========================================
// NIRA: Generación de Informe PDF
// ==========================================
subscribe("nira/pdf", function(){
    if(!loopy.niraCache.results || loopy.niraCache.results.length === 0){
        alert("Primero debés ejecutar una simulación.");
        return;
    }
    if(typeof window.jspdf === 'undefined'){
        alert("Error: Librería jsPDF no cargada. Revisá tu conexión a internet.");
        return;
    }
    
    var results = loopy.niraCache.results;
    var simulaciones = loopy.niraCache.simulaciones || 100;
    var doc = new window.jspdf.jsPDF();
    
    // Colores de marca
    var colorPrimary = [109, 140, 58];   // #6D8C3A (verde oliva)
    var colorText = [40, 40, 40];        // gris oscuro
    var colorMuted = [110, 110, 110];    // gris suave
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    
// ============ ENCABEZADO (con superíndice ¹) ============
doc.setFont("helvetica", "bold");
doc.setFontSize(20);
doc.setTextColor(colorPrimary[0], colorPrimary[1], colorPrimary[2]);

var titleText = "Informe de estabilidad NIRA";
doc.text(titleText, 14, 20);

// Calcular el ancho exacto del título y posicionar el ¹ justo después
var titleWidth = doc.getTextWidth(titleText);
doc.setFontSize(12);
doc.text("¹", 14 + titleWidth + 1, 16);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(colorText[0], colorText[1], colorText[2]);
    var now = new Date();
    var dateStr = now.toLocaleDateString('es-AR', { 
        year: 'numeric', month: 'long', day: 'numeric' 
    });
    doc.text("Fecha: " + dateStr, 14, 28);
    doc.text("Simulaciones realizadas: " + simulaciones, 14, 34);
    
    // ============ TABLA DE RESULTADOS ============
    var tableData = results.map(function(r){
        return [r.label, r.top1.toFixed(1) + "%", r.top3.toFixed(1) + "%", r.top5.toFixed(1) + "%"];
    });
    
    if(typeof doc.autoTable === "function"){
    doc.autoTable({
        startY: 45,
        head: [["Nodo", "Top 1", "Top 3", "Top 5"]],
        body: tableData,
        theme: "striped",
        headStyles: { 
            fillColor: [109, 140, 58],  // verde oliva de tu marca
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 10,
            halign: "center"
        },
        bodyStyles: { 
            fontSize: 9,
            textColor: [40, 40, 40]
        },
        alternateRowStyles: { 
            fillColor: [245, 247, 240]  // verde muy suave para filas alternas
        },
        columnStyles: {
            0: { cellWidth: 85, halign: "left" },   // Nodo: ancho fijo
            1: { cellWidth: 30, halign: "center", fontStyle: "bold" },
            2: { cellWidth: 30, halign: "center" },
            3: { cellWidth: 30, halign: "center" }
        },
        margin: { left: 14, right: 14 },
        didParseCell: function(data) {
            // Resaltar en verde los valores >= 40%
            if (data.column.index >= 1 && data.column.index <= 3 && data.section === 'body') {
                var value = parseFloat(data.cell.raw);
                if (value >= 40) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.textColor = [109, 140, 58]; // verde oliva
                }
            }
        }
    });
}
    
    var finalY = doc.lastAutoTable.finalY + 8;
    
    // ============ GUÍA DE LECTURA ============
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(colorPrimary[0], colorPrimary[1], colorPrimary[2]);
    doc.text("Guía de lectura", 14, finalY);
    finalY += 6;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(colorText[0], colorText[1], colorText[2]);
    
    var guia = [
        { label: "Top 1:", desc: "Porcentaje de simulaciones en las que el nodo fue la mejor diana de intervención. Indica posible prioridad clínica." },
        { label: "Top 3:", desc: "Frecuencia en que el nodo estuvo entre las 3 mejores dianas. Sugiere robustez como diana." },
        { label: "Top 5:", desc: "Frecuencia en que el nodo estuvo entre las 5 mejores dianas. Sugiere relevancia en el sistema." }
    ];
    
    guia.forEach(function(item){
        doc.setFont("helvetica", "bold");
        doc.text(item.label, 16, finalY);
        doc.setFont("helvetica", "normal");
        var textWidth = doc.getTextWidth(item.label) + 2;
        var descLines = doc.splitTextToSize(item.desc, pageWidth - 16 - textWidth - 14);
        doc.text(descLines, 16 + textWidth, finalY);
        finalY += descLines.length * 4 + 2;
    });
    
    finalY += 4;
    
    // ============ INTERPRETACIÓN CLÍNICA ============
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(colorPrimary[0], colorPrimary[1], colorPrimary[2]);
    doc.text("Orientaciones para la interpretación", 14, finalY);
    finalY += 6;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(colorText[0], colorText[1], colorText[2]);
    
    var interpretacion = [
        "Nodos con Top 1 superior al 40% (resaltados en verde) suelen ser dianas relevantes a considerar: intervenir sobre ellos tiende a producir mayor efecto en el resto del sistema, según el modelo actual.",
        "Nodos con Top 1 bajo pero Top 3 o Top 5 alto pueden ser dianas secundarias útiles para abordajes multimodales.",
        "Nodos con Top 5 cercano a 0% aparecen como periféricos en este modelo: intervenir sobre ellos tendría poco efecto sistémico esperado.",
        "Si varios nodos comparten Top 1 similar (entre 30% y 50%), puede tener sentido abordar más de uno.",
        "Un Top 1 muy alto (>70%) puede sugerir que la red está organizada alrededor de ese factor: conviene considerar su abordaje antes que el de síntomas secundarios."
    ];
    
    interpretacion.forEach(function(line){
        var lines = doc.splitTextToSize("• " + line, pageWidth - 28);
        doc.text(lines, 16, finalY);
        finalY += lines.length * 4 + 1;
    });
    
    // ============ NOTA AL PIE (solo en la primera página) ============
    var notaMetodologica = "¹ Este informe surge de simular intervenciones sobre cada nodo de la red, observando cómo el cambio se propaga al resto del sistema (efecto cascada o spillover), sin contar el cambio directo del nodo intervenido. El ranking refleja qué nodos, al ser intervenidos, producen cambios más amplios según el modelo actual. La red es una construcción clínica que representa la formulación del caso en un momento dado, atravesada por múltiples variables. Por eso, los resultados son orientativos, no prescriptivos. Modificar nodos, conexiones o sus intensidades puede alterar significativamente el ranking. Se recomienda interpretarlos en diálogo con el juicio clínico, la literatura y la experiencia del consultante.";
    
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(colorMuted[0], colorMuted[1], colorMuted[2]);
    
    // Línea divisoria sutil antes de la nota
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(14, pageHeight - 45, pageWidth - 14, pageHeight - 45);
    
    var notaLines = doc.splitTextToSize(notaMetodologica, pageWidth - 28);
    doc.text(notaLines, 14, pageHeight - 40);
    
    // ============ FOOTER CENTRADO EN TODAS LAS PÁGINAS ============
    var pageCount = doc.internal.getNumberOfPages();
    for(var i = 1; i <= pageCount; i++){
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(colorMuted[0], colorMuted[1], colorMuted[2]);
        doc.textWithLink(
            "En Medio del Contexto  —  www.enmediodelcontexto.com.ar", 
            pageWidth / 2, 
            pageHeight - 10, 
            { 
                url: "https://enmediodelcontexto.com.ar/",
            	target: "_blank",  
                align: "center"
            }
        );
    }
    
    doc.save("informe-estabilidad-nira.pdf");
});

} // <--- CIERRE DE Sidebar(loopy)

function SidebarPage(){
    var self = this; self.target = null;
    self.dom = document.createElement("div");
    self.show = function(){ self.dom.style.display="block"; self.onshow(); };
    self.hide = function(){ self.dom.style.display="none"; self.onhide(); };
    self.components = []; self.componentsByID = {};
    self.addComponent = function(propName, component){
        if(!component){ component = propName; propName = ""; }
        component.page = self; component.propName = propName;
        self.dom.appendChild(component.dom); self.components.push(component);
        self.componentsByID[propName] = component; return component;
    };
    self.getComponent = function(propName){ return self.componentsByID[propName]; };
    self.edit = function(object){ self.target = object; for(var i=0;i<self.components.length;i++) self.components[i].show(); self.onedit(); };
    self.onedit = function(){}; self.onshow = function(){}; self.onhide = function(){};
    self.hide();
}

/////////////////////////////////////////////////////////////////////////////////////////////
// COMPONENTS ///////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////
function Component(){ var self=this; self.dom=null; self.page=null; self.propName=null; self.show=function(){}; self.getValue=function(){ return self.page.target[self.propName]; }; self.setValue=function(v){ publish("model/changed"); self.page.target[self.propName]=v; self.page.onedit(); }; }
function ComponentInput(c){ var s=this; Component.apply(s); s.dom=document.createElement("div"); var l=_createLabel(c.label), cl=c.textarea?"component_textarea":"component_input", i=_createInput(cl,c.textarea); i.oninput=function(){ s.setValue(i.value); }; s.dom.appendChild(l); s.dom.appendChild(i); s.show=function(){ i.value=s.getValue(); }; s.select=function(){ setTimeout(function(){ i.select(); },10); }; }
function ComponentSlider(c){ var s=this; Component.apply(s); s.dom=document.createElement("div"); var lt=c.label, l=_createLabel(lt); s.dom.appendChild(l); if(c.bg==="strength"){ var ind=document.createElement("div"); ind.setAttribute("class","component_slider_indicators"); ind.innerHTML="<span>(+)</span><span>(-)</span>"; s.dom.appendChild(ind); } var sd=document.createElement("div"); sd.setAttribute("class","component_slider"); s.dom.appendChild(sd); var ul=function(){ if(c.bg==="strength"){ var v=s.getValue(), si=(v>0)?"+":""; l.innerHTML=lt+" "+si+v.toFixed(1); } }; var sl; if(c.bg==="color"){ sl=document.createElement("div"); sl.style.width="250px"; sl.style.height="31.25px"; sl.style.display="flex"; sl.setAttribute("class","component_slider_graphic"); for(var i=0;i<Node.COLORS.length;i++){ var sq=document.createElement("div"); sq.style.flex="1"; sq.style.height="100%"; sq.style.backgroundColor=Node.COLORS[i]; sl.appendChild(sq); } } else { sl=new Image(); sl.draggable=false; sl.src="css/sliders/"+c.bg+".png"; sl.setAttribute("class","component_slider_graphic"); } var p=new Image(); p.draggable=false; p.src="css/sliders/slider_pointer.png"; p.setAttribute("class","component_slider_pointer"); if(c.bg==="color") p.style.top="33.25px"; sd.appendChild(sl); sd.appendChild(p); var ns; if(c.bg==="strength"){ ns=_createInput("component_slider_native"); ns.type="range"; ns.min=0; ns.max=c.options.length-1; ns.step=1; s.dom.appendChild(ns); } else { sl.style.cursor="default"; } var mp=function(){ var v=s.getValue(), oi=c.options.indexOf(v), x=(oi+0.5)*(250/c.options.length); p.style.left=(x-7.5)+"px"; if(ns) ns.value=oi; }; if(ns){ ns.oninput=function(){ var oi=parseInt(ns.value), o=c.options[oi]; s.setValue(o); if(c.oninput) c.oninput(o); mp(); ul(); }; } var id=false, omd=function(e){ id=true; si(e); }, omu=function(){ id=false; }, omm=function(e){ if(id) si(e); }; var si=function(e){ var idx=e.x/250, oi=Math.floor(idx*c.options.length), o=c.options[oi]; if(o===undefined) return; s.setValue(o); if(c.oninput) c.oninput(o); mp(); ul(); }; _addMouseEvents(sl,omd,omm,omu); s.show=function(){ mp(); ul(); }; s.setBGColor=function(co){ sl.style.background=co; }; }
function ComponentButton(c){ var s=this; Component.apply(s); s.dom=document.createElement("div"); var b=_createButton(c.label, function(){ c.onclick(s.page.target); }); s.dom.appendChild(b); if(c.header) b.setAttribute("header","yes"); }
function ComponentHTML(c){ var s=this; Component.apply(s); s.dom=document.createElement("div"); s.dom.innerHTML=c.html; }
function ComponentOutput(c){ var s=this; Component.apply(s); s.dom=_createInput("component_output"); s.dom.setAttribute("readonly","true"); s.dom.onclick=function(){ s.dom.select(); }; s.output=function(str){ s.dom.value=str; }; }
function ComponentChoices(c){ var s=this; Component.apply(s); s.dom=document.createElement("div"); var l=_createLabel(c.label); s.dom.appendChild(l); var cd=document.createElement("div"); cd.setAttribute("class","component_choices"); s.dom.appendChild(cd); for(var i=0;i<c.choices.length;i++){ var ch=c.choices[i], b=document.createElement("div"); b.setAttribute("class","component_choice"); b.innerHTML=ch.label; (function(v){ b.onclick=function(){ s.setValue(v); if(c.oninput) c.oninput(v); s.show(); }; })(ch.value); cd.appendChild(b); } s.show=function(){ var v=s.getValue(); for(var i=0;i<cd.children.length;i++){ var b=cd.children[i], ch=c.choices[i]; if(ch.value==v) b.setAttribute("active","yes"); else b.removeAttribute("active"); } }; }
