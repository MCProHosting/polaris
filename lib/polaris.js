var config = require('config');
var _ = require('lodash');

var Raft = require('../lib/raft/axon');
var jobs = require('./job/jobs');
var factory = require('./job/factory');

/**
 * Instance responsible for maintaining application state and managing
 * process-level executions.
 */
function Polaris () {
    this._raft = null;
    // A map of ongoing jobs on the Polaris instance. IMPORTANT! When
    // polaris is a client, these will be "client" jobs, but when it is
    // a master they'll be "master" jobs.
    this._jobs = {};

    setInterval(this._heartbeat.bind(this), config.get('job.heartbeat'));
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
    var raft = this._raft = new Raft(config.get('raft.self'), config.get('raft.cluster')).boot();

    //
    // Role changes.
    //
    raft.on('leader', function () {
        // Sent when the node changes to a leader (maybe from a follower).
        // Update the state and promote all jobs.
        self._promote();
    });

    //
    // Job state changes
    //
    raft.on('job:status', function (data) {
        // We get these events as a client. When this happens just update
        // the stored job info. We do this in case the master goes down,
        // we can just promote the client up.

        if (this.isLeader()) {
            log.info('Got a job:status sent when we were not a client.');
            return;
        }

        // Look up the job
        var job = self.findJob(data.id);
        // If we didn't already have a job, try and make one from the factory.
        if (!job) {
            var Job = jobs[data.name].client;
            if (!Job) {
                return;
            }
            data.raft = self._raft;
            job = self._jobs[data.id] = new Job(data);
            job.work();
        } else {
            job.update(data);
        }

        // If the job status is complete, remove it.
        if (job.getJob().isComplete()) {
            delete jobs[data.job.id];
        }
    });
    raft.on('job:report', function (data) {
        // We get this event when we're a master. This is sent by clients
        // to let the master know their progress on the jobs that
        // they're working on.
        if (!this.isLeader()) {
            log.info('Got a job:report sent when we were not a master.');
            return;
        }

        for (var key in data) {
            var job = self.findJob(key);
            if (job) {
                job.updateRange(data[key]);
            }
        }
    });
    raft.on('job:create', function (data) {
        // Called when a client passes a job to be run on the Polaris
        // master. Not used in "normal" operation, but simplifies debugging
        // and the web interface significantly.
        self.createJob(data.name, data.options);
    });

    return this;
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
    if (this.isLeader()) {
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

module.exports = Polaris;
