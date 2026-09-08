"""Full snapshot census. Never mutates the three pinned inputs."""
import collections, csv, hashlib, io, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXPECTED = {
    'data': 'a36b00ec6dc43fe0a222ad0b9d54454220e7a8461018ec877ae032bee302403b',
    'adm1': 'a4d355ec7536a1248589e3dfbaccd7e76005c8909f1bd2d8194aa60988eb9362',
    'adm3': 'ac22b7ff802419e7182b21934d484b1defb8356666ed6b889040f69119ee3c14',
}
LEVELS = ['Задовільний', 'Помірний', 'Високий', 'Дуже високий', 'Непереборний']
duplicates = []
def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result: duplicates.append(key)
        result[key] = value
    return result

sources = {}
for name, expected in EXPECTED.items():
    raw = (ROOT / 'assets/data' / (name+'.json')).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected, f'Pinned source changed: {name}'
    sources[name] = json.loads(raw, object_pairs_hook=unique_object)
assert not duplicates, f'Duplicate JSON keys: {duplicates}'
data, adm1, adm3 = (sources[n] for n in ['data', 'adm1', 'adm3'])
geometry_ids = [f['properties']['id'] for f in adm3['features']]
gids = set(geometry_ids)
count = lambda seq: dict(sorted(collections.Counter(seq).items()))
duplicate_values = lambda seq: {k:v for k,v in count(seq).items() if v>1}
unmapped = [{'id':i, **data[i]} for i in sorted(set(data)-gids)]
missing = sorted(gids-set(data))
invalid = {i:d for i,d in data.items() if d.get('risk') not in LEVELS}
bad_codes = {i:d.get('code') for i,d in data.items() if not re.fullmatch(r'UA\d{17}', d.get('code','')) or d['code'][2:9]!=i}
assert not invalid and not bad_codes
assert missing == ['3200000']
assert not duplicate_values(geometry_ids)
assert not duplicate_values(d['code'] for d in data.values())
assert not duplicate_values(f['properties']['id'] for f in adm1['features'])
assert all(re.fullmatch(r'\d{7}', i) for i in set(data)|gids)
regions = {}
for i,d in data.items():
    prefix=i[:2]
    assert prefix not in regions or regions[prefix]==d['region']
    regions[prefix]=d['region']
adm1_ids=set(f['properties']['id'] for f in adm1['features'])
report = {
    'baseline': '8e24e53dffcc77caf6b2e23a7b96b370b5948529', 'sourceSha256': EXPECTED,
    'riskRecords': len(data), 'adm1Features':len(adm1['features']), 'adm3Features':len(geometry_ids),
    'matchedRiskRecords':len(set(data)&gids), 'explorerEntriesIncludingSpecial':len(set(data)|gids),
    'classesAllRiskRecords':count(d['risk'] for d in data.values()),
    'classesMappedRiskRecords':count(d['risk'] for i,d in data.items() if i in gids),
    'regionRecordCounts':count(d['region'] for d in data.values()),
    'duplicateJsonKeys':duplicates, 'duplicateGeometryIds':duplicate_values(geometry_ids),
    'duplicateCodes':duplicate_values(d['code'] for d in data.values()),
    'ambiguousFullNames':duplicate_values(d['name'] for d in data.values()),
    'invalidOrMissingRiskValues':invalid, 'invalidCodesOrIdMismatch':bad_codes,
    'riskRecordsWithoutGeometry':unmapped, 'geometryWithoutRiskRecord':missing,
    'specialCase':{'id':'3200000','name':'Чорнобильська зона відчуження','authority':'Special handling inherited from baseline code; no risk record or KATOTTG code assigned.'},
    'effectiveDate':None, 'effectiveDateEvidence':'Repository data commit on 12 January 2026 is not proof of official effective date. No explicit provenance/date fields in the snapshot.',
    'recordFields':sorted(set(k for d in data.values() for k in d)),
    'adm1IdsNotRiskPrefixes':sorted(adm1_ids-set(regions)),
    'riskPrefixesNotAdm1Ids':sorted(set(regions)-adm1_ids),
    'adm1JoinPolicy':'Do not join adm1 ids to risk prefixes. Draw adm1 outlines only. Region filtering uses the explicit region field on all risk records and their joined adm3 geometries.',
    'geometryProperties':sorted(set(k for f in adm3['features'] for k in f['properties'])),
}
manifest={'baseline':report['baseline'],'geometryIds':sorted(gids),'regions':regions,'unmappedIds':[d['id'] for d in unmapped],'riskRecords':len(data),'specialId':'3200000','sourceSha256':EXPECTED}
csv_file=io.StringIO(); writer=csv.writer(csv_file,lineterminator='\n');writer.writerow(['id','code','name','region','source_risk','geometry','classification_status'])
for i in sorted(set(data)|gids):
    d=data.get(i,{})
    writer.writerow([i,d.get('code',''),d.get('name','Чорнобильська зона відчуження'),d.get('region','Київська область'),d.get('risk',''),'present' if i in gids else 'absent','special' if i=='3200000' else 'valid'])
outputs={ROOT/'working/experiment-001/evidence/census.json':json.dumps(report,ensure_ascii=False,indent=2)+'\n',ROOT/'working/experiment-001/evidence/joined-records.csv':csv_file.getvalue(),ROOT/'assets/derived/geography.json':json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n'}
for path,text in outputs.items():
    if '--check' in sys.argv: assert path.read_text()==text, f'Outdated derived census: {path.name}'
    else: path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
print(f'PASS: {len(data)} risk records; {len(geometry_ids)} geometries; {len(set(data)&gids)} joined; {len(unmapped)} records without geometry; 1 special geometry; no duplicate identifiers/codes or invalid classes.')
