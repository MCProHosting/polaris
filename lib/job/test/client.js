var Client = require('../_client');
var util = require('util');

/**
 * A rather useless test job that just executes on an interval.
 */
function TestClient () {
    Base.apply(this, arguments);
    this._interval = null;
    this._master = require('./master');
}

util.inherits(TestClient, Client);

TestClient.prototype.work = function () {
    if (!this._working) {
        return clearInterval(self._interval);
    }

    var self = this;
    this._interval = setInterval(function () {
        var next = self._nextInRange();
        if (next !== null) {
            console.log('Worked on ' + next);
        }
    }, 5);
};

TestClient.prototype.halt = function () {
    clearInterval(this._interval);
};

module.exports = TestClient;
