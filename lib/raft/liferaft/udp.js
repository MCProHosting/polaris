var LifeRaft = require('liferaft');
var axon = require('axon');
var log = require('../../log');

// Axon-based UDP liferaft subclass. Base on their official example.
module.exports = LifeRaft.extend({
    /**
     * Reference our socket.
     *
     * @type {Msg}
     * @private
     */
    socket: null,

    /**
     * Initialized, start connecting all the things.
     *
     * @param {Object} options Options.
     * @api private
     */
    initialize: function initialize (options) {
        var raft = this;
        var socket;

        socket = raft.socket = axon.socket('rep');

        socket.bind(raft.address);
        socket.on('message', function(data, fn) {
            raft.emit('data', data, fn);
        });

        socket.on('error', function (err) {
            log.warning('Failed to boot on ' + raft.address, { err: err });
        });
    },

    /**
     * The message to write.
     *
     * @param {Object} packet The packet to write to the connection.
     * @param {Function} fn Completion callback.
     * @api private
     */
    write: function write(packet, fn) {
        var raft = this;
        var socket = raft.socket;

        if (!socket) {
            socket = raft.socket = axon.socket('req');

            socket.connect(raft.address);
            socket.on('error', function (err) {
                log.warning('Failed to write to ' + raft.address, { err: err });
                fn(err);
            });
        }

        socket.send(packet, function (data) {
            fn(undefined, data);
        });
    }
});
