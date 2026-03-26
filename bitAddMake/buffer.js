(function (root) {
  'use strict';

  // Enhanced Buffer shim for bitcoinjs-lib compatibility
  // Provides: Buffer.from, Buffer.alloc, Buffer.concat, Buffer.isBuffer
  // Instance: toString, slice, copy, equals, compare, readUInt8, writeUInt8, indexOf, fill, subarray

  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function base64ToBytes(str) {
    str = str.replace(/=+$/, '');
    var bytes = [];
    for (var i = 0; i < str.length; i += 4) {
      var c0 = base64Chars.indexOf(str[i]);
      var c1 = base64Chars.indexOf(str[i + 1]);
      var c2 = str[i + 2] !== undefined ? base64Chars.indexOf(str[i + 2]) : -1;
      var c3 = str[i + 3] !== undefined ? base64Chars.indexOf(str[i + 3]) : -1;
      bytes.push((c0 << 2) | (c1 >> 4));
      if (c2 !== -1) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
      if (c3 !== -1) bytes.push(((c2 & 3) << 6) | c3);
    }
    return new Uint8Array(bytes);
  }

  function bytesToBase64(bytes) {
    var result = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      result += base64Chars[b0 >> 2];
      result += base64Chars[((b0 & 3) << 4) | (b1 >> 4)];
      result += i + 1 < bytes.length ? base64Chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      result += i + 2 < bytes.length ? base64Chars[b2 & 63] : '=';
    }
    return result;
  }

  function hexToBytes(hex) {
    var arr = [];
    for (var i = 0; i < hex.length; i += 2) {
      arr.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(arr);
  }

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  // Buffer constructor — wraps Uint8Array with extra methods
  function Buffer(arg, encodingOrOffset, length) {
    if (typeof arg === 'number') {
      return Buffer.alloc(arg);
    }
    return Buffer.from(arg, encodingOrOffset, length);
  }

  Buffer.from = function (value, encodingOrOffset, length) {
    if (typeof value === 'string') {
      var enc = encodingOrOffset || 'utf8';
      var data;
      if (enc === 'hex') {
        data = hexToBytes(value);
      } else if (enc === 'base64') {
        data = base64ToBytes(value);
      } else {
        data = new TextEncoder().encode(value);
      }
      return _wrap(data);
    }
    if (value instanceof Uint8Array || Array.isArray(value)) {
      return _wrap(new Uint8Array(value));
    }
    if (value && value.data && value.data instanceof Uint8Array) {
      return _wrap(new Uint8Array(value.data));
    }
    if (value && typeof value.length === 'number') {
      return _wrap(new Uint8Array(value));
    }
    return _wrap(new Uint8Array(0));
  };

  Buffer.alloc = function (size, fill) {
    var arr = new Uint8Array(size);
    if (fill !== undefined) {
      arr.fill(typeof fill === 'number' ? fill : 0);
    }
    return _wrap(arr);
  };

  Buffer.allocUnsafe = Buffer.alloc;

  Buffer.concat = function (list, totalLength) {
    if (totalLength === undefined) {
      totalLength = 0;
      for (var i = 0; i < list.length; i++) {
        totalLength += list[i].length;
      }
    }
    var result = new Uint8Array(totalLength);
    var offset = 0;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item._data) {
        result.set(item._data, offset);
      } else if (item instanceof Uint8Array) {
        result.set(item, offset);
      }
      offset += item.length;
    }
    return _wrap(result);
  };

  Buffer.isBuffer = function (obj) {
    return obj && obj._isBuffer === true;
  };

  Buffer.byteLength = function (str, encoding) {
    if (typeof str !== 'string') return str.length;
    encoding = encoding || 'utf8';
    if (encoding === 'hex') return str.length / 2;
    if (encoding === 'base64') {
      var len = str.length;
      if (str[len - 1] === '=') len--;
      if (str[len - 1] === '=') len--;
      return Math.floor(len * 3 / 4);
    }
    return new TextEncoder().encode(str).length;
  };

  Buffer.isEncoding = function () { return true; };

  // Create a wrapped Uint8Array with Buffer methods
  function _wrap(uint8) {
    // Use Proxy to provide index-based access and Buffer methods
    var buf = new Uint8Array(uint8);

    // Attach hidden data reference
    Object.defineProperty(buf, '_data', { value: uint8, writable: false, enumerable: false });
    Object.defineProperty(buf, '_isBuffer', { value: true, writable: false, enumerable: false });

    // toString
    buf.toString = function (encoding, start, end) {
      var data = this;
      if (start !== undefined || end !== undefined) {
        data = this.slice(start || 0, end || this.length);
      }
      encoding = encoding || 'utf8';
      if (encoding === 'hex') return bytesToHex(data);
      if (encoding === 'base64') return bytesToBase64(data);
      return new TextDecoder().decode(data);
    };

    // toJSON
    buf.toJSON = function () {
      return { type: 'Buffer', data: Array.from(this) };
    };

    // equals
    buf.equals = function (other) {
      if (this.length !== other.length) return false;
      for (var i = 0; i < this.length; i++) {
        if (this[i] !== other[i]) return false;
      }
      return true;
    };

    // compare
    buf.compare = function (other) {
      var len = Math.min(this.length, other.length);
      for (var i = 0; i < len; i++) {
        if (this[i] < other[i]) return -1;
        if (this[i] > other[i]) return 1;
      }
      if (this.length < other.length) return -1;
      if (this.length > other.length) return 1;
      return 0;
    };

    // copy
    buf.copy = function (target, targetStart, sourceStart, sourceEnd) {
      targetStart = targetStart || 0;
      sourceStart = sourceStart || 0;
      sourceEnd = sourceEnd || this.length;
      for (var i = sourceStart; i < sourceEnd; i++) {
        target[targetStart++] = this[i];
      }
      return sourceEnd - sourceStart;
    };

    // Override slice to return Buffer
    var origSlice = Uint8Array.prototype.slice;
    buf.slice = function (start, end) {
      return _wrap(origSlice.call(this, start, end));
    };

    // subarray override
    buf.subarray = function (start, end) {
      return _wrap(Uint8Array.prototype.subarray.call(this, start, end));
    };

    // write
    buf.write = function (string, offset, length, encoding) {
      offset = offset || 0;
      encoding = encoding || 'utf8';
      var bytes;
      if (encoding === 'hex') {
        bytes = hexToBytes(string);
      } else {
        bytes = new TextEncoder().encode(string);
      }
      var len = Math.min(bytes.length, length || (this.length - offset));
      for (var i = 0; i < len; i++) {
        this[offset + i] = bytes[i];
      }
      return len;
    };

    // readUInt8 / writeUInt8
    buf.readUInt8 = function (offset) { return this[offset]; };
    buf.writeUInt8 = function (value, offset) { this[offset] = value; return offset + 1; };

    // readUInt32BE / writeUInt32BE
    buf.readUInt32BE = function (offset) {
      return ((this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]) >>> 0;
    };
    buf.writeUInt32BE = function (value, offset) {
      this[offset] = (value >>> 24) & 0xFF;
      this[offset + 1] = (value >>> 16) & 0xFF;
      this[offset + 2] = (value >>> 8) & 0xFF;
      this[offset + 3] = value & 0xFF;
      return offset + 4;
    };

    // indexOf
    buf.indexOf = function (val) {
      if (typeof val === 'number') {
        for (var i = 0; i < this.length; i++) {
          if (this[i] === val) return i;
        }
        return -1;
      }
      return -1;
    };

    // fill override
    var origFill = Uint8Array.prototype.fill;
    buf.fill = function (val, start, end) {
      origFill.call(this, val, start, end);
      return this;
    };

    // reverse
    buf.reverse = function () {
      var arr = Array.from(this);
      arr.reverse();
      for (var i = 0; i < arr.length; i++) this[i] = arr[i];
      return this;
    };

    return buf;
  }

  root.Buffer = Buffer;

})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
