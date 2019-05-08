#!/usr/bin/env node

const rc = require('rc');
const fs = require('fs');
const NeoSuite = require('../lib');
const minimist = require('minimist');
const util = require('../lib/util');

console.error('[NEOSUITE] r2r.js refactored from the ground');
const dbDir = 'db/cmd';

async function main(argv) {
  const options = getopt(argv);
  const ns = new NeoSuite();
  try {
    let tests = [];
    if (Array.isArray(options.dbdir)) {
      for (let dbdir of options.dbdir) {
        let res = await ns.load(dbdir);
        tests.push(...res);
      }
    } else {
      tests = await ns.load(options.dbdir);
    }
    if (options.fuzz) {
      const binTests = await ns.load(options.fuzz);
      tests.push(...binTests);
    }
    if (options.count) {
      console.error('Found', tests.length, 'tests');
    }
    if (options.bins) {
      const bins = util.sortUniq(tests.map(t => t.file));
      console.log(bins.join('\n'));
    }
    if (options.json) {
      if (options.totext) {
        console.log(JSON.stringify(tests, null, 2));
      } else {
        console.log(JSON.stringify(tests));
      }
    } else if (options.totext) {
      if (options.inplace) {
        console.error("TODO")
      } else {
        tests.map(test => console.log(testToText(test)));
      }
    }
    if (options.run) {
      console.error('Running tests');
      await ns.run(tests);
    }
  } catch (e) {
    console.error(e);
  } finally {
    console.error('done');
  }
  return 0;
}

const args = {
  d: null,
  f: null,
  boolean: [ 'c', 'i', 'h', 't', 'r', 'a', 'b' ]
};

function getopt(argv) {
  const opt = minimist(argv.slice(2), args);
  if (opt.h) {
    console.log('Usage: neosuite [-options]');
    console.log(' -a        : run all tests');
    console.log(' -d [path] : specify test file or tests directory');
    console.log(' -c        : count number of tests loaded');
    console.log(' -f [path] : run fuzzed binaries from given path');
    console.log(' -i        : interactive/inplace (-t)');
    console.log(' -t        : convert to tedt (use -i to modify in-place)');
    console.log(' -j        : show tests loaded in JSON format');
    console.log(' -b        : list all bins used in testing');
    console.log(' -r        : run tests');
    process.exit(0);
  }
  if (opt.a) {
    opt.f = '../bins/fuzzed';
    opt.r = true;
    opt.d = 'db/';
  }
  return {
    action: 'run',
    all: opt.a,
    bins: opt.b,
    fuzz: opt.f,
    inplace: opt.i,
    totext: opt.t,
    edit: opt.e,
    json: opt.j,
    run: opt.r,
    target: opt._,
    dbdir: opt.d || 'db/cmd',
    count: opt.c
  };
}

main(process.argv).then(process.exit).catch(console.error);

function testToText(test) {
  // this check should be here
  if (!(test.name && test.cmds)) {
    throw new Error('Invalid test: ' + JSON.stringify(test));
  }
  let res = 'NAME=' + test.name + '\n';
  res += 'FILE=' + test.file + '\n';
  if (test.path) {
    res += 'PATH=' + test.path + '\n';
  }
  if (test.arch) {
    res += 'ARCH=' + test.arch + '\n';
  }
  if (test.bits) {
    res += 'BITS=' + test.bits + '\n';
  }
  if (test.broken) {
    res += 'BROKEN=1\n';
  }
  // console.log('CMDS=' + test.cmds.join(';'));
  res += 'CMDS=<<EOF\n' + test.cmds.join('\n') + '\nEOF\n';
  res += 'EXPECT=<<EOF\n' + test.expect + '\nEOF\n';
  res += 'RUN\n';
  return res;
}
