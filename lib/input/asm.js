const path = require('path');
const util = require('../util');
module.exports = parseAsm;

function parseAsm (test, lines) {
  /* Parse first argument */
  return lines.map(line => parseAsmLine(test, line));
}

function parseAsmLine(test, line) {
  const source = test.source;
  let r2args = [];
  let args = line.match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g);
  if (!args || args.length < 3) {
    return {}; // throw new Error('Wrong test format');
  }
  let filetree = source.split(path.sep);
  const filename = filetree[filetree.length - 1].split('_');
  if (filename.length > 3) {
    console.error(colors.red.bold('[XX]', 'Wrong filename: ' + source));
    return [];
  } else if (filename.length === 2) {
    r2args.push('e asm.bits=' + filename[1]);
  } else if (filename.length === 3) {
    r2args.push('e asm.cpu=' + filename[1]);
    r2args.push('e asm.bits=' + filename[2]);
  }
  r2args.push('e asm.arch=' + filename[0]);
  const res = util.newTest(source);
  res.asmType = args[0];
  res.asm = args[1].split('"').join('');
  res.expect = args[2];
  res.offset = args[3]; // can be ""
  return res;
}

