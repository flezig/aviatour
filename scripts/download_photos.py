"""Optional resource refresh; requires certifi. Review images and licenses after running."""
import ssl, certifi
import json, urllib.request, urllib.parse, re, html, time
from pathlib import Path
queries={'hero':'Amalfi coast','LED':'Saint Petersburg Church Savior','KZN':'Kazan Kul Sharif','KGD':'Kaliningrad','AER':'Sochi sea','MRV':'Pyatigorsk mountain','EVN':'Yerevan panorama','TBS':'Tbilisi panorama','IST':'Istanbul Hagia Sophia','GYD':'Baku panorama','MSQ':'Minsk Upper Town'}
root=Path(__file__).resolve().parent.parent / 'Aviator/Resources/Assets.xcassets'; root.mkdir(parents=True,exist_ok=True)
(root/'Contents.json').write_text('{"info":{"author":"xcode","version":1}}')
credits=['# Фотографии Aviator','', 'Локальные фотографии Wikimedia Commons, загружены 01.10.2026. MRV иллюстрирует регион Кавказских Минеральных Вод. Изображения не подтверждают рейсы. Атрибуция доступна также в приложении.','']
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'AviatorMVP/1.0 (local travel demo; image credits in repository)'})
 return urllib.request.urlopen(req,timeout=25,context=ssl.create_default_context(cafile=certifi.where())).read()
for key,q in queries.items():
 try:
  params={'action':'query','format':'json','generator':'search','gsrsearch':q+' filetype:bitmap','gsrnamespace':6,'gsrlimit':20,'prop':'imageinfo','iiprop':'url|extmetadata|size','iiurlwidth':1000}
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
   credits.append(f"- **{key}**: [{page['title']}]({info['descriptionurl']}) — {artist}; [{license}]({meta.get('LicenseUrl',{}).get('value',info['descriptionurl'])}). Фото масштабировано средствами Commons, отображается с кадрированием.")
   print(key,len(image),license,flush=True); break
  else: print('NO PHOTO',key,flush=True)
 except Exception as e: print('ERROR',key,str(e),flush=True)
 time.sleep(.2)
(Path(__file__).resolve().parent.parent / 'Aviator/Resources/credits.md').write_text('\n'.join(credits)+'\n')
