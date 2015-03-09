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
 * @param {Number} start
 * @param {Number} end
 */
function Master (start, end) {
    events.EventEmitter.call(this);

    // number range for this job
    this._start = start;
    this._end = end;
    // tracking of ranges dispatched to clients
    this._ranges = null;
    // the raft cluster it's acting on
    this._raft = null;
    // the name of this job. It should be overridden by inheriting classes
    this._name = null;
    // metadata sent down with the job
    this._metadata = {};
    // whether to ensure job success (see setEnsure below)
    this._ensure = null;
    // random UUID for job tracking
    this._id = uuid.v4();
    // whether the job is complete
    this._complete = null;
}

util.inherits(Base, events.EventEmitter);

/**
 * Sets the Raft to use for this job.
 * @param {Raft} raft
 */
Job.prototype.setRaft = function (raft) {
    this._raft = raft;
};

/**
 * Sets the ranges object on the job. Should NOT be called during normal
 * operation. Its purpose is to allow the creation of a new master from
 * ranges previously sent out, if the master failed.
 * @param {Array} ranges
 */
Job.prototype.setRanges = function (ranges) {
    this._ranges = ranges;
};

/**
 * Sets metadata that is sent down to clients when they recieve the job.
 * @param {Raft} raft
 */
Job.prototype.setMeta = function (metadata) {
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
Job.prototype.setEnsure = function (ensure) {
    this._ensure = ensure;
};

/**
 * Returns the job ID.
 * @return {String}
 */
Job.prototype.getId = function () {
    return this._id;
};

/**
 * Returns the start position of the job range.
 * @return {Number}
 */
Job.prototype.getStart = function () {
    return this._start;
};

/**
 * Returns the end position of the job range.
 * @return {Number}
 */
Job.prototype.getEnd = function () {
    return this._end;
};

/**
 * Gets the ranges associated with this job.
 * @return {Array}
 */
Job.prototype.getRanges = function () {
    return this._ranges;
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
            progress: this._start,
            // Status is "pending" as it's not sent out yet
            status: status.PENDING,
            // Keep track of the last time we heard about the job's work.
            lastUpdate: new Date(),
            // If the job is ensured, we'll keep track of retries
            // and stop eventually.
            retries: 0
        };
    }
    // Due to rounding errors we probably didn't reach the end of the range.
    // Manually assign the _end to the last node.
    this._ranges[nodes[i - 1]].end = this._end;
};

/**
 * Constructs and sends a packet that assigns the given range.
 * @param {Object} range
 */
Master.prototype._writeDispatch = function (range) {
    this._raft.writeTo(range.node, 'job:new', {
        job: {
            id: this._id,
            name: this._name,
            metadata: this._metadata,
            ranges: this._ranges,
            start: this._start,
            end: this._end,
            ensure: this._ensure
        },
        range: _.pick(range, ['rangeId', 'start', 'end'])
    });

    range.status = status.WORKING;
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
    var completedSegment = _.clone(range);
    completed.end = completed.progress;
    completed.status = status.DONE;
    completed.rangeId += 'segment';

    // And update the range to a status of PENDING, move the work to a
    // different worker, and set the start point to the last progress.
    range.retries += 1;
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
    range.status = status.PENDING;
    range.rangeId += 'ra';
    this._writeDispatch(range);
};

/**
 * Emits an event to the cluster with current range progresses.
 */
Master.prototype._emitProgress = function () {
    this._raft.writeTo(this._raft.FOLLOWERS, 'job:status', {
        id: this._id,
        ranges: this._ranges
    });

    this.emit(this._complete ? 'complete' : 'progress', this._ranges);
};

/**
 * Runs maintainance on the job. It dispatches jobs, reassigns failed jobs,
 * and emits progress events.
 */
Master.prototype._heartbeat = function () {
    this._complete = true;

    for (var i = 0, l = ranges.length; i < l; i++) {
        var range = ranges[i];
        // Write new pending ranges out.
        if (range.status === status.PENDING) {
            this._writeDispatch(range);
        }
        // Handle "failed" jobs
        else if (range.status === status.FAILED) {
            this._processFailed(range);
        }
        // If there are any ranges that are not done and not aborted,
        // the set complete to be false.
        if (range.status !== status.DONE && range.status !== status.ABORTED) {
            this._complete = false;
        }
    }

    this._emitProgress();

    // If we aren't complete, repeat the heartbeat.
    if (!this._complete) {
        setTimeout(_.bind(this._heartbeat, this), config.get('job.heartbeat'));
    }
};

/**
 * Takes data from a job:progress event and updates the corresponding range.
 * @param  {Object} packet
 */
Master.prototype.updateRange = function (range) {
    var storedRange = _.find(this._ranges, { id: packet.id });
    // If the ID contained an invalid range, that's not a big deal.
    // Can happen if nodes leave a cluster and enter it later. Just abort.
    if (!storedRange) {
        log.debug('Attempted to update invalid range ID for job.', {
            packet: packet,
            job: this._id
        });
        return;
    }

    _.extend(storedRange, range);
};

/**
 * Runs the job. Dispatches ranges to listening clients. Should only be
 * called once per job.
 */
Master.prototype.run = function () {
    this._assignRanges();
    this._heartbeat();
};

module.exports = Master;
