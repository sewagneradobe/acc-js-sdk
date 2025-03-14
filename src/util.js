/*
Copyright 2020 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
(function() {
"use strict";    
  

/**********************************************************************************
 * 
 * Generic utilities
 * 
 *********************************************************************************/

/**
 * @namespace Utils
 */

/**
 * @memberof Utils
 * @class
 * @constructor
 */
class Util {

  /**
   * Generic helper functions available everywhere in the SDK. Al functions are static, it is not necessary to create new instances of this object
   */
  constructor() {
  }

  /**
   * Indicates whether the SDK is running in a browser or not
   * @returns {boolean} a boolean indicating if the SDK is running in a browser or not
   */
  static isBrowser() {
    const browser = typeof window !== 'undefined';
    return browser;
  }
  
  /**
   * Tests if an object is a JavaScript array
   * @param {*} obj the object to test, may be undefined
   * @returns {boolean} true if the object is an array
   */
  static isArray(obj) {
    if (obj === null || obj === undefined) return false;
    // JavaScript arrays are objects
    if (typeof obj != "object") return false;
    // They also have a length property. But checking the length is not enough
    // since, it can also be an object litteral with a "length" property. Campaign
    // schema attributes typically have a "length" attribute and are not arrays
    if (obj.length === undefined || obj.length === null) return false;
    // So check for a "push" function
    if (obj.push === undefined || obj.push === null) return false;
    if (typeof obj.push != "function") 
        return false;
    return true;
  }

  // Helper function for trim() to replace text between 2 indices
  static _removeBetween(text, from, to) {
    var index = 0;
    while (index < text.length) {
      index = text.indexOf(from, index);
      if (index == -1) break;
      const index2 = text.indexOf(to, index);
      if (index2 == -1) {
        break;
      }
      text = text.substring(0, index + from.length) + '***' + text.substring(index2);
      index = index2;
    }
    return text;
  }
  
  /**
   * Trims a text, an object or an array and remove sensitive information, such as session tokens, passwords, etc.
   * 
   * @param {string|Object|Array} obj is the object to trim
   * @returns {string|Object|Array} the trimmed object
   */
  static trim(obj) {
    if (obj == null || obj == undefined) return undefined;
    if (Util.isArray(obj)) {
      const a = [];
      for (const p of obj) {
        a.push(Util.trim(p));
      }
      return a;
    }
    if (typeof obj == "object") {
      for (const p in obj) {
        if (p.toLowerCase() === "x-security-token")
          obj[p] = "***";
        else if (p === "Cookie") {
          var index = obj[p].toLowerCase().indexOf("__sessiontoken");
          if (index !== -1) {
            index = obj[p].indexOf("=", index);
            if (index !== -1) {
              index = index + 1;
              const endIndex = obj[p].indexOf(";", index);
              if (endIndex == -1)
                obj[p] = obj[p].substring(0, index) + "***";
              else 
                obj[p] = obj[p].substring(0, index) + "***" + obj[p].substring(endIndex);
            }
          }
        }
        else
          obj[p] = Util.trim(obj[p]);
      }
    }
    if (typeof obj == "string") {
      // Remove trailing blanks
      while (obj && (obj.endsWith(' ') || obj.endsWith('\n') || obj.endsWith('\r') || obj.endsWith('\t')))
        obj = obj.substring(0, obj.length - 1);

      // Hide session tokens
      obj = this._removeBetween(obj, "<Cookie>__sessiontoken=", "</Cookie>");
      obj = this._removeBetween(obj, "<X-Security-Token>", "</X-Security-Token>");
      obj = this._removeBetween(obj, '<sessiontoken xsi:type="xsd:string">', '</sessiontoken>');
      obj = this._removeBetween(obj, "<pstrSessionToken xsi:type='xsd:string'>", "</pstrSessionToken>");
      obj = this._removeBetween(obj, "<pstrSecurityToken xsi:type='xsd:string'>", "</pstrSecurityToken>");
      obj = this._removeBetween(obj, '<password xsi:type="xsd:string">', '</password>');
    }
    return obj;
  }
}

/**
 * The ArrayMap object is used to access elements as either an array or a map
 * 
 * @class
 * @constructor
 * @memberof Utils
 */

class ArrayMap {
  constructor() {
      // List of items, as an ordered array. Use defineProperty to make it non-enumerable
      // and support for for ... in loop to iterate by item key
      Object.defineProperty(this, "_items", {
        value: [],
        writable: false,
        enumerable: false,
      });

      Object.defineProperty(this, "_map", {
        value: [],
        writable: false,
        enumerable: false,
      });
      
      // Number of items. Use defineProperty to make it non-enumerable
      // and support for for ... in loop to iterate by item key
      Object.defineProperty(this, "length", {
        value: 0,
        writable: true,
        enumerable: false,
      });
  }

  _push(key, value) {
      let isNumKey = false;
      if (key) {
        // reserved keyworkds
        const isReserved = key === "_items" || key === "length" || key === "_push" || key === "forEach" || key === "map" || key === "_map" || key === "get" || key === "find" || key === "flatMap" || key === "filter";

        // already a child with the name => there's a problem with the schema
        if (!isReserved && this[key]) throw new Error(`Failed to add element '${key}' to ArrayMap. There's already an item with the same name`);

        // Set key as a enumerable property, so that elements can be accessed by key, 
        // but also iterated on with a for ... in loop
        // For compatibility 
        if (!isReserved) this[key] = value;
        this._map[key] = value;

        // Special case where keys are numbers or strings convertible with numbers
        const numKey = +key;
        if (numKey === numKey) {
          // keys is a number. If it matches the current index, then we are good,
          // and we can add the property as an enumerable property
          isNumKey = true;
        }
      }

      if (!isNumKey) {
        // Set the index property so that items can be accessed by array index.
        // However, make it non-enumerable to make sure indexes do not show up in a for .. in loop
        Object.defineProperty(this, this._items.length, {
          value: value,
          writable: false,
          enumerable: false,
        });
      }
      // Add to array and set length
      this._items.push(value);
      this.length = this._items.length;
  }

  /**
   * Executes a provided function once for each array element.
   * @param {*} callback Function that is called for every element of the array
   * @param {*} thisArg Optional value to use as this when executing the callback function.
   * @returns a new array
   */
  forEach(callback, thisArg) {
      return this._items.forEach(callback, thisArg);
  }

  /**
   * Returns the first element that satisfies the provided testing function. If no values satisfy the testing function, undefined is returned.
   * @param {*} callback Function that is called for every element of the array
   * @param {*} thisArg Optional value to use as this when executing the callback function.
   * @returns the first element matching the testing function
   */
  find(callback, thisArg) {
    return this._items.find(callback, thisArg);
  }

  /**
   * creates a new array with all elements that pass the test implemented by the provided function.
   * @param {*} callback Function that is called for every element of the array
   * @param {*} thisArg Optional value to use as this when executing the callback function.
   * @returns an array containing elements passing the test function
   */
   filter(callback, thisArg) {
    return this._items.filter(callback, thisArg);
  }

  /**
   * Get a element by either name (access as a map) or index (access as an array). Returns undefined if the element does not exist or
   * if the array index is out of range.
   * @param {string|number} indexOrKey the name or index of the element
   * @returns the element matching the name or index
   */
  get(indexOrKey) {
    if (typeof indexOrKey === 'number') return this._items[indexOrKey];
    return this._map[indexOrKey];
  }

  /**
   * Creates a new array populated with the results of calling a provided function on every element in the calling array.
   * @param {*} callback Function that is called for every element of the array
   * @param {*} thisArg Optional value to use as this when executing the callback function.
   * @returns a new array
   */
  map(callback, thisArg) {
    return this._items.map(callback, thisArg);
  }

  /**
   * Returns a new array formed by applying a given callback function to each element of the array, and then flattening the result by one level. 
   * @param {*} callback Function that is called for every element of the array
   * @param {*} thisArg Optional value to use as this when executing the callback function.
   * @returns a new array
   */
  flatMap(callback, thisArg) {
    return this._items.flatMap(callback, thisArg);
  }

  /**
   * Iterates over all the elements using the for ... of syntax.
   * @returns returns each element one after the other
   */
  *[Symbol.iterator] () {
      for (const item of this._items) {
          yield item;
      }
  }
}

// Public expots
exports.Util = Util;
exports.ArrayMap = ArrayMap;

})();