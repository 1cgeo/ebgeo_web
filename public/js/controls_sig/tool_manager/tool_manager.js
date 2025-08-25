// Path: js\controls_sig\tool_manager\tool_manager.js
class ToolManager {
    constructor(map) {
        this.map = map;
        this.activeTool = null;
        this.selectionManager = null;
    }

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
    }

    setActiveTool(tool) {
        if(!tool) {
            return
        }
        
        if (this.activeTool && this.activeTool === tool) {
            this.deactivateCurrentTool();
            return
        }

        if (this.activeTool) {
            this.activeTool.deactivate();
        }

        this.activeTool = tool;
        tool.activate();

        this.selectionManager.deselectAllFeatures();

    }

    deactivateCurrentTool() {
        if (this.activeTool) {
            this.activeTool.deactivate();
            this.activeTool = null;
        }
    }
}

export default ToolManager;
