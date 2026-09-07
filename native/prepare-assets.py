from PIL import Image
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
source=root.parent if (root.parent/"public").exists() else root.parent/"POKER"
out=root/'assets'
(out/'portraits').mkdir(exist_ok=True)
(out/'backgrounds').mkdir(exist_ok=True)
for p in (source/'public'/'backgrounds').glob('*.png'):
    Image.open(p).convert('RGB').save(out/'backgrounds'/(p.stem+'.jpg'),quality=92)
packs={
 'm|east-asia':['east-male-01','east-male-02','east-male-elder','east-male-young'],
 'f|east-asia':['east-female-01','east-female-02','east-female-03'],
 'm|western':['west-male-01','west-male-02'],
 'f|western':['west-female-01'],
 'm|south-west-asia':['southwest-male-01']}
manifest={}
def avatar_hash(v):
    n=0x9e3779b9
    for c in v:n=(n*33+ord(c))&0xffffffff
    return n
for item in json.loads((out/'roster-portraits.json').read_text('utf-8')):
    a=str(item['avatar']); parts=a.split('|'); crop=None
    if parts[0] in ('atlas','role'):
        _,id,gender,region,age,job,*tail=parts
        scene=tail[0] if tail else 'life'; slot=int(tail[1]) if len(tail)>1 else 0
        key=gender+'|'+('western' if region in ('europe','latin','global') else region)
        pool=packs.get(key,[]); index=slot//16
        if index<len(pool):pack='avatar-atlas-'+pool[index]; col=slot%4; row=(slot//4)%4
        else:
            pack='avatar-atlas-demographic-v3' if (avatar_hash(id+'|'+scene)>>8)%2 else 'avatar-atlas-demographic-v2'
            col={'east-asia':0,'south-west-asia':1,'africa':2}.get(region,3); row=(2 if gender=='f' else 0)+slot%2
        p=source/'public'/'portraits'/(pack+'.png'); im=Image.open(p); w,h=im.size; crop=im.crop((col*w//4,row*h//4,(col+1)*w//4,(row+1)*h//4))
    else:
        index=parts[2] if parts[0]=='legend' else a
        p=source/'public'/'portraits'/(index+'.jpg')
        if p.exists():crop=Image.open(p)
    if crop:
        crop=crop.convert('RGB'); crop.thumbnail((256,256)); target=item['id']+'.jpg';crop.save(out/'portraits'/target,quality=94);manifest[a]=target
(out/'avatar-map.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
print('Prepared',len(manifest),'stable portrait mappings and five backgrounds')

