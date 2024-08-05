class ResetNorthControl {
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';
      this._button = document.createElement('button');
      this._button.type = 'button';
      this._button.className = 'mapbox-gl-draw_ctrl-draw-btn';
      this._button.setAttribute("id", "north-tool");
      this._button.title = 'Reseta para o norte';
      this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_north_black.svg" alt="NORTH" />';
      this._button.onclick = () => {
        this._map.easeTo({
          pitch: 0,
          bearing: 0
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

  export default ResetNorthControl;