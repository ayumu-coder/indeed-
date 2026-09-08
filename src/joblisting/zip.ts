import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * The slice of ZIP that .xlsx needs: stored or deflated entries, no encryption, no ZIP64.
 * Reaching for a dependency here would pull a whole spreadsheet library in for what is,
 * in the end, a container format we only ever round-trip.
 */

export class ZipError extends Error {}

const LOCAL_HEADER = 0x0403_4b50;
const CENTRAL_HEADER = 0x0201_4b50;
const END_OF_CENTRAL_DIRECTORY = 0x0605_4b50;
const STORED = 0;
const DEFLATED = 8;
/** MS-DOS timestamp for 1980-01-01T00:00:00 — a fixed date keeps output reproducible. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // The record is 22 bytes plus a comment of up to 64 KiB, so scan backwards from the end.
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new ZipError('Not a ZIP archive: end-of-central-directory record not found');
}

/** Reads every entry, preserving order so a rewritten archive keeps the original layout. */
export function readZip(archive: Buffer): readonly ZipEntry[] {
  const end = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  // ZIP64 parks 0xFFFFFFFF sentinels in these fields; reading them as sizes would silently
  // produce a corrupt workbook, so refuse the archive instead.
  if (entryCount === 0xffff || cursor === 0xffff_ffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }

  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_HEADER) {
      throw new ZipError(`Corrupt central directory at entry ${index}`);
    }
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (compressedSize === 0xffff_ffff || localOffset === 0xffff_ffff) {
      throw new ZipError(`ZIP64 entry is not supported: ${name}`);
    }
    if (method !== STORED && method !== DEFLATED) {
      throw new ZipError(`Unsupported compression method ${method} for ${name}`);
    }
    if (archive.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new ZipError(`Corrupt local header for ${name}`);
    }
    // The local header's own name/extra lengths are authoritative for where data starts.
    const dataStart =
      localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);

    entries.push({
      name,
      data: method === STORED ? Buffer.from(compressed) : inflateRawSync(compressed),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data, { level: 9 });
    // Deflate can inflate tiny or incompressible payloads; store those verbatim instead.
    const useDeflate = deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? DEFLATED : STORED;
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}
