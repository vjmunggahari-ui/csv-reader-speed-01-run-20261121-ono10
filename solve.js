// A fast drop-in for csv-reader 1.0.0: run(input) returns {columns, rows, errors} exactly as
// the reference does, for every {text, header}. Written from the written policy, not from the
// reference's code: the reference walks one character at a time, this one jumps field to field
// with indexOf and slices whole fields at once, and only falls back to a character walk for
// the rare field that holds a stray CR. No clock, no randomness, nothing kept between calls.
//
// Policy (make.fun's own): a U+FEFF at the very start is dropped; a record ends at LF or CRLF
// and a line with no characters is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field opening with a quote runs to the next undoubled quote ("" inside is one
// quote, each CRLF or lone CR inside reads as LF), what follows its closing quote up to the
// next comma or line break is appended as it stands (quote_junk when the field ends), and a
// quote that never closes is a literal character with the text after it read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is literal; fields stay strings, never
// trimmed or converted; columns is the first record when header is true, else null; rows holds
// the records after it, each padded with "" (short_row, with fields: its count) or cut
// (long_row, with extra: the cut fields) to the first record's width; each error is
// {code, line, row} in the order met, line the 1-based line its record starts on (every LF,
// CRLF and lone CR inside quotes counted), row its record's index in rows (null for the header).

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text[0] === '\uFEFF') pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: header).
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field from pos, appending onto `value` (added counts the characters
  // kept by this call only). Returns {value, ended, added}. `nl` is the index of the line
  // break that ends the current record (or -1): an unquoted field cannot pass it, so only
  // the next comma is searched and the field ends at the nearer of the two. A stray CR
  // inside the slice drops to the character walk below.
  function readUnquoted(value, nl) {
    let added = 0;
    if (pos >= n) return { value, ended: END, added };
    const iC = text.indexOf(',', pos);
    if (nl !== -1 && (iC === -1 || iC > nl)) {
      // The field ends at the record's line break (a CR right before the LF makes it CRLF).
      if (nl > pos && text[nl - 1] === '\r') {
        const seg = text.slice(pos, nl - 1);
        if (seg.indexOf('\r') !== -1) return slowUnquoted(value, added);
        value += seg;
        added += seg.length;
        pos = nl + 1;
        line += 1;
        return { value, ended: BREAK, added };
      }
      const seg = text.slice(pos, nl);
      if (seg.indexOf('\r') !== -1) return slowUnquoted(value, added);
      value += seg;
      added += seg.length;
      pos = nl + 1;
      line += 1;
      return { value, ended: BREAK, added };
    }
    if (iC === -1) {
      const seg = text.slice(pos);
      if (seg.indexOf('\r') !== -1) return slowUnquoted(value, added);
      value += seg;
      added += seg.length;
      pos = n;
      return { value, ended: END, added };
    }
    const seg = text.slice(pos, iC);
    if (seg.indexOf('\r') !== -1) return slowUnquoted(value, added);
    value += seg;
    added += seg.length;
    pos = iC + 1;
    return { value, ended: COMMA, added };
  }

  // The character walk, used only when a field holds a stray CR: the same reading as the
  // reference, one character at a time, a CR not followed by LF dropped (stray_cr).
  function slowUnquoted(value, added) {
    while (pos < n) {
      const c = text[pos];
      if (c === ',') {
        pos += 1;
        return { value, ended: COMMA, added };
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        return { value, ended: BREAK, added };
      }
      if (c === '\r') {
        if (text[pos + 1] === '\n') {
          pos += 2;
          line += 1;
          return { value, ended: BREAK, added };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        continue;
      }
      value += c;
      added += 1;
      pos += 1;
    }
    return { value, ended: END, added };
  }

  // Appends the quoted segment text[a..b) onto value: CR and LF inside it each read as one LF
  // and count one line; a segment with neither is sliced whole.
  function appendSegment(value, a, b) {
    const iN = text.indexOf('\n', a);
    const hasN = iN !== -1 && iN < b;
    const iR = text.indexOf('\r', a);
    const hasR = iR !== -1 && iR < b;
    if (!hasN && !hasR) return value + text.slice(a, b);
    let out = value;
    let i = a;
    while (i < b) {
      const c = text[i];
      if (c === '\r') {
        out += '\n';
        line += 1;
        i += text[i + 1] === '\n' ? 2 : 1;
      } else if (c === '\n') {
        out += '\n';
        line += 1;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted(nl) {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let scan = pos;
    while (true) {
      const j = text.indexOf('"', pos);
      if (j === -1) {
        // The quote never closes: it is a literal character, and the text after it is read
        // again as unquoted (the line count inside the failed scan is dropped).
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"', nl);
      }
      if (text[j + 1] === '"') {
        // A doubled quote: one quote in the value, and the scan goes on.
        value = appendSegment(value, scan, j);
        value += '"';
        pos = j + 2;
        scan = pos;
        continue;
      }
      value = appendSegment(value, scan, j);
      pos = j + 1;
      if (pos >= n) return { value, ended: END };
      const c = text[pos];
      if (c === ',') {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        return { value, ended: BREAK };
      }
      if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
        return { value, ended: BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the next comma or
      // line break; junk counts when characters were kept.
      const junk = readUnquoted(value, text.indexOf('\n', pos));
      if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let nl = text.indexOf('\n', pos);
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text[pos] === '"';
      if (quoted) {
        field = readQuoted(nl);
        if (field.ended === COMMA) nl = text.indexOf('\n', pos);
      } else {
        field = readUnquoted('', nl);
      }
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
