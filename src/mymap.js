
class MyMap {
  constructor() {
    this._map = {};
    this._size = 0;
  }

  set (key, value) {
    if (!this._map.hasOwnProperty(key)) {
      this._size += 1;
    }
    this._map[key] = value;
  }

  get (key) {
    return this._map[key];
  }

  has (key) {
    return this._map.hasOwnProperty(key);
  }

  remove (key) {
    if (this._map.hasOwnProperty(key)) {
      this._size -= 1;
    }
    delete this._map[key];
  }

  size () {
    return this._size;
  }

  map () {
    return this._map;
  }

  values () {
    var vals = [];
    for (var key in this._map) {
      if (this._map.hasOwnProperty(key)) {
        vals.push(this._map[key]);
      }
    }
    return vals;
  }
}

export default MyMap;
