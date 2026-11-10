import React, {createContext, useContext, useEffect, useState} from 'react';
import {DownloadSimple, File, X} from '@phosphor-icons/react';
import {contentUrl, isPreviewable, parseDownloadLink, previewUrl} from './files.mjs';

// App supplies download (refreshes the narrow download cookie first) and image viewing.
export const FileActions = createContext({download: async () => {}, view: () => {}});

// Compact tile for one generated file; images open the viewer, everything downloads directly.
export function FileTile({file}) {
  const {download, view} = useContext(FileActions);
  const link = parseDownloadLink(file.url, location.origin);
  const image = link && isPreviewable(file.name);
  const [broken, setBroken] = useState(false);
  const open = () => link && (image && !broken ? view({...link, name: file.name}) : download({...link, name: file.name}));
  return <div className="file-tile" title={file.path}>
    <button className="file-tile-main" onClick={open} aria-label={image ? `查看图片 ${file.name}` : `下载 ${file.name}`}>
      {image && !broken ? <img src={previewUrl(link.project, link.file)} alt="" loading="lazy" onError={() => setBroken(true)}/> : <File size={22}/>}
      <span><strong>{file.name}</strong><small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small></span>
    </button>
    <button className="file-tile-download" aria-label={`下载 ${file.name}`} disabled={!link} onClick={() => download({...link, name: file.name})}><DownloadSimple size={16}/></button>
  </div>;
}
// Files produced in one turn, shown under that turn; long lists collapse.
export function TurnFiles({files}) {
  const [all, setAll] = useState(false);
  const shown = all || files.length <= 4 ? files : files.slice(0, 3);
  return <section className="turn-files" aria-label="本轮生成的文件">
    {shown.map(f => <FileTile key={f.path} file={f}/>)}
    {shown.length < files.length && <button className="turn-files-more" onClick={() => setAll(true)}>还有 {files.length - shown.length} 个文件</button>}
  </section>;
}
// Thumbnails for images the user pasted or attached; the bytes load lazily from the owner-checked route.
export function MessageImages({images}) {
  const {view} = useContext(FileActions);
  return <div className="message-images">{images.map((image, i) => image.url || image.src
    ? <button key={i} type="button" className="message-image" aria-label={`放大查看图片 ${i + 1}`} onClick={() => view({src: image.url || image.src, name: `图片 ${i + 1}`})}><img src={image.url || image.src} alt={`图片 ${i + 1}`} loading="lazy"/></button>
    : null)}</div>;
}

// Markdown link renderer: generated-file links become a file chip (or an inline image); others open externally.
export function MarkdownLink({href, children}) {
  const {download, view} = useContext(FileActions);
  const link = parseDownloadLink(href || '', location.origin);
  const [broken, setBroken] = useState(false);
  if (!link) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  const plain = typeof children === 'string' ? children : Array.isArray(children) && children.every(c => typeof c === 'string') ? children.join('') : null;
  const label = !plain || /^https?:\/\//.test(plain) || plain.includes('/download?') ? link.name : children;
  const chip = <button type="button" className="file-chip" title={`下载 ${link.file}`} onClick={() => download(link)}><File size={15}/><span>{label}</span><DownloadSimple size={14}/></button>;
  if (!isPreviewable(link.name) || broken) return chip;
  return <span className="inline-image">
    <button type="button" className="inline-image-frame" aria-label={`放大查看 ${link.name}`} onClick={() => view(link)}><img src={previewUrl(link.project, link.file)} alt={link.name} loading="lazy" onError={() => setBroken(true)}/></button>
    {chip}
  </span>;
}

// Markdown image renderer: generated images load through the authenticated preview route.
export function MarkdownImage({src, alt}) {
  const {view} = useContext(FileActions);
  const link = parseDownloadLink(src || '', location.origin);
  if (!link || !isPreviewable(link.name)) return <img src={src} alt={alt || ''} loading="lazy"/>;
  return <button type="button" className="inline-image-frame" aria-label={`放大查看 ${link.name}`} onClick={() => view(link)}><img src={previewUrl(link.project, link.file)} alt={alt || link.name} loading="lazy"/></button>;
}

export function ImageViewer({image, onClose}) {
  const {download} = useContext(FileActions);
  useEffect(() => { const key = e => e.key === 'Escape' && onClose(); addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, []);
  return <div className="image-viewer" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}>
    <header onClick={e => e.stopPropagation()}><span>{image.name}</span>{image.project && <button onClick={() => download(image)}><DownloadSimple size={17}/>下载</button>}<button aria-label="关闭图片" onClick={onClose}><X size={20}/></button></header>
    <img src={image.src || previewUrl(image.project, image.file)} alt={image.name} onClick={e => e.stopPropagation()}/>
  </div>;
}

// Native streaming download through the cookie-scoped content route; no intermediate page.
export async function startDownload(link) {
  const a = document.createElement('a');
  a.href = contentUrl(link.project, link.file); a.download = link.name || '';
  document.body.append(a); a.click(); a.remove();
}
