"use strict";
// ZIP mínimo, método "store" (sin compresión). Los PDF ya vienen comprimidos,
// así que store alcanza y evita depender de un paquete externo (que en Railway
// dio problemas con pdf-lib). Uso: zip([{name, data:Buffer}]) -> Buffer.

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data);
    const size = data.length;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4);         // version needed
    lh.writeUInt16LE(0x0800, 6);     // flags (UTF-8 nombre)
    lh.writeUInt16LE(0, 8);          // método: store
    lh.writeUInt16LE(0, 10);         // hora
    lh.writeUInt16LE(0x21, 12);      // fecha (fija, 1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // signature
    cd.writeUInt16LE(20, 4);         // version made by
    cd.writeUInt16LE(20, 6);         // version needed
    cd.writeUInt16LE(0x0800, 8);     // flags
    cd.writeUInt16LE(0, 10);         // método
    cd.writeUInt16LE(0, 12);         // hora
    cd.writeUInt16LE(0x21, 14);      // fecha
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);         // extra len
    cd.writeUInt16LE(0, 32);         // comment len
    cd.writeUInt16LE(0, 34);         // disk
    cd.writeUInt16LE(0, 36);         // internal attrs
    cd.writeUInt32LE(0, 38);         // external attrs
    cd.writeUInt32LE(offset, 42);    // offset del local header
    central.push(Buffer.concat([cd, nameBuf]));

    offset += lh.length + nameBuf.length + size;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

module.exports = { zip, crc32 };
