# Polaris

## What is it?

Polaris is a distributed platform for running any job that can be represented by a range of integers. For example, for sending emails to users, you could count that you need to send to 1000 users, and then "work" in the range 0-1000.

## How does it work?

The polaris nodes for a [Raft cluster](http://raftconsensus.github.io/) and elect a leader node. That leader is responsible for listening for incoming *jobs* and distributing *tasks* to clients, by sending out sub-ranges in the job's total range. It keeps track of follower's progress, and in the event that a follower fails, it reassigns whatever the follower was working on to other nodes in the cluster. It also periodically tells followers the overall job progress, so that in the event of the leader node failing, the next elected leader can resume where it left off.

## Anatomy of a Job

A job has the following basic components:

 * `start` and `end` - numbers that indicate the beginning and end of the job's range.
 * `metadata` to use as necessary for telling clients how to process the job.
 * `name` for Polaris to know what job type to use for this job.
 * `id` a UUIDv4 that identifies the task.
 * `ensure` - a boolean. This lets Polaris know what to do if a node that is working on a task fails. If `ensure=true`, then we'll reassign the task and resume from where the child told us it was last at. This is fine for when you don't mind a task being run in duplicates. If `ensure=false`, we'll drop the task and mark it as ABORTED.

Implementation-side, you can view the `lib/job/test` directory to see an example job type. Each type consists of a Client, responsible for actually working on the job, and a Master, which is used on leader nodes to oversee the job's progress.
