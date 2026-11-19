package server

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Online documents come in two kinds. A "doc" is a list of blocks whose text
// is Markdown inline syntax (**bold**, *italic*, ~~strike~~, `code`,
// [link](url)), so it imports and exports Markdown losslessly and maps onto
// Word runs. A "sheet" is a set of named grids whose cells hold what the user
// typed: a value or a formula starting with "=".
//
// Collaboration is server-ordered. Clients send operations; the server applies
// them one batch at a time, assigns the next version and sends the resolved
// operations to everyone with the document open. Text inside one block is
// merged (each side's change is replayed onto the other), everything else is
// last writer wins, which is what Feishu users see for cells and block types.

const (
	docMaxBlocks    = 20000
	docMaxBlockText = 20000
	sheetMaxRows    = 50000
	sheetMaxCols    = 200
	sheetMaxCells   = 300000
	sheetMaxPages   = 50
	docMaxBytes     = 8 << 20
)

var docBlockTypes = map[string]bool{"p": true, "h1": true, "h2": true, "h3": true, "bullet": true, "ordered": true, "todo": true, "quote": true, "code": true, "divider": true, "table": true}
var docIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)

type docBlock struct {
	ID      string     `json:"id"`
	Type    string     `json:"type"`
	Text    string     `json:"text"`
	Checked bool       `json:"checked,omitempty"`
	Lang    string     `json:"lang,omitempty"`
	Rows    [][]string `json:"rows,omitempty"`
}
type docBody struct {
	Blocks []docBlock `json:"blocks"`
}

type sheetStyle struct {
	B  bool   `json:"b,omitempty"`
	I  bool   `json:"i,omitempty"`
	U  bool   `json:"u,omitempty"`
	S  bool   `json:"s,omitempty"`
	A  string `json:"a,omitempty"`
	BG string `json:"bg,omitempty"`
	C  string `json:"c,omitempty"`
}
type sheetCell struct {
	V string      `json:"v,omitempty"`
	S *sheetStyle `json:"s,omitempty"`
}
type sheetPage struct {
	ID    string               `json:"id"`
	Name  string               `json:"name"`
	Cells map[string]sheetCell `json:"cells"`
	Cols  map[string]int       `json:"cols,omitempty"`
}
type sheetMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type sheetBody struct {
	Sheets []sheetPage `json:"sheets"`
}

type docOp struct {
	Op    string      `json:"op"`
	ID    string      `json:"id,omitempty"`
	After *string     `json:"after,omitempty"`
	Block *docBlock   `json:"block,omitempty"`
	Base  *string     `json:"base,omitempty"`
	Text  *string     `json:"text,omitempty"`
	Sheet string      `json:"sheet,omitempty"`
	Ref   string      `json:"ref,omitempty"`
	Cell  *sheetCell  `json:"cell,omitempty"`
	At    int         `json:"at,omitempty"`
	N     int         `json:"n,omitempty"`
	Name  string      `json:"name,omitempty"`
	Col   string      `json:"col,omitempty"`
	Width int         `json:"width,omitempty"`
	Page  *sheetPage  `json:"page,omitempty"`
	Pages []sheetMeta `json:"pages,omitempty"`
}

func newDocBody() docBody { return docBody{Blocks: []docBlock{{ID: newID()[:12], Type: "p"}}} }
func newSheetBody() sheetBody {
	return sheetBody{Sheets: []sheetPage{{ID: newID()[:12], Name: "Sheet1", Cells: map[string]sheetCell{}}}}
}

// splice describes how b differs from a as one replaced run of runes.
func splice(a, b []rune) (pos, del int, ins []rune) {
	for pos < len(a) && pos < len(b) && a[pos] == b[pos] {
		pos++
	}
	ea, eb := len(a), len(b)
	for ea > pos && eb > pos && a[ea-1] == b[eb-1] {
		ea--
		eb--
	}
	return pos, ea - pos, b[pos:eb]
}

// mergeText replays the change base→mine onto theirs (base→theirs having
// happened first). The browser runs the same function, so both sides agree.
func mergeText(base, mine, theirs string) string {
	if mine == base || theirs == mine {
		return theirs
	}
	if theirs == base {
		return mine
	}
	b, m, t := []rune(base), []rune(mine), []rune(theirs)
	p1, d1, i1 := splice(b, m)
	p2, d2, i2 := splice(b, t)
	// Positions of mine in theirs. A start lands after text they inserted
	// there, an end before it, so a deletion next to or around their
	// insertion keeps what they typed.
	startAt := func(p int) int {
		switch {
		case p < p2:
			return p
		case p >= p2+d2:
			return p + len(i2) - d2
		default:
			return p2 + len(i2)
		}
	}
	endAt := func(p int) int {
		switch {
		case p < p2:
			return p
		case p <= p2+d2:
			return p2
		default:
			return p + len(i2) - d2
		}
	}
	start, end := startAt(p1), endAt(p1+d1)
	if end < start {
		end = start
	}
	var keep []rune
	if len(i2) > 0 && p2 >= start && p2+len(i2) <= end {
		keep = t[p2 : p2+len(i2)]
	}
	out := make([]rune, 0, len(t)+len(i1))
	out = append(append(append(append(out, t[:start]...), i1...), keep...), t[end:]...)
	return string(out)
}

func validBlock(b *docBlock) error {
	if b == nil || !docIDPattern.MatchString(b.ID) || !docBlockTypes[b.Type] || !validText(b.Text, docMaxBlockText) || len(b.Lang) > 30 {
		return fmt.Errorf("文档内容无效")
	}
	if len(b.Rows) > 500 {
		return fmt.Errorf("表格最多 500 行")
	}
	for _, row := range b.Rows {
		if len(row) > 50 {
			return fmt.Errorf("表格最多 50 列")
		}
		for _, cell := range row {
			if !validText(cell, 5000) {
				return fmt.Errorf("表格内容过长")
			}
		}
	}
	if b.Type != "table" {
		b.Rows = nil
	}
	if b.Type != "todo" {
		b.Checked = false
	}
	if b.Type != "code" {
		b.Lang = ""
	}
	return nil
}

func (d *docBody) index(id string) int {
	for i, b := range d.Blocks {
		if b.ID == id {
			return i
		}
	}
	return -1
}

// place inserts b after the block with id after ("" is the top) and returns
// the id it really follows, since that block may have been removed meanwhile.
func (d *docBody) place(b docBlock, after string) string {
	at := 0
	if after != "" {
		if i := d.index(after); i >= 0 {
			at = i + 1
		} else {
			at = len(d.Blocks)
		}
	}
	d.Blocks = append(d.Blocks, docBlock{})
	copy(d.Blocks[at+1:], d.Blocks[at:])
	d.Blocks[at] = b
	if at == 0 {
		return ""
	}
	return d.Blocks[at-1].ID
}

// applyDocOps applies a batch and returns the operations as they ended up,
// plus whether the block order changed.
func applyDocOps(d *docBody, ops []docOp) (out []docOp, reordered bool, err error) {
	for _, op := range ops {
		switch op.Op {
		case "insert":
			if op.Block == nil {
				return nil, false, fmt.Errorf("文档内容无效")
			}
			b := *op.Block
			if err = validBlock(&b); err != nil {
				return nil, false, err
			}
			if d.index(b.ID) >= 0 {
				continue
			}
			if len(d.Blocks) >= docMaxBlocks {
				return nil, false, fmt.Errorf("文档最多 %d 段", docMaxBlocks)
			}
			after := ""
			if op.After != nil {
				after = *op.After
			}
			real := d.place(b, after)
			out = append(out, docOp{Op: "insert", After: &real, Block: &b})
			reordered = true
		case "delete":
			if i := d.index(op.ID); i >= 0 {
				d.Blocks = append(d.Blocks[:i], d.Blocks[i+1:]...)
				out = append(out, docOp{Op: "delete", ID: op.ID})
				reordered = true
			}
		case "move":
			i := d.index(op.ID)
			if i < 0 || op.After == nil || *op.After == op.ID {
				continue
			}
			b := d.Blocks[i]
			d.Blocks = append(d.Blocks[:i], d.Blocks[i+1:]...)
			real := d.place(b, *op.After)
			out = append(out, docOp{Op: "move", ID: op.ID, After: &real})
			reordered = true
		case "text":
			i := d.index(op.ID)
			if i < 0 || op.Text == nil {
				continue
			}
			base := d.Blocks[i].Text
			if op.Base != nil {
				base = *op.Base
			}
			text := mergeText(base, *op.Text, d.Blocks[i].Text)
			if !validText(text, docMaxBlockText) {
				return nil, false, fmt.Errorf("单段最多 %d 字", docMaxBlockText)
			}
			d.Blocks[i].Text = text
			out = append(out, docOp{Op: "text", ID: op.ID, Text: &text})
		case "block":
			if op.Block == nil {
				return nil, false, fmt.Errorf("文档内容无效")
			}
			i := d.index(op.Block.ID)
			if i < 0 {
				continue
			}
			b := *op.Block
			b.Text = d.Blocks[i].Text
			if err = validBlock(&b); err != nil {
				return nil, false, err
			}
			d.Blocks[i] = b
			out = append(out, docOp{Op: "block", Block: &b})
		default:
			return nil, false, fmt.Errorf("不支持的文档操作")
		}
	}
	if len(d.Blocks) == 0 {
		b := docBlock{ID: newID()[:12], Type: "p"}
		top := ""
		d.Blocks = []docBlock{b}
		out = append(out, docOp{Op: "insert", After: &top, Block: &b})
		reordered = true
	}
	return out, reordered, nil
}

func (d *docBody) order() []string {
	ids := make([]string, len(d.Blocks))
	for i, b := range d.Blocks {
		ids[i] = b.ID
	}
	return ids
}

// Cell references -----------------------------------------------------------

var cellRefPattern = regexp.MustCompile(`^([A-Z]{1,3})([1-9][0-9]{0,5})$`)

func columnName(n int) string {
	s := ""
	for n > 0 {
		n--
		s = string(rune('A'+n%26)) + s
		n /= 26
	}
	return s
}
func columnNumber(s string) int {
	n := 0
	for _, r := range s {
		n = n*26 + int(r-'A'+1)
	}
	return n
}
func parseRef(ref string) (col, row int, ok bool) {
	m := cellRefPattern.FindStringSubmatch(ref)
	if m == nil {
		return 0, 0, false
	}
	col = columnNumber(m[1])
	row, _ = strconv.Atoi(m[2])
	return col, row, col >= 1 && col <= sheetMaxCols && row >= 1 && row <= sheetMaxRows
}
func cellName(col, row int) string { return columnName(col) + strconv.Itoa(row) }

var sheetNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.]*$`)

// sheetPrefix is how a formula names another sheet.
func sheetPrefix(name string) string {
	if sheetNamePattern.MatchString(name) && !cellRefPattern.MatchString(strings.ToUpper(name)) {
		return name + "!"
	}
	return "'" + strings.ReplaceAll(name, "'", "''") + "'!"
}

// formulaRef matches an optional sheet prefix and a cell or range reference.
var formulaRef = regexp.MustCompile(`((?:'(?:[^']|'')+'|[A-Za-z_\p{Han}][A-Za-z0-9_.\p{Han}]*)!)?(\$?)([A-Z]{1,3})(\$?)([0-9]+)(?::(\$?)([A-Z]{1,3})(\$?)([0-9]+))?`)

func unquoteSheet(prefix string) string {
	prefix = strings.TrimSuffix(prefix, "!")
	if strings.HasPrefix(prefix, "'") {
		return strings.ReplaceAll(strings.Trim(prefix, "'"), "''", "'")
	}
	return prefix
}

// rewriteRefs calls fn for every reference outside string literals. fn gets
// the sheet the reference points to and both ends of it, and returns the new
// text (or keep=true to leave it as it was).
func rewriteRefs(formula, current string, fn func(sheet string, m []string) (string, bool)) string {
	var out strings.Builder
	inString := false
	start := 0
	flush := func(end int) {
		chunk := formula[start:end]
		locs := formulaRef.FindAllStringSubmatchIndex(chunk, -1)
		last := 0
		for _, loc := range locs {
			before := byte(0)
			if loc[0] > 0 {
				before = chunk[loc[0]-1]
			}
			after := byte(0)
			if loc[1] < len(chunk) {
				after = chunk[loc[1]]
			}
			// Not part of a longer name, and not a function call like LOG10(.
			if before == '_' || before == '.' || (before >= 'A' && before <= 'Z') || (before >= 'a' && before <= 'z') || (before >= '0' && before <= '9') || after == '(' || (after >= 'A' && after <= 'Z') || (after >= 'a' && after <= 'z') || after == '_' {
				continue
			}
			m := make([]string, 10)
			for i := 0; i < 10; i++ {
				if loc[2*i] >= 0 {
					m[i] = chunk[loc[2*i]:loc[2*i+1]]
				}
			}
			sheet := current
			if m[1] != "" {
				sheet = unquoteSheet(m[1])
			}
			if text, keep := fn(sheet, m); !keep {
				out.WriteString(chunk[last:loc[0]])
				out.WriteString(text)
				last = loc[1]
			}
		}
		out.WriteString(chunk[last:])
	}
	for i := 0; i < len(formula); i++ {
		if formula[i] != '"' {
			continue
		}
		if !inString {
			flush(i)
			start = i
			inString = true
		} else if i+1 < len(formula) && formula[i+1] == '"' {
			i++
		} else {
			out.WriteString(formula[start : i+1])
			start = i + 1
			inString = false
		}
	}
	if inString {
		out.WriteString(formula[start:])
	} else {
		flush(len(formula))
	}
	return out.String()
}

// shiftAxis moves one end of a reference for an insert (n>0) or delete (n<0)
// at position at; ok is false when a single reference was deleted.
func shiftAxis(v, at, n int) (int, bool) {
	if n > 0 {
		if v >= at {
			return v + n, true
		}
		return v, true
	}
	del := -n
	if v >= at+del {
		return v - del, true
	}
	if v >= at {
		return at, false
	}
	return v, true
}

// shiftFormula adjusts references to sheet target after inserting (n>0) or
// deleting (n<0) rows or columns at position at, like Excel does.
func shiftFormula(formula, current, target string, rows bool, at, n int) string {
	return rewriteRefs(formula, current, func(sheet string, m []string) (string, bool) {
		if sheet != target {
			return "", true
		}
		c1, r1 := columnNumber(m[3]), atoi(m[5])
		single := m[7] == ""
		c2, r2 := c1, r1
		if !single {
			c2, r2 = columnNumber(m[7]), atoi(m[9])
		}
		var ok1, ok2 bool
		if rows {
			if n < 0 && !single {
				// A range shrinks around the deleted rows.
				del := -n
				if r1 >= at && r1 < at+del {
					r1 = at + del
				}
				if r2 >= at && r2 < at+del {
					r2 = at - 1
				}
				if r2 < r1 {
					return m[1] + "#REF!", false
				}
			}
			r1, ok1 = shiftAxis(r1, at, n)
			r2, ok2 = shiftAxis(r2, at, n)
		} else {
			if n < 0 && !single {
				del := -n
				if c1 >= at && c1 < at+del {
					c1 = at + del
				}
				if c2 >= at && c2 < at+del {
					c2 = at - 1
				}
				if c2 < c1 {
					return m[1] + "#REF!", false
				}
			}
			c1, ok1 = shiftAxis(c1, at, n)
			c2, ok2 = shiftAxis(c2, at, n)
		}
		if single && (!ok1 || !ok2) {
			return m[1] + "#REF!", false
		}
		text := m[1] + m[2] + columnName(c1) + m[4] + strconv.Itoa(r1)
		if !single {
			text += ":" + m[6] + columnName(c2) + m[8] + strconv.Itoa(r2)
		}
		return text, false
	})
}

// offsetFormula moves the relative parts of every reference by dc, dr, as
// when a formula is copied (and for Excel's shared formulas).
func offsetFormula(formula string, dc, dr int) string {
	return rewriteRefs(formula, "", func(_ string, m []string) (string, bool) {
		move := func(abs, col, absRow, row string) string {
			c, r := columnNumber(col), atoi(row)
			if abs == "" {
				c += dc
			}
			if absRow == "" {
				r += dr
			}
			if c < 1 || r < 1 {
				return "#REF!"
			}
			return abs + columnName(c) + absRow + strconv.Itoa(r)
		}
		text := m[1] + move(m[2], m[3], m[4], m[5])
		if m[7] != "" {
			text += ":" + move(m[6], m[7], m[8], m[9])
		}
		return text, false
	})
}

func renameInFormula(formula, current, old, name string) string {
	return rewriteRefs(formula, current, func(sheet string, m []string) (string, bool) {
		if m[1] == "" || sheet != old {
			return "", true
		}
		return sheetPrefix(name) + strings.TrimPrefix(m[0], m[1]), false
	})
}

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

func (b *sheetBody) find(id string) int {
	for i, p := range b.Sheets {
		if p.ID == id {
			return i
		}
	}
	return -1
}
func (b *sheetBody) meta() []sheetMeta {
	out := make([]sheetMeta, len(b.Sheets))
	for i, p := range b.Sheets {
		out[i] = sheetMeta{p.ID, p.Name}
	}
	return out
}
func (b *sheetBody) cellCount() int {
	n := 0
	for _, p := range b.Sheets {
		n += len(p.Cells)
	}
	return n
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validCell(c *sheetCell) bool {
	if c == nil {
		return true
	}
	if !validText(c.V, 32000) {
		return false
	}
	if s := c.S; s != nil {
		if (s.A != "" && s.A != "left" && s.A != "center" && s.A != "right") || (s.BG != "" && !colorPattern.MatchString(s.BG)) || (s.C != "" && !colorPattern.MatchString(s.C)) {
			return false
		}
		if *s == (sheetStyle{}) {
			c.S = nil
		}
	}
	return true
}

func validSheetName(b *sheetBody, name, except string) error {
	name = strings.TrimSpace(name)
	if name == "" || !validText(name, 31) || strings.ContainsAny(name, `[]:*?/\`) {
		return fmt.Errorf("工作表名称需为 1–31 字，且不含 [ ] : * ? / \\")
	}
	for _, p := range b.Sheets {
		if p.ID != except && strings.EqualFold(p.Name, name) {
			return fmt.Errorf("已有同名工作表")
		}
	}
	return nil
}

// structural inserts or deletes rows or columns in one page and fixes every
// formula in the workbook that points at it; it returns the pages changed.
func (b *sheetBody) structural(pi int, rows bool, at, n int) []int {
	target := b.Sheets[pi].Name
	page := &b.Sheets[pi]
	moved := map[string]sheetCell{}
	for ref, c := range page.Cells {
		col, row, _ := parseRef(ref)
		v := row
		if !rows {
			v = col
		}
		nv, ok := shiftAxis(v, at, n)
		if !ok {
			continue
		}
		if rows {
			row = nv
		} else {
			col = nv
		}
		if row > sheetMaxRows || col > sheetMaxCols {
			continue
		}
		moved[cellName(col, row)] = c
	}
	page.Cells = moved
	if !rows && len(page.Cols) > 0 {
		cols := map[string]int{}
		for name, w := range page.Cols {
			if nv, ok := shiftAxis(columnNumber(name), at, n); ok && nv <= sheetMaxCols {
				cols[columnName(nv)] = w
			}
		}
		page.Cols = cols
	}
	changed := []int{pi}
	for i := range b.Sheets {
		touched := false
		for ref, c := range b.Sheets[i].Cells {
			if strings.HasPrefix(c.V, "=") {
				if f := shiftFormula(c.V, b.Sheets[i].Name, target, rows, at, n); f != c.V {
					c.V = f
					b.Sheets[i].Cells[ref] = c
					touched = true
				}
			}
		}
		if touched && i != pi {
			changed = append(changed, i)
		}
	}
	return changed
}

func applySheetOps(b *sheetBody, ops []docOp) (out []docOp, err error) {
	pageOp := func(i int) docOp { p := b.Sheets[i]; return docOp{Op: "page", Page: &p} }
	for _, op := range ops {
		switch op.Op {
		case "cell":
			pi := b.find(op.Sheet)
			if pi < 0 {
				continue
			}
			if _, _, ok := parseRef(op.Ref); !ok || !validCell(op.Cell) {
				return nil, fmt.Errorf("单元格内容无效")
			}
			if op.Cell == nil || (op.Cell.V == "" && op.Cell.S == nil) {
				delete(b.Sheets[pi].Cells, op.Ref)
				out = append(out, docOp{Op: "cell", Sheet: op.Sheet, Ref: op.Ref})
				continue
			}
			if _, exists := b.Sheets[pi].Cells[op.Ref]; !exists && b.cellCount() >= sheetMaxCells {
				return nil, fmt.Errorf("表格最多 %d 个单元格", sheetMaxCells)
			}
			b.Sheets[pi].Cells[op.Ref] = *op.Cell
			c := *op.Cell
			out = append(out, docOp{Op: "cell", Sheet: op.Sheet, Ref: op.Ref, Cell: &c})
		case "width":
			pi := b.find(op.Sheet)
			col := columnNumber(op.Col)
			if pi < 0 || !regexp.MustCompile(`^[A-Z]{1,3}$`).MatchString(op.Col) || col > sheetMaxCols || op.Width < 30 || op.Width > 1000 {
				continue
			}
			if b.Sheets[pi].Cols == nil {
				b.Sheets[pi].Cols = map[string]int{}
			}
			b.Sheets[pi].Cols[op.Col] = op.Width
			out = append(out, docOp{Op: "width", Sheet: op.Sheet, Col: op.Col, Width: op.Width})
		case "insertRows", "deleteRows", "insertCols", "deleteCols":
			pi := b.find(op.Sheet)
			limit := sheetMaxRows
			if strings.HasSuffix(op.Op, "Cols") {
				limit = sheetMaxCols
			}
			if pi < 0 || op.At < 1 || op.At > limit || op.N < 1 || op.N > 1000 {
				continue
			}
			n := op.N
			if strings.HasPrefix(op.Op, "delete") {
				n = -n
			}
			for _, i := range b.structural(pi, strings.HasSuffix(op.Op, "Rows"), op.At, n) {
				out = append(out, pageOp(i))
			}
		case "addSheet":
			if op.Page == nil || !docIDPattern.MatchString(op.Page.ID) || b.find(op.Page.ID) >= 0 {
				continue
			}
			if len(b.Sheets) >= sheetMaxPages {
				return nil, fmt.Errorf("最多 %d 个工作表", sheetMaxPages)
			}
			if err = validSheetName(b, op.Page.Name, ""); err != nil {
				return nil, err
			}
			b.Sheets = append(b.Sheets, sheetPage{ID: op.Page.ID, Name: strings.TrimSpace(op.Page.Name), Cells: map[string]sheetCell{}})
			out = append(out, pageOp(len(b.Sheets)-1), docOp{Op: "pages", Pages: b.meta()})
		case "renameSheet":
			pi := b.find(op.Sheet)
			if pi < 0 {
				continue
			}
			if err = validSheetName(b, op.Name, op.Sheet); err != nil {
				return nil, err
			}
			old, name := b.Sheets[pi].Name, strings.TrimSpace(op.Name)
			b.Sheets[pi].Name = name
			for i := range b.Sheets {
				touched := false
				for ref, c := range b.Sheets[i].Cells {
					if strings.HasPrefix(c.V, "=") {
						if f := renameInFormula(c.V, b.Sheets[i].Name, old, name); f != c.V {
							c.V = f
							b.Sheets[i].Cells[ref] = c
							touched = true
						}
					}
				}
				if touched {
					out = append(out, pageOp(i))
				}
			}
			out = append(out, docOp{Op: "pages", Pages: b.meta()})
		case "deleteSheet":
			pi := b.find(op.Sheet)
			if pi < 0 || len(b.Sheets) == 1 {
				continue
			}
			b.Sheets = append(b.Sheets[:pi], b.Sheets[pi+1:]...)
			out = append(out, docOp{Op: "pages", Pages: b.meta()})
		case "moveSheet":
			pi := b.find(op.Sheet)
			if pi < 0 || op.At < 0 || op.At >= len(b.Sheets) || op.At == pi {
				continue
			}
			p := b.Sheets[pi]
			b.Sheets = append(b.Sheets[:pi], b.Sheets[pi+1:]...)
			b.Sheets = append(b.Sheets[:op.At], append([]sheetPage{p}, b.Sheets[op.At:]...)...)
			out = append(out, docOp{Op: "pages", Pages: b.meta()})
		default:
			return nil, fmt.Errorf("不支持的表格操作")
		}
	}
	return out, nil
}
