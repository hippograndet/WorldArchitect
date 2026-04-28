import JSZip from 'jszip';
import { getDb } from '../db/index.js';

interface ArticleExportRow {
  id: string;
  title: string;
  status: string;
  template_type: string;
  temporal_anchor_start: string | null;
  temporal_anchor_end: string | null;
  category_name: string;
  body: string;
  summary: string;
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

function buildMarkdown(row: ArticleExportRow): string {
  const lines: string[] = [];

  lines.push(`# ${row.title}`);
  lines.push('');
  lines.push(`**Category:** ${row.category_name}`);
  lines.push(`**Status:** ${row.status}`);
  lines.push(`**Template:** ${row.template_type}`);

  if (row.temporal_anchor_start) {
    const anchor = row.temporal_anchor_end
      ? `${row.temporal_anchor_start} – ${row.temporal_anchor_end}`
      : row.temporal_anchor_start;
    lines.push(`**Temporal anchor:** ${anchor}`);
  }

  lines.push('');

  if (row.summary) {
    lines.push('## Introduction');
    lines.push('');
    lines.push(row.summary);
    lines.push('');
  }

  if (row.body) {
    lines.push(row.body);
  }

  return lines.join('\n');
}

export async function buildWorldZip(worldId: string): Promise<Buffer> {
  const db = getDb();

  const world = db
    .prepare(`SELECT name FROM worlds WHERE id = ?`)
    .get(worldId) as { name: string } | undefined;

  if (!world) throw new Error('World not found.');

  const articles = db
    .prepare(
      `SELECT
         a.id,
         a.title,
         a.status,
         a.template_type,
         a.temporal_anchor_start,
         a.temporal_anchor_end,
         c.name AS category_name,
         COALESCE(av.body, '')    AS body,
         COALESCE(wbe.summary, '') AS summary
       FROM articles a
       JOIN categories c ON c.id = a.category_id
       LEFT JOIN article_versions av ON av.id = a.current_version_id
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE a.world_id = ?
       ORDER BY c.sort_order, a.title`,
    )
    .all(worldId) as ArticleExportRow[];

  const zip = new JSZip();

  // Track used filenames to avoid collisions
  const usedNames = new Map<string, number>();

  for (const article of articles) {
    const base = sanitizeFilename(article.title) || `article_${article.id}`;
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    const filename = count === 0 ? `${base}.md` : `${base}_${count}.md`;

    zip.file(filename, buildMarkdown(article));
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
