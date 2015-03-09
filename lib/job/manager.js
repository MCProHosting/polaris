var Bluebird = require('bluebird');
var errors = require('./errors');
var jobs = require('./jobs');

/**
 * Used by the polaris master to manage a job's status across the cluster.
 */
function JobManager (polaris, packet) {
    this._polaris = polaris;
    this._packet = packet;
}

/**
 * Starts a job, dispatching it to followers of the cluster.
 * @return {Promise}
 */
JobManager.prototype.start = function () {
    // Reject invalid jobs.
    if (typeof jobs[this._packet.job] === 'undefined') {
        return Bluebird.reject(new errors.InvalidJob('Job `' + this._packet.job + '` is invalid!'));
    }


};
