var events = require('events');
var util = require('util');
var uuid = require('node-uuid');
var config = require('config');
var _ = require('lodash');

var status = require('./status');
var log = require('../log');

/**
 * A base job "master". This will be run on master instances and be
 * responsible for dividing the task up for dispatching. It can emit
 * the following events:
 *     - complete(ranges)
 *     - progress(ranges)
 *
 * @param {Object} options
 */
function Master (options) {
    events.EventEmitter.call(this);

    // number range for this job
    this._start = +options.start;
    this._end = +options.end;
    // tracking of ranges dispatched to clients
    this._ranges = options.ranges || [];
    // the raft cluster it's acting on
    this._raft = options.raft || null;
    // metadata sent down with the job
    this._metadata = options.metadata || {};
    // whether to ensure job success (see setEnsure below)
    this._ensure = options.ensure || null;
    // random UUID for job tracking
    this._id = options.id || uuid.v4();
    // the name of this job. It should be overridden by inheriting classes
    this._name = null;
    // whether the job is complete
    this._complete = null;
}

util.inherits(Master, events.EventEmitter);

/**
 * Sets the Raft to use for this job.
 * @param {Raft} raft
 */
Master.prototype.setRaft = function (raft) {
    this._raft = raft;
};

/**
 * Sets the ranges object on the job. Should NOT be called during normal
 * operation. Its purpose is to allow the creation of a new master from
 * ranges previously sent out, if the master failed.
 * @param {Array} ranges
 */
Master.prototype.setRanges = function (ranges) {
    this._ranges = ranges;
};

/**
 * Sets metadata that is sent down to clients when they recieve the job.
 * @param {Raft} raft
 */
Master.prototype.setMeta = function (metadata) {
    this._metadata = metadata;
};

/**
 * Sets whether this job is "ensured". If a follower drops out of the cluste
 *  during a job, we do one of two things. If "ensure" is true, we re-dispatch
 *  the job range from where the cluster last told us it had gotten to. This
 *  would be important for things like trimming subscriber roles. If "ensure"
 *  is false, we'll just mark the job range as failed and leave it as that.
 *  This would be preferable for things like live notification, where it's
 *  not a big deal if we don't send a message, but we don't want to send
 *  duplicates.
 *
 * @param {Boolean} raft
 */
Master.prototype.setEnsure = function (ensure) {
    this._ensure = ensure;
};

/**
 * Simply returns itself. For compatiblity with the client version.
 * @return {Job}
 */
Master.prototype.getJob = function () {
    return this;
};

/**
 * Returns the job ID.
 * @return {String}
 */
Master.prototype.getId = function () {
    return this._id;
};

/**
 * Returns the start position of the job range.
 * @return {Number}
 */
Master.prototype.getStart = function () {
    return this._start;
};

/**
 * Returns the end position of the job range.
 * @return {Number}
 */
Master.prototype.getEnd = function () {
    return this._end;
};

/**
 * Gets the ranges associated with this job.
 * @return {Array}
 */
Master.prototype.getRanges = function () {
    return this._ranges;
};

/**
 * Returns whether the job is complete.
 * @return {Boolean}
 */
Master.prototype.isComplete = function () {
    return this._complete;
};

/**
 * Takes a list of ranges and assigns them to the given set of nodes.
 * @param {Array} nodes List of nodes that are viable candidates to
 *                      recieve jobs.
 */
Master.prototype._assignRanges = function () {
    // Calculate the length of segment to dispatch to each node. We'll
    // divide everything equally.
    var nodes = this._raft.getWorkers();
    var num = nodes.length;
    var rangeSize = ~~((this._end - this._start) / num);
    var ranges = this._ranges = new Array(num);

    // Do so, saving it to the "ranges" dict
    for (var i = 0; i < num; i++) {
        ranges[i] =  {
            // Create some unique ID based off the start
            rangeId: this._id + '-' + i,
            // Save the node
            node: nodes[i],
            // Set the start, end, and progress points. Progress will
            // be updated by workers periodically.
            start: this._start + rangeSize * i,
            end: this._start + rangeSize * (i + 1),
            progress: this._start + rangeSize * i,
            // Status is "pending" as it's not sent out yet
            status: status.WORKING,
            // Keep track of the last time we heard about the job's work.
            lastUpdate: new Date(),
            // If the job is ensured, we'll keep track of retries
            // and stop eventually.
            retries: 0
        };
    }

    // Due to rounding errors we probably didn't reach the end of the range.
    // Manually assign the _end to the last node.
    this._ranges[i - 1].end = this._end;
};

/**
 * Takes a range marked as FAILED. Either redispatches it, or aborts
 * it, depending on settings and previous failures.
 * @param  {Number} range
 */
Master.prototype._processFailed = function (range) {
    // If the job is not ensured, just set the range to aborted
    // and log an info.
    if (!this._ensure) {
        range.status = status.ABORTED;
        log.info('Non-ensured job range aborted.', range);
        return;
    }

    // Otherwise, it is ensured. If we're out of retries, abort
    // and log an error.
    if (range.retries > config.get('job.retries')) {
        range.status = status.ABORTED;
        log.error('Ensured job range aborted.', range);
        return;
    }

    // Otherwise, add a new completed range for the confirmed work...
    if (range.status > range.start) {
        range.retries = 0;
        var completedSegment = _.clone(range);
        completedSegment.end = completedSegment.progress;
        completedSegment.status = status.DONE;
        completedSegment.rangeId += 'segment';
        this._ranges.push(completedSegment);
    }
    // Only add a retry if we're "stuck" on the same job item.
    else {
        range.retries += 1;
    }

    // And update the range to a status of PENDING, move the work to a
    // different worker, and set the start point to the last progress.
    this._reassignRange(range);
};

/**
 * Takes a range, removes it from the node it's currently working on,
 * and assigns it to a different noce.
 * @param  {Object} range
 */
Master.prototype._reassignRange = function (range) {
    range.node = _(this._raft.getWorkers()).without(range.node).sample();
    range.start = range.progress;
    range.status = status.WORKING;
    range.rangeId = uuid.v4();
};

/**
 * Emits an event to the cluster with current range progresses.
 */
Master.prototype._emitProgress = function () {
    this._raft.writeTo(this._raft.FOLLOWERS, 'job:status', {
        id: this._id,
        name: this._name,
        metadata: this._metadata,
        ranges: this._ranges,
        start: this._start,
        end: this._end,
        ensure: this._ensure,
        complete: this._complete
    });

    this.emit(this._complete ? 'complete' : 'progress', this._ranges);
};

/**
 * Reassigns all workload for a node address.
 * @param  {*} node
 */
Master.prototype.reassign = function (node) {
    for (var i = 0, l = this._ranges.length; i < l; i++) {
        var range = this._ranges[i];
        if (range.node === node) {
            this._processFailed(range);
        }
    }
};

/**
 * Runs maintainance on the job. It dispatches jobs, reassigns failed jobs,
 * and emits progress events.
 */
Master.prototype.heartbeat = function () {
    this._complete = true;

    for (var i = 0, l = this._ranges.length; i < l; i++) {
        var range = this._ranges[i];

        // Reassign stale jobs.
        if (range.status === status.WORKING && (new Date() - range.lastUpdate) > config.get('job.staleTimeout')) {
            range.status = status.FAILED;
        }

        // Handle "failed" jobs
        if (range.status === status.FAILED) {
            this._processFailed(range);
        }
        // If there are any ranges that are not done and not aborted,
        // the set complete to be false.
        if (range.status !== status.DONE && range.status !== status.ABORTED) {
            this._complete = false;
        }
    }

    this._emitProgress();
    return this;
};

/**
 * Takes data from a job:progress event and updates the corresponding range.
 * @param  {Object} packet
 */
Master.prototype.updateRange = function (ranges) {
    for (var i = 0, l = ranges.length; i < l; i++) {
        var range = ranges[i];
        var storedRange = _.find(this._ranges, { rangeId: range.rangeId });
        // If the ID contained an invalid range, that's not a big deal.
        // Can happen if nodes leave a cluster and enter it later. Just abort.
        if (!storedRange) {
            log.debug('Attempted to update invalid range ID for job.', {
                range: range,
                job: this._id
            });
            continue;
        }

        _.extend(storedRange, range);
        storedRange.lastUpdate = new Date();
    }
};

/**
 * Runs the job. Dispatches ranges to listening clients. Should only be
 * called once per job.
 */
Master.prototype.run = function () {
    this._assignRanges();
};

module.exports = Master;
