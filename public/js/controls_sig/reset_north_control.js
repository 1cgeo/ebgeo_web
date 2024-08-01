class ResetNorthControl {
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      this._button = document.createElement('button');
      this._button.type = 'button';
      this._button.title = 'Reset bearing to north';
      this._button.innerHTML = 'N'; // You can use any icon or text here
      this._button.onclick = () => {
        this._map.resetNorth();
      };
      this._container.appendChild(this._button);
      return this._container;
    }
  
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
  }

  export default ResetNorthControl;
  
class ResetNorthControl {
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      this._button = document.createElement('button');
      this._button.type = 'button';
      this._button.title = 'Reset bearing to north';
      this._button.innerHTML = 'N'; // You can use any icon or text here
      this._button.onclick = () => {
        this._map.resetNorth();
      };
      this._container.appendChild(this._button);
      return this._container;
    }
  
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
  }

  export default ResetNorthControl;
  