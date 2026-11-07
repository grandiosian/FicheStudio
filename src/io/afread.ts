// Lecture bas niveau du format Affinity : conteneur (#FT4, #Fil) et flux d'objets « KS ».
// Description complète : ~/Documents/DEV/AF_Format/FORMAT.md
import { decompress as zstdDecompress } from "fzstd";

const ARCHIVE_MAGIC = 0x414bff00;
const STREAM_MAGIC = 0x534bff00;

class Reader {
  dv: DataView;
  constructor(public b: Uint8Array, public p = 0) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  bytes(n: number) {
    if (this.p + n > this.b.length) throw new Error(`lecture hors limites à ${this.p}`);
    const s = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return s;
  }
  u8() { return this.dv.getUint8(this.p++); }
  i8() { return this.dv.getInt8(this.p++); }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  u64() { const v = Number(this.dv.getBigUint64(this.p, true)); this.p += 8; return v; }
  i64() { const v = Number(this.dv.getBigInt64(this.p, true)); this.p += 8; return v; }
  f32() { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  /** FourCC de classe/champ (stocké inversé). */
  tag() { return String.fromCharCode(...this.bytes(4)).split("").reverse().join(""); }
  /** Marqueur de conteneur (stocké en clair). */
  marker() { return String.fromCharCode(...this.bytes(4)); }
  str(n: number) { return new TextDecoder().decode(this.bytes(n)); }
}

export interface FatEntry { id: number; kind: number; offset: number; size: number; csize: number; crc: number; comp: number; name: string | null }

export class AfArchive {
  version: number;
  entries = new Map<number, FatEntry>();
  meta: unknown = null;
  constructor(public data: Uint8Array) {
    const r = new Reader(data);
    if (r.u32() !== ARCHIVE_MAGIC) throw new Error("Ce n'est pas un fichier Affinity");
    this.version = r.u16();
    r.u16();
    r.tag();
    if (r.marker() !== "#Inf") throw new Error("Bloc #Inf attendu");
    let fatOff = r.u64();
    const fats: { created: number; files: FatEntry[] }[] = [];
    const seen = new Set<number>();
    while (fatOff && !seen.has(fatOff)) {
      seen.add(fatOff);
      const f = new Reader(data, fatOff);
      const tag = f.marker();
      if (!["#FAT", "#FT2", "#FT3", "#FT4"].includes(tag)) throw new Error(`Table inattendue ${tag}`);
      const next = f.u64(), created = f.u64();
      f.bytes(24);
      const n = f.u32();
      f.bytes(8);
      f.u16(); f.u8();
      const files: FatEntry[] = [];
      for (let i = 0; i < n; i++) {
        const e: FatEntry = { id: f.u32(), kind: f.u8(), offset: 0, size: 0, csize: 0, crc: 0, comp: 0, name: null };
        if (e.kind !== 2) {
          e.offset = f.u64(); e.size = f.u64(); e.csize = f.u64(); e.crc = f.u32(); e.comp = f.u8();
          if (tag !== "#FAT") f.u32();
          if (tag === "#FT4") f.u32();
          if (tag === "#FAT" || tag === "#FT2") e.comp = ({ 1: 0x01, 2: 0x41, 3: 0x81, 4: 0xc1 } as Record<number, number>)[e.comp] ?? 0;
          if (e.kind === 0) e.name = f.str(f.u16());
        }
        files.push(e);
      }
      fats.push({ created, files });
      fatOff = next;
    }
    const names = new Map<number, string>();
    for (const fat of fats.sort((a, b) => a.created - b.created))
      for (const e of fat.files) {
        if (e.name) names.set(e.id, e.name);
        else if (names.has(e.id)) e.name = names.get(e.id)!;
        this.entries.set(e.id, e);
      }
    const mi = lastIndexOf(data, [0xff, 0xff, 0xff, 0xff, 0x4d, 0x65, 0x74, 0x61]); // "Meta"
    if (mi >= 0) {
      try {
        const m = new Reader(data, mi + 8);
        m.u32(); m.u32(); m.bytes(8);
        const size = m.u32(); m.u8();
        this.meta = JSON.parse(m.str(size));
      } catch { /* métadonnées facultatives */ }
    }
  }

  byName(name: string): FatEntry | undefined {
    for (const e of this.entries.values()) if (e.kind !== 2 && e.size && e.name === name) return e;
    return undefined;
  }

  async extract(e: FatEntry): Promise<Uint8Array> {
    const r = new Reader(this.data, e.offset);
    if (r.marker() !== "#Fil") throw new Error("Bloc #Fil attendu");
    const raw = r.bytes(e.csize);
    const alg = e.comp & 3;
    let out: Uint8Array;
    if (alg === 2) out = zstdDecompress(raw);
    else if (alg === 1) out = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    else out = raw.slice();
    if ((e.comp & 0xc0) === 0x40) {
      let acc = 0;
      for (let i = 0; i < out.length; i++) { acc = (acc + out[i]) & 0xff; out[i] = acc; }
    }
    return out;
  }
}

function lastIndexOf(h: Uint8Array, n: number[]): number {
  outer: for (let i = h.length - n.length; i >= 0; i--) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

// ------------------------------------------------------------------ flux KS

export type KsValue = number | boolean | string | null | KsValue[] | KsObj | Uint8Array;
export interface KsObj { $class?: string; $id?: number; $ref?: number; [k: string]: KsValue | undefined }

export class KsStream {
  r: Reader;
  blobs: Uint8Array[] = [];
  constructor(data: Uint8Array) { this.r = new Reader(data); }

  parse(): KsObj {
    const r = this.r;
    if (r.u32() !== STREAM_MAGIC) throw new Error("Flux KS attendu");
    const ver = r.u16();
    const root: KsObj = { $class: r.tag() };
    r.u16();
    if (ver >= 2) r.u32();
    this.fields(root);
    return root;
  }

  fields(obj: KsObj, withTag = true, list?: KsValue[]) {
    const r = this.r;
    for (;;) {
      let t = r.u8();
      if (t === 0) return;
      const arr = (t & 0x80) !== 0;
      t &= 0x7f;
      const tag = withTag ? r.tag() : "";
      const v = this.value(t, arr);
      if (list) list.push(v);
      else if (tag in obj) {
        const prev = obj[tag];
        obj[tag] = Array.isArray(prev) && (prev as KsValue[] & { dup?: true }).dup ? [...(prev as KsValue[]), v] : Object.assign([prev as KsValue, v], { dup: true as const });
      } else obj[tag] = v;
    }
  }

  value(t: number, arr: boolean): KsValue {
    const r = this.r;
    let count = 1;
    let enumVer: number | null = null, inline: string | null = null, curveSize = 0;
    if (arr) {
      if (t === 0x2b || t === 0x2e) r.u32();
      count = r.u32();
      if (t === 0x2a) enumVer = r.u16();
      if (t === 0x32) { inline = r.tag(); r.u16(); }
    }
    if (t === 0x2c) curveSize = r.u16();
    const vals: KsValue[] = [];
    for (let i = 0; i < count; i++) vals.push(this.one(t, enumVer, inline, curveSize));
    return arr ? vals : vals[0];
  }

  one(t: number, enumVer: number | null, inline: string | null, curveSize: number): KsValue {
    const r = this.r;
    switch (t) {
      case 0x01: return r.u8();
      case 0x02: return r.u16();
      case 0x03: case 0x2f: case 0x34: return r.u32();
      case 0x04: return r.u64();
      case 0x05: return r.i8();
      case 0x06: return r.i16();
      case 0x07: return r.i32();
      case 0x08: return r.i64();
      case 0x09: return r.f32();
      case 0x0a: return r.f64();
      case 0x29: return r.u8() !== 0;
      case 0x2b: case 0x2e: return r.str(r.u32());
      case 0x2a: { const v = r.u16(); if (enumVer === null) r.u16(); return v; }
      case 0x2c:
        if (curveSize === 18) return [r.f64(), r.f64(), r.u8(), r.u8()];
        if (curveSize === 12) return [r.f64(), r.u8(), r.u8(), r.u8(), r.u8()];
        if (curveSize === 16) return [r.f64(), r.u32(), r.u32()];
        return r.bytes(curveSize).slice();
      case 0x2d: { const b = r.bytes(r.u32()).slice(); this.blobs.push(b); return b; }
      case 0x30: { const items: KsValue[] = []; this.fields({}, false, items); return items; }
      case 0x31: return this.object31();
      case 0x32: {
        if (r.u8() === 0) return null;
        const cls = inline ?? r.tag();
        if (!inline) r.u16();
        const o: KsObj = { $class: cls };
        this.fields(o);
        return o;
      }
      case 0x33: { const tag = r.tag(); const n = r.u32(); return { $class: "$file", kind: tag, path: r.str(n) }; }
      case 0x75: { r.u16(); return r.bytes(r.u8()).slice(); }
    }
    if (t >= 0x15 && t <= 0x19) return Array.from({ length: t - 0x13 }, () => r.i32());
    if (t >= 0x1f && t <= 0x23) return Array.from({ length: t - 0x1d }, () => r.f32());
    if (t >= 0x24 && t <= 0x28) return Array.from({ length: t - 0x22 }, () => r.f64());
    if (t >= 0x35 && t <= 0x74) return r.bytes(t - 0x34).slice();
    throw new Error(`Type de champ inconnu ${t.toString(16)} à ${r.p}`);
  }

  object31(): KsObj | null {
    const r = this.r;
    const st = r.u8();
    if (st === 0) return null;
    if (st === 2) return { $ref: r.u32() };
    if (st !== 1) throw new Error(`Statut d'objet inconnu ${st}`);
    const o: KsObj = { $id: r.u32() };
    let cls: string | undefined;
    for (;;) {
      const f = r.u8();
      if (f === 0) { const tag = r.tag(); r.u16(); cls ??= tag; this.fields(o); }
      else if (f === 1) { const tag = r.tag(); cls ??= tag; break; } // lire le tag même si la classe est déjà connue
      else if (f === 2) break;
      else throw new Error(`Drapeau de classe inconnu ${f}`);
    }
    this.fields(o);
    o.$class = cls; // la chaîne commence par la classe la plus dérivée
    return o;
  }
}
