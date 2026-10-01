"""Deterministic Xcode project writer; no third-party generator required."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET

def ident(value): return hashlib.sha1(value.encode()).hexdigest()[:24].upper()
def quote(value): return json.dumps(str(value))
objects = {}
def add(key, isa, **values):
    oid=ident(key); objects[oid]={'isa':isa, **values}; return oid
class Raw(str): pass

def array(items): return Raw('( '+', '.join(items)+' )')
def settings(items): return Raw('{ '+ ' '.join(f'{k} = {quote(v)};' for k,v in items.items())+' }')

files={}
for path in sorted([*Path('Aviator').rglob('*.swift'), *Path('AviatorTests').glob('*.swift'), *Path('AviatorUITests').glob('*.swift'),Path('Aviator/Resources/airports.json'),Path('Aviator/Resources/credits.md'),Path('Aviator/Resources/Assets.xcassets'), *Path('Aviator/Config').glob('*.xcconfig'), *Path('Aviator/Config').glob('*.plist')]):
    kind={'.swift':'sourcecode.swift','.json':'text.json','.md':'text','.xcassets':'folder.assetcatalog','.xcconfig':'text.xcconfig','.plist':'text.plist.xml'}[path.suffix]
    files[str(path)]=add(str(path), 'PBXFileReference', lastKnownFileType=quote(kind), path=quote(path), sourceTree=quote('<group>'))
products={name:add(name+'product','PBXFileReference',explicitFileType=quote('wrapper.application' if name=='Aviator' else 'wrapper.cfbundle'),path=quote(name+('.app' if name=='Aviator' else '.xctest')),sourceTree=quote('BUILT_PRODUCTS_DIR')) for name in ['Aviator','AviatorTests','AviatorUITests']}
productgroup=add('productgroup','PBXGroup',children=array(list(products.values())),name=quote('Products'),sourceTree=quote('<group>'))
group=add('rootgroup','PBXGroup',children=array([*files.values(),productgroup]),sourceTree=quote('<group>'))
targets={name:ident(name+'target') for name in products}
projectID=ident('project')

def configs(name):
    ids=[]
    for mode in ['Debug','Release']:
        values={'SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SWIFT_VERSION':'5.0','TARGETED_DEVICE_FAMILY':'1','PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'com.aviator.'+name.lower(),'CODE_SIGN_STYLE':'Automatic','SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','ENABLE_TESTABILITY':'YES' if mode=='Debug' else 'NO','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else ''}
        if name=='Aviator':
            values.update({'INFOPLIST_FILE':f'Aviator/Config/Info-{mode}.plist','GENERATE_INFOPLIST_FILE':'NO','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon'})
        else:
            values['GENERATE_INFOPLIST_FILE']='YES'
            if name=='AviatorTests': values.update({'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/Aviator.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Aviator','BUNDLE_LOADER':'$(TEST_HOST)'})
            else: values['TEST_TARGET_NAME']='Aviator'
        ids.append(add(name+mode,'XCBuildConfiguration',name=quote(mode),baseConfigurationReference=files[f'Aviator/Config/{mode}.xcconfig'],buildSettings=settings(values)))
    return add(name+'configs','XCConfigurationList',buildConfigurations=array(ids),defaultConfigurationIsVisible='0',defaultConfigurationName=quote('Release'))

for name,target in targets.items():
    sources=[]; resources=[]
    for path,ref in files.items():
        include=(path.startswith(name+'/') and path.endswith('.swift'))
        resource=name=='Aviator' and path.startswith('Aviator/Resources/')
        if include or resource:
            build=add(name+path+'build','PBXBuildFile',fileRef=ref)
            (sources if include else resources).append(build)
    sourcephase=add(name+'sources','PBXSourcesBuildPhase',buildActionMask='2147483647',files=array(sources),runOnlyForDeploymentPostprocessing='0')
    resourcephase=add(name+'resources','PBXResourcesBuildPhase',buildActionMask='2147483647',files=array(resources),runOnlyForDeploymentPostprocessing='0')
    frameworkphase=add(name+'frameworks','PBXFrameworksBuildPhase',buildActionMask='2147483647',files=array([]),runOnlyForDeploymentPostprocessing='0')
    dependencies=[]
    if name!='Aviator':
        proxy=add(name+'proxy','PBXContainerItemProxy',containerPortal=projectID,proxyType='1',remoteGlobalIDString=targets['Aviator'],remoteInfo=quote('Aviator'))
        dependencies.append(add(name+'dependency','PBXTargetDependency',target=targets['Aviator'],targetProxy=proxy))
    add(name+'target','PBXNativeTarget',buildConfigurationList=configs(name),buildPhases=array([sourcephase,frameworkphase,resourcephase]),buildRules=array([]),dependencies=array(dependencies),name=quote(name),productName=quote(name),productReference=products[name],productType=quote('com.apple.product-type.application' if name=='Aviator' else 'com.apple.product-type.bundle.'+('unit-test' if name=='AviatorTests' else 'ui-testing')))
projectconfigs=[]
for mode in ['Debug','Release']:
    projectconfigs.append(add('project'+mode,'XCBuildConfiguration',buildSettings=settings({'CLANG_ENABLE_MODULES':'YES','CLANG_ENABLE_OBJC_ARC':'YES','SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SWIFT_VERSION':'5.0'}),name=quote(mode)))
listID=add('projectconfigs','XCConfigurationList',buildConfigurations=array(projectconfigs),defaultConfigurationIsVisible='0',defaultConfigurationName=quote('Release'))
add('project','PBXProject',attributes=Raw('{ LastUpgradeCheck = 1600; }'),buildConfigurationList=listID,compatibilityVersion=quote('Xcode 14.0'),developmentRegion=quote('ru'),hasScannedForEncodings='0',knownRegions=array([quote('ru'),quote('en'),quote('Base')]),mainGroup=group,productRefGroup=productgroup,projectDirPath=quote(''),projectRoot=quote(''),targets=array(list(targets.values())))
root=Path('Aviator.xcodeproj'); root.mkdir(exist_ok=True)
lines=['// !$*UTF8*$!','{','archiveVersion = 1;','classes = {};','objectVersion = 56;','objects = {']
for oid,value in objects.items():
    lines.append(oid+' = { '+' '.join(f'{k} = {v};' for k,v in value.items())+' };')
lines.extend(['};','rootObject = '+projectID+';','}'])
(root/'project.pbxproj').write_text('\n'.join(lines)+'\n')
workspace=root/'project.xcworkspace'; workspace.mkdir(exist_ok=True); (workspace/'contents.xcworkspacedata').write_text('<?xml version="1.0" encoding="UTF-8"?><Workspace version="1.0"><FileRef location="self:"></FileRef></Workspace>')
schemes=root/'xcshareddata/xcschemes';schemes.mkdir(parents=True,exist_ok=True)
scheme=ET.Element('Scheme',LastUpgradeVersion='1600',version='1.3')
build=ET.SubElement(scheme,'BuildAction',parallelizeBuildables='YES',buildImplicitDependencies='YES'); entries=ET.SubElement(build,'BuildActionEntries')
def ref(parent,name):
    ET.SubElement(parent,'BuildableReference',BuildableIdentifier='primary',BlueprintIdentifier=targets[name],BuildableName=name+('.app' if name=='Aviator' else '.xctest'),BlueprintName=name,ReferencedContainer='container:Aviator.xcodeproj')
for name in targets:
    entry=ET.SubElement(entries,'BuildActionEntry',buildForTesting='YES',buildForRunning='YES' if name=='Aviator' else 'NO',buildForProfiling='YES' if name=='Aviator' else 'NO',buildForArchiving='YES' if name=='Aviator' else 'NO',buildForAnalyzing='YES');ref(entry,name)
test=ET.SubElement(scheme,'TestAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',shouldUseLaunchSchemeArgsEnv='YES'); testables=ET.SubElement(test,'Testables')
for name in ['AviatorTests','AviatorUITests']: ref(ET.SubElement(testables,'TestableReference',skipped='NO'),name)
launch=ET.SubElement(scheme,'LaunchAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',launchStyle='0',useCustomWorkingDirectory='NO',ignoresPersistentStateOnLaunch='NO',debugDocumentVersioning='YES',debugServiceExtension='internal',allowLocationSimulation='YES');ref(ET.SubElement(launch,'BuildableProductRunnable',runnableDebuggingMode='0'),'Aviator')
profile=ET.SubElement(scheme,'ProfileAction',buildConfiguration='Release',shouldUseLaunchSchemeArgsEnv='YES',savedToolIdentifier='',useCustomWorkingDirectory='NO',debugDocumentVersioning='YES');ref(ET.SubElement(profile,'BuildableProductRunnable',runnableDebuggingMode='0'),'Aviator')
ET.SubElement(scheme,'AnalyzeAction',buildConfiguration='Debug');ET.SubElement(scheme,'ArchiveAction',buildConfiguration='Release',revealArchiveInOrganizer='YES')
ET.indent(scheme);ET.ElementTree(scheme).write(schemes/'Aviator.xcscheme',encoding='utf-8',xml_declaration=True)
print('Generated',len(files),'file references, 3 targets')
