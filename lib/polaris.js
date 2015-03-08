var config = require('config');
var Raft = require('../lib/raft/axon');

/**
 * Instance responsible for maintaining application state and managing
 * process-level executions.
 */
function Polaris () {
    this._raft = null;
    this._state = 'follower';
    this._jobs = [];
}

/**
 * Boots the polaris instance into the cluster.
 */
Polaris.prototype.boot = function () {
    var self = this;
    var raft = this._raft = new Raft(config.get('raft.self'), config.get('raft.cluster')).boot();
};

/**
 * Tears down the Polaris instance. Sends final progress updates on every
 * job before removing itself
 * @return {Promise}
 */
Polaris.prototype.destroy = function () {
    if (this.raft) {}
};
