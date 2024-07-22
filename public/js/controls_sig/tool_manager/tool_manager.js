class ToolManager {
    constructor(map, draw, selectionManager) {
        this.map = map;
        this.draw = draw;
        this.selectionManager = selectionManager;
        this.activeTool = null;
    }

    setActiveTool(tool) {
        if (this.activeTool && this.activeTool !== tool) {
            this.activeTool.deactivate();
        }
        this.activeTool = tool;
        if (tool) {
            tool.activate();
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
