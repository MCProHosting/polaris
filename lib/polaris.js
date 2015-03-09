var config = require('config');
var Raft = require('../lib/raft/axon');
var factory = require('./job/factory');

/**
 * Instance responsible for maintaining application state and managing
 * process-level executions.
 */
function Polaris () {
    this._raft = null;
    this._state = null;
    // A map of ongoing jobs on the Polaris instance. IMPORTANT! When
    // polaris is a client, these will be "client" jobs, but when it is
    // a master they'll be "master" jobs.
    this._jobs = {};
}

/**
 * Returns running jobs on the polaris cluster.
 * @return {[]Job}
 */
Polaris.prototype.getJobs = function () {
    return this._jobs;
};

/**
 * Finds a job by its ID.
 * @param  {String} id
 * @return {Job}
 */
Polaris.prototype.findJob = function (id) {
    return this._jobs[id];
};

/**
 * Boots the polaris instance into the cluster.
 * @return {Polaris}
 */
Polaris.prototype.boot = function () {
    var self = this;
    var raft = this._raft = new Raft(config.get('raft.self'), config.get('raft.cluster')).boot();

    //
    // Role changes.
    //
    raft.on('leader', function () {
        self._state = 'master';
        self._promote();
    });
    raft.on('follower', function () {
        self._state = 'follower';
    });

    //
    // Job state changes
    //
    raft.on('job:status', function (data) {
        var job = this.findJob(data.id);
        if (job) {
            job.getJob().ranges = data.ranges;
        }
    });
    raft.on('job:new', function (data) {
        // Look up the job, or create a new one.
        var job = this.findJob(data.job.id) || factory.create(data);
        if (job) {
            this._jobs.push(job);
        }
    });
    raft.on('job:report', function (data) {
        for (var key in data) {
            var job = this.findJob(key);
            if (job) {
                job.updateRange(data[key]);
            }
        }
    });

    return this;
};

/**
 * Sends job status updates back up to the master node.
 */
Polaris.prototype._sendUpdates = function () {
    if (this._state !== 'client') {
        return;
    }

    var updates = _.mapValues(this._jobs, function (job) {
        return job.getRanges();
    });

    this._raft.writeTo(this._raft.LEADER, 'job:report', updates);
};

/**
 * Promotes the polaris state from being a client to being a master. Note
 * that there is no equivalent "demote", as the only time a Raft exits its
 * master state is when it crashes/leaves the cluster.
 * @return {[type]} [description]
 */
Polaris.prototype._promote = function () {
    if (this._state !== 'client') {
        return;
    }

    this._jobs = _.mapValues(this._jobs, function (job) {
        return job.upgrade();
    });
};

/**
 * Tears down the Polaris instance. Sends final progress updates on every
 * job before removing itself
 * @return {Promise}
 */
Polaris.prototype.destroy = function () {
    if (this.raft) {}
};
