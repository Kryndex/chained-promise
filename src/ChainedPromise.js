/*
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import fix from "./fix";

/**
 * An extended promise for recurring promises with multiple compositions.
 *
 * ```javascript
 * var chained = ChainedPromise.from(promise);
 * chained.flatMap(a).flatMap(b).flatMap(c).forEach(fn).catch(onRejected);
 * ```
 *
 * is equivalent to:
 *
 * ```javascript
 * promise.then(a).then(b).then(c).then(fn).then((v) => v.next)
 *        .then(a).then(b).then(c).then(fn).then((v) => v.next)
 *        .then(a).then(b).then(c).then(fn).then((v) => v.next)
 *        ...
 *        .catch(onRejected);
 * ```
 *
 * `(v) => v.next` function is the default {@link ChainedPromise#next} value picker. We can supply
 * custom value picker to the {@link ChainedPromise#constructor} and {@link ChainedPromise#from}.
 */
class ChainedPromise extends Promise {
  /**
   * Initializes fields common to both {@link ChainedPromise#constructor} and
   * {@link ChainedPromise#from} code path.
   * @private
   */
  _initialize() {
    this.flatMapChain = [];
  }

  /**
   * Constructs next {@link ChainedPromise} that carries over settings and composition properties
   * of the current one.
   * @param {T} v
   * @returns {ChainedPromise.<T>}
   * @private
   * @template T
   */
  _nextPromise(v) {
    const nextPromise = ChainedPromise.from(this.next(v), this.next);
    nextPromise.flatMapChain = this.flatMapChain;
    return nextPromise;
  }

  /**
   * @param {function(function, function)} executor Promise executor
   * @param {function(T) : Promise.<T>} next
   * @template T
   */
  constructor(executor, next = ChainedPromise.nextFieldPicker("next")) {
    super(executor);
    /**
     * Function to construct promise to next item in chain.
     * @type {function(T) : Promise.<T>}
     * @template T
     */
    this.next = next;
    this._initialize();
  }

  /**
   * Creates a ChainedPromise that extends given Promise.
   * @param {Promise.<T>} innerPromise
   * @param {function(T) : Promise.<T>} next
   * @returns {ChainedPromise.<T>}
   * @template T
   */
  static from(innerPromise, next = ChainedPromise.nextFieldPicker("next")) {
    Object.setPrototypeOf(innerPromise, ChainedPromise.prototype);
    innerPromise.next = next;
    innerPromise._initialize();

    return innerPromise;
  }

  /**
   * Returns a function to pick the given attribute.
   * @param {string} attr Name of the attribute (that will contain the next promise).
   * @returns {function(T) : Promise.<T>}
   * @template T
   */
  static nextFieldPicker(attr) {
    return (x) => x[attr];
  }

  /**
   * @param {function(T)} fn
   * @returns {Promise}
   * @template T
   */
  forEach(fn) {
    return fix((v) => {
      fn(v);
      return this._nextPromise(v);
    })(this);
  }

  /**
   * Stacks up flat map operation to be performed in this promise. See {@link ChainedPromise} for
   * examples.
   * @param {function(T) : Promise.<U>} fn
   * @returns {ChainedPromise.<U>}
   * @template T
   * @template U
   */
  flatMap(fn) {
    this.flatMapChain.push(fn);
    return this;
  }

  /**
   * Non-async equivalent of {@link #flatMap}.
   * @param {function(T) : U} fn
   * @returns {ChainedPromise.<U>}
   * @template T
   * @template U
   */
  map(fn) {
    this.flatMap((v) => Promise.resolve(fn(v)));
    return this;
  }

  /**
   * Overrides Promise.then to compose with extra functions. See {@link ChainedPromise} for the
   * specifics of available compositions.
   * @param {function(T): (U | Promise.<U>)} onFulfilled
   * @param {function(*): (U | Promise.<U>)} onRejected
   * @returns {Promise.<T>}
   * @template T
   * @template U
   */
  then(onFulfilled, onRejected) {
    if (!onFulfilled) {
      // Skip processing in case of Promise.catch call.
      return super.then(onFulfilled, onRejected);
    }
    // Branch out no-op special case, since "super" in ES6 is not a first-class citizen.
    if (this.flatMapChain.length === 0) {
      return super.then(onFulfilled, onRejected);
    } else {
      const firstFlatMapped = super.then(this.flatMapChain[0]);
      const flatMapped = this.flatMapChain.slice(1).reduce((x,y) => x.then(y), firstFlatMapped);
      return flatMapped.then(onFulfilled, onRejected);
    }
  }

  /**
   * Flat-maps current promise chain to resolve into successive accumulation of values, from given
   * accumulator. Accumulator should pass on next promise to the accumulated value.
   * @param {function(U, T): (Promise.<U>)} fn Accumulator that takes previous accumulation and
   * current value, and calculate next accumulation.
   * @param {U} initial Initial accumulated value to start with.
   * @returns {ChainedPromise.<U>}
   * @template T
   * @template U
   */
  accumulate(fn, initial) {
    let accumulated = initial;
    this.flatMap((v) => fn(accumulated, v))
      .flatMap((acc) => {
        accumulated = acc;
        return acc;
      });
    return this;
  }
}

export default ChainedPromise;