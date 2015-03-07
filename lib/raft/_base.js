var events = require('events');
var util = require('util');
var _ = require('lodash');

/**
 * Basic interface for Raft implementation. It's an EventEmitter that can
 * emit the following events:
 *     - leader() - state changed to leader
 *     - follower() - state changed to follower
 *     - initialized() - node initialized
 *     - error() some error occured
 *     - data(data) - gets an object
 * @param {String} address The TCP address of this current node
 * @param {[]String} other A list of the addresses of other nodes.
 */
function Base (address, others) {
    events.EventEmitter.call(this);

    this._address = address;
    this._others = _.without(others, address);
}

util.inherits(Base, events.EventEmitter);

/**
 * Initializes the Raft cluster, listening appropriately.
 * @return {Base} [description]
 */
Base.prototype.boot = function () {
    throw new Error('Not implemented');
};


/**
 * Writes a given event to someone else in the cluster, causing it to
 * be sent on their instances of this object.
 * @param  {*} type
 * @param  {String} event
 * @param  {*} data
 * @return {Promise}
 */
Base.prototype.writeTo = function (type, event, data) {
    throw new Error('Not implemented');
};

// Constants used for telling the Raft who to write to.
Base.prototype.LEADER = 0;
Base.prototype.FOLLOWERS = 1;
Base.prototype.ALL = 2;

module.exports = Base;
