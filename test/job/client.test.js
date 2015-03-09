var Client = require('../../lib/job/_client');
var Master = require('../../lib/job/_master');
var expect = require('chai').expect;
var sinon = require('sinon');

describe('basic client', function () {
    beforeEach(function () {
        this.client = new Client();
        this.client._master = new Master({});
        this.client.setRaft(this.raft);

        sinon.stub(this.raft, 'self').returns('a');
    });

    it('sets the raft correctly', function () {
        expect(this.client._raft).to.equal(this.raft);
        expect(this.client._master._raft).to.equal(this.raft);
    });

    it('gets complete status', function () {
        var stub = sinon.stub(this.client._master, 'isComplete').returns(true);
        expect(this.client.isComplete()).to.be.true;
        expect(stub.calledOnce).to.be.true;
    });

    it('lists own ranges', function () {
        this.client._master._ranges = [
            { node: 'a', rangeId: 1},
            { node: 'b', rangeId: 2},
            { node: 'a', rangeId: 3},
        ];

        expect(this.client.getRanges()).to.deep.equal([
            { node: 'a', rangeId: 1},
            { node: 'a', rangeId: 3}
        ]);
    });

    it('updates data correctly', function () {
        var stub = sinon.stub(this.client, 'startWork');

        this.client._master._name = 'foo';
        this.client._master._ranges = [
            { node: 'a', rangeId: 1, progress: 0 },
            { node: 'b', rangeId: 2, progress: 2 },
            { node: 'a', rangeId: 3, progress: 10 },
        ];

        this.client.update({
            name: 'bar',
            ranges: [
                { node: 'a', rangeId: 1, progress: 0 },
                { node: 'b', rangeId: 2, progress: 8},
                { node: 'a', rangeId: 3, progress: 5},
            ]
        });

        expect(this.client._master.getRanges()).to.deep.equal([
            { node: 'a', rangeId: 1, progress: 0 },
            { node: 'b', rangeId: 2, progress: 8},
            { node: 'a', rangeId: 3, progress: 10 },
        ]);

        expect(stub.calledOnce).to.be.true;
    });
});
