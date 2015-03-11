var config = require('config');
var _ = require('lodash');

var AxonRaft = require('../lib/raft/axon');
var redis = require('./db/redis');
var jobs = require('./job/jobs');
var log = require('./log');

/**
 * Instance responsible for maintaining application state and managing
 * process-level executions.
 */
function Polaris () {
    this._raft = new AxonRaft(config.get('raft.self'), config.get('raft.cluster'));
    // Map of jobs Polaris is currently running
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
        options.name = name;
        var job = this._instantiateClient(options);
        job.run();

        return job;
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
    log.debug('Polaris booting on ' + config.get('raft.self'));

    var raft = this._raft.boot();
    raft.on('leader',       this._promote.bind(this));
    raft.on('follower',     this._handleFollower.bind(this));
    raft.on('job:report',   this._handleJobReport.bind(this));
    raft.on('job:create',   this._handleJobCreate.bind(this));
    raft.on('job:assign',   this._handleJobAssign.bind(this));
    raft.on('job:complete', this._handleJobComplete.bind(this));

    setInterval(this._heartbeat.bind(this), config.get('job.heartbeat'));

    return this;
};

/**
 * Creates a new job client from the data.
 * @param  {Object} data
 * @return {Client}
 */
Polaris.prototype._instantiateClient = function (data) {
    var job = new jobs[data.name](_.extend({ raft: this._raft }, data));
    this._jobs[job.getId()] = job;
    return job;
};

/**
 * Handles becoming a follower. Loads jobs from Redis and starts working
 * on them.
 */
Polaris.prototype._handleFollower = function () {
    if (_.keys(this._jobs).length === 0) {
        this._loadJobs(function (jobs) {
            _.invoke(jobs, 'startWork');
        });
    }
};

/**
 * We get new job events whenever the master
 * creates a job for us to to work on.
 * @param  {String} id
 */
Polaris.prototype._handleJobAssign = function (id) {
    if (this.isLeader()) {
        log.info('Got a job:new sent when we were not a client.');
        return;
    }

    var self = this;
    redis.getSlave().client.HGET(config.get('redis.jobToken'), id, function (err, result) {
        if (err) {
            return log.error(err);
        } else if (!result) {
            return log.warn('Job ' + id + ' does not exist');
        }

        var data = JSON.parse(result);
        var job = self.findJob(id);
        if (!job) {
            job = self._instantiateClient(data);
        } else {
            job.updateProperties(data);
        }

        job.startWork();
    });
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
 * Handles a job completion event.
 * @param  {Object} data
 */
Polaris.prototype._handleJobComplete = function (id) {
    delete this._jobs[id];
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
        var updates = _(this._jobs)
            .mapValues(function (job) {
                return job.getUpdatedRanges();
            })
            .omit(function (updates) {
                return updates.length === 0;
            });

        this._raft.writeTo(this._raft.LEADER, 'job:report', updates);
    }
};

/**
 * Loads ongoing jobs from Redis.
 * @param  {Function} cb
 */
Polaris.prototype._loadJobs = function (cb) {
    var self = this;
    redis.getSlave().client.hgetall(config.get('redis.jobToken'), function (err, results) {
        if (err) {
            return log.error(err);
        }

        // Start the saved jobs running.
        self._jobs = _.mapValues(results, function (result) {
            var data = JSON.parse(result);
            var job = self.findJob(result.id);

            if (job) {
                job.update(data);
            } else {
                job = self._instantiateClient(data);
            }

            return job;
        }, self);

        cb.call(self, self._jobs);
    });
};

/**
 * Promotes the polaris state from being a client to being a master. Note
 * that there is no equivalent "demote", as the only time a Raft exits its
 * master state is when it crashes/leaves the cluster.
 * @return {[type]} [description]
 */
Polaris.prototype._promote = function () {
    // Stop all ongoing clients
    _.invoke(this._jobs, 'halt');

    // Load jobs and start them
    this._loadJobs(function (jobs) {
        _.invoke(jobs, 'reassign', [this._raft.self()]);
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
