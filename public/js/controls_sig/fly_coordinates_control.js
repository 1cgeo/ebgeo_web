class FlyToCoordinatesControl {
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
  
      this._input = document.createElement('input');
      this._input.type = 'text';
      this._input.placeholder = 'Enter coordinates (lng, lat)';
      this._input.style.width = '200px';
  
      // Add event listener for the Enter key
      this._input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this._flyToCoordinates();
        }
      });
  
      this._container.appendChild(this._input);
      return this._container;
    }
  
    _flyToCoordinates() {
      const coords = this._input.value.split(',');
      if (coords.length === 2) {
        const lng = parseFloat(coords[0].trim());
        const lat = parseFloat(coords[1].trim());
        if (this._validateCoordinates(lng, lat)) {
          this._map.flyTo({
            center: [lng, lat],
            zoom: 10,
            essential: true
          });
        } else {
          alert('Invalid coordinates. Please enter in the format: lng, lat');
        }
      } else {
        alert('Invalid input. Please enter in the format: lng, lat');
      }
    }
  
    _validateCoordinates(lng, lat) {
      // Validate longitude and latitude
      if (isNaN(lng) || isNaN(lat)) {
        return false;
      }
      if (lng < -180 || lng > 180) {
        return false;
      }
      if (lat < -90 || lat > 90) {
        return false;
      }
      return true;
    }
  
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
  }
  
  export default FlyToCoordinatesControl;

class FlyToCoordinatesControl {
    onAdd(map) {
      this._map = map;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
  
      this._input = document.createElement('input');
      this._input.type = 'text';
      this._input.placeholder = 'Enter coordinates (lng, lat)';
      this._input.style.width = '200px';
  
      // Add event listener for the Enter key
      this._input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this._flyToCoordinates();
        }
      });
  
      this._container.appendChild(this._input);
      return this._container;
    }
  
    _flyToCoordinates() {
      const coords = this._input.value.split(',');
      if (coords.length === 2) {
        const lng = parseFloat(coords[0].trim());
        const lat = parseFloat(coords[1].trim());
        if (this._validateCoordinates(lng, lat)) {
          this._map.flyTo({
            center: [lng, lat],
            zoom: 10,
            essential: true
          });
        } else {
          alert('Invalid coordinates. Please enter in the format: lng, lat');
        }
      } else {
        alert('Invalid input. Please enter in the format: lng, lat');
      }
    }
  
    _validateCoordinates(lng, lat) {
      // Validate longitude and latitude
      if (isNaN(lng) || isNaN(lat)) {
        return false;
      }
      if (lng < -180 || lng > 180) {
        return false;
      }
      if (lat < -90 || lat > 90) {
        return false;
      }
      return true;
    }
  
    onRemove() {
      this._container.parentNode.removeChild(this._container);
      this._map = undefined;
    }
  }
  
  export default FlyToCoordinatesControl;
