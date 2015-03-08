var Bluebird = require('bluebird');

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
JobManager.prototype.start = Bluebird.method(function () {

});
