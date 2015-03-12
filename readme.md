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

Implementation-side, you can view the `lib/job/test` directory to see an example job type. Each type consists of a Client, responsible for actually working on the job, and a Master, which is used on leader nodes to oversee the job's progress.

## So, how stable?

I built and ran a test job, whose purpose was to add the current task "point" into a Redis list ten times a second. It was run in a four-worker cluster with workers designed to randomly crash every 15 to 45 seconds. The results are shown below:

| Job Length | Duplicates     | Missing    |
| ---------- | -------------- | ---------- |
| 1,000      | 6 (0.601%)     | 0 (0.000%) |
| 5,000      | 83 (1.660%)    | 0 (0.000%) |
| 10,000     | 149 (1.490%)   | 0 (0.000%) |
| 50,000     | 149 (2.526%)   | 0 (0.000%) |

## Scalability

 * Network traffic increases in O(n) relative to the number of nodes in the cluster, and is independent of the number or size of ongoing jobs.
 * Memory usage increases in O(n) relative to the number of ongoing jobs, and O(n^0.5) relative to the job size. The number of clusters in the node does not have a significant direct impact on memory usage, but node failures result in segmentation and in increases in memory usage.
 * CPU usage follows the same scaling pattern as memory usage, but is generally trivial (network latency is the bottleneck).
