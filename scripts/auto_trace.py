import json, math, sys, os
from pathlib import Path
from PIL import Image

def detect_lights(img):
    w,h=img.size
    mask=[[False]*w for _ in range(h)]
    pix=img.load()
    for y in range(h):
        for x in range(w):
            r,g,b=pix[x,y]
            if r>200 and 100<g<200 and b<120 and (r-g)>30 and (g-b)>20:
                mask[y][x]=True
    visited=[[False]*w for _ in range(h)]
    comps=[]
    from collections import deque
    for y in range(h):
        for x in range(w):
            if mask[y][x] and not visited[y][x]:
                q=deque([(x,y)]); visited[y][x]=True; pts=[]
                while q:
                    cx,cy=q.popleft(); pts.append((cx,cy))
                    for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                        nx,ny=cx+dx,cy+dy
                        if 0<=nx<w and 0<=ny<h and mask[ny][nx] and not visited[ny][nx]:
                            visited[ny][nx]=True; q.append((nx,ny))
                if 80<len(pts)<4000:  # filter noise and huge bright regions
                    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
                    comps.append((sum(xs)//len(xs), sum(ys)//len(ys), len(pts)))
    comps=sorted(comps, key=lambda t:-t[2])
    return comps[:40]

def trace_walls(img):
    w,h=img.size
    scale=max(12,min(30, w//300))
    sw,sh=w//scale,h//scale
    small=img.resize((sw,sh)).convert('L')
    inside=[[small.getpixel((x,y))>20 for x in range(sw)] for y in range(sh)]
    walls=set()
    for y in range(sh):
        for x in range(sw):
            if not inside[y][x]:
                continue
            if x==0 or not inside[y][x-1]:
                walls.add((x*scale,y*scale,x*scale,(y+1)*scale))
            if x==sw-1 or not inside[y][x+1]:
                walls.add(((x+1)*scale,y*scale,(x+1)*scale,(y+1)*scale))
            if y==0 or not inside[y-1][x]:
                walls.add((x*scale,y*scale,(x+1)*scale,y*scale))
            if y==sh-1 or not inside[y+1][x]:
                walls.add((x*scale,(y+1)*scale,(x+1)*scale,(y+1)*scale))
    from collections import defaultdict
    vert=defaultdict(list); horz=defaultdict(list)
    for x1,y1,x2,y2 in walls:
        if x1==x2:
            x=x1; yA=min(y1,y2); yB=max(y1,y2); vert[x].append((yA,yB))
        else:
            y=y1; xA=min(x1,x2); xB=max(x1,x2); horz[y].append((xA,xB))
    merged=[]
    for x,segments in vert.items():
        segments=sorted(segments)
        cur_start,cur_end=segments[0]
        for s,e in segments[1:]:
            if s<=cur_end:
                cur_end=max(cur_end,e)
            else:
                merged.append((x,cur_start,x,cur_end))
                cur_start,cur_end=s,e
        merged.append((x,cur_start,x,cur_end))
    for y,segments in horz.items():
        segments=sorted(segments)
        cur_start,cur_end=segments[0]
        for s,e in segments[1:]:
            if s<=cur_end:
                cur_end=max(cur_end,e)
            else:
                merged.append((cur_start,y,cur_end,y))
                cur_start,cur_end=s,e
        merged.append((cur_start,y,cur_end,y))
    return merged

def process(scene_path):
    scene=json.load(open(scene_path))
    bg_src=scene['background']['src']
    # convert module path to local
    if bg_src.startswith('modules/nimble-maps/'):
        img_path=Path('assets')/Path(bg_src).relative_to('modules/nimble-maps/assets')
    elif bg_src.startswith('modules/'):
        img_path=Path('assets')/Path(bg_src.split('modules/nimble-maps/assets/')[-1])
    else:
        img_path=Path(bg_src)
    if not img_path.exists():
        print(f"skip {scene_path}: image missing {img_path}")
        return
    img=Image.open(img_path).convert('RGB')
    lights=detect_lights(img)
    walls=trace_walls(img)
    scene['lights']=[{
        "_id": f"autolight{i:03d}",
        "x": x,
        "y": y,
        "rotation": 0,
        "config": {
            "dim": 220,
            "bright": 110,
            "angle": 360,
            "color": "#ff9329",
            "alpha": 0.5,
            "animation": {"type":"torch","speed":3,"intensity":3},
            "darkness": {"min":0,"max":1},
            "luminosity": 0.5
        },
        "hidden": False,
        "flags": {}
    } for i,(x,y,_) in enumerate(lights,1)]
    scene['walls']=[{
        "_id": f"autowall{i:04d}",
        "c": [seg[0],seg[1],seg[2],seg[3]],
        "door": 0,
        "ds": 0,
        "move": 1,
        "sight": 1,
        "sound": 1,
        "light": 1,
        "flags": {}
    } for i,seg in enumerate(walls,1)]
    json.dump(scene, open(scene_path,'w'), indent=2)
    print(scene_path, 'walls',len(walls),'lights',len(lights))

if __name__=='__main__':
    paths=sys.argv[1:]
    if not paths:
        print('usage: python auto_trace.py scene1.json ...')
        sys.exit(1)
    for p in paths:
        process(p)
