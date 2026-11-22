// csv-reader-fast: a faster drop-in for csv-reader 1.0.0 (make.fun).
//
// Returns exactly csv-reader's answer for every input {text, header}:
// {columns, rows, errors}. Same reading policy, written for speed:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded with "" (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line the 1-based line
//     its record starts on, row its record's index in rows, null for the header.
//
// How it is fast: clean lines (no quotes, no stray CR) are split with one
// slice + String split; unquoted fields are read with a tight charCodeAt loop
// that slices whole runs instead of building strings a character at a time;
// quoted fields jump from quote to quote with indexOf and slice whole chunks.
// Error objects are only built when an error actually occurs, so the hot path
// for clean rows allocates nothing but the answer itself.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next. Dependency-free ES module.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters the last unquoted
  // read kept (for quote_junk). Kept in locals instead of a result object so
  // the hot path allocates nothing per field.
  let ended = END;
  let added = 0;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field; `ended`
  // and `added` (the characters kept) are left in the locals above.
  function readUnquoted(value) {
    added = 0;
    let start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        // ','
        if (pos > start) {
          value += text.slice(start, pos);
          added += pos - start;
        }
        pos += 1;
        ended = COMMA;
        return value;
      }
      if (c === 10) {
        // '\n'
        if (pos > start) {
          value += text.slice(start, pos);
          added += pos - start;
        }
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      if (c === 13) {
        // '\r'
        if (pos > start) {
          value += text.slice(start, pos);
          added += pos - start;
        }
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          return value;
        }
        pushError('stray_cr');
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    if (pos > start) {
      value += text.slice(start, pos);
      added += pos - start;
    }
    ended = END;
    return value;
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field;
  // `ended` is left in the local above.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        pushError('unterminated_quote');
        return readUnquoted('"');
      }
      if (q > p) {
        const chunk = text.slice(p, q);
        if (chunk.indexOf('\r') === -1 && chunk.indexOf('\n') === -1) {
          value += chunk;
        } else {
          // CRLF and a lone CR inside quotes are each one LF, and each
          // counts one line.
          value += chunk.replace(/\r\n?|\n/g, () => {
            line += 1;
            return '\n';
          });
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // '""' inside the field is one quote.
        value += '"';
        p = q + 2;
        continue;
      }
      // The closing quote is at q.
      pos = q + 1;
      if (pos >= len) {
        ended = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        ended = COMMA;
        return value;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (added > 0) pushError('quote_junk');
      return junk;
    }
  }

  // Stores a finished record: the header, or a row padded or cut to the
  // first record's width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: one physical line with no quotes and no stray CR (a trailing
    // CR before its LF is the CRLF line break). Split it in one go.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    const seg = text.slice(pos, lineEnd);
    if (seg.indexOf('"') === -1) {
      const r = seg.indexOf('\r');
      if (r === -1 || (nl !== -1 && r === seg.length - 1)) {
        const fields = (r === -1 ? seg : seg.slice(0, -1)).split(',');
        pos = nl === -1 ? len : nl + 1;
        line += 1;
        finishRecord(fields);
        continue;
      }
    }

    // Slow path: the line holds a quote or a stray CR.
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
