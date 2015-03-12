var Bluebird = require('bluebird');
var axon = require('axon');
var util = require('util');
var config = require('config');
var _ = require('lodash');

var liferaft = require('liferaft');
var Raft = require('./liferaft/udp');
var Base = require('./_base');
var log = require('../log');

/**
 * Axon (UDP) implementation of Raft using the Liferaft framework.
 */
function AxonRaft () {
    Base.apply(this, arguments);
    this._raft = null;
    // On the first boot, liferaft doesn't emit a follower event. This
    // is a fix for that.
    this._emittedFollower = false;
}

util.inherits(AxonRaft, Base);

AxonRaft.prototype.boot = function () {
    var raft = this._raft = new Raft(this._address, config.get('raft.settings'));
    var self = this;

    this._others.forEach(function (other) {
        raft.join(other);
    });

    raft.on('leader',        function () { self.emit('leader');   });
    raft.on('follower',      function () { self.emit('follower'); });
    raft.on('leader change', function () {
        if (!self._emittedFollower) {
            self.emit('follower');
            self._emittedFollower = true;
        }
    });

    raft.on('error', function (err) {
        log.warn(err);
        // currently there's not "super critial" errors from liferaft
        // that indicate an invalid cluster. Just log it and be done.
    });

    raft.on('rpc', function (packet, reply) {
        self.emit(packet.data.event, packet.data.data);
        reply(raft.packet('data', { event: 'ok' }));
    });

    return this;
};

AxonRaft.prototype.writeTo = function (type, event, data) {
    var raft = this._raft;
    var packet = raft.packet('data', { event: event, data: data });

    return new Bluebird(function (resolve, reject) {
        raft.message(type, packet, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

AxonRaft.prototype.getWorkers = function () {
    return _(this._raft.nodes).without(this._raft.leader).pluck('address').value();
};

AxonRaft.prototype.getLeader = function () {
    return this._raft.leader;
};

AxonRaft.prototype.isLeader = function () {
    return this._raft.leader === this._address;
};

AxonRaft.prototype.self = function () {
    return this._address;
};

AxonRaft.prototype.LEADER = liferaft.LEADER;
AxonRaft.prototype.FOLLOWERS = liferaft.FOLLOWER;
AxonRaft.prototype.ALL = liferaft.CHILD;

module.exports = AxonRaft;
