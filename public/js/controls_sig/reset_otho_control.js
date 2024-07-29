class ResetOrthogonalControl {
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      this._button = document.createElement('button');
      this._button.type = 'button';
      this._button.title = 'Reset to orthogonal view';
      this._button.innerHTML = 'O'; // You can use any icon or text here
      this._button.onclick = () => {
        this._map.easeTo({
          pitch: 0
        });
      };
      this._container.appendChild(this._button);
      return this._container;
    }
  
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
  }
  
  export default ResetOrthogonalControl;
