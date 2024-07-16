class ToolManager {
    constructor(map) {
        this.map = map;
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

    setDrawMode(mode) {
        this.deactivateCurrentTool();
        this.draw.changeMode(mode);
    }
}

export default ToolManager;