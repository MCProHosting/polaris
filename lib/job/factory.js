var log = require('../log');
var jobs = require('./jobs');

/**
 * Simple factor function that takes a packet and returns a
 * corresponding client instance.
 * @param  {Object} packet
 * @param  {String} type
 * @return {Client}
 */
module.exports = function (packet, type) {
    var job = jobs[packet.job.name];
    if (typeof job === 'undefined') {
        log.error('Unknown job `' + packet.job.name + '`');
        return;
    }

    return new job[type]();
};
