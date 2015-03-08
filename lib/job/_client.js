/**
 * A base job "client". This will be run on follower instances and be
 * responsible for executing tasks in the given range.
 * @param {String} id
 * @param {Number} start
 * @param {Number} end
 */
function Client (id, start, end) {
    this._id = id;
    this._start = start;
    this._end = end;
    this._progress = start;
}

/**
 * Returns the job ID.
 * @return {String}
 */
Client.prototype.getId = function () {
    return this._id;
};

/**
 * Returns the start position of the job range.
 * @return {Number}
 */
Client.prototype.getStart = function () {
    return this._start;
};

/**
 * Returns the end position of the job range.
 * @return {Number}
 */
Client.prototype.getEnd = function () {
    return this._end;
};

/**
 * Returns the job's progress in a three-element array of numbers, in
 * the format: [start, current, end].
 * @return {[]Number}
 */
Client.prototype.getProgress = function () {
    return [ this.getStart(), this._progress, this.getEnd() ];
};

/**
 * Starts a job execution.
 */
Client.prototype.start = function () {
    throw new Error('not implemented');
};

/**
 * Stops the job executiong, returning the last progress array.
 * @return {[]Number}
 */
Client.prototype.halt = function () {
    throw new Error('not implemented');
};

module.exports = Client;
