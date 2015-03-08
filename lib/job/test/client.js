var Client = require('../_client');
var util = require('util');

/**
 * A rather useless test job that just executes on an interval.
 */
function TestClient () {
    Base.apply(this, arguments);
    this._interval = null;
}

util.inherits(TestClient, Client);

TestClient.prototype.start = function () {
    var self = this;
    this._interval = setInterval(function () {
        if (self._progress < self._end) {
            self._progress++;
        } else {
            clearInterval(self._interval);
        }
    }, 5);
};

TestClient.prototype.stop = function () {
    clearInterval(this._interval);
    return this.getProgress();
};

module.exports = TestClient;
