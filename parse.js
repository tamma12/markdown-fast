
// Fast CommonMark 0.31.2 + GFM 0.29 renderer, byte-identical to marked 18.1.3
// (default options: gfm on, breaks off, pedantic off). Written from the spec.

const C_SPACE = 32, C_TAB = 9, C_NL = 10, C_CR = 13;
const C_LT = 60, C_GT = 62, C_AMP = 38, C_QUOT = 34, C_SQ = 39;
const C_BSLASH = 92, C_BT = 96, C_STAR = 42, C_US = 95, C_TILDE = 126;
const C_LBRK = 91, C_RBRK = 93, C_LPAR = 40, C_RPAR = 41;
const C_HASH = 35, C_MINUS = 45, C_PLUS = 43, C_BANG = 33;
const C_PIPE = 124, C_COLON = 58, C_SLASH = 47;

// ---------- small char helpers ----------
function isSpace(c) {
  if (c === C_SPACE || c === C_TAB || c === C_NL || c === C_CR) return true;
  if (c === 0x00a0 || c === 0x1680) return true;
  if (c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f) return true;
  if (c === 0x3000) return true;
  return c >= 0x2000 && c <= 0x200a;
}
// ASCII whitespace only (space/tab/newline/CR): link destinations and
// titles end at these, never at a non-breaking space (which is part of
// the destination and gets percent-encoded)
function isAsciiSpace(c) { return c === C_SPACE || c === C_TAB || c === C_NL || c === C_CR; }
function isDigit(c) { const d = c - 48; return d >= 0 && d <= 9; }
function isAlpha(c) {
  const up = c - 65, lo = c - 97;
  return (up >= 0 && up <= 25) || (lo >= 0 && lo <= 25);
}
function isAlnum(c) { return isAlpha(c) ? true : isDigit(c); }
function isPunct(c) {
  if (c >= 33 && c <= 47) return true;
  if (c >= 58 && c <= 64) return true;
  if (c >= 91 && c <= 96) return true;
  return c >= 123 && c <= 126;
}
const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;
// CommonMark punctuation = Unicode categories P (punctuation) and S (symbol)
function isUnicodePunct(c) {
  if (c < 128) return isPunct(c);
  return UNICODE_PUNCT_RE.test(String.fromCodePoint(c));
}

// ---------- escaping ----------
// Escape & < > " ' for text and attribute values (marked escapes all five).
function esc(s) {
  let buf = '', seg = 0;
  for (let p = 0; p < s.length; p++) {
    const code = s.charCodeAt(p);
    let sub = '';
    switch (code) {
      case 38: sub = '&amp;'; break;
      case 60: sub = '&lt;'; break;
      case 62: sub = '&gt;'; break;
      case 34: sub = '&quot;'; break;
      case 39: sub = '&#39;'; break;
      default: continue;
    }
    buf += s.slice(seg, p) + sub; seg = p + 1;
  }
  return seg === 0 ? s : buf + s.slice(seg);
}
// Escape only & < > (used inside code spans / code blocks).
function escText(s) {
  let buf = '', seg = 0;
  for (let p = 0; p < s.length; p++) {
    const code = s.charCodeAt(p);
    let sub = '';
    switch (code) {
      case 38: sub = '&amp;'; break;
      case 60: sub = '&lt;'; break;
      case 62: sub = '&gt;'; break;
      default: continue;
    }
    buf += s.slice(seg, p) + sub; seg = p + 1;
  }
  return seg === 0 ? s : buf + s.slice(seg);
}
// Escape an href/title attribute value: like esc, but a '&' that starts a
// valid entity reference (&name; &#123; &#xAB;) is kept verbatim.
function escAttr(s) {
  let buf = '', seg = 0;
  for (let p = 0; p < s.length; p++) {
    const code = s.charCodeAt(p);
    let sub = '';
    if (code === 38) {
      const ent = decodeEntity(s, p);
      if (ent) { p += ent.len - 1; continue; }
      sub = '&amp;';
    } else switch (code) {
      case 60: sub = '&lt;'; break;
      case 62: sub = '&gt;'; break;
      case 34: sub = '&quot;'; break;
      case 39: sub = '&#39;'; break;
      default: continue;
    }
    buf += s.slice(seg, p) + sub; seg = p + 1;
  }
  return seg === 0 ? s : buf + s.slice(seg);
}

// ---------- entities ----------
// marked passes named references (&name;) through unchanged and decodes
// numeric references. A reference is valid when:
//   &#digits;             1-7 decimal digits
//   &#x hex; / &#X hex;   1-6 hex digits
//   &word;                [A-Za-z0-9_]+  (no validation against a list)
// Values 0, > 0x10FFFF and surrogates decode to U+FFFD.
function decodeEntity(s, i) {
  // s[i] === '&'. Returns {len, out} or null when not a valid reference.
  const total = s.length;
  let p = i + 1;
  if (p >= total) return null;
  if (s.charCodeAt(p) === 35) {
    p++;
    let isHex = false;
    if (p < total && (s.charCodeAt(p) === 120 || s.charCodeAt(p) === 88)) { isHex = true; p++; }
    const firstDigit = p;
    if (isHex) {
      while (p < total) {
        const d = s.charCodeAt(p);
        const hexDigit = (d >= 48 && d <= 57) || (d >= 97 && d <= 102) || (d >= 65 && d <= 70);
        if (!hexDigit) break;
        p++;
      }
    } else {
      while (p < total && s.charCodeAt(p) >= 48 && s.charCodeAt(p) <= 57) p++;
    }
    const count = p - firstDigit;
    if (count === 0 || (isHex ? count > 6 : count > 7)) return null;
    if (p >= total || s.charCodeAt(p) !== 59) return null;
    const val = parseInt(s.slice(firstDigit, p), isHex ? 16 : 10);
    let decoded;
    if (val === 0 || val > 0x10FFFF || (val >= 0xD800 && val <= 0xDFFF)) decoded = '\uFFFD';
    else decoded = String.fromCodePoint(val);
    return { len: p - i + 1, out: decoded };
  }
  const firstWord = p;
  while (p < total) {
    const d = s.charCodeAt(p);
    const wordChar = (d >= 48 && d <= 57) || (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 95;
    if (!wordChar) break;
    p++;
  }
  if (p === firstWord) return null;
  if (p >= total || s.charCodeAt(p) !== 59) return null;
  return { len: p - i + 1, out: s.slice(i, p + 1) };
}

// ---------- link labels ----------
// Normalize a reference label: collapse whitespace to one space, trim,
// case-fold (Unicode lowercase, with ß/ẞ folding to "ss" as in the
// CommonMark spec's Unicode case folding).
function normLabel(s) {
  const folded = s.split('ß').join('ss').split('ẞ').join('ss');
  return folded.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Percent-encode a URL the way marked does for link destinations.
// Characters marked leaves alone in hrefs stay; everything else (including
// non-ASCII and controls) is percent-encoded.
const HREF_SAFE_CODES = new Set([...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~!$&\'()*+,;=?:/@%#'].map(ch => ch.charCodeAt(0)));
function encodeHref(s) {
  let buf = '', seg = 0;
  for (let p = 0; p < s.length; p++) {
    const code = s.charCodeAt(p);
    if (!HREF_SAFE_CODES.has(code)) {
      buf += s.slice(seg, p) + encodeURIComponent(s[p]);
      seg = p + 1;
    }
  }
  return seg === 0 ? s : buf + s.slice(seg);
}

// ---------- inline parsing ----------
// Node kinds: 0 text, 1 code, 2 raw html, 3 br, 4 delim, 5 bracket,
//             6 em, 7 strong, 8 del, 9 link, 10 image.
function mkNode(kind) { return { k: kind, next: null, prev: null, parent: null }; }

function appendNode(head, tail, node) {
  node.prev = tail;
  if (tail) tail.next = node; else head.v = node;
  tail.v = node;
  return tail;
}

// Flanking info for a delimiter run: prevC/nextC are char codes (-1 = edge).
function flankInfo(prevC, nextC, beforeWs, afterWs) {
  const prevIsPunct = prevC >= 0 && isUnicodePunct(prevC);
  const nextIsPunct = nextC >= 0 && isUnicodePunct(nextC);
  const canOpen = !afterWs && (!nextIsPunct || beforeWs || prevIsPunct);
  const canClose = !beforeWs && (!prevIsPunct || afterWs || nextIsPunct);
  return [canOpen, canClose];
}

// Try to read a <...> autolink or inline HTML starting at src[pos] ('<').
// Returns {len, html} for raw HTML, {len, href, text} for an autolink, or null.
function scanAngle(src, pos) {
  const len = src.length;
  let cur = pos + 1;
  // autolink: scheme:rest  or  email
  if (cur < len) {
    // scheme: 2-32 chars, first alpha, rest alnum + - . _
    let p = cur;
    if (isAlpha(src.charCodeAt(p))) {
      p++;
      while (p < len && (isAlnum(src.charCodeAt(p)) || src.charCodeAt(p) === 43 ||
        src.charCodeAt(p) === 45 || src.charCodeAt(p) === 46)) p++;
      if (p - cur >= 2 && p - cur <= 32 && p < len && src.charCodeAt(p) === 58) {
        // rest until '>' with no space / control / '<'
        let q = p + 1;
        while (q < len) {
          const code = src.charCodeAt(q);
          if (code === 62) {
            const inner = src.slice(pos + 1, q);
            return { kind: 'auto', len: q - pos + 1, href: encodeHref(inner), text: inner };
          }
          if (code === 32 || code === 10 || code === 13 || code === 60 || code < 32) break;
          q++;
        }
      }
    }
    // email: local@domain
    let q = cur;
    let atIdx = -1;
    while (q < len) {
      const code = src.charCodeAt(q);
      if (code === 62) {
        if (atIdx > cur && atIdx < q - 1) {
          const inner = src.slice(pos + 1, q);
          // validate local@domain roughly: no spaces, domain has a dot part
          const user = inner.slice(0, atIdx - cur), host = inner.slice(atIdx - cur + 1);
          if (user.length > 0 && host.length > 0 && host.indexOf('.') >= 0 &&
            /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(user) &&
            /^[A-Za-z0-9.-]+$/.test(host) && !host.startsWith('-') && !host.endsWith('-')) {
            return { kind: 'auto', len: q - pos + 1, href: 'mailto:' + encodeHref(inner), text: inner };
          }
        }
        break;
      }
      if (code === 64) { if (atIdx < 0) atIdx = q; else break; }
      if (code === 32 || code === 10 || code === 13 || code === 60 || code < 32) break;
      q++;
    }
  }
  // inline HTML: comment, PI, declaration, CDATA, open/close tag
  if (src.startsWith('<!--', pos)) {
    // <!--> and <!---> are complete (empty) comments
    if (src.charCodeAt(pos + 4) === 62) return { kind: 'html', len: 5, html: src.slice(pos, pos + 5) };
    if (src.charCodeAt(pos + 4) === 45 && src.charCodeAt(pos + 5) === 62) return { kind: 'html', len: 6, html: src.slice(pos, pos + 6) };
    const end = src.indexOf('-->', pos + 4);
    if (end >= 0) return { kind: 'html', len: end + 3 - pos, html: src.slice(pos, end + 3) };
    return null;
  }
  if (src.startsWith('<?', pos)) {
    const end = src.indexOf('?>', pos + 2);
    if (end >= 0) return { kind: 'html', len: end + 2 - pos, html: src.slice(pos, end + 2) };
    return null;
  }
  if (src.startsWith('<!', pos)) {
    const end = src.indexOf('>', pos + 2);
    if (end >= 0) {
      const inner = src.slice(pos + 2, end);
      if (/^[A-Za-z][A-Za-z0-9-]*(\s[^>]*)?$/.test(inner) || /^\[CDATA\[/.test(inner)) {
        if (/^\[CDATA\[/.test(inner)) {
          const ce = src.indexOf(']]>', pos + 9);
          if (ce >= 0) return { kind: 'html', len: ce + 3 - pos, html: src.slice(pos, ce + 3) };
          return null;
        }
        return { kind: 'html', len: end + 1 - pos, html: src.slice(pos, end + 1) };
      }
    }
    return null;
  }
  // open or close tag: <name ...> or </name>
  let q = cur;
  let isClose = false;
  if (q < len && src.charCodeAt(q) === 47) { isClose = true; q++; }
  if (q >= len || !isAlpha(src.charCodeAt(q))) return null;
  while (q < len && (isAlnum(src.charCodeAt(q)) || src.charCodeAt(q) === 45)) q++;
  // after the tag name only '>', '/' or whitespace may follow (a ':' or
  // '.' directly after the name is not a tag: <m:abc>, <foo.bar.baz>)
  if (q < len) {
    const nxt = src.charCodeAt(q);
    if (!(nxt === 62 || nxt === 47 || nxt === 32 || nxt === 9 || nxt === 10 || nxt === 13)) return null;
  }
  // a closing tag takes no attributes: only whitespace then '>'
  if (isClose) {
    while (q < len && (src.charCodeAt(q) === 32 || src.charCodeAt(q) === 9 || src.charCodeAt(q) === 10 || src.charCodeAt(q) === 13)) q++;
    if (q < len && src.charCodeAt(q) === 62) return { kind: 'html', len: q + 1 - pos, html: src.slice(pos, q + 1) };
    return null;
  }
  // attribute list: each attribute must be separated from the previous
  // one by whitespace (no whitespace => not a tag, e.g. 'bar'title=)
  while (q < len) {
    const code = src.charCodeAt(q);
    if (code === 62) {
      return { kind: 'html', len: q + 1 - pos, html: src.slice(pos, q + 1) };
    }
    if (code === 47 && q + 1 < len && src.charCodeAt(q + 1) === 62) {
      return { kind: 'html', len: q + 2 - pos, html: src.slice(pos, q + 2) };
    }
    if (code === 32 || code === 9 || code === 10 || code === 13) { q++; continue; }
    if (code === 34 || code === 39) {
      const mark = code; q++;
      while (q < len && src.charCodeAt(q) !== mark) q++;
      if (q >= len) return null;
      q++; continue;
    }
    if (code === 61) { q++; continue; }
    // attribute name: the first char must be preceded by whitespace or
    // '=' (a name char directly after a value is invalid, e.g. 'bar'title=);
    // consume the whole name at once.
    if (isAlnum(code) || code === 95 || code === 58 || code === 46 || code === 45) {
      const before = src.charCodeAt(q - 1);
      if (!(before === 32 || before === 9 || before === 10 || before === 13 || before === 61)) return null;
      q++;
      while (q < len && (isAlnum(src.charCodeAt(q)) || src.charCodeAt(q) === 95 || src.charCodeAt(q) === 58 || src.charCodeAt(q) === 46 || src.charCodeAt(q) === 45)) q++;
      continue;
    }
    return null;
  }
  return null;
}

// Extended autolink (GFM): www., scheme://, or email, starting at src[pos].
// prevC is the char before pos (-1 at start). Returns {len, href, text} or null.
function scanExtended(src, pos, prevC, stopAtDD) {
  const len = src.length;
  // must not be preceded by an alphanumeric char (that would make the
  // scheme/www part of a longer word); any other char is fine, including
  // '<', '"', '>', '=', ';', ':', ',', '!', '?', '|', '\\', '/', '.', '-'
  if (prevC >= 0 && isAlnum(prevC)) return null;
  // www.
  if (src.startsWith('www.', pos)) {
    const afterWww = pos + 4;
    const end = scanExtUrl(src, afterWww);
    if (end > afterWww) {
      const inner = src.slice(pos, end);
      return { len: end - pos, href: 'http://' + encodeHref(inner), text: inner };
    }
    return null;
  }
  // mailto: / xmpp: followed by an email address, plus an optional single
  // path segment /[A-Za-z0-9@.]+ (marked's emailProtocol rule)
  if (src.startsWith('mailto:', pos) || src.startsWith('xmpp:', pos)) {
    const schemeLen = src.charCodeAt(pos) === 109 ? 7 : 5; // 'mailto:' / 'xmpp:'
    const mailEnd = scanEmailAt(src, pos + schemeLen, stopAtDD);
    if (mailEnd > pos + schemeLen) {
      let end = mailEnd;
      if (end < len && src.charCodeAt(end) === 47) {
        let q = end + 1;
        while (q < len) {
          const code = src.charCodeAt(q);
          if (isAlnum(code) || code === 64 || code === 46) q++;
          else break;
        }
        if (q > end + 1) end = q;
      }
      const inner = src.slice(pos, end);
      return { len: end - pos, href: encodeHref(inner), text: inner };
    }
    return null;
  }
  // scheme://
  if (isAlpha(src.charCodeAt(pos))) {
    let q = pos;
    while (q < len && isAlnum(src.charCodeAt(q))) q++;
    if (q - pos >= 2 && q - pos <= 32 && src.startsWith('://', q)) {
      const end = scanExtUrl(src, q + 3);
      if (end > q + 3) {
        const inner = src.slice(pos, end);
        return { len: end - pos, href: encodeHref(inner), text: inner };
      }
    }
  }
  // email: local@domain.tld
  const mailEnd = scanEmailAt(src, pos, stopAtDD);
  if (mailEnd > pos) {
    const inner = src.slice(pos, mailEnd);
    return { len: mailEnd - pos, href: 'mailto:' + encodeHref(inner), text: inner };
  }
  return null;
}

// Scan an email address starting at src[pos]; return the end index, or pos if
// none. Local part: [A-Za-z0-9._+-]+ ; domain: labels joined by '.', at
// least one dot, and every label after the first must end with an
// alphanumeric char (a domain ending in '-' or '_' is not an email).
// Scan an email address starting at pos (the local part). Returns the index
// just past the email, or pos if there is none. Mirrors marked's email regex
// [A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-]):
// the domain is the LONGEST valid run of labels ending in an alphanumeric
// char such that the following char is not a word char or '-'. When the
// longest domain fails the lookahead, backtrack to a shorter label prefix
// (e.g. foo@bar.baz__ -> foo@bar.baz is NOT a link, but
// foo@a.b.c__ -> foo@a.b links and .c__ is text).
// stopAtDD: when true, a '__' run is an emphasis delimiter boundary, not
// part of the domain (the email ends right before it).
function scanEmailAt(src, pos, stopAtDD) {
  const len = src.length;
  let cur = pos;
  let atIdx = -1;
  while (cur < len) {
    const code = src.charCodeAt(cur);
    if (stopAtDD && code === 95 && cur + 1 < len && src.charCodeAt(cur + 1) === 95) break;
    // a single '_' is an emphasis-delimiter boundary (not part of the
    // domain) when an '_' delimiter is open and the '_' cannot continue
    // a label (next char is not alnum or '_')
    if (stopAtDD && code === 95) {
      const nxt = cur + 1 < len ? src.charCodeAt(cur + 1) : -1;
      if (!(isAlnum(nxt) || nxt === 95)) break;
    }
    if (isAlnum(code) || code === 46 || code === 95 || code === 45 || code === 43) { cur++; continue; }
    if (code === 64) { if (atIdx < 0) { atIdx = cur; cur++; continue; } break; }
    break;
  }
  if (atIdx <= pos) return pos;
  // label end positions in the domain src[atIdx+1..cur)
  const labelEnds = [];
  let p = atIdx + 1;
  while (p < cur) {
    let q = p;
    while (q < cur && src.charCodeAt(q) !== 46) q++;
    labelEnds.push(q);
    p = q + 1;
  }
  // try the longest domain first, backtracking to shorter label prefixes
  for (let li = labelEnds.length - 1; li >= 1; li--) {
    const endPos = labelEnds[li];
    if (endPos <= atIdx + 1) continue;
    if (!isAlnum(src.charCodeAt(endPos - 1))) continue;
    let valid = true;
    let start = atIdx + 1;
    for (let k = 0; k <= li; k++) {
      const le = labelEnds[k];
      if (le <= start) { valid = false; break; }
      for (let m = start; m < le; m++) {
        const cc = src.charCodeAt(m);
        if (!(isAlnum(cc) || cc === 95 || cc === 45)) { valid = false; break; }
      }
      if (!valid) break;
      start = le + 1;
    }
    if (!valid) continue;
    // lookahead: the char after the domain must not be a word char or '-';
    // a '__' delimiter boundary (stopAtDD) counts as a valid boundary,
    // as does a single '_' closing an open emphasis delimiter
    if (endPos < len) {
      const nxt = src.charCodeAt(endPos);
      if (stopAtDD && nxt === 95 && endPos + 1 < len && src.charCodeAt(endPos + 1) === 95) {
        return endPos;
      }
      if (stopAtDD && nxt === 95) {
        const nxt2 = endPos + 1 < len ? src.charCodeAt(endPos + 1) : -1;
        if (!(isAlnum(nxt2) || nxt2 === 95)) return endPos;
      }
      if (isAlnum(nxt) || nxt === 95 || nxt === 45) continue;
    }
    return endPos;
  }
  return pos;
}

// Scan the tail of an extended URL (after www. or scheme://). Handles
// trailing punctuation and balanced parens the way GFM does.
function scanExtUrl(src, pos) {
  const len = src.length;
  let cur = pos, depth = 0;
  while (cur < len) {
    const code = src.charCodeAt(cur);
    if (code === 32 || code === 10 || code === 13 || code === 60 || code === 34 || code === 39) break;
    // an & starting an entity reference (&name; / &#123; / &#x1F;) ends
    // the autolink before the & (gfm-627)
    if (code === 38) {
      let q = cur + 1;
      if (q < len && src.charCodeAt(q) === 35) {
        q++;
        if (q < len && (src.charCodeAt(q) === 120 || src.charCodeAt(q) === 88)) q++;
        const firstDigit = q;
        while (q < len && isAlnum(src.charCodeAt(q))) q++;
        if (q > firstDigit && q < len && src.charCodeAt(q) === 59) break;
      } else {
        const firstDigit = q;
        while (q < len && isAlnum(src.charCodeAt(q))) q++;
        if (q > firstDigit && q < len && src.charCodeAt(q) === 59) break;
      }
    }
    // '(' only starts a group if a matching ')' follows before the URL
    // ends (marked's _backpedal \([^)]*\) ); an unclosed '(' ends the URL
    if (code === 40) {
      let q = cur + 1;
      while (q < len) {
        const cc = src.charCodeAt(q);
        if (cc === 41) break;
        if (cc === 32 || cc === 10 || cc === 13 || cc === 60 || cc === 34 || cc === 39) { q = -1; break; }
        q++;
      }
      if (q < 0 || q >= len) break;
      depth++; cur++; continue;
    }
    // an unbalanced ) is only excluded when trailing; if more URL
    // follows it is part of the URL (gfm-626). '[' and ']' are part of
    // the URL too (marked's url rule is [^\s<]*, so a trailing ] is
    // included: https://example.com] links with href ...%5D).
    // paren never goes below 0: a ')' with no open group is unbalanced
    // (it stays in the URL) but does not make the depth negative, so a
    // later balanced ')' is not trimmed by mistake.
    if (code === 41) { if (depth > 0) depth--; cur++; continue; }
    cur++;
  }
  // trim trailing punctuation . , ; : ! ? and * _ ~ and trailing
  // unbalanced ) ; trimming one can expose the other, so loop until stable.
  // A trailing ')' is balanced (kept) when an open '(' precedes it in the
  // URL; recompute the depth before it to decide.
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    while (cur > pos) {
      const code = src.charCodeAt(cur - 1);
      if (code === 46 || code === 44 || code === 59 || code === 58 || code === 33 || code === 63 ||
        code === 42 || code === 95 || code === 126) { cur--; trimmed = true; }
      else break;
    }
    while (cur > pos && src.charCodeAt(cur - 1) === 41) {
      let inner = 0;
      for (let k = pos; k < cur - 1; k++) {
        const cc = src.charCodeAt(k);
        if (cc === 40) inner++;
        else if (cc === 41 && inner > 0) inner--;
      }
      if (inner > 0) break; // this ')' closes a group; keep it
      cur--; trimmed = true;
    }
  }
  return cur;
}

// marked's link-label pattern (inline `link`/`reflink` rules), with the
// `brackets` (Le) placeholder inlined. Applied sticky at '[' it matches
// `[label]`; the match length gives the closing ']'. Using the regex
// itself (instead of a manual scan) preserves its backtracking: a loose
// code span is tried first, but if the overall match fails the engine
// falls back to `` ``+(?=\]) ``, so a label like [less `` a ` b ``]
// still ends at the first ']'.
const LABEL_FULL = /\[(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?\]/y;

// marked 18.1.3 inline-masking regexes (verbatim from its tokenizer
// rules: blockSkip and anyPunctuationOutsideCode). The masked src is
// used for the emStrong/del last-possible-closer search: backticks
// inside code spans are normalised to '+', then [label](...) links,
// code spans and HTML tags are replaced by same-length '[aaa...]'
// masks, so delimiters inside them cannot close an emphasis run.
// Length is preserved, so masked indices are the original indices.
const ANY_PUNCT_OUTSIDE_CODE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const BLOCK_SKIP = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;

function maskedInlineSrc(text) {
  let masked = text.replace(ANY_PUNCT_OUTSIDE_CODE, (whole, span, punct) => punct ? '+'.repeat(whole.length) : span ? span + whole.slice(span.length, -span.length).replace(/`/g, '+') + span : whole);
  masked = masked.replace(BLOCK_SKIP, (whole, span, codeSpan) => {
    const prefix = codeSpan ? codeSpan.length : 0;
    return whole.slice(0, prefix) + '[' + 'a'.repeat(whole.length - prefix - 2) + ']';
  });
  return masked;
}

// marked's fe(): for each delimiter, the index of the last run whose
// preceding char is not whitespace, in the masked src.
function lastCloserIdx(masked) {
  const last = { '*': -1, '_': -1, '~': -1 };
  const total = masked.length;
  for (let p = 0; p < total; p++) {
    const run = masked[p];
    if (run !== '*' && run !== '_' && run !== '~') continue;
    const prev = p === 0 ? '\n' : masked[p - 1];
    let q = p + 1;
    while (q < total && masked[q] === run) q++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') last[run] = p;
    p = q - 1;
  }
  return last;
}

// Match marked's link-label pattern starting at text[i] ('[').
// Returns the index of the closing ']' or -1 if the label cannot be
// consumed (e.g. a lone backtick that cannot form a loose code span
// and is not 2+ backticks before ']').
function matchLabelEnd(text, i) {
  LABEL_FULL.lastIndex = i;
  const m = LABEL_FULL.exec(text);
  if (!m) return -1;
  return i + m[0].length - 1;
}

// ---------- inline scanner ----------
// Builds a linked list of inline nodes for one text run and returns its root
// ({k:-1, f, l}). `refs` maps normalized labels to {href, title}.
function scanInline(text, refs) {
  const root = { k: -1, f: null, l: null, next: null, prev: null, parent: null };
  const delims = [];
  const brackets = [];
  const n = text.length;
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf !== '') {
      const nd = mkNode(0); nd.s = buf; buf = '';
      linkChild(root, nd);
    }
  };
  const pushDelim = (ch, len, open, close, prevC, nextC, pos) => {
    flush();
    const nd = mkNode(4); nd.ch = ch; nd.n = len; nd.open = open; nd.close = close;
    nd.prevC = prevC; nd.nextC = nextC; nd.o = false; nd.pos = pos;
    linkChild(root, nd);
    delims.push(nd);
    return nd;
  };
  const inLinkText = () => {
    for (let b = 0; b < brackets.length; b++) if (brackets[b].active) return true;
    return false;
  };
  // True if any currently-open bracket would actually form a link (or
  // image) at its closing ']'. Marked only suppresses an extended
  // autolink inside a link that really forms; a bracket whose label is
  // invalid or whose reference is undefined leaves the autolink alone
  // (e.g. [must render other https://cdn.example.net. because][3]
  // with no [3] definition still autolinks the URL).
  const linkTextWillForm = () => {
    for (let b = brackets.length - 1; b >= 0; b--) {
      const br = brackets[b];
      if (!br.active || br.labelEnd < 0) continue;
      if (tryLink(text, br.labelEnd, br, refs)) return true;
    }
    return false;
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    // ---- backslash ----
    if (c === C_BSLASH) {
      if (i + 1 < n) {
        const d = text.charCodeAt(i + 1);
        if (d === C_NL) {
          flush(); const nd = mkNode(3); linkChild(root, nd); i += 2;
          // after a hard break, skip the next line's leading spaces/tabs
          while (i < n && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
          continue;
        }
        if (isPunct(d)) { buf += text[i + 1]; i += 2; continue; }
      }
      buf += '\\'; i++; continue;
    }
    // ---- code span ----
    if (c === C_BT) {
      let j = i;
      while (j < n && text.charCodeAt(j) === C_BT) j++;
      const run = j - i;
      // find a matching run of the same length; a code span inside a
      // link label may not reach past the label's closing ']' (marked
      // matches the label first, so a backtick in a label can only
      // close within the label)
      let limit = n;
      for (let b = brackets.length - 1; b >= 0; b--) {
        const br2 = brackets[b];
        if (br2.active && br2.labelEnd >= 0) { limit = br2.labelEnd; break; }
      }
      let k = j, found = -1;
      while (k < limit) {
        if (text.charCodeAt(k) === C_BT) {
          let m = k;
          while (m < n && text.charCodeAt(m) === C_BT) m++;
          if (m - k === run) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found < 0) { buf += text.slice(i, j); i = j; continue; }
      let content = text.slice(j, found).replace(/\r\n?|\n/g, ' ');
      if (content.length >= 2 && content.charCodeAt(0) === 32 &&
        content.charCodeAt(content.length - 1) === 32 && !/^\s+$/.test(content)) {
        content = content.slice(1, -1);
      }
      flush();
      const nd = mkNode(1); nd.s = content; linkChild(root, nd);
      i = found + run;
      continue;
    }
    // ---- emphasis / strikethrough delimiters ----
    if (c === C_STAR || c === C_US || c === C_TILDE) {
      const ch = String.fromCharCode(c);
      let j = i;
      while (j < n && text.charCodeAt(j) === c) j++;
      const len = j - i;
      const prevC = i > 0 ? text.charCodeAt(i - 1) : -1;
      const nextC = j < n ? text.charCodeAt(j) : -1;
      const beforeWs = prevC < 0 || isSpace(prevC);
      const afterWs = nextC < 0 || isSpace(nextC);
      const fl = flankInfo(prevC, nextC, beforeWs, afterWs);
      let open, close;
      if (ch === '_') {
        open = fl[0] && (!fl[1] || (prevC >= 0 && isUnicodePunct(prevC)));
        close = fl[1] && (!fl[0] || (nextC >= 0 && isUnicodePunct(nextC)));
      } else {
        open = fl[0]; close = fl[1];
      }
      pushDelim(ch, len, open, close, prevC, nextC, i);
      i = j;
      continue;
    }
    // ---- brackets ----
    if (c === C_LBRK) {
      flush();
      const nd = mkNode(5); nd.s = '['; nd.img = false; linkChild(root, nd);
      brackets.push({ node: nd, img: false, active: true, start: i + 1, labelEnd: matchLabelEnd(text, i) });
      i++;
      continue;
    }
    if (c === C_BANG && i + 1 < n && text.charCodeAt(i + 1) === C_LBRK) {
      flush();
      const nd = mkNode(5); nd.s = '!['; nd.img = true; linkChild(root, nd);
      brackets.push({ node: nd, img: true, active: true, start: i + 2, labelEnd: matchLabelEnd(text, i + 1) });
      i += 2;
      continue;
    }
    if (c === C_RBRK) {
      // try to form a link from the nearest bracket. A dead (inactive)
      // bracket still "consumes" the ]: pop it and treat ] as literal,
      // so an outer bracket is only tried by a later ].
      if (brackets.length > 0) {
        const br = brackets[brackets.length - 1];
        if (!br.active) { brackets.pop(); buf += ']'; i++; continue; }
        const res = tryLink(text, i, br, refs);
        if (res) {
          // deactivate this bracket and any brackets inside its text
          brackets.length = brackets.length - 1;
          // a link's text may not contain another link: deactivate all
          // still-open (outer) brackets. Images may live inside links,
          // so forming an image does not deactivate anything.
          if (!br.img) for (let b = 0; b < brackets.length; b++) if (!brackets[b].img) brackets[b].active = false;
          flush();
          const link = makeLinkNode(br, root, res);
          i = res.end;
          continue;
        }
        // no link: this bracket can never form one (marked's behaviour)
        brackets.pop();
      }
      buf += ']'; i++;
      continue;
    }
    // ---- angle autolink / inline HTML ----
    if (c === C_LT) {
      const a = scanAngle(text, i);
      if (a) {
        flush();
        if (a.kind === 'auto') {
          const nd = mkNode(9);
          nd.href = a.href; nd.title = null;
          const tnd = mkNode(0); tnd.s = a.text;
          nd.f = tnd; nd.l = tnd; tnd.parent = nd;
          linkChild(root, nd);
        } else {
          // raw inline HTML: track marked's lexer "inLink" state exactly.
          // startATag /^<a /i sets it, endATag /^<\/a>/i clears it. The
          // start test needs a literal SPACE after 'a', so <a> and <a/>
          // do NOT set it, but <a  /> DOES (even though self-closing) and
          // then never clears, suppressing later extended autolinks
          // document-wide. The end test needs '>' right after 'a'.
          const h = a.html;
          if (h.length >= 3 && h.charCodeAt(0) === 60 && (h.charCodeAt(1) === 97 || h.charCodeAt(1) === 65) && h.charCodeAt(2) === 32) {
            refs.__inRawA = true;
          } else if (h.length >= 4 && h.charCodeAt(0) === 60 && h.charCodeAt(1) === 47 && (h.charCodeAt(2) === 97 || h.charCodeAt(2) === 65) && h.charCodeAt(3) === 62) {
            refs.__inRawA = false;
          }
          const nd = mkNode(2); nd.s = a.html; linkChild(root, nd);
        }
        i += a.len;
        continue;
      }
      buf += '<'; i++;
      continue;
    }
    // ---- entity ----
    if (c === C_AMP) {
      const e = decodeEntity(text, i);
      if (e) {
        if (text.charCodeAt(i + 1) === 35) {
          // numeric reference: the decoded char is plain text, so it
          // gets escaped on render (e.g. &#X22; -> " -> &quot;)
          buf += e.out;
        } else {
          // named reference: kept verbatim as raw HTML (e.g. &ouml;)
          flush();
          const nd = mkNode(2); nd.s = e.out; linkChild(root, nd);
        }
        i += e.len;
        continue;
      }
      buf += '&'; i++;
      continue;
    }
    // ---- newline: hard or soft break ----
    if (c === C_NL) {
      // count trailing spaces in buf
      let sp = 0;
      while (sp < buf.length && buf.charCodeAt(buf.length - 1 - sp) === 32) sp++;
      if (sp >= 2) {
        buf = buf.slice(0, buf.length - sp);
        flush();
        const nd = mkNode(3); linkChild(root, nd);
        i++;
        // after a hard break, skip the next line's leading spaces/tabs
        while (i < n && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
      } else {
        buf += '\n';
        i++;
      }
      continue;
    }
    // ---- extended autolinks (not inside a link that really forms, not inside a raw <a>) ----
    if (!refs.__inRawA && (!inLinkText() || !linkTextWillForm())) {
      const prevC = i > 0 ? text.charCodeAt(i - 1) : -1;
      let stopAtDD = false;
      for (let d = 0; d < delims.length; d++) {
        if (delims[d].ch === '_' && delims[d].open) { stopAtDD = true; break; }
      }
      const ex = scanExtended(text, i, prevC, stopAtDD);
      if (ex) {
        flush();
        const nd = mkNode(9);
        nd.href = ex.href; nd.title = null;
        const tnd = mkNode(0); tnd.s = ex.text;
        nd.f = tnd; nd.l = tnd; tnd.parent = nd;
        linkChild(root, nd);
        i += ex.len;
        continue;
      }
    }
    // ---- plain char ----
    buf += text[i];
    i++;
  }
  flush();
  // marked's emStrong/del closer search runs on the masked src: a
  // delimiter hidden inside a [label](...) / code span / HTML tag
  // cannot close an emphasis run. Only compute it when there are
  // delimiters to resolve.
  let masked = null, feIdx = null;
  if (delims.length > 0) {
    masked = maskedInlineSrc(text);
    feIdx = lastCloserIdx(masked);
  }
  processEmphasis(root, delims, masked, feIdx);
  return root;
}

// Append child node to a parent's child list.
function linkChild(parent, nd) {
  nd.parent = parent;
  nd.prev = parent.l;
  nd.next = null;
  if (parent.l) parent.l.next = nd; else parent.f = nd;
  parent.l = nd;
}

// Build a link/image node from a resolved bracket: children are the nodes
// between the bracket node and the end of the parent's child list.
function makeLinkNode(br, root, res) {
  const bnode = br.node;
  // collect children: bnode.next ... root.l
  const first = bnode.next;
  const last = root.l;
  const nd = mkNode(br.img ? 10 : 9);
  nd.href = res.href; nd.title = res.title;
  if (first) {
    nd.f = first; nd.l = last;
    first.prev = null;
    last.next = null;
    let c = first;
    while (c) { c.parent = nd; if (c === last) break; c = c.next; }
  } else { nd.f = null; nd.l = null; }
  // replace bnode in root's list with nd; drop everything after bnode
  const prev = bnode.prev;
  nd.prev = prev; nd.next = null; nd.parent = root;
  if (prev) prev.next = nd; else root.f = nd;
  root.l = nd;
  if (br.img) {
    // alt text: plain text of the children
    nd.alt = plainText(nd);
  }
  return nd;
}

// Plain text of a node's children (for image alt text).
function plainText(nd) {
  let out = '';
  for (let c = nd.f; c; c = c.next) {
    if (c.k === 0) out += c.s;
    else if (c.k === 1) out += c.s;
    else if (c.k === 2) out += c.s;
    else if (c.k === 5) out += c.s;
    else if (c.k === 6 || c.k === 7 || c.k === 8 || c.k === 9) out += plainText(c);
    else if (c.k === 10) out += c.alt || '';
    // delimiters (k=4) and br (k=3) contribute nothing
  }
  return out;
}

// ---------- link destination / title cleaning ----------
// Process backslash escapes and entity references in a destination or title,
// then percent-encode (destinations only).
function cleanRaw(s) {
  let out = '', i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === C_BSLASH && i + 1 < n && isPunct(s.charCodeAt(i + 1))) {
      out += s[i + 1]; i += 2; continue;
    }
    if (c === C_AMP) {
      const e = decodeEntity(s, i);
      if (e) { out += e.out; i += e.len; continue; }
    }
    out += s[i]; i++;
  }
  return out;
}
function cleanDest(raw) { return encodeHref(cleanRaw(raw)); }
function cleanTitle(raw) { return cleanRaw(raw); }

// Parse a link tail starting just after ']' (text[closePos] === ']').
// `br` is the bracket entry. Returns {href, title, end} or null.
function tryLink(text, closePos, br, refs) {
  // the label must be consumable by marked's label regex and this ']'
  // must be its closer (a lone backtick that cannot form a loose code
  // span kills the label, so no link forms); otherwise this ']' is
  // inside the label or the label is invalid
  if (br.labelEnd !== closePos) return null;
  const n = text.length;
  const linkText = text.slice(br.start, closePos);
  let i = closePos + 1;
  if (i < n && text.charCodeAt(i) === C_LPAR) {
    // inline link; if it fails, fall through to reference links (cm-568)
  inlineLink: {
    let j = i + 1;
    while (j < n && isAsciiSpace(text.charCodeAt(j))) j++;
    if (j >= n) break inlineLink;;
    let dest = null, k;
    if (text.charCodeAt(j) === C_LT) {
      // angle destination: no newline, no unescaped '<'
      k = j + 1;
      let ok = false;
      while (k < n) {
        const c = text.charCodeAt(k);
        if (c === C_GT) { ok = true; break; }
        if (c === C_NL || c === C_CR || c === C_LT) break;
        if (c === C_BSLASH && k + 1 < n && isPunct(text.charCodeAt(k + 1))) { k += 2; continue; }
        k++;
      }
      if (!ok) break inlineLink;;
      dest = text.slice(j + 1, k);
      k++;
    } else {
      // bare destination: balanced parens, ends at space or closing paren
      let depth = 0;
      k = j;
      while (k < n) {
        const c = text.charCodeAt(k);
        if (c === C_BSLASH && k + 1 < n && isPunct(text.charCodeAt(k + 1))) { k += 2; continue; }
        if (c === C_LPAR) { depth++; k++; continue; }
        if (c === C_RPAR) {
          if (depth === 0) break;
          depth--; k++; continue;
        }
        if (isAsciiSpace(c)) break;
        k++;
      }
      if (k >= n) break inlineLink;;
      dest = text.slice(j, k);
    }
    // after destination: optional whitespace, optional title, then ')'
    while (k < n && isAsciiSpace(text.charCodeAt(k))) k++;
    if (k < n && text.charCodeAt(k) === C_RPAR) {
      return { href: cleanDest(dest), title: null, end: k + 1 };
    }
    if (k >= n) break inlineLink;;
    const qc = text.charCodeAt(k);
    let title = null, m;
    if (qc === C_QUOT || qc === C_SQ) {
      m = k + 1;
      let ok = false;
      while (m < n) {
        const c = text.charCodeAt(m);
        if (c === C_BSLASH && m + 1 < n && (text.charCodeAt(m + 1) === qc || text.charCodeAt(m + 1) === C_BSLASH)) { m += 2; continue; }
        if (c === qc) { ok = true; break; }
        m++;
      }
      if (!ok) break inlineLink;;
      title = text.slice(k + 1, m);
      m++;
    } else if (qc === C_LPAR) {
      let depth = 1;
      m = k + 1;
      let ok = false;
      while (m < n) {
        const c = text.charCodeAt(m);
        if (c === C_BSLASH && m + 1 < n && isPunct(text.charCodeAt(m + 1))) { m += 2; continue; }
        if (c === C_LPAR) { depth++; m++; continue; }
        if (c === C_RPAR) {
          depth--;
          if (depth === 0) { ok = true; break; }
          m++; continue;
        }
        m++;
      }
      if (!ok) break inlineLink;;
      title = text.slice(k + 1, m);
      m++;
    } else {
      break inlineLink;;
    }
    while (m < n && isAsciiSpace(text.charCodeAt(m))) m++;
    if (m < n && text.charCodeAt(m) === C_RPAR) {
      return { href: cleanDest(dest), title: cleanTitle(title), end: m + 1 };
    }
    break inlineLink;
  }
  }
  if (i < n && text.charCodeAt(i) === C_LBRK) {
    // full or collapsed reference: [label] (scanBracketLabel handles
    // escaped brackets inside the label)
    const lab = scanBracketLabel(text, i);
    if (!lab) return null;
    const labelEnd = lab.end - 1;
    let label = lab.raw;
    if (label === '') label = linkText;
    const ref = refs.get(normLabel(label));
    if (!ref) return null;
    return { href: ref.href, title: ref.title, end: labelEnd + 1 };
  }
  // shortcut reference
  const ref = refs.get(normLabel(linkText));
  if (!ref) return null;
  return { href: ref.href, title: ref.title, end: closePos + 1 };
}

// ---------- emphasis ----------
// Wrap the nodes between opener and closer into an em/strong/del node.
// opener/closer are delimiter nodes, siblings under the same parent.
// Their .n has already been reduced by `use`.
function wrapEmphasis(opener, closer, kind) {
  const P = opener.parent;
  const W = mkNode(kind);
  const first = opener.next, last = closer.prev;
  W.f = first === closer ? null : first;
  W.l = last === opener ? null : last;
  W.parent = P;
  // detach children into W and set their parent
  let c = first;
  while (c && c !== closer) { c.parent = W; c = c.next; }
  if (first && first !== closer) first.prev = null;
  if (last && last !== opener) last.next = null;
  // rebuild P's list segment: [opener?] + W + [closer?]
  const before = opener.prev, after = closer.next;
  let prev = before;
  const seq = [];
  if (opener.n > 0) seq.push(opener);
  seq.push(W);
  if (closer.n > 0) seq.push(closer);
  for (const nd of seq) {
    nd.prev = prev; nd.next = null; nd.parent = P;
    if (prev) prev.next = nd;
    prev = nd;
  }
  if (after) after.prev = prev;
  if (prev) prev.next = after;
  if (!before) P.f = seq[0];
  if (!after) P.l = seq[seq.length - 1];
  return W;
}

// Wrap the nodes between opener and closer into an em/strong/del node,
// putting any LEFTOVER delimiter counts INSIDE the new node (as its first
// / last children) — marked's raw for an em/strong token includes the
// whole delimiter runs and only strips 1 (em) or 2 (strong) chars from
// each end, so leftovers belong to the inner text and are re-resolved
// there. opener/closer .n have already been reduced by `use`.
function wrapEmphasisIn(opener, closer, kind) {
  const P = opener.parent;
  const W = mkNode(kind);
  W.parent = P;
  const first = opener.next, last = closer.prev;
  // capture the neighbours BEFORE addChild rewires opener/closer
  const before = opener.prev, after = closer.next;
  let prev = null;
  const addChild = (nd) => {
    nd.parent = W; nd.prev = prev; nd.next = null;
    if (prev) prev.next = nd; else W.f = nd;
    prev = nd;
  };
  if (opener.n > 0) addChild(opener);
  let c = first;
  while (c && c !== closer) { const nx = c.next; addChild(c); c = nx; }
  if (closer.n > 0) addChild(closer);
  W.l = prev;
  W.prev = before; W.next = after;
  if (before) before.next = W; else P.f = W;
  if (after) after.prev = W; else P.l = W;
  return W;
}

// Build a fresh delimiter node for a split-off run tail (the part of a
// closer run that falls outside an em/strong raw). Flags are computed
// from its new flanking context: its preceding char is the same
// delimiter (it is a run tail), its following char is nextC.
function makeSplitDelim(ch, n, nextC, pos) {
  const prevC = ch.charCodeAt(0);
  const beforeWs = isSpace(prevC);
  const afterWs = nextC < 0 || isSpace(nextC);
  const fl = flankInfo(prevC, nextC, beforeWs, afterWs);
  let open, close;
  if (ch === '_') {
    open = fl[0] && (!fl[1] || (prevC >= 0 && isUnicodePunct(prevC)));
    close = fl[1] && (!fl[0] || (nextC >= 0 && isUnicodePunct(nextC)));
  } else {
    open = fl[0]; close = fl[1];
  }
  const nd = mkNode(4); nd.ch = ch; nd.n = n; nd.open = open; nd.close = close;
  nd.prevC = prevC; nd.nextC = nextC; nd.o = true; nd.pos = pos;
  return nd;
}

// marked's emStrong "right delimiter is punct" flag for an opener: the
// odd-match rule then also applies to close-only candidates.
function emStrongR(opener) {
  const prevC = opener.prevC, nextC = opener.nextC;
  if (prevC < 0 || isSpace(prevC)) return false;
  const nextIsPunct = nextC >= 0 && isUnicodePunct(nextC);
  const prevIsDelimOrPunct = prevC === 42 || prevC === 95 || isUnicodePunct(prevC);
  return nextIsPunct || (opener.ch === '*' && !prevIsDelimOrPunct);
}

// Split one literal delimiter off the front of a run: insert a text
// node with that char before nd, shrink nd by 1. The remaining run is
// now a tail (its preceding char is the same delimiter).
function peelOneDelim(nd) {
  const t = mkNode(0); t.s = nd.ch;
  const P = nd.parent;
  t.parent = P; t.prev = nd.prev; t.next = nd;
  if (nd.prev) nd.prev.next = t; else P.f = t;
  nd.prev = t;
  nd.n -= 1;
  nd.pos += 1;
  nd.o = true;
  nd.prevC = nd.ch.charCodeAt(0);
}

// marked's RDelim first alternative (emStrongRDelimAst/Und): a `*`
// inside a `__...__` span (or a `_` inside a `**...**` span) is
// skipped when scanning for a closer — it is not counted as an opener
// or a closer. The regex is anchored at the slice start (just after
// the opener), so the candidate is skipped iff the first three
// delimiter runs after the opener are exactly: och-run(>=2),
// candidate ch-run, och-run(>=2) — the candidate is the ONLY
// delimiter between the opening and closing opposite strong markers.
function isOppositeStrongSkip(masked, openerEnd, pos, ch) {
  const och = ch === '*' ? '_' : '*';
  const n = masked.length;
  const runs = [];
  let i = openerEnd;
  while (i < n && runs.length < 3) {
    while (i < n && masked[i] !== '*' && masked[i] !== '_') i++;
    if (i >= n) break;
    const c = masked[i];
    let j = i;
    while (j < n && masked[j] === c) j++;
    runs.push({ ch: c, start: i, len: j - i });
    i = j;
  }
  if (runs.length < 3) return false;
  return runs[0].ch === och && runs[0].len >= 2 &&
         runs[1].ch === ch && runs[1].start === pos &&
         runs[2].ch === och && runs[2].len >= 2;
}

// True if nd sits inside a formed link/image label: marked tokenizes
// a formed link's label in its own inline pass (its own masked src),
// so the paragraph-level masking does not apply to it.
function inFormedLink(nd) {
  let p = nd.parent;
  while (p) {
    if (p.k === 9 || p.k === 10) return true;
    p = p.parent;
  }
  return false;
}

function processEmphasis(root, delims, masked, feIdx) {
  // Marked-style, opener-driven emphasis resolution (replaces the
  // reference-algorithm closer-driven pass): the leftmost opener claims
  // the first closer that covers its run (m/f accounting + odd-match
  // rule), and the inner text is then re-resolved inside the new node.
  // This matches marked 18.1.3 where the reference algorithm diverges
  // (nested runs like **a *b*c d**, ***a***, **a *b* c**).
  // `masked`/`feIdx` are marked's masked-src last-possible-closer
  // bound: a closer hidden inside a [label](...) / code span / HTML
  // tag (masked out) or beyond the last visible closer cannot close.
  // Delimiters inside a formed link's label are exempt (separate pass).
  for (let di = 0; di < delims.length; di++) {
    const opener = delims[di];
    if (!opener.open || opener.n === 0) continue;
    const ch = opener.ch;
    const inLink = masked ? inFormedLink(opener) : false;
    if (ch === '~') {
      // marked del: opener and closer must have the SAME length (1 or 2)
      if (opener.n > 2) continue;
      const o = opener.n;
      let p = o;
      for (let ci = di + 1; ci < delims.length; ci++) {
        const closer = delims[ci];
        if (closer.ch !== '~' || closer.n === 0 || closer.n !== o) continue;
        if (closer.parent !== opener.parent) continue;
        if (!inLink) {
          if (closer.pos > feIdx['~']) break;
          if (masked[closer.pos] !== '~') continue;
        }
        if (closer.open && !closer.close) { p += o; continue; }
        if (!closer.close) continue;
        p -= o;
        if (p > 0) continue;
        opener.n -= o; closer.n -= o;
        wrapEmphasisIn(opener, closer, 8);
        break;
      }
      continue;
    }
    // * and _ : marked emStrong scan. If the scan finds no closer, peel
    // one literal delimiter off the front of the run and retry (marked
    // re-tokenizes one char later after a failed emStrong attempt, e.g.
    // **foo* -> *<em>foo</em>).
    let wrapped = false;
    while (opener.n > 0 && !wrapped) {
      const k = opener.n;
      let m = k, f = 0;
      const y = k;
      const R = emStrongR(opener);
      const o = !!opener.o;
      for (let ci = di + 1; ci < delims.length; ci++) {
        const closer = delims[ci];
        if (closer.ch !== ch || closer.n === 0) continue;
        if (closer.parent !== opener.parent) continue;
        if (!inLink) {
          if (closer.pos > feIdx[ch]) break;
          if (masked[closer.pos] !== ch) continue;
          if (isOppositeStrongSkip(masked, opener.pos + opener.n, closer.pos, ch)) continue;
        }
        const b = closer.n;
        if (closer.open && !closer.close) {
          // opening run found while scanning: adds to the count
          m += b;
          continue;
        }
        if (!closer.close) continue;
        const both = closer.open && closer.close;
        if (both || R) {
          if (o && both) break; // no match
          // odd match: skip this closer
          if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; continue; }
        }
        m -= b;
        if (m > 0) continue;
        const use = Math.min(b, b + m + f);
        if (use <= 0) continue;
        const kind = (Math.min(k, use) % 2 === 1) ? 6 : 7;
        const consumed = kind === 6 ? 1 : 2;
        // marked's raw holds `use` closer delimiters; of those, only
        // `consumed` are stripped by slice(1,-1)/slice(2,-2) — the rest
        // stay inside the em/strong text. The closer run's tail beyond
        // `use` falls outside the raw entirely.
        const insideCloser = use - consumed;
        const outsideCloser = b - use;
        opener.n = k - consumed;
        closer.n = insideCloser;
        const W = wrapEmphasisIn(opener, closer, kind);
        if (outsideCloser > 0) {
          const tail = makeSplitDelim(ch, outsideCloser, closer.nextC, closer.pos + use);
          const P = W.parent;
          tail.parent = P; tail.prev = W; tail.next = W.next;
          if (W.next) W.next.prev = tail; else P.l = tail;
          W.next = tail;
          delims.splice(ci + 1, 0, tail);
        }
        wrapped = true;
        break;
      }
      if (!wrapped) peelOneDelim(opener);
    }
    // an opener with leftovers inside the new node must be re-examined
    // there (marked re-tokenizes the inner text); it is the first child
    // of the new node, so nothing precedes it there (o = false)
    if (wrapped && opener.n > 0) { opener.o = false; di--; }
  }
}

function processEmphasisRef(root, delims) {
  // openers_bottom per char, split by the match size it blocks: an em
  // (use=1) match blocks every opener below it; a strong (use=2) match
  // blocks only em matches below it (a later strong may still nest).
  // A closer that finds no opener clears both again.
  const bottomEm = { '*': -1, '_': -1, '~': -1 };
  const bottomStrong = { '*': -1, '_': -1, '~': -1 };
  for (let di = 0; di < delims.length; di++) {
    const closer = delims[di];
    if (!closer.close || closer.n === 0) continue;
    let oi = di - 1;
    let matched = false;
    while (oi >= 0) {
      const opener = delims[oi];
      if (opener.ch !== closer.ch || !opener.open || opener.n === 0) { oi--; continue; }
      if (opener.parent !== closer.parent) { oi--; continue; }
      // odd match: if EITHER delimiter can both open and close, and the
      // length sum is a multiple of 3 (unless both lengths are multiples
      // of 3), skip this opener
      if (((opener.open && opener.close) || (closer.open && closer.close)) &&
        (opener.n + closer.n) % 3 === 0 &&
        !(opener.n % 3 === 0 && closer.n % 3 === 0)) { oi--; continue; }
      // strikethrough (~) needs opener and closer of the SAME length
      // (1 or 2 tildes); a longer run is not a delimiter at all
      if (closer.ch === '~') {
        if (opener.n !== closer.n || opener.n > 2) { oi--; continue; }
      }
      const use = (opener.n >= 2 && closer.n >= 2) ? 2 : 1;
      // below the bottom for this match size: skip this opener
      if (use === 1 ? oi <= bottomEm[closer.ch] : oi <= bottomStrong[closer.ch]) { oi--; continue; }
      const kind = closer.ch === '~' ? 8 : (use === 2 ? 7 : 6);
      opener.n -= use; closer.n -= use;
      wrapEmphasis(opener, closer, kind);
      matched = true;
      // the bottom is set only when the closer can open but the opener
      // cannot close (an "asymmetric" match); when the opener can close
      // too, an outer emphasis may still nest over it. A use=1 (em) match
      // blocks only STRONG matches below it, and a use=2 (strong) match
      // blocks only EM matches below it — the other size may still nest
      // (e.g. *a *b*c d** keeps its outer em, **a *b*c d** loses its
      // outer strong).
      if (!opener.close && closer.open) {
        if (use === 1) {
          bottomStrong[closer.ch] = oi;
        } else {
          bottomEm[closer.ch] = oi;
        }
      }
      if (closer.n === 0) break;
      // the same opener may still have delimiters left (e.g. ***foo***):
      // retry it before moving to an earlier opener
      if (opener.n === 0) oi--;
    }
    if (!matched) { bottomEm[closer.ch] = -1; bottomStrong[closer.ch] = -1; }
  }
}

// ---------- inline render ----------
function renderInline(root) {
  let out = '';
  for (let n = root.f; n; n = n.next) out += renderNode(n);
  return out;
}
function renderChildren(n) {
  let out = '';
  for (let c = n.f; c; c = c.next) out += renderNode(c);
  return out;
}
function renderNode(n) {
  switch (n.k) {
    case 0: return esc(n.s);
    case 1: return '<code>' + esc(n.s) + '</code>';
    case 2: return n.s;
    case 3: return '<br>';
    case 4: return n.ch.repeat(n.n);
    case 5: return n.s;
    case 6: return '<em>' + renderChildren(n) + '</em>';
    case 7: return '<strong>' + renderChildren(n) + '</strong>';
    case 8: return '<del>' + renderChildren(n) + '</del>';
    case 9: {
      let s = '<a href="' + escAttr(n.href) + '"';
      if (n.title != null && n.title !== undefined) s += ' title="' + escAttr(n.title) + '"';
      return s + '>' + renderChildren(n) + '</a>';
    }
    case 10: {
      let s = '<img src="' + escAttr(n.href) + '" alt="' + esc(n.alt || '') + '"';
      if (n.title != null && n.title !== undefined) s += ' title="' + escAttr(n.title) + '"';
      return s + '>';
    }
  }
  return '';
}

// Public inline entry point.
function inline(text, refs) {
  return renderInline(scanInline(text, refs));
}

// ---------- block lexer ----------
const BLOCK_TAG_SET = new Set(['address','article','aside','base','basefont','blockquote','body','caption','center','col','colgroup','dd','details','dialog','dir','div','dl','dt','fieldset','figcaption','figure','footer','form','frame','frameset','h1','h2','h3','h4','h5','h6','head','header','hr','html','iframe','legend','li','link','main','menu','menuitem','meta','nav','noframes','ol','optgroup','option','p','param','section','source','summary','table','tbody','td','tfoot','th','thead','title','tr','track','ul']);
const PRE_TAG_SET = new Set(['pre','script','style','textarea']);

function isBlankLine(s) {
  for (let p = 0; p < s.length; p++) {
    const code = s.charCodeAt(p);
    if (code !== 32 && code !== 9) return false;
  }
  return true;
}
// indentation width in columns (tab advances to next multiple of 4)
function indentWidth(s) {
  let col = 0;
  for (let p = 0; p < s.length; p++) {
    const code = s.charCodeAt(p);
    if (code === 32) col++;
    else if (code === 9) col += 4 - (col % 4);
    else break;
  }
  return col;
}
// remove n columns of leading whitespace; a straddling tab becomes spaces.
// When n is not a multiple of 4, a tab beyond the boundary changes width
// if kept as a tab, so leading tabs are expanded to spaces (by original
// column) instead; when n is a multiple of 4, tabs keep their width and
// stay tabs.
function dedentColumns(s, n, expandBoundary) {
  if (n % 4 !== 0) {
    let col = 0, p = 0;
    let expanded = '';
    while (p < s.length) {
      const code = s.charCodeAt(p);
      if (code === 32) { expanded += ' '; col++; p++; }
      else if (code === 9) {
        const w = 4 - (col % 4);
        expanded += ' '.repeat(w);
        col += w; p++;
      } else break;
    }
    if (n >= col) return s.slice(p);
    return expanded.slice(n) + s.slice(p);
  }
  let col = 0, p = 0;
  while (p < s.length && col < n) {
    const code = s.charCodeAt(p);
    if (code === 32) { col++; p++; }
    else if (code === 9) {
      const w = 4 - (col % 4);
      if (col + w > n) return ' '.repeat(col + w - n) + s.slice(p + 1);
      col += w; p++;
    } else break;
  }
  // when dedenting list-item content, a tab sitting exactly at the dedent
  // boundary expands to spaces (its width at the original column): it
  // becomes leading content, and marked renders it as spaces, not a tab
  // (fenced code in a list item). Indented code keeps the tab.
  if (expandBoundary && col === n && p < s.length && s.charCodeAt(p) === 9) {
    return ' '.repeat(4 - (col % 4)) + s.slice(p + 1);
  }
  return s.slice(p);
}
// strip a blockquote marker ('>' + one optional space) from a line, expanding
// a tab after '>' to the right number of spaces (a tab counts as one space,
// the rest of its width stays as spaces in the content)
function stripBQMarker(line) {
  const first = firstNonWs(line);
  const startCol = columnOf(line, first);
  let p = first + 1;
  let col = startCol + 1;
  let prefix = '';
  if (p < line.length) {
    const code = line.charCodeAt(p);
    if (code === 32) { p++; col++; }
    else if (code === 9) {
      const w = 4 - (col % 4);
      prefix = ' '.repeat(w - 1);
      p++; col += w;
    }
  }
  // expand any further leading tabs to spaces, using the ORIGINAL column
  // (a tab's width depends on where it sits in the source line)
  let out = prefix;
  while (p < line.length) {
    const code = line.charCodeAt(p);
    if (code === 32) { out += ' '; p++; col++; }
    else if (code === 9) {
      const w = 4 - (col % 4);
      out += ' '.repeat(w);
      p++; col += w;
    } else break;
  }
  return out + line.slice(p);
}
// index of first non-space/tab char
function firstNonWs(s) {
  let p = 0;
  while (p < s.length) {
    const code = s.charCodeAt(p);
    if (code !== 32 && code !== 9) break;
    p++;
  }
  return p;
}

// --- link reference definitions ---
// scan a bracketed label starting at src[pos] == '['; returns {end, raw} or null
function scanBracketLabel(src, pos) {
  if (src.charCodeAt(pos) !== 91) return null;
  let cur = pos + 1;
  while (cur < src.length) {
    const code = src.charCodeAt(cur);
    if (code === 92) { cur += 2; continue; }
    if (code === 91) return null; // unescaped [ inside label: invalid
    if (code === 93) return { end: cur + 1, raw: src.slice(pos + 1, cur) };
    cur++;
  }
  return null;
}
// normalize a label for lookup: unescape backslashes, collapse whitespace, trim, lowercase
function normalizeLabel(raw) {
  let buf = '';
  for (let p = 0; p < raw.length; p++) {
    const code = raw.charCodeAt(p);
    if (code === 92 && p + 1 < raw.length) { buf += raw[p + 1]; p++; continue; }
    if (code === 32 || code === 9 || code === 10 || code === 13) {
      if (buf.length && buf[buf.length - 1] !== ' ') buf += ' ';
      continue;
    }
    buf += raw[p];
  }
  if (buf.endsWith(' ')) buf = buf.slice(0, -1);
  return buf.toLowerCase();
}
// parse a link destination starting at src[pos]; returns {end, dest} or null
function scanDestination(src, pos) {
  if (src.charCodeAt(pos) === 60) { // <
    let cur = pos + 1;
    while (cur < src.length) {
      const code = src.charCodeAt(cur);
      if (code === 10) return null;
      if (code === 62) return { end: cur + 1, dest: src.slice(pos + 1, cur) };
      if (code === 60) return null;
      if (code === 92) { cur += 2; continue; }
      cur++;
    }
    return null;
  }
  let cur = pos, depth = 0;
  while (cur < src.length) {
    const code = src.charCodeAt(cur);
    if (code === 32 || code === 9 || code === 10) break;
    if (code < 32) return null;
    if (code === 92) { cur += 2; continue; }
    if (code === 40) depth++;
    else if (code === 41) {
      if (depth === 0) break;
      depth--;
    }
    cur++;
  }
  if (cur === pos) return null;
  return { end: cur, dest: src.slice(pos, cur) };
}
// parse a link title starting at src[pos] ('"' or "'" or '('); paren titles do NOT
// allow unescaped nested parens (definition rule)
function scanTitleDef(src, pos) {
  const quote = src.charCodeAt(pos);
  if (quote === 34 || quote === 39) { // " or '
    let cur = pos + 1;
    while (cur < src.length) {
      const code = src.charCodeAt(cur);
      if (code === 92) { cur += 2; continue; }
      if (code === quote) return { end: cur + 1, title: unescapeTitle(src.slice(pos + 1, cur)) };
      cur++;
    }
    return null;
  }
  if (quote === 40) { // (
    let cur = pos + 1;
    while (cur < src.length) {
      const code = src.charCodeAt(cur);
      if (code === 92) { cur += 2; continue; }
      if (code === 41) return { end: cur + 1, title: unescapeTitle(src.slice(pos + 1, cur)) };
      if (code === 40) return null; // nested ( not allowed in definitions
      cur++;
    }
    return null;
  }
  return null;
}
function unescapeTitle(t) {
  let buf = '';
  for (let p = 0; p < t.length; p++) {
    // only a backslash before ASCII punctuation is an escape; otherwise
    // the backslash stays (e.g. \b in a title keeps the backslash)
    if (t.charCodeAt(p) === 92 && p + 1 < t.length && isPunct(t.charCodeAt(p + 1))) { buf += t[p + 1]; p++; continue; }
    buf += t[p];
  }
  return buf;
}
// try to parse a link reference definition starting at lines[idx] (0-3 indent).
// returns {endIdx, key, href, title} (endIdx = index just past the definition) or null.
function tryParseDefinition(lines, idx, end) {
  const firstLine = lines[idx];
  if (indentWidth(firstLine) > 3) return null;
  const start = firstNonWs(firstLine);
  if (firstLine.charCodeAt(start) !== 91) return null;
  // label may span lines; the destination may be on the next line and the
  // title on the line after that (a title may itself span lines). Join
  // lines until a blank line (a definition never spans one) or 8 lines.
  // Parsing stops at the definition's real end (endIdx counts newlines
  // up to the parse position), so extra joined lines are never consumed.
  let text = firstLine.slice(start);
  let usedLines = 1;
  while (usedLines < 8 && idx + usedLines < end) {
    const nextLine = lines[idx + usedLines];
    if (isBlankLine(nextLine)) break;
    text += '\n' + nextLine;
    usedLines++;
  }
  const label = scanBracketLabel(text, 0);
  if (!label) return null;
  // labels match WITHOUT unescaping backslashes (foo\! does not match foo!)
  const key = normLabel(label.raw);
  if (!key) return null;
  let pos = label.end;
  // separators after ':': spaces and newlines, never a tab on the same line
  // (a tab is allowed as indentation at the start of a following line)
  const skipSeparators = () => {
    while (pos < text.length) {
      const code = text.charCodeAt(pos);
      if (code === 32) { pos++; continue; }
      if (code === 10) {
        pos++;
        while (pos < text.length) {
          const inner = text.charCodeAt(pos);
          if (inner === 32 || inner === 9) pos++;
          else break;
        }
        continue;
      }
      break;
    }
  };
  if (text.charCodeAt(pos) !== 58) return null; // ':'
  pos++;
  skipSeparators();
  if (pos >= text.length) return null;
  const dest = scanDestination(text, pos);
  if (!dest) return null;
  pos = dest.end;
  let title = null;
  // after the destination: only spaces on this line, then optional title
  let after = pos;
  while (after < text.length && text.charCodeAt(after) === 32) after++;
  if (after < text.length && text.charCodeAt(after) !== 10) {
    // title on the same line, but only if whitespace separated it from
    // the destination (e.g. <bar>(baz) is junk, not a title)
    if (after === pos) return null;
    const parsed = scanTitleDef(text, after);
    if (!parsed) return null;
    title = parsed.title;
    let tail = parsed.end;
    while (tail < text.length && text.charCodeAt(tail) === 32) tail++;
    // junk after the title on the SAME line invalidates it; a newline
    // (extra lines were joined for dest/title) is fine
    if (tail < text.length && text.charCodeAt(tail) !== 10) return null;
    pos = tail;
  } else {
    // end of line: title may be on the immediately following line
    pos = after;
    if (pos < text.length && text.charCodeAt(pos) === 10) {
      let tail = pos + 1;
      while (tail < text.length && (text.charCodeAt(tail) === 32 || text.charCodeAt(tail) === 9)) tail++;
      if (tail < text.length && text.charCodeAt(tail) !== 10) {
        const parsed = scanTitleDef(text, tail);
        if (parsed) {
          let tailEnd = parsed.end;
          while (tailEnd < text.length && text.charCodeAt(tailEnd) === 32) tailEnd++;
          if (tailEnd >= text.length || text.charCodeAt(tailEnd) === 10) {
            title = parsed.title;
            pos = tailEnd;
          }
        }
      }
    }
  }
  // count how many source lines the definition consumed
  let newlines = 0;
  for (let k = 0; k < pos && k < text.length; k++) if (text.charCodeAt(k) === 10) newlines++;
  return { endIdx: idx + newlines + 1, key, href: cleanDest(dest.dest), title: title === null ? null : cleanTitle(title) };
}

// --- HTML block start classification ---
// scan a complete tag (space-only separators) starting at src[pos]; returns end index or -1
function scanCompleteTag(src, pos) {
  let cur = pos;
  if (src.charCodeAt(cur) !== 60) return -1; // <
  cur++;
  let isClose = false;
  if (src.charCodeAt(cur) === 47) { isClose = true; cur++; }
  const firstCode = src.charCodeAt(cur);
  if (!((firstCode >= 65 && firstCode <= 90) || (firstCode >= 97 && firstCode <= 122))) return -1;
  cur++;
  while (cur < src.length) {
    const code = src.charCodeAt(cur);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45) cur++;
    else break;
  }
  if (isClose) {
    while (cur < src.length && src.charCodeAt(cur) === 32) cur++;
    if (src.charCodeAt(cur) === 62) return cur + 1;
    return -1;
  }
  while (true) {
    if (cur >= src.length) return -1;
    const code = src.charCodeAt(cur);
    if (code === 62) return cur + 1;
    if (code === 47) {
      if (src.charCodeAt(cur + 1) === 62) return cur + 2;
      return -1;
    }
    if (code !== 32) return -1;
    cur++;
    while (cur < src.length && src.charCodeAt(cur) === 32) cur++;
    if (cur >= src.length) return -1;
    const nextCode = src.charCodeAt(cur);
    if (nextCode === 62) return cur + 1;
    if (nextCode === 47) {
      if (src.charCodeAt(cur + 1) === 62) return cur + 2;
      return -1;
    }
    const attrFirst = src.charCodeAt(cur);
    if (!((attrFirst >= 65 && attrFirst <= 90) || (attrFirst >= 97 && attrFirst <= 122) || attrFirst === 95 || attrFirst === 58)) return -1;
    cur++;
    while (cur < src.length) {
      const nameCode = src.charCodeAt(cur);
      if ((nameCode >= 65 && nameCode <= 90) || (nameCode >= 97 && nameCode <= 122) || (nameCode >= 48 && nameCode <= 57) || nameCode === 95 || nameCode === 45 || nameCode === 46 || nameCode === 58) cur++;
      else break;
    }
    while (cur < src.length && src.charCodeAt(cur) === 32) cur++;
    if (src.charCodeAt(cur) === 61) { // =
      cur++;
      while (cur < src.length && src.charCodeAt(cur) === 32) cur++;
      if (cur >= src.length) return -1;
      const valueCode = src.charCodeAt(cur);
      if (valueCode === 34 || valueCode === 39) {
        cur++;
        while (cur < src.length && src.charCodeAt(cur) !== valueCode) cur++;
        if (cur >= src.length) return -1;
        cur++;
      } else {
        const valueStart = cur;
        while (cur < src.length) {
          const valueChar = src.charCodeAt(cur);
          if (valueChar === 32 || valueChar === 34 || valueChar === 39 || valueChar === 61 || valueChar === 60 || valueChar === 62 || valueChar === 96) break;
          cur++;
        }
        if (cur === valueStart) return -1;
      }
    }
  }
}
// classify a possible HTML block start; returns {kind, endName} or null
// kind: 'pre' | 'block' | 'comment' | 'pi' | 'decl' | 'cdata' | 'tag'
function htmlBlockInfo(line) {
  if (indentWidth(line) > 3) return null;
  const first = firstNonWs(line);
  if (line.charCodeAt(first) !== 60) return null;
  const second = line.charCodeAt(first + 1);
  if (second === 33) { // !
    if (line.startsWith('<!--', first)) return { kind: 'comment' };
    if (line.startsWith('<![CDATA[', first)) return { kind: 'cdata' };
    const third = line.charCodeAt(first + 2);
    if ((third >= 65 && third <= 90) || (third >= 97 && third <= 122)) return { kind: 'decl' };
    return null;
  }
  if (second === 63) return { kind: 'pi' }; // <?
  let p = first + 1;
  const isClosing = line.charCodeAt(p) === 47;
  if (isClosing) p++; // /
  const nameFirst = line.charCodeAt(p);
  if (!((nameFirst >= 65 && nameFirst <= 90) || (nameFirst >= 97 && nameFirst <= 122))) return null;
  let tagName = '';
  let q = p;
  while (q < line.length) {
    const code = line.charCodeAt(q);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45) { tagName += line[q]; q++; }
    else break;
  }
  const lowerName = tagName.toLowerCase();
  const after = q < line.length ? line.charCodeAt(q) : -1;
  if (after !== -1 && after !== 32 && after !== 9 && after !== 62 && after !== 47) return null;
  // HTML block type 1 (pre/script/style/textarea) starts only with an
  // OPENING tag; a closing </pre> etc. is not a type-1 start (cm-148:
  // it must not interrupt a paragraph) and falls through to the
  // type-7 'tag' check below (a complete tag alone on its line).
  if (PRE_TAG_SET.has(lowerName) && !isClosing) return { kind: 'pre', endName: lowerName };
  if (BLOCK_TAG_SET.has(lowerName)) return { kind: 'block' };
  const tagEnd = scanCompleteTag(line, first);
  if (tagEnd > 0) {
    let r = tagEnd;
    while (r < line.length && (line.charCodeAt(r) === 32 || line.charCodeAt(r) === 9)) r++;
    if (r === line.length) return { kind: 'tag' };
  }
  return null;
}
// find a matching end tag </name ...> in a line (case-insensitive); returns index past '>' or -1
function findEndTag(line, name, from) {
  const lowered = line.toLowerCase();
  const pattern = '</' + name;
  let at = lowered.indexOf(pattern, from);
  while (at >= 0) {
    let after = at + pattern.length;
    while (after < line.length && (line.charCodeAt(after) === 32 || line.charCodeAt(after) === 9)) after++;
    if (line.charCodeAt(after) === 62) return after + 1;
    at = lowered.indexOf(pattern, after);
  }
  return -1;
}
// consume an HTML block starting at lines[idx]; returns {endIdx, text}
function lexHtmlBlock(lines, idx, end, srcEndsWithNL) {
  const info = htmlBlockInfo(lines[idx]);
  const first = firstNonWs(lines[idx]);
  let last = idx;
  let closed = false; // true if an end-marker closed the block
  if (info.kind === 'comment' || info.kind === 'pi' || info.kind === 'decl' || info.kind === 'cdata' || info.kind === 'pre') {
    const needle = info.kind === 'comment' ? '-->' : info.kind === 'pi' ? '?>' : info.kind === 'cdata' ? ']]>' : info.kind === 'decl' ? '>' : null;
    for (; last < end; last++) {
      const line = lines[last];
      let hit = false;
      if (info.kind === 'pre') {
        hit = findEndTag(line, info.endName, last === idx ? first : 0) >= 0;
      } else {
        const from = (last === idx && info.kind === 'comment') ? first + 4 : 0;
        hit = line.indexOf(needle, from) >= 0;
      }
      if (hit) { closed = true; break; }
    }
    if (!closed) last = end - 1; // ran to EOF
  } else {
    // 'block' or 'tag': ends at a blank line
    for (; last < end; last++) {
      if (isBlankLine(lines[last])) break;
    }
    last = last - 1; // last consumed line
    if (last < idx) last = idx;
  }
  // last is now the index of the last consumed line (for marker kinds, the closing line)
  let text = '';
  for (let k = idx; k <= last; k++) {
    if (k > idx) text += '\n';
    text += lines[k];
  }
  if (closed) {
    if (last < end - 1) {
      // marked's ge() keeps the closing line's trailing newline unless
      // the next line is EMPTY; a whitespace-only line does not drop it
      // (the raw regex match stops at the space/tab, so ge sees only one
      // trailing blank and keeps it). An empty next line drops it.
      if (lines[last + 1].length > 0) text += '\n';
    } else if (srcEndsWithNL) {
      text += '\n';
    }
  } else {
    // ran to EOF (or ended at a blank line): blank-line end adds nothing;
    // EOF end keeps the source's trailing newline
    if (last === end - 1 && srcEndsWithNL) {
      // only when the block actually ran to EOF without a blank line ending it
      if (info.kind === 'block' || info.kind === 'tag') {
        // blank-line kind that ran to EOF: trailing newline is kept
        text += '\n';
      } else {
        text += '\n';
      }
    }
  }
  return { endIdx: last + 1, text };
}

// --- ATX heading / fence / thematic break detectors ---
// returns {depth, text} or null; text is the raw inline content
function atxHeading(line) {
  if (indentWidth(line) > 3) return null;
  const first = firstNonWs(line);
  let p = first, count = 0;
  while (p < line.length && line.charCodeAt(p) === 35 && count < 7) { p++; count++; }
  if (count === 0 || count > 6) return null;
  if (p < line.length) {
    const after = line.charCodeAt(p);
    if (after !== 32 && after !== 9) return null;
  }
  let content = line.slice(p);
  // strip leading spaces/tabs
  let lead = 0;
  while (lead < content.length && (content.charCodeAt(lead) === 32 || content.charCodeAt(lead) === 9)) lead++;
  content = content.slice(lead);
  // strip trailing spaces/tabs
  let tail = content.length;
  while (tail > 0 && (content.charCodeAt(tail - 1) === 32 || content.charCodeAt(tail - 1) === 9)) tail--;
  content = content.slice(0, tail);
  // strip a closing sequence of #s preceded by a space (or the whole
  // content being #s, e.g. "### ###" -> empty heading)
  if (content.endsWith('#')) {
    let hashes = content.length;
    while (hashes > 0 && content.charCodeAt(hashes - 1) === 35) hashes--;
    if (hashes < content.length && (hashes === 0 || content.charCodeAt(hashes - 1) === 32 || content.charCodeAt(hashes - 1) === 9)) {
      content = content.slice(0, hashes);
      let trimmed = content.length;
      while (trimmed > 0 && (content.charCodeAt(trimmed - 1) === 32 || content.charCodeAt(trimmed - 1) === 9)) trimmed--;
      content = content.slice(0, trimmed);
    }
  }
  return { depth: count, text: content };
}
// returns {ch, len, indent, info} or null
function fenceInfo(line) {
  const ind = indentWidth(line);
  if (ind > 3) return null;
  const first = firstNonWs(line);
  const fenceCh = line.charCodeAt(first);
  if (fenceCh !== 96 && fenceCh !== 126) return null; // ` or ~
  let p = first, run = 0;
  while (p < line.length && line.charCodeAt(p) === fenceCh) { p++; run++; }
  if (run < 3) return null;
  const info = line.slice(p);
  if (fenceCh === 96 && info.indexOf('`') >= 0) return null; // backtick fence info has no backticks
  return { ch: fenceCh, len: run, indent: ind, info };
}
// language = first word of the info string (space/tab separated); backslash
// escapes in the info are unescaped
function fenceLanguage(info) {
  let start = 0;
  while (start < info.length && (info.charCodeAt(start) === 32 || info.charCodeAt(start) === 9)) start++;
  let end = start;
  while (end < info.length && info.charCodeAt(end) !== 32 && info.charCodeAt(end) !== 9) end++;
  let word = info.slice(start, end);
  if (word.indexOf('\\') >= 0) {
    let unescaped = '', k = 0;
    while (k < word.length) {
      if (word.charCodeAt(k) === 92 && k + 1 < word.length && isPunct(word.charCodeAt(k + 1))) { unescaped += word[k + 1]; k += 2; }
      else { unescaped += word[k]; k++; }
    }
    word = unescaped;
  }
  return word;
}
function isThematicBreak(line) {
  if (indentWidth(line) > 3) return false;
  const first = firstNonWs(line);
  const mark = line.charCodeAt(first);
  if (mark !== 42 && mark !== 45 && mark !== 95) return false; // * - _
  let marks = 0;
  for (let pos = first; pos < line.length; pos++) {
    const code = line.charCodeAt(pos);
    if (code === mark) marks++;
    else if (code !== 32 && code !== 9) return false;
  }
  return marks >= 3;
}
// is this line a setext underline? returns 1 (=) or 2 (-) or 0.
// The line must be only =s (or only -s) plus surrounding whitespace;
// internal spaces (e.g. "= =") are NOT a setext underline.
function setextLevel(line) {
  if (indentWidth(line) > 3) return 0;
  const first = firstNonWs(line);
  const mark = line.charCodeAt(first);
  if (mark !== 61 && mark !== 45) return 0; // = or -
  let pos = first;
  while (pos < line.length && line.charCodeAt(pos) === mark) pos++;
  while (pos < line.length && (line.charCodeAt(pos) === 32 || line.charCodeAt(pos) === 9)) pos++;
  if (pos < line.length) return 0;
  return mark === 61 ? 1 : 2;
}
// does this line start a list item? returns {ordered, marker, start, contentIdx, indent} or null
// contentIdx = index where the item content starts (after marker + spaces)
function listItemStart(line) {
  const ind = indentWidth(line);
  if (ind > 3) return null;
  const first = firstNonWs(line);
  const mark = line.charCodeAt(first);
  if (mark === 42 || mark === 43 || mark === 45) { // * + -
    let after = first + 1;
    if (after >= line.length) return { ordered: false, marker: line[first], start: null, contentIdx: -1, indent: ind };
    const nextCode = line.charCodeAt(after);
    if (nextCode !== 32 && nextCode !== 9) return null;
    // skip spaces/tabs; content must exist and not be only whitespace
    let content = after;
    while (content < line.length && (line.charCodeAt(content) === 32 || line.charCodeAt(content) === 9)) content++;
    if (content >= line.length) return { ordered: false, marker: line[first], start: null, contentIdx: -1, indent: ind };
    return { ordered: false, marker: line[first], start: null, contentIdx: content, indent: ind };
  }
  // ordered: 1-9 digits then . or )
  if (mark >= 48 && mark <= 57) {
    let p = first, num = 0, digits = 0;
    while (p < line.length && line.charCodeAt(p) >= 48 && line.charCodeAt(p) <= 57 && digits < 10) {
      num = num * 10 + (line.charCodeAt(p) - 48);
      p++; digits++;
    }
    if (digits === 0 || digits > 9) return null;
    if (p < line.length && line.charCodeAt(p) >= 48 && line.charCodeAt(p) <= 57) return null; // >9 digits
    const delim = line.charCodeAt(p);
    if (delim !== 46 && delim !== 41) return null; // . or )
    const marker = line.slice(first, p + 1);
    p++;
    if (p >= line.length) return { ordered: true, marker, start: num, contentIdx: -1, indent: ind };
    const nextCode = line.charCodeAt(p);
    if (nextCode !== 32 && nextCode !== 9) return null;
    let content = p;
    while (content < line.length && (line.charCodeAt(content) === 32 || line.charCodeAt(content) === 9)) content++;
    if (content >= line.length) return { ordered: true, marker, start: num, contentIdx: -1, indent: ind };
    return { ordered: true, marker, start: num, contentIdx: content, indent: ind };
  }
  return null;
}

// column (tab-expanded) of the character at index idx in s
function columnOf(s, idx) {
  let col = 0;
  for (let i = 0; i < idx && i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 9) col += 4 - (col % 4);
    else col++;
  }
  return col;
}

// ---------- main block lexer ----------
// lex lines[start..end) into tokens; defs is a shared map of link definitions
// lazy[i] (optional, indexed like lines) marks lines added as lazy continuations
function lexRange(lines, start, end, defs, srcEndsWithNL, lazy, inListItem) {
  const tokens = [];
  let loose = false;
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (isBlankLine(line)) {
      // a blank line between two blocks at this level makes a list loose;
      // a trailing blank line (nothing after it) does not
      if (tokens.length > 0) {
        let k = i;
        while (k < end && isBlankLine(lines[k])) k++;
        if (k < end) loose = true;
        i = k;
        continue;
      }
      i++;
      continue;
    }
    // link reference definitions (only at the start of a block)
    const def = tryParseDefinition(lines, i, end);
    if (def) {
      if (!defs.has(def.key)) defs.set(def.key, { href: def.href, title: def.title });
      i = def.endIdx;
      continue;
    }
    const ind = indentWidth(line);
    // ATX heading
    const atx = atxHeading(line);
    if (atx) {
      tokens.push({ type: 'heading', depth: atx.depth, text: atx.text });
      i++;
      continue;
    }
    // fenced code
    const fence = fenceInfo(line);
    if (fence) {
      const res = lexFenced(lines, i, end, fence);
      tokens.push(res.token);
      i = res.endIdx;
      continue;
    }
    // HTML block (types 1-6 can interrupt a paragraph; type 7 is handled here too
    // since we are at a block boundary)
    const hb = htmlBlockInfo(line);
    if (hb) {
      const res = lexHtmlBlock(lines, i, end, srcEndsWithNL);
      tokens.push({ type: 'html', text: res.text });
      i = res.endIdx;
      continue;
    }
    // thematic break
    if (isThematicBreak(line)) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }
    // blockquote
    if (ind <= 3) {
      const s = firstNonWs(line);
      if (line.charCodeAt(s) === 62) { // >
        const res = lexBlockquote(lines, i, end, defs, srcEndsWithNL);
        tokens.push(res.token);
        i = res.endIdx;
        continue;
      }
    }
    // list
    const li = listItemStart(line);
    if (li) {
      const res = lexList(lines, i, end, defs, srcEndsWithNL);
      tokens.push(res.token);
      i = res.endIdx;
      continue;
    }
    // indented code
    if (ind >= 4) {
      const res = lexIndentedCode(lines, i, end);
      tokens.push(res.token);
      i = res.endIdx;
      continue;
    }
    // paragraph (handles setext headings and tables)
    const res = lexParagraph(lines, i, end, defs, srcEndsWithNL, lazy, inListItem);
    tokens.push(res.token);
    i = res.endIdx;
  }
  return { tokens, loose };
}

// fenced code block starting at lines[idx]; fence is the fenceInfo result
function lexFenced(lines, idx, end, fence) {
  const lang = fenceLanguage(fence.info);
  const ch = fence.ch, need = fence.len;
  // marked dedents fenced content by CHARACTERS (Dt): remove up to the
  // fence indent's character count of leading whitespace (a tab counts
  // as one character, so a straddling tab is removed whole, not expanded
  // to spaces). The fence indent in characters is the first-non-ws index.
  // BUT this applies ONLY to backtick fences: tilde fences do NOT dedent
  // their content at all (verified against marked 18.1.3).
  const fChars = ch === 96 ? firstNonWs(lines[idx]) : 0;
  const content = [];
  let j = idx + 1;
  let closed = false;
  for (; j < end; j++) {
    const line = lines[j];
    if (indentWidth(line) <= 3) {
      const s = firstNonWs(line);
      if (line.charCodeAt(s) === ch) {
        let p = s, n = 0;
        while (p < line.length && line.charCodeAt(p) === ch) { p++; n++; }
        if (n >= need) {
          // rest of the line must be only whitespace
          let ok = true;
          for (let k = p; k < line.length; k++) {
            const c = line.charCodeAt(k);
            if (c !== 32 && c !== 9) { ok = false; break; }
          }
          if (ok) { closed = true; break; }
        }
      }
    }
    let k = 0;
    while (k < line.length && k < fChars) {
      const c = line.charCodeAt(k);
      if (c === 32 || c === 9) k++;
      else break;
    }
    content.push(line.slice(k));
  }
  let text = content.join('\n');
  return { token: { type: 'code', text, lang }, endIdx: closed ? j + 1 : j };
}

// indented code block starting at lines[idx]
function lexIndentedCode(lines, idx, end) {
  const content = [];
  let j = idx;
  for (; j < end; j++) {
    const line = lines[j];
    if (isBlankLine(line)) {
      // a blank line is part of the block only if a later indented line follows
      let k = j + 1;
      while (k < end && isBlankLine(lines[k])) k++;
      if (k < end && indentWidth(lines[k]) >= 4) {
        // include the blank lines (dedented); land on k (the for-loop
        // increment moves past it, so step back one first)
        while (j < k) { content.push(dedentColumns(lines[j], 4)); j++; }
        j = k - 1;
        continue;
      }
      break;
    }
    if (indentWidth(line) < 4) break;
    content.push(dedentColumns(line, 4));
  }
  // strip leading and trailing blank lines
  let a = 0;
  while (a < content.length && content[a] === '') a++;
  let b = content.length;
  while (b > a && content[b - 1] === '') b--;
  const text = content.slice(a, b).join('\n');
  return { token: { type: 'code', text, lang: '' }, endIdx: j };
}

// --- table parsing ---
// split a table row line into cells; returns array of raw cell strings or null
function splitTableRow(line) {
  const s = firstNonWs(line);
  // collect cell spans as [start, end) indices into line; a \| escape
  // becomes a literal | in the cell (backslash consumed here)
  const spans = [];
  let i = s;
  let hasPipe = false;
  // leading pipe is optional
  if (line.charCodeAt(i) === 124) i++;
  let cellStart = i;
  // we build each cell's text only if it contains an escape; otherwise slice
  let cur = null; // null = no escape seen, slice directly at the end
  for (; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 92) { // backslash
      if (i + 1 < line.length && line.charCodeAt(i + 1) === 124) {
        if (cur === null) cur = line.slice(cellStart, i);
        cur += '|';
        i++;
        continue;
      }
      if (cur !== null) { cur += line[i]; if (i + 1 < line.length) { cur += line[i + 1]; i++; } continue; }
      // no escape yet and this backslash is not before a pipe: the cell
      // still has no escape, keep slicing (the backslash stays in the text)
      continue;
    }
    if (c === 124) { // |
      spans.push(cur === null ? [cellStart, i, null] : [0, 0, cur]);
      cur = null;
      hasPipe = true;
      cellStart = i + 1;
      continue;
    }
    if (cur !== null) cur += line[i];
  }
  // trailing pipe: if the line ends with an unescaped |, the last cell is dropped
  if (hasPipe) {
    let e = line.length;
    while (e > 0 && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
    if (e > 0 && line.charCodeAt(e - 1) === 124) {
      // last cell (cur) is the trailing empty one; drop it
    } else {
      spans.push(cur === null ? [cellStart, line.length, null] : [0, 0, cur]);
    }
  } else {
    spans.push(cur === null ? [cellStart, line.length, null] : [0, 0, cur]);
  }
  // trim each cell
  const cells = new Array(spans.length);
  for (let k = 0; k < spans.length; k++) {
    const sp = spans[k];
    let txt = sp[2] !== null ? sp[2] : line.slice(sp[0], sp[1]);
    let a = 0, b = txt.length;
    while (a < b && (txt.charCodeAt(a) === 32 || txt.charCodeAt(a) === 9)) a++;
    while (b > a && (txt.charCodeAt(b - 1) === 32 || txt.charCodeAt(b - 1) === 9)) b--;
    cells[k] = txt.slice(a, b);
  }
  return cells;
}
// is this line a valid table delimiter row for a header with n cells?
// returns the align array or null. The delimiter row must be indented
// at most 3 columns (4+ is indented code, not a table).
function tableDelimiter(line, n) {
  if (indentWidth(line) > 3) return null;
  const cells = splitTableRow(line);
  if (!cells || cells.length !== n) return null;
  const align = [];
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    // the cell must be dashes with optional colons (already trimmed by splitTableRow)
    let left = false, right = false, ok = true, dashes = 0;
    for (let i = 0; i < c.length; i++) {
      const ch = c.charCodeAt(i);
      if (ch === 58) { // :
        if (i === 0) left = true;
        else if (i === c.length - 1) right = true;
        else { ok = false; break; }
      } else if (ch === 45) { dashes++; }
      else { ok = false; break; }
    }
    if (!ok || dashes < 1) return null;
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return align;
}
// try to form a table from a header line and the following line (delimiter)
// returns {header, align} or null
function tryTableHeader(headerLine, delimLine) {
  // fast pre-check: a delimiter row holds only | - : space tab, and must
  // contain a '-'; without that, no table can start here (avoids splitting
  // the header line for every paragraph's second line)
  let hasDash = false;
  for (let i = 0; i < delimLine.length; i++) {
    const c = delimLine.charCodeAt(i);
    if (c === 45) { hasDash = true; continue; }
    if (c === 124 || c === 58 || c === 32 || c === 9) continue;
    return null;
  }
  if (!hasDash) return null;
  const header = splitTableRow(headerLine);
  if (!header || header.length === 0) return null;
  const align = tableDelimiter(delimLine, header.length);
  if (!align) return null;
  return { header, align };
}

// --- paragraph (with setext headings and tables) ---
function interruptsParagraph(line, inListItem) {
  if (indentWidth(line) > 3) return false;
  if (atxHeading(line)) return true;
  if (fenceInfo(line)) return true;
  const hb = htmlBlockInfo(line);
  if (hb && hb.kind !== 'tag') return true;
  if (isThematicBreak(line)) return true;
  const s = firstNonWs(line);
  if (line.charCodeAt(s) === 62) return true; // >
  const li = listItemStart(line);
  if (li && li.contentIdx >= 0) {
    if (!li.ordered) return true;
    // an ordered list interrupts a paragraph only if it starts at 1,
    // unless we are directly inside a list item (a nested list there
    // interrupts regardless of its start number)
    if (li.start === 1 || inListItem) return true;
  }
  return false;
}
function lexParagraph(lines, i, end, defs, srcEndsWithNL, lazy, inListItem) {
  const paraLines = [lines[i]];
  let j = i + 1;
  let setext = 0;
  while (j < end) {
    const line = lines[j];
    if (isBlankLine(line)) {
      // inside a blockquote/list, a trailing spaces-only line (from a >
      // marker) is kept as paragraph content ("foo\n "), not dropped;
      // at the top level it ends the paragraph
      if (lazy && line.length > 0 && j === end - 1) {
        paraLines.push(line);
        j++;
      }
      break;
    }
    const sl = setextLevel(line);
    if (sl) {
      // a lazy underline only counts as setext if the previous paragraph line
      // was itself lazy; a lazy underline after a proper line is plain text
      const underlineLazy = lazy ? !!lazy[j] : false;
      const prevLazy = lazy ? !!lazy[j - 1] : false;
      if (!underlineLazy || prevLazy) { setext = sl; j++; break; }
      // otherwise fall through: the line is paragraph text
    }
    if (paraLines.length === 1) {
      const tbl = tryTableHeader(paraLines[0], line);
      if (tbl) {
        // consume body rows: any non-blank line that does not start another block.
        // An empty or spaces-only line ends the table, but a whitespace-only
        // line containing a tab is a (blank) row, not a blank line.
        const rows = [];
        let k = j + 1;
        for (; k < end; k++) {
          const rl = lines[k];
          let spacesOnly = true, hasTab = false;
          for (let q = 0; q < rl.length; q++) {
            const cc = rl.charCodeAt(q);
            if (cc === 9) { hasTab = true; spacesOnly = false; break; }
            if (cc !== 32) { spacesOnly = false; break; }
          }
          if (spacesOnly) break;
          if (hasTab && rl.trim() === '') {
            // tab-only line: an empty row
            const cells = splitTableRow(rl);
            while (cells.length < tbl.header.length) cells.push('');
            if (cells.length > tbl.header.length) cells.length = tbl.header.length;
            rows.push(cells);
            continue;
          }
          if (indentWidth(rl) >= 4) break;
          if (atxHeading(rl) || fenceInfo(rl) || isThematicBreak(rl)) break;
          const rh = htmlBlockInfo(rl);
          if (rh && rh.kind !== 'tag') break;
          const rs = firstNonWs(rl);
          if (rl.charCodeAt(rs) === 62) break; // >
          if (listItemStart(rl)) break;
          const cells = splitTableRow(rl);
          // pad/truncate to the header width
          while (cells.length < tbl.header.length) cells.push('');
          if (cells.length > tbl.header.length) cells.length = tbl.header.length;
          rows.push(cells);
        }
        return { token: { type: 'table', header: tbl.header, align: tbl.align, rows }, endIdx: k };
      }
    }
    if (interruptsParagraph(line, inListItem)) {
      // a lazy line (blockquote/list continuation) never interrupts the
      // paragraph; it is plain paragraph text
      if (lazy && lazy[j]) { paraLines.push(line); j++; continue; }
      break;
    }
    paraLines.push(line);
    j++;
  }
  // a setext heading's content is trimmed (leading spaces of the first
  // line and trailing whitespace of the last line are dropped); a plain
  // paragraph keeps them
  if (setext) {
    let t = paraLines.join('\n');
    t = t.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    return { token: { type: 'heading', depth: setext, text: t }, endIdx: j };
  }
  return { token: { type: 'paragraph', text: paraLines.join('\n') }, endIdx: j };
}

// is the innermost still-open block in these tokens a paragraph?
// true only when the last token is a paragraph that is a DIRECT child of
// this token list (not nested inside a list or blockquote). Used for the
// "too-indented line is a lazy continuation" rule: a lazy line that belongs
// to a nested item's paragraph must be dedented by that item, not by us.
function lastIsDirectParagraph(tokens) {
  if (!tokens || tokens.length === 0) return false;
  return tokens[tokens.length - 1].type === 'paragraph';
}
function innermostOpenIsParagraph(tokens) {
  if (!tokens || tokens.length === 0) return false;
  const last = tokens[tokens.length - 1];
  if (last.type === 'paragraph') return true;
  if (last.type === 'blockquote') return innermostOpenIsParagraph(last.tokens);
  if (last.type === 'list') {
    if (!last.items || last.items.length === 0) return false;
    return innermostOpenIsParagraph(last.items[last.items.length - 1].tokens);
  }
  return false;
}
// can this line be a lazy continuation of a paragraph inside a blockquote?
// (it must not start a block that ends the paragraph/blockquote)
function lazyLineEndsQuote(line) {
  if (indentWidth(line) > 3) return false; // indented text is paragraph text
  if (atxHeading(line)) return true;
  if (fenceInfo(line)) return true;
  const hb = htmlBlockInfo(line);
  if (hb && hb.kind !== 'tag') return true;
  if (isThematicBreak(line)) return true;
  const s = firstNonWs(line);
  if (line.charCodeAt(s) === 62) return true; // > (should not happen)
  if (listItemStart(line)) return true; // any list item, even empty
  return false;
}
function lexBlockquote(lines, i, end, defs, srcEndsWithNL) {
  const content = []; // {text, lazy}
  let j = i;
  let prevLazy = false;
  while (j < end) {
    const line = lines[j];
    if (indentWidth(line) <= 3) {
      const s = firstNonWs(line);
      if (line.charCodeAt(s) === 62) { // >
        content.push({ text: stripBQMarker(line), lazy: false });
        prevLazy = false;
        j++;
        continue;
      }
    }
    if (isBlankLine(line)) break;
    // lazy line: must continue an open paragraph
    if (content.length === 0) break;
    const soFar = content.map(c => c.text);
    if (isBlankLine(soFar[soFar.length - 1])) break;
    const probe = lexRange(soFar, 0, soFar.length, new Map(), srcEndsWithNL, null, false);
    if (!innermostOpenIsParagraph(probe.tokens)) break;
    if (lazyLineEndsQuote(line)) break;
    let text = line;
    // a lazy line indented 4+ columns is dedented by 4 (it is paragraph
    // text, not indented code)
    if (indentWidth(line) >= 4) text = dedentColumns(line, 4);
    const sl = setextLevel(line);
    if (sl > 0 && prevLazy && line.charCodeAt(0) !== 9) {
      // lazy setext underline after a lazy line: neutralize it with 4 spaces
      let k = 0;
      while (k < line.length && line.charCodeAt(k) === 32) k++;
      text = '    ' + line.slice(k);
    }
    content.push({ text, lazy: true });
    prevLazy = true;
    j++;
  }
  const innerLines = content.map(c => c.text);
  const innerLazy = content.map(c => c.lazy);
  const tokens = lexRange(innerLines, 0, innerLines.length, defs, false, innerLazy, false).tokens;
  return { token: { type: 'blockquote', tokens }, endIdx: j };
}

// --- list parsing ---
// compute the content indent for a list item (columns)
function listContentIndent(line, li) {
  const markerEndCol = columnOf(line, firstNonWs(line) + li.marker.length);
  const markerIndent = indentWidth(line);
  const markerWidth = markerEndCol - markerIndent;
  if (li.contentIdx < 0) return markerIndent + markerWidth + 1;
  const contentCol = columnOf(line, li.contentIdx);
  const spacesAfter = contentCol - markerEndCol;
  if (spacesAfter >= 5) return markerIndent + markerWidth + 1;
  return contentCol;
}
// collect one list item's content lines; returns {lines, lazy, endIdx, hasInternalBlank}
// does this line look like a table delimiter row (only | - : space tab,
// at least one dash)? Used by the incremental paragraph tracker.
function looksLikeTableDelim(line) {
  let hasDash = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 45) { hasDash = true; continue; }
    if (c === 124 || c === 58 || c === 32 || c === 9) continue;
    return false;
  }
  return hasDash;
}
function collectListItem(lines, i, end, li) {
  const contentIndent = listContentIndent(lines[i], li);
  const content = [];
  const lazyArr = [];
  let j = i;
  // first line: the content after the marker. The content starts at column
  // contentCol; the content line keeps (contentCol - contentIndent) spaces.
  if (li.contentIdx >= 0) {
    const contentCol = columnOf(lines[i], li.contentIdx);
    content.push(' '.repeat(Math.max(0, contentCol - contentIndent)) + lines[i].slice(li.contentIdx));
    lazyArr.push(false);
    j = i + 1;
  } else {
    j = i + 1;
  }
  let hasInternalBlank = false;
  let pendingBlanks = 0;
  // fenced code tracking: fence content lines are part of the item regardless
  // of their indent, so while inside a fence we collect every line
  let inFence = false, fenceCh = 0, fenceLen = 0, fenceHasContent = false;
  const fenceStart = (d) => {
    const f = fenceInfo(d);
    if (!f) return false;
    inFence = true; fenceCh = f.ch; fenceLen = f.len; fenceHasContent = false;
    return true;
  };
  const fenceClose = (d) => {
    const s = firstNonWs(d);
    if (indentWidth(d) > 3) return false;
    if (d.charCodeAt(s) !== fenceCh) return false;
    let p = s, n = 0;
    while (p < d.length && d.charCodeAt(p) === fenceCh) { p++; n++; }
    if (n < fenceLen) return false;
    while (p < d.length && d.charCodeAt(p) === 32) p++;
    if (p < d.length) return false;
    return true;
  };
  if (content.length > 0) fenceStart(content[content.length - 1]);
  // incremental paragraph state (replaces the O(n^2) lexRange probe):
  // 'none' = last block is not a paragraph, 'direct' = content ends with a
  // paragraph that is a direct child, 'nested' = innermost open block is a
  // paragraph inside a blockquote / nested list.
  let paraState = 'none';
  const noteLine = (d) => {
    if (isBlankLine(d)) { paraState = 'none'; return; }
    if (paraState !== 'none') {
      if (interruptsParagraph(d, true)) { paraState = 'none'; return; }
      if (setextLevel(d)) { paraState = 'none'; return; }
      if (looksLikeTableDelim(d)) { paraState = 'none'; return; }
      return; // paragraph continues (stays direct or nested)
    }
    // no paragraph open: does d start a new block?
    if (atxHeading(d) || fenceInfo(d) || isThematicBreak(d)) { paraState = 'none'; return; }
    const hb = htmlBlockInfo(d);
    if (hb && hb.kind !== 'tag') { paraState = 'none'; return; }
    if (indentWidth(d) >= 4) { paraState = 'none'; return; }
    const s = firstNonWs(d);
    if (d.charCodeAt(s) === 62) { // > blockquote: paragraph inside it is nested
      const inner = d.slice(s + 1).replace(/^[ \t]/, '');
      if (isBlankLine(inner)) { paraState = 'none'; return; }
      if (atxHeading(inner) || fenceInfo(inner) || isThematicBreak(inner)) { paraState = 'none'; return; }
      paraState = 'nested';
      return;
    }
    const li2 = listItemStart(d);
    if (li2) {
      if (li2.contentIdx < 0) { paraState = 'none'; return; }
      paraState = 'nested';
      return;
    }
    paraState = 'direct';
  };
  const noteBlanks = (n) => { if (n > 0) paraState = 'none'; };
  if (content.length > 0) noteLine(content[content.length - 1]);
  while (j < end) {
    const line = lines[j];
    if (inFence) {
      // fence content: a non-blank line indented less than the item's
      // content indent is OUTSIDE the item (no lazy continuation inside
      // a fence) -- but ONLY if the fence has no content yet. Once an
      // indented content line has been collected, later low-indent lines
      // are part of the open fence. If the first content line is
      // low-indent, the item ends here and the fence is cut short.
      if (!isBlankLine(line) && indentWidth(line) < contentIndent && !fenceHasContent) break;
      // fence content: dedent by the content indent if possible, else as-is
      const ind = indentWidth(line);
      let d;
      if (ind >= contentIndent) { d = dedentColumns(line, contentIndent, true); if (!isBlankLine(d)) fenceHasContent = true; }
      else d = line;
      if (pendingBlanks > 0) { hasInternalBlank = true; for (let b = 0; b < pendingBlanks; b++) { content.push(''); lazyArr.push(false); } noteBlanks(pendingBlanks); }
      pendingBlanks = 0;
      content.push(d);
      lazyArr.push(false);
      paraState = 'none';
      if (!isBlankLine(d) && fenceClose(d)) inFence = false;
      j++;
      continue;
    }
    if (isBlankLine(line)) {
      // a blank line before any content ends an empty item
      if (content.length === 0) break;
      pendingBlanks++;
      j++;
      continue;
    }
    const ind = indentWidth(line);
    if (ind >= contentIndent) {
      // indented content line: dedent by the content indent
      const d = dedentColumns(line, contentIndent, true);
      // if it would be indented code while a paragraph is open, it is a lazy
      // continuation: dedent by 4 more columns. Only when the paragraph is
      // a direct child of this item; a nested item's paragraph is dedented
      // by that item, not by us. A leading tab that straddles the
      // container boundary is not indented-code indent (its remainder is
      // content), so the +4 dedent must not apply to tab-indented lines.
      const leadHasTab = (() => { for (let q = 0; q < line.length; q++) { const cc = line.charCodeAt(q); if (cc === 9) return true; if (cc !== 32) break; } return false; })();
      if (indentWidth(d) >= 4 && !leadHasTab && content.length > 0 && pendingBlanks === 0 && !isBlankLine(content[content.length - 1])) {
        if (paraState === 'direct') {
          if (pendingBlanks > 0) { hasInternalBlank = true; for (let b = 0; b < pendingBlanks; b++) { content.push(''); lazyArr.push(false); } }
          pendingBlanks = 0;
          const ld = dedentColumns(line, contentIndent + 4);
          content.push(ld);
          lazyArr.push(true);
          noteLine(ld);
          j++;
          continue;
        }
      }
      if (pendingBlanks > 0) { hasInternalBlank = true; for (let b = 0; b < pendingBlanks; b++) { content.push(''); lazyArr.push(false); } noteBlanks(pendingBlanks); }
      pendingBlanks = 0;
      content.push(d);
      lazyArr.push(false);
      noteLine(d);
      fenceStart(d);
      j++;
      continue;
    }
    // indent < content indent: a lazy line (only if a paragraph is open, and
    // no blank line has intervened — a blank line ends the paragraph)
    if (content.length === 0) break;
    if (pendingBlanks > 0) break;
    if (lazyLineEndsQuote(line)) break;
    if (isBlankLine(content[content.length - 1])) break;
    if (paraState === 'none') break;
    // a lazy line that would be indented code is dedented by 4
    if (ind >= 4) {
      if (pendingBlanks > 0) { hasInternalBlank = true; for (let b = 0; b < pendingBlanks; b++) { content.push(''); lazyArr.push(false); } noteBlanks(pendingBlanks); }
      pendingBlanks = 0;
      const ld = dedentColumns(line, 4);
      content.push(ld);
      lazyArr.push(true);
      noteLine(ld);
      j++;
      continue;
    }
    if (pendingBlanks > 0) { hasInternalBlank = true; for (let b = 0; b < pendingBlanks; b++) { content.push(''); lazyArr.push(false); } noteBlanks(pendingBlanks); }
    pendingBlanks = 0;
    content.push(line);
    lazyArr.push(true);
    noteLine(line);
    j++;
  }
  // trailing blank lines are not part of the item
  return { lines: content, lazy: lazyArr, endIdx: j - pendingBlanks, hasInternalBlank };
}
function lexList(lines, i, end, defs, srcEndsWithNL) {
  const first = listItemStart(lines[i]);
  const ordered = first.ordered;
  const bulletChar = ordered ? null : first.marker;
  const delim = ordered ? first.marker[first.marker.length - 1] : null;
  const startNum = ordered ? first.start : null;
  const items = [];
  let j = i;
  let loose = false;
  while (j < end) {
    // a thematic break line ends the list (it is an <hr>, not an item)
    if (isThematicBreak(lines[j])) break;
    const li = listItemStart(lines[j]);
    if (!li) break;
    if (li.ordered !== ordered) break;
    if (ordered) {
      if (li.marker[li.marker.length - 1] !== delim) break;
    } else if (li.marker !== bulletChar) break;
    const res = collectListItem(lines, j, end, li);
    const itemLex = lexRange(res.lines, 0, res.lines.length, defs, false, res.lazy, true);
    const itemTokens = itemLex.tokens;
    if (itemLex.loose) loose = true;
    // task list: first line of the item's first paragraph starts with [ ] / [x] / [X]
    let task = false, checked = false;
    if (itemTokens.length > 0 && itemTokens[0].type === 'paragraph') {
      const txt = itemTokens[0].text;
      if (txt.length >= 4 && txt.charCodeAt(0) === 91) {
        const c1 = txt.charCodeAt(1);
        if ((c1 === 32 || c1 === 120 || c1 === 88) && txt.charCodeAt(2) === 93 && txt.charCodeAt(3) === 32) {
          task = true;
          checked = (c1 === 120 || c1 === 88);
          itemTokens[0].text = txt.slice(4);
        }
      }
    }
    items.push({ type: 'list_item', task, checked, tokens: itemTokens });
    // blank lines before the next item make the whole list loose; only skip
    // past them when another item of the same kind actually follows, so the
    // caller still sees a blank line before a non-list block
    let k = res.endIdx;
    while (k < end && isBlankLine(lines[k])) k++;
    const nk = k < end ? listItemStart(lines[k]) : null;
    const sameKind = nk && nk.ordered === ordered &&
      (ordered ? nk.marker[nk.marker.length - 1] === delim : nk.marker === bulletChar);
    if (k > res.endIdx && sameKind) {
      loose = true;
      j = k;
    } else {
      j = res.endIdx;
    }
    // if the next line is not a list item of the same kind, stop
    if (j < end) {
      const nl = listItemStart(lines[j]);
      if (!nl) break;
      if (nl.ordered !== ordered) break;
      if (ordered) {
        if (nl.marker[nl.marker.length - 1] !== delim) break;
      } else if (nl.marker !== bulletChar) break;
    }
  }
  return { token: { type: 'list', ordered, start: startNum, loose, items }, endIdx: j };
}

// ---------- renderer ----------
function renderTokens(tokens, refs) {
  let html = '';
  for (let idx = 0; idx < tokens.length; idx++) {
    html += renderToken(tokens[idx], refs);
  }
  return html;
}
function renderTableCell(tag, content, align) {
  let cell = '<' + tag;
  if (align) cell += ' align="' + align + '"';
  return cell + '>' + content + '</' + tag + '>\n';
}
function renderTable(tok, refs) {
  let html = '<table>\n<thead>\n<tr>\n';
  for (let k = 0; k < tok.header.length; k++) {
    html += renderTableCell('th', inline(tok.header[k], refs), tok.align[k]);
  }
  html += '</tr>\n</thead>\n';
  if (tok.rows.length === 0) return html + '</table>\n';
  html += '<tbody>';
  for (const row of tok.rows) {
    html += '<tr>\n';
    for (let k = 0; k < row.length; k++) {
      html += renderTableCell('td', inline(row[k], refs), tok.align[k]);
    }
    html += '</tr>\n';
  }
  return html + '</tbody></table>\n';
}
function renderList(tok, refs) {
  const tag = tok.ordered ? 'ol' : 'ul';
  let html = '<' + tag;
  if (tok.ordered && tok.start !== 1) html += ' start="' + tok.start + '"';
  html += '>\n';
  for (const item of tok.items) html += renderListItem(item, refs, tok.loose);
  return html + '</' + tag + '>\n';
}
function renderToken(tok, refs) {
  switch (tok.type) {
    case 'heading':
      return '<h' + tok.depth + '>' + inline(tok.text, refs) + '</h' + tok.depth + '>\n';
    case 'code': {
      let html = '<pre><code';
      if (tok.lang) html += ' class="language-' + escAttr(tok.lang) + '"';
      html += '>' + esc(tok.text);
      if (tok.text.length > 0 && !tok.text.endsWith('\n')) html += '\n';
      return html + '</code></pre>\n';
    }
    case 'hr':
      return '<hr>\n';
    case 'blockquote':
      return '<blockquote>\n' + renderTokens(tok.tokens, refs) + '</blockquote>\n';
    case 'list':
      return renderList(tok, refs);
    case 'paragraph':
      return '<p>' + inline(tok.text, refs) + '</p>\n';
    case 'html':
      return tok.text;
    case 'table':
      return renderTable(tok, refs);
    default:
      return '';
  }
}
function renderListItem(item, refs, loose) {
  let html = '<li>';
  const children = item.tokens;
  if (children.length === 0) return html + '</li>\n';
  // task checkbox goes before the first paragraph's content (inside <p>
  // when the list is loose)
  let isFirst = true;
  for (const child of children) {
    if (child.type === 'paragraph') {
      const box = (isFirst && item.task)
        ? (item.checked ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ')
        : '';
      if (loose) html += '<p>' + box + inline(child.text, refs) + '</p>\n';
      else html += box + inline(child.text, refs);
    } else {
      html += renderToken(child, refs);
    }
    isFirst = false;
  }
  return html + '</li>\n';
}

// ---------- public entry point ----------
export function parse(markdown) {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let endsWithNewline = false;
  if (normalized.endsWith('\n')) { lines.pop(); endsWithNewline = true; }
  const definitions = new Map();
  const blockTokens = lexRange(lines, 0, lines.length, definitions, endsWithNewline, null, false).tokens;
  return renderTokens(blockTokens, definitions);
}
