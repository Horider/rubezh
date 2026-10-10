"""Build matching pixel-art magic orb and ground-impact animation assets."""

from pathlib import Path
import math
import random

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
GAME = ROOT.parents[1] / "game" / "effects"   # frames the game loads
ORB = GAME / "magic-orb"
GROUND = GAME / "magic-ground"
SCALE = 3

INK = (27, 17, 38, 255)
PURPLE_DARK = (57, 26, 83, 255)
PURPLE = (111, 47, 165, 255)
VIOLET = (155, 70, 215, 255)
LILAC = (211, 117, 244, 255)
PALE = (246, 206, 255, 255)
WARM_WHITE = (255, 246, 220, 255)
GOLD_DARK = (112, 68, 35, 255)
GOLD = (220, 151, 64, 255)
GOLD_LIGHT = (255, 217, 126, 255)
STONE_DARK = (80, 67, 77, 255)
STONE = (144, 123, 120, 255)
STONE_LIGHT = (196, 175, 157, 255)


def fresh(size):
    image = Image.new("RGBA", size)
    return image, ImageDraw.Draw(image)


def sparkle(draw, x, y, size, color=PALE):
    draw.line((x - size, y, x + size, y), fill=color)
    draw.line((x, y - size, x, y + size), fill=color)
    draw.point((x, y), fill=WARM_WHITE)


def faceted_orb(draw, x, y, radius, light=True):
    r = radius
    shell = [(x-r,y-2),(x-r+2,y-r+2),(x-2,y-r),(x+r-3,y-r+1),
             (x+r,y-2),(x+r-1,y+r-3),(x+2,y+r),(x-r+2,y+r-2)]
    draw.polygon(shell, fill=INK)
    draw.polygon([(x-r+2,y-2),(x-r+4,y-r+3),(x-1,y-r+2),
                  (x+r-4,y-r+3),(x+r-2,y-1),(x+r-3,y+r-4),
                  (x+1,y+r-2),(x-r+3,y+r-4)], fill=PURPLE)
    draw.polygon([(x-r+4,y-2),(x-2,y-r+3),(x+2,y-1),(x-1,y+r-3)], fill=VIOLET)
    draw.polygon([(x+2,y-1),(x+r-4,y-r+4),(x+r-3,y+r-4),(x-1,y+r-3)], fill=PURPLE_DARK)
    draw.polygon([(x-2,y-r+3),(x+r-5,y-r+4),(x+2,y-1)], fill=LILAC)
    if light:
        draw.polygon([(x-2,y-3),(x+2,y-4),(x+4,y),(x+1,y+3),(x-3,y+2)], fill=PALE)
        draw.point((x,y-1), fill=WARM_WHITE)
    draw.line((x-r+3,y-2,x-r+5,y-r+4), fill=GOLD)
    draw.point((x+r-4,y+r-3), fill=GOLD_LIGHT)


def arc_fragments(draw, x, y, r, phase, count=4, color=VIOLET):
    box=(x-r,y-r,x+r,y+r)
    for i in range(count):
        start=(phase+i*360/count)%360
        draw.arc(box,start,start+25,fill=PURPLE_DARK,width=3)
        draw.arc(box,start+3,start+22,fill=color,width=1)
        angle=math.radians(start+12)
        tx=round(x+math.cos(angle)*r)
        ty=round(y+math.sin(angle)*r)
        draw.point((tx,ty),fill=GOLD_LIGHT if i%2==0 else PALE)


def orb_frame(index):
    image, draw = fresh((64,64))
    rng=random.Random(1430+index)
    # A stepped halo keeps the luminous core readable on both dark forest and sand.
    if index <= 5:
        r=(3,4,6,8,10,11)[index]
        x=38 if index==5 else 32
        draw.ellipse((x-r-4,32-r-4,x+r+4,32+r+4),fill=(100,42,162,30))
        draw.ellipse((x-r-2,32-r-2,x+r+2,32+r+2),fill=(151,62,214,55))
        if index==5:
            draw.polygon([(6,32),(15,28),(30,25),(30,39),(15,35)],fill=PURPLE_DARK)
            draw.polygon([(12,32),(23,30),(34,28),(34,35),(23,34)],fill=VIOLET)
            draw.line((6,33,19,33),fill=GOLD_DARK)
            for px,py in ((6,27),(14,38),(23,24)):
                draw.point((px,py),fill=LILAC)
        faceted_orb(draw,x,32,r)
        if index>=1:
            arc_fragments(draw,x,32,r+7,23+index*19,4 if index>=3 else 3,
                          LILAC if index>=4 else PURPLE)
        for j in range(min(2+index,7)):
            angle=(j*2.4+index*.63)
            dist=r+9+(j%2)*4
            sx=round(x+math.cos(angle)*dist)
            sy=round(32+math.sin(angle)*dist)
            if 3<sx<61 and 3<sy<61:
                sparkle(draw,sx,sy,1 if j%3 else 2,GOLD_LIGHT if j%3==0 else PALE)
    elif index==6:
        # Impact splinters the crystal into a four-pointed violet flare.
        draw.polygon([(32,6),(37,22),(54,28),(39,35),(33,55),(27,38),(9,32),(26,25)],fill=PURPLE_DARK)
        draw.polygon([(32,10),(35,26),(49,29),(36,33),(32,50),(29,35),(14,32),(29,28)],fill=VIOLET)
        draw.polygon([(31,19),(38,29),(33,42),(27,32)],fill=PALE)
        draw.polygon([(32,24),(36,31),(32,37),(28,31)],fill=WARM_WHITE)
        for x,y in ((11,17),(52,14),(49,47),(15,51)):
            sparkle(draw,x,y,2,GOLD_LIGHT)
    elif index==7:
        draw.ellipse((13,13,51,51),fill=(132,56,196,54))
        draw.polygon([(32,5),(38,24),(59,30),(39,37),(33,59),(26,40),(5,33),(25,26)],fill=PURPLE)
        draw.polygon([(32,12),(36,27),(51,31),(36,35),(32,51),(28,36),(13,32),(28,28)],fill=LILAC)
        draw.ellipse((22,22,42,42),fill=PALE)
        draw.polygon([(26,26),(32,21),(39,27),(42,32),(36,39),(28,38),(22,32)],fill=WARM_WHITE)
        for x,y in ((8,21),(55,17),(50,52),(14,53)):
            draw.point((x,y),fill=GOLD_LIGHT)
    elif index==8:
        arc_fragments(draw,32,32,25,18,5,LILAC)
        draw.ellipse((17,17,47,47),fill=INK)
        draw.ellipse((20,20,44,44),fill=PURPLE)
        draw.ellipse((23,23,41,41),fill=LILAC)
        draw.polygon([(30,24),(39,30),(35,39),(26,38),(23,30)],fill=PALE)
        draw.point((30,28),fill=WARM_WHITE)
        for x,y in ((32,3),(60,32),(32,60),(4,32)):
            sparkle(draw,x,y,2,GOLD_LIGHT)
    else:
        arc_fragments(draw,32,32,26,37,4,PURPLE)
        for x,y,r in ((22,31,4),(33,24,5),(42,34,4),(33,43,3)):
            draw.polygon([(x-r,y),(x,y-r),(x+r,y),(x,y+r)],fill=PURPLE_DARK)
            draw.polygon([(x-r+1,y),(x,y-r+1),(x+1,y)],fill=STONE)
        for x,y in ((8,14),(53,12),(57,47),(13,54),(31,4)):
            draw.point((x,y),fill=GOLD_LIGHT if rng.randrange(2) else LILAC)
    return image.resize((192,192),Image.Resampling.NEAREST)


def ellipse_arc(draw,cx,cy,rx,ry,start,end,color,width=1):
    draw.arc((cx-rx,cy-ry,cx+rx,cy+ry),start,end,fill=color,width=width)


def ground_rune(draw,cx,cy,rx,ry,phase,opacity=1):
    dark=PURPLE_DARK if opacity>.5 else (72,36,88,150)
    bright=VIOLET if opacity>.5 else (142,76,175,160)
    ellipse_arc(draw,cx,cy,rx,ry,8+phase,164+phase,dark,2)
    ellipse_arc(draw,cx,cy,rx,ry,188+phase,344+phase,dark,2)
    ellipse_arc(draw,cx,cy,rx-2,max(2,ry-2),20+phase,160+phase,bright,1)
    ellipse_arc(draw,cx,cy,rx-2,max(2,ry-2),200+phase,340+phase,bright,1)
    for angle in (0,45,90,135,180,225,270,315):
        rad=math.radians(angle)
        x=round(cx+rx*math.cos(rad))
        y=round(cy+ry*math.sin(rad))
        draw.polygon([(x,y-2),(x+2,y),(x,y+2),(x-2,y)],fill=GOLD_DARK)
        draw.point((x,y),fill=GOLD_LIGHT if opacity>.5 else GOLD)


def stone_chip(draw,x,y,size,light=False):
    draw.polygon([(x-size,y),(x-size+1,y-size+1),(x+size-1,y-size),
                  (x+size,y),(x+size-1,y+size-1),(x-size+1,y+size)],fill=STONE_DARK)
    draw.polygon([(x-size+1,y-1),(x-size+2,y-size+1),(x+size-1,y-size),
                  (x+size-1,y-1),(x,y+1)],fill=STONE_LIGHT if light else STONE)
    draw.line((x-size+1,y+1,x+size-1,y+1),fill=GOLD_DARK)


def ground_frame(index):
    image,draw=fresh((80,64))
    rng=random.Random(5100+index)
    cx,cy=40,50
    if index==0:
        draw.polygon([(37,0),(43,0),(42,37),(47,49),(33,49),(38,37)],fill=PURPLE_DARK)
        draw.polygon([(39,0),(42,0),(41,40),(44,49),(36,49),(39,40)],fill=VIOLET)
        draw.line((40,1,40,46),fill=PALE,width=2)
        draw.ellipse((32,45,48,54),fill=PURPLE)
        draw.ellipse((35,46,45,51),fill=WARM_WHITE)
        for x,y in ((29,48),(51,46),(35,55),(47,54)):
            sparkle(draw,x,y,1,GOLD_LIGHT)
    elif index==1:
        draw.ellipse((25,40,55,57),fill=(106,48,148,45))
        draw.polygon([(40,35),(44,43),(52,47),(44,50),(40,56),(35,50),(27,47),(36,43)],fill=VIOLET)
        draw.ellipse((33,42,47,51),fill=PALE)
        draw.ellipse((36,43,44,48),fill=WARM_WHITE)
        ground_rune(draw,cx,cy,12,5,0)
        for x,y in ((24,38),(57,41),(31,32),(49,34)):
            sparkle(draw,x,y,1,GOLD_LIGHT)
    else:
        radius=[0,0,17,22,27,33,30,25,19,12][index]
        ry=max(4,round(radius*.35))
        # Warm dust and earth cracks tie the magic to the painted forest map.
        if index<=8:
            draw.ellipse((cx-radius-1,cy-ry+1,cx+radius+1,cy+ry+4),fill=(76,53,70,45))
            for offset in (-1,1):
                draw.line((cx+offset*5,cy-1,cx+offset*10,cy+4,cx+offset*15,cy+3),fill=GOLD_DARK,width=1)
            ground_rune(draw,cx,cy,radius,ry,index*5,1 if index<=6 else .35)
        if index<=5:
            # Central impact glyph and rising violet light.
            draw.polygon([(cx,cy-9),(cx+7,cy-2),(cx,cy+4),(cx-7,cy-2)],fill=PURPLE_DARK)
            draw.polygon([(cx,cy-7),(cx+5,cy-2),(cx,cy+2),(cx-5,cy-2)],fill=VIOLET)
            draw.point((cx,cy-3),fill=WARM_WHITE)
            if index<=3:
                top={2:24,3:32}[index]
                draw.polygon([(cx-3,top),(cx+3,top),(cx+2,cy-7),(cx-2,cy-7)],fill=PURPLE)
                draw.line((cx,top,cx,cy-9),fill=PALE)
        if 3<=index<=8:
            lift={3:1,4:3,5:6,6:8,7:6,8:3}[index]
            chips=[(-21,0,3),(-13,-4,3),(-5,-1,2),(8,-3,3),(17,0,3),(25,-1,2)]
            for j,(dx,dy,size) in enumerate(chips):
                x=cx+dx+(j%3-1)*max(0,index-5)
                y=cy+dy-lift-(j%2)*2
                stone_chip(draw,x,y,size,j%2==0)
            for j in range(5):
                x=cx+rng.randrange(-radius,radius+1)
                y=cy-rng.randrange(4,14)-lift//2
                draw.point((x,y),fill=GOLD_LIGHT if j%2 else LILAC)
        if index==9:
            draw.ellipse((29,49,51,57),fill=(62,35,78,75))
            for x,y in ((17,47),(24,41),(59,44),(65,49),(35,38),(47,40)):
                draw.point((x,y),fill=STONE if x%2 else PURPLE)
    return image.resize((240,192),Image.Resampling.NEAREST)


def save_animation(folder,frames,columns):
    folder.mkdir(parents=True,exist_ok=True)
    width,height=frames[0].size
    rows=math.ceil(len(frames)/columns)
    sheet=Image.new("RGBA",(width*columns,height*rows))
    for i,frame in enumerate(frames):
        frame.save(folder/f"frame-{i+1:02d}.png")
        sheet.alpha_composite(frame,((i%columns)*width,(i//columns)*height))
    sheet.save(ROOT/f"{folder.name}-v2-sheet.png")   # preview sheet stays with the sources


def main():
    save_animation(ORB,[orb_frame(i) for i in range(10)],10)
    save_animation(GROUND,[ground_frame(i) for i in range(10)],5)
    print("Created 10 transparent frames and a sprite sheet for each magic effect.")


if __name__=="__main__":
    main()
