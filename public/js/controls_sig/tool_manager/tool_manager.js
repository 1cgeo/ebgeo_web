class ToolManager {
    constructor(map) {
        this.map = map;
        this.activeTool = null;
        this.drawControl = null;
        this.selectionManager = null;
    }

    setDrawControl(drawControl) {
        this.drawControl = drawControl;
    }

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
    }

    setActiveTool(tool) {
        if(!tool) {
            return
        }
        
        if (this.activeTool && this.activeTool === tool && tool !== this.drawControl) {
            this.deactivateCurrentTool();
            return
        }

        if (this.activeTool) {
            this.activeTool.deactivate();
        }

        this.activeTool = tool;
        tool.activate();

        if (this.drawControl && this.activeTool !== this.drawControl && this.selectionManager) {
            this.selectionManager.deselectAllFeatures(true);
        }
    }

    deactivateCurrentTool() {
        if (this.activeTool) {
            this.activeTool.deactivate();
            this.activeTool = null;
        }
    }
}

export default ToolManager;
