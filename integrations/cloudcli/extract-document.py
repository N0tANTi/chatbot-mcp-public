#!/usr/bin/env python3
import json, pathlib, re, subprocess, sys, tarfile, zipfile
import xml.etree.ElementTree as ET
file=pathlib.Path(sys.argv[1]);kind=sys.argv[2].lower(); text=''
name=sys.argv[3] if len(sys.argv)>3 else file.name
ARCHIVES=['.zip','.tar','.gz','.tgz','.xz','.bz2']
def listing(entries,total):
    # Names and sizes only: nothing is extracted on the server.
    mb=total/1024**2
    folder=re.sub(r'[^\w.-]+','_',re.sub(r'(\.tar)?\.(zip|tar|gz|tgz|xz|bz2)$','',name,flags=re.I)) or 'archive'
    head=[f'压缩包「{name}」的内容清单（服务器只读取了目录，没有解压）：共 {len(entries)} 个文件，解压后合计约 {mb:.1f} MB。',
          f'需要用到时，请先解压到项目里一个新的空目录（例如 uploads/{folder}/），不要直接运行包里的脚本或程序。']
    if total>2*1024**3: head.append('注意：解压后体积很大，只解压需要的文件。')
    rows=[f'{size}\t{path}' for path,size in entries[:500]]
    if len(entries)>500: rows.append(f'（其余 {len(entries)-500} 项未列出）')
    return '\n'.join(head+['','字节\t路径']+rows)
if kind in ARCHIVES:
    if kind=='.zip' or zipfile.is_zipfile(file):
        with zipfile.ZipFile(file) as z: entries=[(e.filename,e.file_size) for e in z.infolist() if not e.is_dir()]
        text=listing(entries,sum(s for _,s in entries))
    elif tarfile.is_tarfile(file):
        with tarfile.open(file) as t: entries=[(m.name,m.size) for m in t.getmembers() if m.isfile()]
        text=listing(entries,sum(s for _,s in entries))
    else: text=f'「{name}」是单个压缩文件（不是打包的目录），需要时用对应工具解压到项目里新的空目录。'
elif kind=='.pdf':
    result=subprocess.run(['pdftotext','-layout',str(file),'-'],capture_output=True,timeout=20,check=True)
    text=result.stdout.decode('utf8','replace')
elif kind in ['.docx','.xlsx','.pptx','.odt','.epub']:
    with zipfile.ZipFile(file) as z:
        entries=z.infolist()
        if len(entries)>4096 or sum(e.file_size for e in entries)>100*1024**2: raise ValueError('文档解压内容过大')
        shared=[]; chunks=[]
        if kind=='.xlsx' and 'xl/sharedStrings.xml' in z.namelist():
            root=ET.fromstring(z.read('xl/sharedStrings.xml'));shared=[''.join(e.itertext()) for e in root]
        for item in entries:
            name=item.filename
            if not re.match(r'^(word/document\.xml|ppt/slides/slide\d+\.xml|xl/worksheets/sheet\d+\.xml|content\.xml)$',name) and not (kind=='.epub' and name.endswith(('.xhtml','.html'))): continue
            raw=z.read(item)
            if kind=='.epub': chunks.append(re.sub('<[^>]+>',' ',raw.decode('utf8','replace')));continue
            root=ET.fromstring(raw)
            if kind=='.xlsx':
                for row in root.iter():
                    if row.tag.endswith('}row'):
                        values=[]
                        for cell in row:
                            value=''.join(cell.itertext())
                            if cell.get('t')=='s':
                                try:value=shared[int(value)]
                                except (ValueError,IndexError):pass
                            values.append(value)
                        chunks.append('\t'.join(values))
            elif kind=='.odt':chunks.append('\n'.join(''.join(e.itertext()) for e in root.iter() if e.tag.endswith(('}p','}h'))))
            else:chunks.append('\n'.join(e.text for e in root.iter() if e.tag.endswith('}t') and e.text))
        text='\n'.join(chunks)
else:
    raw=file.read_bytes()
    if b'\x00' in raw[:65536] or len(raw)>8*1024**2:
        print(json.dumps({'text':'','empty':True}));sys.exit(0)
    try:text=raw.decode('utf8')
    except UnicodeDecodeError:
        try:text=raw.decode('gb18030')
        except UnicodeDecodeError:print(json.dumps({'text':'','empty':True}));sys.exit(0)
    if kind in ['.html','.htm']:text=re.sub('<[^>]+>',' ',text)
# Very long extractions are skipped; Claude reads the original file itself.
if len(text.encode('utf8'))>4*1024**2: text=''
print(json.dumps({'text':text,'empty':not text.strip()},ensure_ascii=False))
