var Client = require('../_client');
var util = require('util');
var master = require('./master');

/**
 * A rather useless test job that just executes on an interval.
 */
function TestClient (job) {
    Client.apply(this, arguments);
    this._interval = null;
    this._master = new master(job);
    this._raft = job.raft;
}

util.inherits(TestClient, Client);

TestClient.prototype.work = function () {
    var next = this._nextInRange();
    if (next === null) {
        return;
    }

    console.log('Worked on ' + next);
    setTimeout(this.work.bind(this), 10);
};

TestClient.prototype.halt = function () {
    clearInterval(this._interval);
};

module.exports = TestClient;
