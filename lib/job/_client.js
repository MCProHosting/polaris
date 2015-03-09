var events = require('events');
var util = require('util');
var status = require('./status');

/**
 * A base job "client". This will be run on follower instances and be
 * responsible for executing tasks for a job in multiple ranges.
 * @param {String} id
 * @param {Number} start
 * @param {Number} end
 */
function Client () {
    events.EventEmitter.call(this);
    // List of ranges we're working on.
    this._ranges = [];
    // The master correspondent to this client.
    this._master = null;
    // Information about the managing job, in case we need to upgrade.
    this._job = {};
    // Whether the client is currently doing work.
    this._working = false;
}
util.inherits(Client, events.EventEmitter);

/**
 * Returns the next number in a job range (null if nothing is available)
 * and increments the progress on that range.
 * @return {Number}
 */
Client.prototype._nextInRange = function () {
    if (!this._working) {
        return null;
    }

    for (var i = 0, l = this._ranges.length; i < l; i++) {
        var range = this._ranges[i];

        if (range.status === status.WORKING) {
            var number = range.progress++;
            range.status = range.progress >= range.end ? status.DONE : status.WORKING;

            return number;
        }
    }

    this._working = false;
    return null;
};

/**
 * Adds data from the packet to this client.
 * @param {Object} packet
 */
Client.prototype.addNew = function (packet) {
    this._job = _.extend(this._job, packet.job);
    this._ranges.push(_.clone(packet.range));

    if (!this._working) {
        this.work();
    }
};

/**
 * Returns the job object.
 * @return {Object}
 */
Client.prototype.getJob = function () {
    return this._job;
};

/**
 * Returns the job's ranges.
 * @return {Array}
 */
Client.prototype.getRanges = function () {
    return this._ranges;
};

/**
 * Starts a job execution.
 */
Client.prototype.work = function () {
    throw new Error('not implemented');
};

/**
 * Stops the job execution.
 */
Client.prototype.halt = function () {
    throw new Error('not implemented');
};

/**
 * Upgrades a client job to be a "master" job.
 * @return {Master}
 */
Client.prototype.upgrade = function () {
    // Stop running out worker task
    this.halt();

    var master = new this._master(this._job.start, this._job.end);
    master.setRanges(this._ranges);
    master.setRaft(this._raft);
    master.setMeta(this._job.metadata);
    master.setEnsure(this._job.ensure);

    // Look through the ranges. Set anything we're working on to be pending,
    // so that it's re-dispatched to other clients later.
    _.forEach(this._job.ranges, function (range) {
        if (_.any(this._ranges, { id: range.id })) {
            master._reassignRange(range);
        }
    }, this);

    return master;
};

module.exports = Client;
