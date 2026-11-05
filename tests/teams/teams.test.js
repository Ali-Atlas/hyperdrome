/**
 * The AI team suites, in one file so they run one after the other: the runner acts on every team
 * in the database, so the suites must not hold teams at the same time (tests/teams/setup.js).
 */
import './seed.suite.js';
import './runner.suite.js';
import './hook.suite.js';
