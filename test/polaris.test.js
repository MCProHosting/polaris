var sinon = require('sinon');
var expect = require('chai').expect;
var jobs = require('../lib/job/jobs');

describe('polaris instance', function () {
    it('gets the jobs', function () {
        var jobs = this.polaris._jobs = {};
        expect(this.polaris.getJobs()).to.equal(jobs);
    });
    it('finds a single job', function () {
        this.polaris._jobs = { a: 'b' };
        expect(this.polaris.findJob('a')).to.equal('b');
    });

    describe('as a leader', function () {
        beforeEach(function () {
            sinon.stub(this.raft, 'isLeader').returns(true);
            jobs.foo = {
                master: function (opts) {
                    this.opts = opts;
                    this.getId = sinon.stub().returns('bar');
                    this.run = sinon.spy();
                }
            };
        });
        afterEach(function () {
            delete jobs.foo;
        });

        it('gets the leader status', function () {
            expect(this.polaris.isLeader()).to.be.true;
        });

        it('creates a job', function () {
            var options = {};
            this.polaris.createJob('foo', options);
            var jobs = this.polaris.getJobs();
            expect(jobs).to.include.keys('bar');
            expect(jobs.bar.opts).to.equal(options);
            expect(jobs.bar.getId.calledOnce).to.be.true;
            expect(jobs.bar.run.calledOnce).to.be.true;
        });

        it('heartbeats', function () {
            this.polaris._jobs = {
                a: { heartbeat: function () { return { isComplete: function () { return true; }}; }},
                b: { heartbeat: function () { return { isComplete: function () { return false; }}; }},
            };
            this.polaris._heartbeat();
            expect(Object.keys(this.polaris._jobs)).to.deep.equal(['b']);
        });
    });

    describe('as a follower', function () {
        beforeEach(function () {
            sinon.stub(this.raft, 'isLeader').returns(false);
            sinon.stub(this.raft, 'writeTo');
        });
        afterEach(function () {

        });

        it('gets the leader status', function () {
            expect(this.polaris.isLeader()).to.be.false;
        });

        it('creates a job', function () {
            this.polaris.createJob('foo', { a: 'b' });
            expect(this.raft.writeTo.calledWith(
                'leader',
                'job:create',
                { name: 'foo', options: { a: 'b' }}
            )).to.be.true;
        });

        it('promotes jobs', function () {
            this.polaris._jobs = {
                a: { upgrade: function () { return 1; }},
                b: { upgrade: function () { return 2; }},
                c: { upgrade: function () { return 3; }},
            };
            this.polaris._promote();
            expect(this.polaris._jobs).to.deep.equal({ a: 1, b: 2, c: 3 });
        });

        it('reports jobs on heartbeat', function () {
            this.polaris._jobs = {
                a: { getRanges: function () { return 1; }},
                b: { getRanges: function () { return 2; }},
                c: { getRanges: function () { return 3; }},
            };
            this.polaris._heartbeat();
            expect(this.raft.writeTo.calledWith('leader', 'job:report', { a: 1, b: 2, c: 3 }));
        });
    });
});
