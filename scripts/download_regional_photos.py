"""Optional resource refresh; requires certifi. Review images and licenses after running."""
import ssl, certifi, sys
import json, urllib.request, urllib.parse, re, html, time
from pathlib import Path
queries={'PAR':'Paris Eiffel Tower skyline','LON':'London Westminster skyline','ROM':'Rome Colosseum','MIL':'Milan cathedral','BER':'Berlin Brandenburg Gate','MAD':'Madrid city skyline','BCN':'Barcelona Sagrada Familia','LIS':'Lisbon city panorama','AMS':'Amsterdam canal houses','VIE':'Vienna city panorama','PRG':'Prague Charles Bridge panorama','ATH':'Athens Acropolis panorama','NYC':'New York Manhattan skyline','LAX':'Los Angeles skyline','SFO':'San Francisco Golden Gate Bridge','CHI':'Chicago skyline','MIA':'Miami skyline','WAS':'Washington DC Capitol','BOS':'Boston skyline','LAS':'Las Vegas skyline'}
root=Path(__file__).resolve().parent.parent / 'Aviator/Resources/Assets.xcassets'; root.mkdir(parents=True,exist_ok=True)
(root/'Contents.json').write_text('{"info":{"author":"xcode","version":1}}')
credits=(Path(__file__).resolve().parent.parent / 'Aviator/Resources/credits.md').read_text().splitlines()
if '## Европа и США' not in credits:
 credits += ['', '## Европа и США', '', 'Добавлено 04.10.2026. Фото привязаны к городу, включая все его аэропорты.', '']
selected={'LIS':'File:Alfama Rooftops and Tagus River View, Lisbon (54733828355).jpg','LAX':'File:Skyline downtown Los Angeles 2019 1.jpg','MIA':'File:Miami skyline from the ocean.jpg','ATH':'File:Attica 06-13 Athens 50 View from Philopappos - Acropolis Hill.jpg','BCN':'File:Barcelona - Flickr - concrete^fells (1).jpg'}
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'AviatorMVP/1.0 (local travel demo; image credits in repository)'})
 return urllib.request.urlopen(req,timeout=25,context=ssl.create_default_context(cafile=certifi.where())).read()
for key,q in queries.items():
 if len(sys.argv) > 1 and key not in sys.argv[1:]: continue
 if key not in selected and (root/(key+'.imageset')).exists(): continue
 try:
  params={'action':'query','format':'json','generator':'search','gsrsearch':q+' filetype:bitmap','gsrnamespace':6,'gsrlimit':20,'prop':'imageinfo','iiprop':'url|extmetadata|size','iiurlwidth':1000}
  if key in selected:
   params={k:v for k,v in params.items() if k not in ['generator','gsrsearch','gsrnamespace','gsrlimit']}
   params['titles']=selected[key]
  data=json.loads(get('https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(params)))
  for page in sorted(data['query']['pages'].values(),key=lambda p:p.get('index',100)):
   info=page['imageinfo'][0]
   if info.get('width',0)/max(1,info.get('height',1))>2.3: continue
   meta=info.get('extmetadata',{}); license=meta.get('LicenseShortName',{}).get('value','')
   if not any(x in license.lower() for x in ['cc by','cc0','public domain']): continue
   url=info.get('thumburl',info['url'])
   if not url.lower().split('?')[0].endswith(('.jpg','.jpeg','.png')): continue
   image=get(url); ext='png' if '.png' in url.lower() else 'jpg'
   d=root/(key+'.imageset'); d.mkdir(exist_ok=True); (d/('photo.'+ext)).write_bytes(image)
   (d/'Contents.json').write_text(json.dumps({'images':[{'filename':'photo.'+ext,'idiom':'universal'}],'info':{'author':'xcode','version':1}}))
   artist=html.unescape(re.sub('<[^>]+>','',meta.get('Artist',{}).get('value','Wikimedia Commons')))
   credits = [line for line in credits if not line.startswith(f'- **{key}**:')]
   credits.append(f"- **{key}**: [{page['title']}]({info['descriptionurl']}) — {artist}; [{license}]({meta.get('LicenseUrl',{}).get('value',info['descriptionurl'])}). Фото масштабировано средствами Commons, отображается с кадрированием.")
   print(key,len(image),license,flush=True); break
  else: print('NO PHOTO',key,flush=True)
 except Exception as e: print('ERROR',key,str(e),flush=True)
 time.sleep(.2)
(Path(__file__).resolve().parent.parent / 'Aviator/Resources/credits.md').write_text('\n'.join(credits)+'\n')
