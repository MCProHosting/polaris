var Bluebird = require('bluebird');
var axon = require('axon');
var util = require('util');
var config = require('config');
var _ = require('lodash');

var liferaft = require('liferaft');
var Raft = require('./liferaft/udp');
var Base = require('./_base');

/**
 * Axon (UDP) implementation of Raft using the Liferaft framework.
 */
function AxonRaft () {
    Base.apply(this, arguments);
    this._raft = null;
}

util.inherits(AxonRaft, Base);

AxonRaft.prototype.boot = function () {
    var raft = this._raft = new Raft(this._address, config.get('raft.settings'));
    var self = this;

    this._others.forEach(function (other) {
        raft.join(other);
    });

    raft.on('leader',    function () { self.emit('leader');   });
    raft.on('candidate', function () { self.emit('follower'); });
    raft.on('follower',  function () { self.emit('follower'); });

    raft.on('error', function (err) {
        self.emit('error', err);
    });

    raft.on('rpc', function (packet) {
        self.emit(packet.data.event, packet.data.data);
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

AxonRaft.prototype.LEADER = liferaft.LEADER;
AxonRaft.prototype.FOLLOWERS = liferaft.FOLLOWER;
AxonRaft.prototype.ALL = liferaft.CHILD;

module.exports = AxonRaft;
