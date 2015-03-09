var events = require('events');
var util = require('util');
var status = require('./status');
var _ = require('lodash');

/**
 * A base job "client". This will be run on follower instances and be
 * responsible for executing tasks for a job in multiple ranges.
 * @param {Object} options
 */
function Client () {
    events.EventEmitter.call(this);

    // Whether the client is currently doing work.
    this._working = false;
    // Raft cluster instance
    this._raft = null;
    // The master correspondent to this client. Should be overrridden
    // in implementation.
    this._master = null;
}
util.inherits(Client, events.EventEmitter);

/**
 * Sets the Raft to use for this job.
 * @param {Raft} raft
 */
Client.prototype.setRaft = function (raft) {
    this._raft = raft;
    this._master._raft = raft;
};

/**
 * Gets ranges assigned to the current client.
 * @return {Array}
 */
Client.prototype.getRanges = function () {
    return _.where(this._master.getRanges(), { node: this._raft.self() });
};

/**
 * Returns whether the job is fully complete.
 * @return {Boolean}
 */
Client.prototype.isComplete = function () {
    return this._master.isComplete();
};

/**
 * Updates the job to match the given data.
 * @param  {Object} data
 * @return {Client}
 */
Client.prototype.update = function (data) {
    var master = this._master;
    var ranges = this._master.getRanges();

    // Look through the ranges in the update. The current node "knows"
    // more about itself, so for its own ranges just use those.
    for (var i = 0, l = data.ranges.length; i < l; i++) {
        if (data.ranges[i].node === this._raft.self()) {
            var range = _.find(ranges, { rangeId: data.ranges[i].rangeId });
            if (range) {
                data.ranges[i] = range;
            }
        }
    }

    for (var key in data) {
        if (this._master['_' + key] !== 'undefined') {
            this._master['_' + key] = data[key];
        }
    }

    this.startWork();
    return this;
};

/**
 * Returns the next number in a job range (null if nothing is available)
 * and increments the progress on that range.
 * @return {Number}
 */
Client.prototype._nextInRange = function () {
    if (!this._working) {
        return null;
    }

    // Get all ranges on the job
    var ranges = this._master.getRanges();
    for (var i = 0, l = ranges.length; i < l; i++) {
        var range = ranges[i];
        // Skip ranges that aren't assigned to us
        if (range.node !== this._raft.self()) {
            continue;
        }

        // If the range is under a working state, work on it!
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
 * Starts the client working, if it is not already.
 */
Client.prototype.startWork = function () {
    if (!this._working) {
        this._working = true;
        this.work();
    }
};

/**
 * Returns the job object.
 * @return {Object}
 */
Client.prototype.getJob = function () {
    return this._master;
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

    var master = this._master;
    var self = this._raft.self();
    // Look through the ranges. Set anything we're working on to be pending,
    // so that it's re-dispatched to other clients later.
    _.forEach(master._ranges, function (range) {
        if (range.node === self) {
            master._reassignRange(range);
        }
    }, this);

    return master;
};

module.exports = Client;
