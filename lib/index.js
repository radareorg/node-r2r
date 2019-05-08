const parse = require('./parse');
const co = require('co'); // TODO: deprecate
const spawnSync = require('child_process').spawnSync;
const timeoutFuzzed = 60 * 1000;
const walk = require('walk').walk;
const path = require('path');
const spawn = require('child_process').spawn;
const util = require('util');
const common = require('./common');
const r2bin = 'radare2';
const fs = require('fs');

/* promise me magic */
const promiseConcurrency = 8; // jobs
const promiseLimit = require('promise-limit')
const limit = promiseLimit(promiseConcurrency)

const old = require('..');

function newPromise(cb) {
  return limit(_ => new Promise(cb));
}

function complete(test) {
  const failed = test.error || test.stdout !== test.expect;
  if (failed) {
    console.error('[XX]', test.name);
    common.showDiff(test.stdout, test.expect);
    return;
  }
  console.error('[OK]', test.name);
}

module.exports = class NeoSuite {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async run(tests) {
    if (Array.isArray(tests)) {
      const promises = []
      for (let test of tests) {
        promises.push(runTest(test, complete));
      }
      const res = await Promise.all(promises)
      for (let r of res) {
        console.error(r.name, r.expect === r.stdout);
      }
    } else if (typeof tests === 'string') {
      await runTest(tests, complete);
    } else {
      throw new Error('');
    }
  }

  async load(newPath) {
    // walk subdirectories and parse the tests to get a huge array of tests
    const allTests = [];
    return new Promise((resolve, reject) => {
      let error = undefined
      const stat = fs.lstatSync(newPath);
      if (stat.isFile()) {
        return resolve(parse(newPath));
      }
      const walker = walk(newPath, {followLinks: false});
      walker.on('file', (root, stat, next) => {
        const fileName = path.join(newPath, stat.name);
        try {
          const tests = parse(fileName);
          allTests.push(...tests);
        } catch (e) {
          error = e;
          console.error(fileName, e);
        }
        next();
      });
      walker.on('end', () => {
        if (error) {
          return reject(error);
        }
        resolve(allTests);
      });
    });
  }
}

async function runTest (test, complete) {
  switch (test.type) {
  case 'cmd': return runTestCmd(test, complete);
  case 'asm': return runTestAsm(test, complete);
  case 'bin': return runTestBin(test, complete);
  }
  console.error("UNKNOWN TEST");
}

// move into lib/run.js
async function runTestAsm (test, cb) {
  const self = this;
  return newPromise((resolve, reject) => {
    try {
      co(function * () {
        try {
          if (test.args) {
            self.r2.cmd(test.args);
          }
          test.stdout = yield self.r2.cmd(test.cmd);
          return resolve(cb(test));
        } catch (e) {
          return reject(e);
        }
      });
    } catch (e) {
      console.error(e);
      reject(e);
    }
  });
}

// TODO: move into run.js
async function runTestBin (test, cb) {
  return newPromise((resolve, reject) => {
    try {
      co(function * () {
        const args = ['-c', '?e init', '-qcq', '-A', test.path];
        test.birth = new Date();
        const child = spawnSync(r2bin, args, {timeout: timeoutFuzzed});
        test.death = new Date();
        test.lifetime = test.death - test.birth;
        if (child.error) {
          test.fuzz = true;
          test.expectErr = 'N';
          test.stderr = 'X';
          test.spawnArgs = args;
          test.cmdScript = '';
          return reject(cb(test));
        } else {
          return resolve(cb(test));
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function runTestCmd(test, complete) {
  return newPromise((resolve, reject) => {
    // console.error("TYPE", test.name);
    const args = [
      '-escr.utf8=0',
      '-escr.color=0',
      '-escr.interactive=0',
      '-N',
      '-Q'
    ];
    if (process.env.APPVEYOR && process.env.ANSICON === undefined) {
      process.env['ANSICON'] = 'True';
    }
    // append custom r2 args
    if (test.args && test.args.length > 0) {
      args.push(...test.args.split(' '));
    }
    try {
      if (!test.cmds && test.cmdScript) {
        test.cmds = test.cmdScript.split('\n');
      }
      args.push('-c', test.cmds.join(';'));
      // append testfile
      args.push(...test.file.split(' '));

      let res = '';
      let ree = '';
      test.spawnArgs = args;
      const child = spawn(r2bin, args);
      test.birth = new Date();
      child.stdout.on('data', data => {
        res += data.toString();
      });
      child.stderr.on('data', data => {
        ree += data.toString();
      });
      child.on('close', data => {
        test.death = new Date();
        try {
          if (test.tmpScript) {
            fs.unlinkSync(test.tmpScript);
            test.tmpScript = null;
          }
        } catch (e) {
          console.error(e);
          // ignore
        }
        test.lifetime = test.death - test.birth;
        test.stdout = res;
        test.stderr = ree;
        resolve(complete(test));
      });
    } catch (e) {
      console.error(e);
      test.error = e;
      reject(complete(e));
    }
  });
}
