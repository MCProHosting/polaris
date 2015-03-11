var events = require('events');
var util = require('util');
var uuid = require('node-uuid');
var config = require('config');
var _ = require('lodash');

var status = require('./status');
var log = require('../log');
var redis = require('../db/redis');

/**
 * A base job "master". This will be run on master instances and be
 * responsible for dividing the task up for dispatching. It can emit
 * the following events:
 *     - complete(ranges)
 *     - progress(ranges)
 *
 * Jsdocs for functions are marked to be run as #master, #client, or #both
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
    // whether we're currently working on a job segment
    this._working = false;
    // List of nodes to notify that they have been reassigned.
    this._reassignments = [];
    // When a client, the list of ranges that have changed and should
    // be updated.
    this._updatedRanges = {};
}

util.inherits(Master, events.EventEmitter);

/**
 *
 * #both
 *
 * Sets the Raft to use for this job.
 * @param {Raft} raft
 */
Master.prototype.setRaft = function (raft) {
    this._raft = raft;
};

/**
 *
 * #both
 *
 * Sets the ranges object on the job. Should NOT be called during normal
 * operation. Its purpose is to allow the creation of a new master from
 * ranges previously sent out, if the master failed.
 * @param {Array} ranges
 */
Master.prototype.setRanges = function (ranges) {
    this._ranges = ranges;
};

/**
 *
 * #both
 *
 * Sets metadata that is sent down to clients when they recieve the job.
 * @param {Raft} raft
 */
Master.prototype.setMeta = function (metadata) {
    this._metadata = metadata;
};

/**
 *
 * #both
 *
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
 *
 * #both
 *
 * Returns the job ID.
 * @return {String}
 */
Master.prototype.getId = function () {
    return this._id;
};

/**
 *
 * #both
 *
 * Returns the start position of the job range.
 * @return {Number}
 */
Master.prototype.getStart = function () {
    return this._start;
};

/**
 *
 * #both
 *
 * Returns the end position of the job range.
 * @return {Number}
 */
Master.prototype.getEnd = function () {
    return this._end;
};

/**
 *
 * #both
 *
 * Gets the ranges associated with this job.
 * @return {Array}
 */
Master.prototype.getRanges = function () {
    return this._ranges;
};

/**
 *
 * #client
 *
 * Gets the ranges associated the particular client.
 * @return {Array}
 */
Master.prototype.getOwnRanges = function () {
    return _.where(this._ranges, { node: this._raft.self() });
};

/**
 *
 * #client
 *
 * Gets a list of ranges that have changed.
 * @return {Array}
 */
Master.prototype.getUpdatedRanges = function () {
    return _.values(this._updatedRanges);
};

/**
 *
 * #both
 *
 * Returns whether the job is complete.
 * @return {Boolean}
 */
Master.prototype.isComplete = function () {
    return this._complete;
};

/**
 *
 * #both
 *
 * Updates the properties to match the object.
 * @param  {Object} props
 */
Master.prototype.updateProperties = function (props) {
    for (var key in props) {
        if (key === 'ranges') {
            this.updateRange(props.ranges);
        } else {
            this['_' + key] = props[key];
        }
    }
};

/**
 *
 * #master
 *
 * Takes a list of ranges and assigns them to the given set of nodes.
 * @param {Array} nodes List of nodes that are viable candidates to
 *                      recieve jobs.
 */
Master.prototype._assignRanges = function () {
    // Calculate the length of segment to dispatch to each node. We'll
    // divide everything equally.
    var nodes = this._raft.getWorkers();
    var num = nodes.length * 8;
    var rangeSize = ~~((this._end - this._start) / num);
    var ranges = this._ranges = new Array(num);

    // Do so, saving it to the "ranges" dict
    for (var i = 0; i < num; i++) {
        ranges[i] =  {
            // Create some unique ID based off the start
            rangeId: this._id + '-' + i,
            // Save the node
            node: nodes[~~(i / 8)],
            // Set the start, end, and progress points. Progress will
            // be updated by workers periodically.
            start: this._start + rangeSize * i,
            end: this._start + rangeSize * (i + 1),
            progress: this._start + rangeSize * i,
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
    this._ranges[i - 1].end = this._end;
};

/**
 *
 * #master
 *
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

    this._reassignRange(range);
};

/**
 *
 * #master
 *
 * Takes a range, removes it from the node it's currently working on,
 * and assigns it to a different noce.
 * @param  {Object} range
 */
Master.prototype._reassignRange = function (range) {
    // Add a new completed range for the confirmed work...
    if (range.progress > range.start) {
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
    range.node = _(this._raft.getWorkers()).without(range.node, this._raft.getLeader()).sample();
    range.status = status.PENDING;
    range.start = range.progress;

    this._reassignments.push(range.node);
};

/**
 *
 * #master
 *
 * Emits an event to the cluster with current range progresses.
 */
Master.prototype._emitProgress = function () {
    var id = this._id;
    var raft = this._raft;
    var status = {
        id: id,
        name: this._name,
        metadata: this._metadata,
        ranges: this._ranges,
        start: this._start,
        end: this._end,
        ensure: this._ensure,
        complete: this._complete
    };

    // If it's complete, remove the Redis record and let followers know.
    if (status.complete) {
        this.emit('complete', this._ranges);
        raft.writeTo(raft.FOLLOWERS, 'job:complete', id);
        redis.getMaster().client.hdel(config.get('redis.jobToken'), id);
    }
    // Otherwise, emit progress and update redis.
    else {
        this.emit(this._complete, 'progress', this._ranges);

        var reassignments = this._reassignments;
        redis.getMaster().client.hset(config.get('redis.jobToken'), id, JSON.stringify(status), (function (err) {
            if (err) {
                return log.error(err);
            }

            // Let all the nodes whose job status changed know to
            // check their data.
            var writtenTo = [];
            for (; reassignments.length > 0;) {
                var node = reassignments.pop();
                if (writtenTo.indexOf(node) === -1) {
                    writtenTo.push(node);
                    raft.writeTo(node, 'job:assign', id);
                }
            }
        }).bind(this));
    }
};

/**
 *
 * #master
 *
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
 *
 * #master
 *
 * Runs maintainance on the job. It dispatches jobs, reassigns failed jobs,
 * and emits progress events.
 */
Master.prototype.heartbeat = function () {
    this._complete = true;

    for (var i = 0, l = this._ranges.length; i < l; i++) {
        var range = this._ranges[i];

        // Handle "failed" jobs
        if (range.status === status.FAILED) {
            this._processFailed(range);
        }

        // If there are any ranges that are not done and not aborted,
        // the set complete to be false.
        if (range.status !== status.DONE && range.status !== status.ABORTED) {
            this._complete = false;

            // Reassign stale jobs.
            if ((new Date() - range.lastUpdate) > config.get('job.staleTimeout')) {
                this._reassignRange(range);
            }
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
            this._ranges.push(ranges[i]);
        } else {
            // Don't update ranges that are ahead!
            if (storedRange.progress <= range.progress) {
                _.extend(storedRange, range);
            }
            storedRange.lastUpdate = new Date();
        }
    }
};

/**
 *
 * #client
 *
 * Returns the next number in a job range (null if nothing is available)
 * and increments the progress on that range.
 * @return {Number}
 */
Master.prototype._nextInRange = function (node) {
    if (!this._working) {
        return null;
    }

    node = node || this._raft.self();

    // Get all ranges on the job
    var ranges = this._ranges;
    for (var i = 0, l = ranges.length; i < l; i++) {
        var range = ranges[i];
        // Skip ranges that aren't assigned to us
        if (range.node !== node) {
            continue;
        }

        // If the range is under a working state, work on it!
        if (range.status === status.WORKING || range.status === status.PENDING) {
            var number = range.progress++;
            range.status = range.progress >= range.end ? status.DONE : status.WORKING;
            this._updatedRanges[range.rangeId] = range;

            return number;
        }

    }

    this._working = false;
    return null;
};

/**
 *
 * #master
 *
 * Runs the job. Dispatches ranges to listening clients. Should only be
 * called once per job.
 */
Master.prototype.run = function () {
    this._assignRanges();
    this._reassignments.push(this._raft.FOLLOWERS);
};

/**
 *
 * #client
 *
 * Starts the client working, if it is not already.
 */
Master.prototype.startWork = function () {
    if (!this._working) {
        this._working = true;
        this.work();
    }
};

/**
 *
 * #client
 *
 * Starts a job execution.
 */
Master.prototype.work = function () {
    throw new Error('not implemented');
};

/**
 *
 * #client
 *
 * Stops the job execution.
 */
Master.prototype.halt = function () {
    this._working = false;
};

module.exports = Master;
