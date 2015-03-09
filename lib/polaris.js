var config = require('config');
var _ = require('lodash');

var AxonRaft = require('../lib/raft/axon');
var jobs = require('./job/jobs');
var factory = require('./job/factory');
var log = require('./log');

/**
 * Instance responsible for maintaining application state and managing
 * process-level executions.
 */
function Polaris () {
    this._raft = new AxonRaft(config.get('raft.self'), config.get('raft.cluster'));
    // A map of ongoing jobs on the Polaris instance. IMPORTANT! When
    // polaris is a client, these will be "client" jobs, but when it is
    // a master they'll be "master" jobs.
    this._jobs = {};
}

/**
 * Returns whether this polaris is the cluster leader, or not.
 * @return {Boolean} [description]
 */
Polaris.prototype.isLeader = function () {
    return this._raft.isLeader();
};

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
 * Creates a new job by name and options. If this is not the master,
 * we'll send the job to the raft master for processing.
 * @param  {String} name
 * @param  {Object} options
 */
Polaris.prototype.createJob = function (name, options) {
    if (this.isLeader()) {
        // Create the job based on its name...
        var Job = jobs[name].master;
        var job = new Job(_.extend(options, { raft: this._raft }));

        // Save it internally, and run it.
        this._jobs[job.getId()] = job;
        job.run();
    }
    // If this node isn't the master, send the job to the master.
    else {
        this._raft.writeTo(this._raft.LEADER, 'job:create', {
            name: name,
            options: options
        });
    }
};

/**
 * Boots the polaris instance into the cluster.
 * @return {Polaris}
 */
Polaris.prototype.boot = function () {
    var self = this;
    var raft = this._raft.boot();

    setInterval(this._heartbeat.bind(this), config.get('job.heartbeat'));

    raft.on('job:status', this._handleJobStatus.bind(this));
    raft.on('leader',     this._promote.bind(this));
    raft.on('job:report', this._handleJobReport.bind(this));
    raft.on('job:create', this._handleJobCreate.bind(this));

    return this;
};

/**
 * We get job status events as a client from the leader periodically.
 * This is so that, in case the leader falls, the next elected leader
 * can pick up where it left off.
 * @param  {Object} data
 */
Polaris.prototype._handleJobStatus = function (data) {
    if (this.isLeader()) {
        log.info('Got a job:status sent when we were not a client.');
        return;
    }

    // Look up the job
    var job = this.findJob(data.id);
    // If we didn't already have a job, try and make one from the factory.
    if (!job) {
        var Job = jobs[data.name].client;
        if (!Job) {
            return;
        }
        job = this._jobs[data.id] = new Job(data);
        job.setRaft(this._raft);
        job.work();
    } else {
        job.update(data);
    }

    // If the job status is complete, remove it.
    if (job.isComplete()) {
        delete this._jobs[data.id];
    }
};

/**
 * Handles a job creation event. Called when an event was manually triggered
 * on a slave and should get added to the main Polaris. Most of the time,
 * though, the master is responsible for creating the jobs.
 * @param  {Object} data
 */
Polaris.prototype._handleJobCreate = function (data) {
    this.createJob(data.name, data.options);
};

/**
 * Called when a new job reprot arrives. This is sent by clients to let the
 * master know their progress on the jobs that they're working on.
 * @param  {Object} data
 */
Polaris.prototype._handleJobReport = function (data) {
    if (!this.isLeader()) {
        log.info('Got a job:report sent when we were not a master.');
        return;
    }

    for (var key in data) {
        var job = this.findJob(key);
        if (job) {
            job.updateRange(data[key]);
        }
    }
};

/**
 * Sends job status updates back up to the master node.
 */
Polaris.prototype._heartbeat = function () {
    if (_.keys(this._jobs).length === 0) {
        return;
    }

    // If we're the leader, run heartbeats for the jobs
    // and remove the ones that are complete.
    if (this.isLeader()) {
        this._jobs = _.omit(this._jobs, function (job) {
            return job.heartbeat().isComplete();
        });
    }
    // If we're a follower, just let the leader know of our
    // current job statuses.
    else {
        var updates = _.mapValues(this._jobs, function (job) {
            return job.getRanges();
        });

        this._raft.writeTo(this._raft.LEADER, 'job:report', updates);
    }
};

/**
 * Promotes the polaris state from being a client to being a master. Note
 * that there is no equivalent "demote", as the only time a Raft exits its
 * master state is when it crashes/leaves the cluster.
 * @return {[type]} [description]
 */
Polaris.prototype._promote = function () {
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

module.exports = Polaris;
