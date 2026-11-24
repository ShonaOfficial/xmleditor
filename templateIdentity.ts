export interface TemplateIdentityInfo {
  name: string;
  version: string;
  author: string;
  authorUrl: string;
  license: string;
  description: string;
}

function extractField(block: string, regex: RegExp): string {
  const m = regex.exec(block);
  return m?.[1] ? m[1].trim() : '';
}

export function parseTemplateIdentityFromXml(xml: string): TemplateIdentityInfo {
  const skinMatch = /<b:skin\b[^>]*>([\s\S]*?)<\/b:skin>/i.exec(xml);
  const headerSlice = `${xml.slice(0, 3500)}\n${skinMatch ? skinMatch[1].slice(0, 2500) : ''}`;

  const name =
    extractField(headerSlice, /(?:Template\s*Name|Theme\s*Name|Name)\s*:\s*([^\r\n*<>]+)/i) ||
    extractField(xml, /<title[^>]*>([\s\S]*?)<\/title>/i)
      .replace(/<[^>]+>/g, '')
      .trim() ||
    'Template Blogger XML';

  const version = extractField(
    headerSlice,
    /(?:Version|Versi)\s*:\s*([^\r\n*<>]+)/i
  ).replace(/^v/i, '');

  const author = extractField(
    headerSlice,
    /(?:Author|Designer|Created\s*By|Penulis)\s*:\s*([^\r\n*<>]+)/i
  );

  const authorUrl = extractField(
    headerSlice,
    /(?:URL|Author\s*URL|Website|Homepage)\s*:\s*(https?:\/\/[^\s\r\n*<>]+)/i
  );

  const license = extractField(headerSlice, /(?:License|Lisensi)\s*:\s*([^\r\n*<>]+)/i);
  const description = extractField(
    headerSlice,
    /(?:Description|Deskripsi)\s*:\s*([^\r\n*<>]+)/i
  );

  return {
    name,
    version,
    author,
    authorUrl,
    license,
    description,
  };
}

export function applyTemplateIdentityToXml(
  xml: string,
  identity: TemplateIdentityInfo
): string {
  const cleanName = identity.name.trim() || 'Template Blogger XML';
  const cleanVersion = identity.version.trim().replace(/^v/i, '') || '1.0.0';
  const cleanAuthor = identity.author.trim();
  const cleanUrl = identity.authorUrl.trim();
  const cleanLicense = identity.license.trim();
  const cleanDescription = identity.description.trim();

  const lines = [
    `Template Name: ${cleanName}`,
    `Version: ${cleanVersion}`,
    cleanAuthor ? `Author: ${cleanAuthor}` : '',
    cleanUrl ? `URL: ${cleanUrl}` : '',
    cleanLicense ? `License: ${cleanLicense}` : '',
    cleanDescription ? `Description: ${cleanDescription}` : '',
  ].filter(Boolean);

  const skinCommentBlock = `/*\n-----------------------------------------------\nBlogger Template Style\n${lines.join('\n')}\n----------------------------------------------- */`;

  const skinHeaderRegex = /\/\*[\s\S]*?(?:Template\s*Name|Theme\s*Name|Blogger\s*Template\s*Style)[\s\S]*?\*\//i;
  if (skinHeaderRegex.test(xml)) {
    return xml.replace(skinHeaderRegex, skinCommentBlock);
  }

  const cdataSkinRegex = /(<b:skin\b[^>]*>\s*(?:<!\[CDATA\[|\/\*\s*<!\[CDATA\[\s*\*\/)?)/i;
  if (cdataSkinRegex.test(xml)) {
    return xml.replace(cdataSkinRegex, `$1\n${skinCommentBlock}\n`);
  }

  const xmlCommentBlock = `<!--\n${lines.join('\n')}\n-->`;
  const existingTopComment = /(<\?xml[^>]*>\s*)<!--[\s\S]*?(?:Template\s*Name|Theme\s*Name)[\s\S]*?-->/i;
  if (existingTopComment.test(xml)) {
    return xml.replace(existingTopComment, `$1${xmlCommentBlock}`);
  }

  if (/^<\?xml[^>]*>/i.test(xml)) {
    return xml.replace(/^(<\?xml[^>]*>)/i, `$1\n${xmlCommentBlock}`);
  }

  return `${xmlCommentBlock}\n${xml}`;
}
