"""Check Xcode membership and resources without claiming an iOS build."""
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parent.parent
project=root/'Aviator.xcodeproj/project.pbxproj'
with tempfile.NamedTemporaryFile(suffix='.json') as temp:
    subprocess.run(['plutil','-convert','json','-o',temp.name,str(project)],check=True)
    payload=json.loads(Path(temp.name).read_text())
objects=payload['objects']
targets={v['name']:v for v in objects.values() if v['isa']=='PBXNativeTarget'}
assert set(targets)=={'Aviator','AviatorTests','AviatorUITests'}
for name,target in targets.items():
    sources=[]
    for phase_id in target['buildPhases']:
        phase=objects[phase_id]
        if phase['isa']!='PBXSourcesBuildPhase':continue
        for build in phase['files']:
            sources.append(objects[objects[build]['fileRef']]['path'])
    expected={str(path.relative_to(root)) for path in (root/name).rglob('*.swift')}
    assert set(sources)==expected,(name,set(sources)^expected)
    for path in sources:assert (root/path).is_file()
refs=[o for o in objects.values() if o['isa']=='PBXFileReference' and o.get('sourceTree')=='<group>']
assert all((root/o['path']).exists() for o in refs)
scheme=ET.parse(root/'Aviator.xcodeproj/xcshareddata/xcschemes/Aviator.xcscheme')
assert len(scheme.findall('.//TestableReference'))==2
release=plistlib.loads((root/'Aviator/Config/Info-Release.plist').read_bytes())
assert 'NSAppTransportSecurity' not in release
assert (root/'Aviator/Resources/airports.json').read_bytes()==(root/'backend/app/airports.json').read_bytes()
assets=root/'Aviator/Resources/Assets.xcassets'
expected_photos = set('hero LED KZN KGD AER MRV EVN TBS IST GYD MSQ PAR LON ROM MIL BER MAD BCN LIS AMS VIE PRG ATH NYC LAX SFO CHI MIA WAS BOS LAS'.split())
assert {asset.stem for asset in assets.glob('*.imageset')} == expected_photos
credits = (root/'Aviator/Resources/credits.md').read_text()
assert all(f'**{name}**' in credits for name in expected_photos)
for asset in assets.iterdir():
    if not asset.is_dir():continue
    for item in json.loads((asset/'Contents.json').read_text()).get('images',[]):
        if 'filename' in item:assert (asset/item['filename']).exists()
print('Xcode membership: 3 targets, shared scheme, all Swift files and resources present; Release ATS secure. Not an iOS build.')
