
module.exports = {
  cmd: runCmd,
  asm: runAsm,
  bin: runBin,
}

async function runCmd(test) {
 // TODO move code here 
}

async function runAsm(test) {
 // TODO move code here 
function parseAsm (source, line) {
  /* Parse first argument */
  let r2args = [];
  let args = line.match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g);
  if (args.length < 3) {
    console.error(colors.red.bold('[XX]', 'Wrong test format in ' + source + ':' + line));
    return [];
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

  let type = args[0];
  let asm = args[1].split('"').join('');
  let expect = args[2];
  if (args.length >= 4) {
    r2args.push('s ' + args[3]);
  } else {
    r2args.push('s 0');
  }

  /* Generate tests */
  let tests = [];
  for (let c of type) {
    let t = {from: source, broken: false, args: r2args.join(';')};
    t.endianess = false
    if (type.indexOf('E') !== -1) {
      t.endianess = true;
    }
    switch (c) {
      case 'd':
        t.cmd = "e cfg.bigendian=" + t.endianess + ";" + 'pad ' + expect;
        t.expect = asm;
        t.name = filename + ': ' + expect + ' => "' + asm + '"' + colors.blue(' (disassemble)');
        tests.push(t);
        break;
      case 'a':
        t.cmd = "e cfg.bigendian=" + t.endianess + ";" + 'pa ' + asm;
        t.expect = expect;
        t.name = filename + ': "' + asm + '" => ' + expect + colors.blue(' (assemble)');
        tests.push(t);
        break;
      default:
        continue;
    }
    if (type.indexOf('B') !== -1) {
      t.broken = true;
    }
  }
  return tests;
}
}

async function runBin(test) {
 // TODO move code here 
}
