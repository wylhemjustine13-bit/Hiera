import React from 'react';

function inline(text: string, prefix = 'x'): React.ReactNode[] {
  const pattern = /<font face="([^"]+)" size="(\d{1,2})">([\s\S]*?)<\/font>|<mark>([\s\S]*?)<\/mark>|<u>([\s\S]*?)<\/u>|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([\s\S]+?)~~/g;
  const result: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) result.push(text.slice(cursor, match.index));
    const key = prefix + count++;
    if (match[1]) {
      const fonts = ['Arial', 'Georgia', 'Verdana', 'Times New Roman', 'Courier New', 'Trebuchet MS'];
      const face = fonts.includes(match[1]) ? match[1] : 'Arial';
      const size = Math.max(12, Math.min(32, Number(match[2]) || 16));
      result.push(<span key={key} style={{ fontFamily: face, fontSize: size }}>{inline(match[3], key)}</span>);
    } else if (match[4] !== undefined) result.push(<mark key={key}>{inline(match[4], key)}</mark>);
    else if (match[5] !== undefined) result.push(<u key={key}>{inline(match[5], key)}</u>);
    else if (match[6] !== undefined || match[7] !== undefined) result.push(<strong key={key}>{inline(match[6] ?? match[7], key)}</strong>);
    else if (match[8] !== undefined || match[9] !== undefined) result.push(<em key={key}>{inline(match[8] ?? match[9], key)}</em>);
    else if (match[10] !== undefined) result.push(<del key={key}>{inline(match[10], key)}</del>);
    else if (match[11] !== undefined) result.push(<mark key={key}>{inline(match[11], key)}</mark>);
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}

export default function FormattedMessage({ content }: { content: string }) {
  const lines = content.replace(/\r/g, '').split('\n');
  const output: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(<p key={'p' + output.length}>{inline(paragraph.join(' '))}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (items.length && listKind) {
      const List = listKind;
      output.push(<List key={'l' + output.length}>{items.map((item, i) => <li key={i}>{inline(item)}</li>)}</List>);
    }
    items = [];
    listKind = null;
  };
  lines.forEach((line) => {
    const value = line.trim();
    const bullet = value.match(/^[-*•]\s+(.+)$/);
    const numbered = value.match(/^\d+[.)]\s+(.+)$/);
    const heading = value.match(/^(#{1,3})\s+(.+)$/);
    if (!value) { flushParagraph(); flushList(); return; }
    if (heading) {
      flushParagraph(); flushList();
      const Tag = ('h' + heading[1].length) as 'h1' | 'h2' | 'h3';
      output.push(<Tag key={'h' + output.length}>{inline(heading[2])}</Tag>);
    } else if (value.startsWith('> ')) {
      flushParagraph(); flushList();
      output.push(<blockquote key={'q' + output.length}>{inline(value.slice(2))}</blockquote>);
    } else if (/^---+$/.test(value)) {
      flushParagraph(); flushList();
      output.push(<hr key={'r' + output.length} />);
    } else if (bullet || numbered) {
      flushParagraph();
      const nextKind = bullet ? 'ul' : 'ol';
      if (listKind && listKind !== nextKind) flushList();
      listKind = nextKind;
      items.push((bullet || numbered)![1]);
    } else {
      flushList();
      paragraph.push(value);
    }
  });
  flushParagraph();
  flushList();
  return <div className="formatted-message">{output}</div>;
}
