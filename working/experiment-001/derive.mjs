import fs from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { topology } from "topojson-server";
import { feature } from "topojson-client";
import assert from "node:assert/strict";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  await fs.readFile(new URL("assets/derived/geography.json", root)),
);
const objects = {};
for (const name of ["adm1", "adm3"]) {
  const raw = await fs.readFile(new URL(`assets/data/${name}.json`, root));
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    manifest.sourceSha256[name],
  );
  objects[name] = JSON.parse(raw);
}
// Quantize, but do not simplify or discard shapes. Max half-cell error < 1.11 metres.
const topo = topology(structuredClone(objects), 1e6);
let checkedRings = 0,
  checkedVertices = 0;
const key = ([x, y]) =>
  `${Math.round((x - topo.transform.translate[0]) / topo.transform.scale[0])},${Math.round((y - topo.transform.translate[1]) / topo.transform.scale[1])}`;
const rings = (g) =>
  g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
for (const name of ["adm1", "adm3"]) {
  const recovered = feature(topo, topo.objects[name]);
  assert.equal(recovered.features.length, objects[name].features.length);
  for (let i = 0; i < recovered.features.length; i++) {
    const before = objects[name].features[i],
      after = recovered.features[i];
    assert.deepEqual(after.properties, before.properties);
    assert.equal(after.geometry.type, before.geometry.type);
    const a = rings(before.geometry),
      b = rings(after.geometry);
    assert.equal(a.length, b.length);
    for (let j = 0; j < a.length; j++) {
      assert.deepEqual(
        new Set(b[j].map(key)),
        new Set(a[j].map(key)),
        `${name}/${before.properties.id}/ring${j}`,
      );
      assert.ok(new Set(b[j].map(key)).size >= 3, "Collapsed polygon");
      checkedRings++;
      checkedVertices += a[j].length;
    }
  }
}
const json = JSON.stringify(topo),
  gz = gzipSync(json, { level: 9 });
const report = {
  method:
    "topojson-server 3.0.1; quantization 1e6; no simplification; gzip level 9",
  sourceSha256: manifest.sourceSha256,
  features: {
    adm1: objects.adm1.features.length,
    adm3: objects.adm3.features.length,
  },
  checkedRings,
  checkedVertices,
  quantizationScaleDegrees: topo.transform.scale,
  maxHalfCellMetresUpperBound:
    (Math.hypot(...topo.transform.scale) * 111320) / 2,
  topologyBytes: Buffer.byteLength(json),
  gzipBytes: gz.length,
  gzipSha256: createHash("sha256").update(gz).digest("hex"),
  parity:
    "Every feature id/properties, geometry type, ring count and quantized vertex set verified. Classifications read from unchanged data.json; not transformed.",
};
const outputs = [
  ["assets/derived/boundaries.topo.json.gz", gz],
  [
    "working/experiment-001/evidence/derivation.json",
    Buffer.from(JSON.stringify(report, null, 2) + "\n"),
  ],
];
for (const [path, content] of outputs) {
  if (process.argv.includes("--check"))
    assert.deepEqual(await fs.readFile(new URL(path, root)), content, path);
  else await fs.writeFile(new URL(path, root), content);
}
console.log(JSON.stringify(report, null, 2));
