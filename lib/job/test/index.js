var Client = require('../_client');
var util = require('util');
var redis = require('../../db/redis');

/**
 * A rather useless test job that just executes on an interval.
 */
function TestClient (job) {
    Client.apply(this, arguments);
    this._interval = null;
    this._raft = job.raft;
    this._name = 'test';
}

util.inherits(TestClient, Client);

TestClient.prototype.work = function () {
    var next = this._nextInRange();
    if (next === null) {
        return;
    }

    console.log('Worked on ' + next);

    var self = this;
    redis.getMaster().client.rpush('polarisTest', Date.now() + '\t' + next, function () {
        setTimeout(function () {
            self.work();
        }, 200);
    });
};

module.exports = TestClient;
