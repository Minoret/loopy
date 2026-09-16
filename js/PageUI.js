/**********************************

PAGE UI: to extend to Sidebar, Play Controls, Modal.

**********************************/

function PageUI(dom){

    var self = this;
    self.dom = dom;

    self.pages = [];
    self.addPage = function(id, page){
        page.id = id;
        self.dom.appendChild(page.dom);
        self.pages.push(page);
    };
    self.currentPage = null;
    self.showPage = function(id){
        var shownPage = null;
        for(var i=0; i<self.pages.length; i++){
            var page = self.pages[i];
            if(page.id==id){
                page.show();
                shownPage = page;
            }else{
                page.hide();
            }
        }
        self.currentPage = shownPage;
        return shownPage;
    };

}

function Page(){

    var self = this;
    self.target = null;

    // DOM
    self.dom = document.createElement("div");
    self.show = function(){ self.dom.style.display="block"; self.dom.classList.add("visible"); };
    self.hide = function(){ self.dom.style.display="none"; self.dom.classList.remove("visible"); };

    // Add Component
    self.addComponent = function(component){
        component.page = self; // tie to page
        self.dom.appendChild(component.dom); // add to DOM
        return component;
    };

}