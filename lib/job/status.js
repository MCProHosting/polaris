module.exports = {
    PENDING: 0, // range has yet to be dispatched
    WORKING: 1, // currently being worked on
    FAILED: 2,  // failed and may be re-dispatched
    ABORTED: 3, // gave up
    DONE: 5     // completed successfully
};
