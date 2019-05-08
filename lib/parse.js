const fs = require('fs');
const path = require('path');
const input = require('./input');
const util = require('./util');

module.exports = function parse(file, contents) {
  if (file.indexOf('bins/') !== -1) {
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(file);
      return files.map(f => util.newTest(path.join(file, f)));
    }
    return [util.newTest(file)];
  }
  if (contents === undefined) {
    contents = fs.readFileSync(file).toString();
  }
  const lines = contents.split('\n');
  let test = util.newTest(file);

  switch (test.type) {
  case 'asm':
    return input.asm(test, lines);
  case 'cmd':
    return input.cmd(test, lines);
  }
  throw new Error('Unknown test source');
}
