package server

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	pathpkg "path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Markdown ------------------------------------------------------------------

var (
	mdHeading  = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)
	mdTodo     = regexp.MustCompile(`^\s*[-*+]\s+\[([ xX])\]\s+(.*)$`)
	mdBullet   = regexp.MustCompile(`^\s*[-*+]\s+(.*)$`)
	mdOrdered  = regexp.MustCompile(`^\s*\d+[.)]\s+(.*)$`)
	mdDivider  = regexp.MustCompile(`^\s*([-*_])(\s*[-*_]){2,}\s*$`)
	mdTableSep = regexp.MustCompile(`^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$`)
)

func newBlockID() string { return newID()[:12] }

func splitTableRow(line string) []string {
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(strings.TrimSuffix(line, "|"), "|")
	cells := []string{}
	var cur strings.Builder
	for i := 0; i < len(line); i++ {
		if line[i] == '\\' && i+1 < len(line) && line[i+1] == '|' {
			cur.WriteByte('|')
			i++
			continue
		}
		if line[i] == '|' {
			cells = append(cells, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteByte(line[i])
	}
	return append(cells, strings.TrimSpace(cur.String()))
}

func markdownToDoc(src string) docBody {
	src = strings.ReplaceAll(strings.ReplaceAll(src, "\r\n", "\n"), "\r", "\n")
	src = strings.TrimPrefix(src, "\ufeff")
	lines := strings.Split(src, "\n")
	var out []docBlock
	add := func(t, text string) { out = append(out, docBlock{ID: newBlockID(), Type: t, Text: text}) }
	var para []string
	flush := func() {
		if len(para) > 0 {
			add("p", strings.Join(para, "\n"))
			para = nil
		}
	}
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~"):
			flush()
			fence, lang := trimmed[:3], strings.TrimSpace(trimmed[3:])
			var code []string
			for i++; i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), fence); i++ {
				code = append(code, lines[i])
			}
			out = append(out, docBlock{ID: newBlockID(), Type: "code", Text: strings.Join(code, "\n"), Lang: lang})
		case trimmed == "":
			flush()
		case mdHeading.MatchString(trimmed):
			flush()
			m := mdHeading.FindStringSubmatch(trimmed)
			add("h"+strconv.Itoa(min(len(m[1]), 3)), strings.TrimRight(m[2], " #"))
		case mdDivider.MatchString(trimmed):
			flush()
			add("divider", "")
		case mdTodo.MatchString(line):
			flush()
			m := mdTodo.FindStringSubmatch(line)
			out = append(out, docBlock{ID: newBlockID(), Type: "todo", Text: m[2], Checked: m[1] != " "})
		case mdBullet.MatchString(line):
			flush()
			add("bullet", mdBullet.FindStringSubmatch(line)[1])
		case mdOrdered.MatchString(line):
			flush()
			add("ordered", mdOrdered.FindStringSubmatch(line)[1])
		case strings.HasPrefix(trimmed, ">"):
			flush()
			quote := []string{}
			for ; i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), ">"); i++ {
				quote = append(quote, strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[i]), ">")))
			}
			i--
			add("quote", strings.Join(quote, "\n"))
		case strings.HasPrefix(trimmed, "|") && i+1 < len(lines) && mdTableSep.MatchString(lines[i+1]):
			flush()
			rows := [][]string{splitTableRow(line)}
			for i += 2; i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), "|"); i++ {
				rows = append(rows, splitTableRow(lines[i]))
			}
			i--
			out = append(out, docBlock{ID: newBlockID(), Type: "table", Rows: rows})
		default:
			para = append(para, strings.TrimRight(line, " "))
		}
	}
	flush()
	if len(out) == 0 {
		return newDocBody()
	}
	if len(out) > docMaxBlocks {
		out = out[:docMaxBlocks]
	}
	for i := range out {
		if r := []rune(out[i].Text); len(r) > docMaxBlockText {
			out[i].Text = string(r[:docMaxBlockText])
		}
	}
	return docBody{Blocks: out}
}

func docToMarkdown(title string, d docBody) string {
	var b strings.Builder
	b.WriteString("# " + title + "\n\n")
	number := 0
	for i, blk := range d.Blocks {
		if blk.Type == "ordered" {
			number++
		} else {
			number = 0
		}
		listy := blk.Type == "bullet" || blk.Type == "ordered" || blk.Type == "todo"
		switch blk.Type {
		case "h1", "h2", "h3":
			b.WriteString(strings.Repeat("#", int(blk.Type[1]-'0')+1) + " " + blk.Text)
		case "bullet":
			b.WriteString("- " + strings.ReplaceAll(blk.Text, "\n", "\n  "))
		case "ordered":
			b.WriteString(strconv.Itoa(number) + ". " + strings.ReplaceAll(blk.Text, "\n", "\n   "))
		case "todo":
			mark := " "
			if blk.Checked {
				mark = "x"
			}
			b.WriteString("- [" + mark + "] " + blk.Text)
		case "quote":
			b.WriteString("> " + strings.ReplaceAll(blk.Text, "\n", "\n> "))
		case "code":
			b.WriteString("```" + blk.Lang + "\n" + blk.Text + "\n```")
		case "divider":
			b.WriteString("---")
		case "table":
			for r, row := range blk.Rows {
				cells := make([]string, len(row))
				for c, cell := range row {
					cells[c] = strings.ReplaceAll(strings.ReplaceAll(cell, "|", "\\|"), "\n", " ")
				}
				b.WriteString("| " + strings.Join(cells, " | ") + " |\n")
				if r == 0 {
					b.WriteString("|" + strings.Repeat(" --- |", len(row)) + "\n")
				}
			}
		default:
			b.WriteString(strings.ReplaceAll(blk.Text, "\n", "  \n"))
		}
		next := ""
		if i+1 < len(d.Blocks) {
			next = d.Blocks[i+1].Type
		}
		if listy && (next == blk.Type || (blk.Type == "todo" && next == "bullet")) {
			b.WriteString("\n")
		} else if blk.Type != "table" {
			b.WriteString("\n\n")
		} else {
			b.WriteString("\n")
		}
	}
	return b.String()
}

// Inline Markdown as runs ---------------------------------------------------

type inlineRun struct {
	Text                       string
	Bold, Italic, Strike, Code bool
	Underline                  bool
	Link                       string
}

var inlineLink = regexp.MustCompile(`^\[([^\]]*)\]\(([^)\s]+)\)`)

// inlineRuns splits the Markdown inline syntax used in blocks into runs.
func inlineRuns(text string) []inlineRun {
	var runs []inlineRun
	var cur strings.Builder
	state := inlineRun{}
	emit := func() {
		if cur.Len() > 0 {
			r := state
			r.Text = cur.String()
			runs = append(runs, r)
			cur.Reset()
		}
	}
	for i := 0; i < len(text); {
		rest := text[i:]
		switch {
		case rest[0] == '\\' && len(rest) > 1 && strings.ContainsRune("\\*_`~[]()<>#|-", rune(rest[1])):
			cur.WriteByte(rest[1])
			i += 2
		case state.Code && rest[0] == '`':
			emit()
			state.Code = false
			i++
		case state.Code:
			_, n := utf8.DecodeRuneInString(rest)
			cur.WriteString(rest[:n])
			i += n
		case rest[0] == '`' && strings.Contains(rest[1:], "`"):
			emit()
			state.Code = true
			i++
		case strings.HasPrefix(rest, "**"):
			emit()
			state.Bold = !state.Bold
			i += 2
		case strings.HasPrefix(rest, "~~"):
			emit()
			state.Strike = !state.Strike
			i += 2
		case strings.HasPrefix(rest, "<u>"):
			emit()
			state.Underline = true
			i += 3
		case strings.HasPrefix(rest, "</u>"):
			emit()
			state.Underline = false
			i += 4
		case rest[0] == '*':
			emit()
			state.Italic = !state.Italic
			i++
		case rest[0] == '[' && inlineLink.MatchString(rest):
			m := inlineLink.FindStringSubmatch(rest)
			emit()
			for _, inner := range inlineRuns(m[1]) {
				inner.Bold, inner.Italic, inner.Strike, inner.Underline = inner.Bold || state.Bold, inner.Italic || state.Italic, inner.Strike || state.Strike, inner.Underline || state.Underline
				inner.Link = m[2]
				runs = append(runs, inner)
			}
			i += len(m[0])
		default:
			_, n := utf8.DecodeRuneInString(rest)
			cur.WriteString(rest[:n])
			i += n
		}
	}
	emit()
	return runs
}

// plainText is a block's text without Markdown marks.
func plainText(text string) string {
	var b strings.Builder
	for _, r := range inlineRuns(text) {
		b.WriteString(r.Text)
	}
	return b.String()
}

func markdownEscape(text string) string {
	return strings.NewReplacer("\\", "\\\\", "*", "\\*", "`", "\\`", "~", "\\~", "[", "\\[", "]", "\\]", "<", "\\<").Replace(text)
}

func runsToMarkdown(runs []inlineRun) string {
	var b strings.Builder
	for _, r := range runs {
		if r.Text == "" {
			continue
		}
		text := markdownEscape(r.Text)
		if r.Code {
			text = "`" + strings.ReplaceAll(r.Text, "`", "'") + "`"
		}
		// Keep spaces outside the marks, where Markdown needs them.
		lead := len(text) - len(strings.TrimLeft(text, " "))
		trail := len(text) - len(strings.TrimRight(text, " "))
		if lead == len(text) {
			b.WriteString(text)
			continue
		}
		core := text[lead : len(text)-trail]
		if r.Italic {
			core = "*" + core + "*"
		}
		if r.Bold {
			core = "**" + core + "**"
		}
		if r.Strike {
			core = "~~" + core + "~~"
		}
		if r.Underline {
			core = "<u>" + core + "</u>"
		}
		if r.Link != "" {
			core = "[" + core + "](" + strings.ReplaceAll(r.Link, ")", "%29") + ")"
		}
		b.WriteString(text[:lead] + core + text[len(text)-trail:])
	}
	return b.String()
}

// Word ----------------------------------------------------------------------

func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func docxRuns(text string, rels *[]string, extra string) string {
	var b strings.Builder
	for _, r := range inlineRuns(text) {
		props := extra
		if r.Bold {
			props += "<w:b/>"
		}
		if r.Italic {
			props += "<w:i/>"
		}
		if r.Strike {
			props += "<w:strike/>"
		}
		if r.Underline || r.Link != "" {
			props += `<w:u w:val="single"/>`
		}
		if r.Link != "" {
			props += `<w:color w:val="1F6FEB"/>`
		}
		if r.Code {
			props += `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F3F5"/>`
		}
		var run strings.Builder
		for i, line := range strings.Split(r.Text, "\n") {
			if i > 0 {
				run.WriteString("<w:br/>")
			}
			run.WriteString(`<w:t xml:space="preserve">` + xmlText(line) + `</w:t>`)
		}
		x := "<w:r><w:rPr>" + props + "</w:rPr>" + run.String() + "</w:r>"
		if r.Link != "" && rels != nil && safeDocLink(r.Link) {
			*rels = append(*rels, r.Link)
			x = fmt.Sprintf(`<w:hyperlink r:id="rLink%d">%s</w:hyperlink>`, len(*rels), x)
		}
		b.WriteString(x)
	}
	return b.String()
}

func docToDocx(title string, d docBody) ([]byte, error) {
	var body strings.Builder
	var links []string
	para := func(style, props, runs string) {
		pPr := props
		if style != "" {
			pPr = `<w:pStyle w:val="` + style + `"/>` + pPr
		}
		body.WriteString("<w:p><w:pPr>" + pPr + "</w:pPr>" + runs + "</w:p>")
	}
	para("Title", "", docxRuns(markdownEscape(title), nil, ""))
	nums := []string{}
	lastOrdered := false
	for _, blk := range d.Blocks {
		ordered := blk.Type == "ordered"
		switch blk.Type {
		case "h1":
			para("Heading1", "", docxRuns(blk.Text, &links, ""))
		case "h2":
			para("Heading2", "", docxRuns(blk.Text, &links, ""))
		case "h3":
			para("Heading3", "", docxRuns(blk.Text, &links, ""))
		case "bullet":
			para("ListParagraph", `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`, docxRuns(blk.Text, &links, ""))
		case "ordered":
			if !lastOrdered {
				nums = append(nums, fmt.Sprintf(`<w:num w:numId="%d"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`, len(nums)+2))
			}
			para("ListParagraph", fmt.Sprintf(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="%d"/></w:numPr>`, len(nums)+1), docxRuns(blk.Text, &links, ""))
		case "todo":
			box := "☐ "
			if blk.Checked {
				box = "☑ "
			}
			para("", "", docxRuns(markdownEscape(box)+blk.Text, &links, ""))
		case "quote":
			para("Quote", "", docxRuns(blk.Text, &links, ""))
		case "code":
			for _, line := range strings.Split(blk.Text, "\n") {
				para("Code", "", `<w:r><w:t xml:space="preserve">`+xmlText(line)+`</w:t></w:r>`)
			}
		case "divider":
			para("", `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9CDD4"/></w:pBdr>`, "")
		case "table":
			cols := 0
			for _, row := range blk.Rows {
				cols = max(cols, len(row))
			}
			if cols == 0 {
				continue
			}
			body.WriteString(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>`)
			for _, side := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
				body.WriteString(`<w:` + side + ` w:val="single" w:sz="4" w:space="0" w:color="C9CDD4"/>`)
			}
			body.WriteString(`</w:tblBorders></w:tblPr><w:tblGrid>` + strings.Repeat(`<w:gridCol/>`, cols) + `</w:tblGrid>`)
			for r, row := range blk.Rows {
				body.WriteString("<w:tr>")
				for c := 0; c < cols; c++ {
					cell := ""
					if c < len(row) {
						cell = row[c]
					}
					extra := ""
					if r == 0 {
						extra = "<w:b/>"
					}
					body.WriteString("<w:tc><w:p>" + docxRuns(cell, &links, extra) + "</w:p></w:tc>")
				}
				body.WriteString("</w:tr>")
			}
			body.WriteString("</w:tbl>")
		default:
			para("", "", docxRuns(blk.Text, &links, ""))
		}
		lastOrdered = ordered
	}
	const ns = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
	document := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ` + ns + `><w:body>` + body.String() + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`
	var rels strings.Builder
	rels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`)
	for i, link := range links {
		rels.WriteString(fmt.Sprintf(`<Relationship Id="rLink%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="%s" TargetMode="External"/>`, i+1, xmlAttr(link)))
	}
	rels.WriteString(`</Relationships>`)
	font := `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/>`
	style := func(id, name, ppr, rpr string) string {
		return `<w:style w:type="paragraph" w:styleId="` + id + `"><w:name w:val="` + name + `"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>` + ppr + `</w:pPr><w:rPr>` + rpr + `</w:rPr></w:style>`
	}
	styles := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>` + font + `<w:sz w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
		`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
		style("Title", "Title", `<w:spacing w:after="240"/>`, `<w:b/><w:sz w:val="44"/>`) +
		style("Heading1", "heading 1", `<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>`, `<w:b/><w:sz w:val="36"/>`) +
		style("Heading2", "heading 2", `<w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/>`, `<w:b/><w:sz w:val="30"/>`) +
		style("Heading3", "heading 3", `<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/>`, `<w:b/><w:sz w:val="26"/>`) +
		style("ListParagraph", "List Paragraph", `<w:ind w:left="720"/>`, "") +
		style("Quote", "Quote", `<w:ind w:left="567"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C9CDD4"/></w:pBdr>`, `<w:color w:val="646A73"/>`) +
		style("Code", "Code", `<w:spacing w:after="0" w:line="260" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F5F6F7"/>`, `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/>`) +
		`<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`
	level := func(format, text string) string {
		return `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="` + format + `"/><w:lvlText w:val="` + text + `"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`
	}
	numbering := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">` + level("bullet", "•") + `</w:abstractNum><w:abstractNum w:abstractNumId="1">` + level("decimal", "%1.") + `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` + strings.Join(nums, "") + `</w:numbering>`
	return zipFiles(map[string]string{
		"[Content_Types].xml":          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
		"_rels/.rels":                  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml":            document,
		"word/_rels/document.xml.rels": rels.String(),
		"word/styles.xml":              styles,
		"word/numbering.xml":           numbering,
	})
}

// safeDocLink keeps exported links to web pages and e-mail.
func safeDocLink(link string) bool {
	l := strings.ToLower(link)
	return strings.HasPrefix(l, "http://") || strings.HasPrefix(l, "https://") || strings.HasPrefix(l, "mailto:")
}

func xmlAttr(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;").Replace(s)
}

func zipFiles(files map[string]string) ([]byte, error) {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		return names[i] == "[Content_Types].xml" || (names[j] != "[Content_Types].xml" && names[i] < names[j])
	})
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range names {
		f, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err = io.WriteString(f, files[name]); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// readZip reads the named parts of an Office file, refusing zip bombs.
func readZip(raw []byte) (map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, errors.New("不是有效的 Office 文件")
	}
	out := map[string][]byte{}
	total := int64(0)
	for _, f := range zr.File {
		if !strings.HasSuffix(f.Name, ".xml") && !strings.HasSuffix(f.Name, ".rels") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, errors.New("文件已损坏")
		}
		data, err := io.ReadAll(io.LimitReader(rc, 200<<20-total+1))
		rc.Close()
		total += int64(len(data))
		if err != nil || total > 200<<20 {
			return nil, errors.New("文件内容过大")
		}
		out[f.Name] = data
	}
	return out, nil
}

// attr finds an attribute by local name, whatever its namespace prefix.
func attr(e xml.StartElement, name string) string {
	for _, a := range e.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

func relationships(data []byte) map[string]string {
	out := map[string]string{}
	d := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := d.Token()
		if err != nil {
			return out
		}
		if e, ok := tok.(xml.StartElement); ok && e.Name.Local == "Relationship" {
			out[attr(e, "Id")] = attr(e, "Target")
		}
	}
}

func docxToDoc(raw []byte) (docBody, error) {
	files, err := readZip(raw)
	if err != nil {
		return docBody{}, err
	}
	document := files["word/document.xml"]
	if document == nil {
		return docBody{}, errors.New("不是 Word 文档")
	}
	rels := relationships(files["word/_rels/document.xml.rels"])
	// Style ids differ by language ("Heading1", "1", "a1"); names do not.
	styleNames := map[string]string{}
	if data := files["word/styles.xml"]; data != nil {
		d := xml.NewDecoder(bytes.NewReader(data))
		current := ""
		for {
			tok, err := d.Token()
			if err != nil {
				break
			}
			if e, ok := tok.(xml.StartElement); ok {
				if e.Name.Local == "style" {
					current = attr(e, "styleId")
				} else if e.Name.Local == "name" && current != "" {
					styleNames[current] = strings.ToLower(attr(e, "val"))
				}
			}
		}
	}
	// numId → whether level 0 is a bullet.
	bullets := map[string]bool{}
	if data := files["word/numbering.xml"]; data != nil {
		abstract := map[string]bool{}
		d := xml.NewDecoder(bytes.NewReader(data))
		var absID, numID string
		inLevel0 := false
		for {
			tok, err := d.Token()
			if err != nil {
				break
			}
			if e, ok := tok.(xml.StartElement); ok {
				switch e.Name.Local {
				case "abstractNum":
					absID = attr(e, "abstractNumId")
				case "lvl":
					inLevel0 = attr(e, "ilvl") == "0"
				case "numFmt":
					if inLevel0 && absID != "" {
						abstract[absID] = attr(e, "val") == "bullet"
					}
				case "num":
					numID = attr(e, "numId")
				case "abstractNumId":
					if numID != "" {
						bullets[numID] = abstract[attr(e, "val")]
					}
				}
			}
			if e, ok := tok.(xml.EndElement); ok && e.Name.Local == "num" {
				numID = ""
			}
		}
	}
	var blocks []docBlock
	d := xml.NewDecoder(bytes.NewReader(document))
	type paraState struct {
		style, numID string
		runs         []inlineRun
		run          inlineRun
		link         string
	}
	var p *paraState
	var table [][]string
	var row []string
	var cell []string
	tableDepth := 0
	inText := false
	inRunProps := false
	finishPara := func() {
		text := runsToMarkdown(p.runs)
		if tableDepth > 0 {
			cell = append(cell, text)
			p = nil
			return
		}
		name := styleNames[p.style]
		if name == "" {
			name = strings.ToLower(p.style)
		}
		typ := "p"
		switch {
		case name == "title" || strings.Contains(name, "heading 1") || name == "标题 1" || name == "heading1":
			typ = "h1"
		case strings.Contains(name, "heading 2") || name == "标题 2" || name == "heading2" || name == "subtitle":
			typ = "h2"
		case strings.Contains(name, "heading") || strings.HasPrefix(name, "标题 "):
			typ = "h3"
		case strings.Contains(name, "quote") || strings.Contains(name, "引用"):
			typ = "quote"
		case p.numID != "" && p.numID != "0":
			typ = "ordered"
			if bullets[p.numID] {
				typ = "bullet"
			}
		}
		plain := strings.TrimSpace(plainText(text))
		if typ == "p" && (strings.HasPrefix(plain, "☐") || strings.HasPrefix(plain, "☑") || strings.HasPrefix(plain, "☒")) {
			blocks = append(blocks, docBlock{ID: newBlockID(), Type: "todo", Text: strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(text), "☐☑☒")), Checked: !strings.HasPrefix(plain, "☐")})
		} else if !(typ == "p" && text == "" && len(blocks) > 0 && blocks[len(blocks)-1].Type == "p" && blocks[len(blocks)-1].Text == "") {
			blocks = append(blocks, docBlock{ID: newBlockID(), Type: typ, Text: text})
		}
		p = nil
	}
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return docBody{}, errors.New("Word 文档内容已损坏")
		}
		switch e := tok.(type) {
		case xml.StartElement:
			switch e.Name.Local {
			case "tbl":
				tableDepth++
				if tableDepth == 1 {
					table = nil
				}
			case "tr":
				if tableDepth == 1 {
					row = nil
				}
			case "tc":
				if tableDepth == 1 {
					cell = nil
				}
			case "p":
				p = &paraState{}
			case "pStyle":
				if p != nil {
					p.style = attr(e, "val")
				}
			case "numId":
				if p != nil {
					p.numID = attr(e, "val")
				}
			case "hyperlink":
				if p != nil {
					p.link = rels[attr(e, "id")]
				}
			case "r":
				if p != nil {
					p.run = inlineRun{Link: p.link}
				}
			case "rPr":
				inRunProps = true
			case "b", "i", "strike", "dstrike", "u":
				if p != nil && inRunProps {
					v := attr(e, "val")
					on := v != "0" && v != "false" && v != "none"
					switch e.Name.Local {
					case "b":
						p.run.Bold = on
					case "i":
						p.run.Italic = on
					case "u":
						p.run.Underline = on && p.link == ""
					default:
						p.run.Strike = on
					}
				}
			case "t":
				inText = true
			case "tab":
				if p != nil && !inRunProps {
					r := p.run
					r.Text = "\t"
					p.runs = append(p.runs, r)
				}
			case "br", "cr":
				if p != nil {
					r := p.run
					r.Text = "\n"
					p.runs = append(p.runs, r)
				}
			}
		case xml.EndElement:
			switch e.Name.Local {
			case "t":
				inText = false
			case "rPr":
				inRunProps = false
			case "hyperlink":
				if p != nil {
					p.link = ""
				}
			case "p":
				if p != nil {
					finishPara()
				}
			case "tc":
				if tableDepth == 1 {
					row = append(row, strings.Join(cell, " "))
				}
			case "tr":
				if tableDepth == 1 {
					table = append(table, row)
				}
			case "tbl":
				tableDepth--
				if tableDepth == 0 && len(table) > 0 {
					if len(table) > 500 {
						table = table[:500]
					}
					for i := range table {
						if len(table[i]) > 50 {
							table[i] = table[i][:50]
						}
					}
					blocks = append(blocks, docBlock{ID: newBlockID(), Type: "table", Rows: table})
				}
			}
		case xml.CharData:
			if inText && p != nil {
				r := p.run
				r.Text = string(e)
				p.runs = append(p.runs, r)
			}
		}
		if len(blocks) >= docMaxBlocks {
			break
		}
	}
	if len(blocks) == 0 {
		return newDocBody(), nil
	}
	for i := range blocks {
		if r := []rune(blocks[i].Text); len(r) > docMaxBlockText {
			blocks[i].Text = string(r[:docMaxBlockText])
		}
	}
	return docBody{Blocks: blocks}, nil
}

// Excel ---------------------------------------------------------------------

var numberPattern = regexp.MustCompile(`^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$`)

func sheetToXLSX(b sheetBody) ([]byte, error) {
	files := map[string]string{}
	// Styles: one cell format per distinct style used.
	type styleKey struct {
		B, I, U, S bool
		A, BG, C   string
	}
	fonts := []string{`<font><sz val="11"/><name val="Calibri"/></font>`}
	fills := []string{`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`}
	xfs := []string{`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`}
	index := map[styleKey]int{}
	styleOf := func(s *sheetStyle) int {
		if s == nil {
			return 0
		}
		k := styleKey{s.B, s.I, s.U, s.S, s.A, s.BG, s.C}
		if i, ok := index[k]; ok {
			return i
		}
		font := "<font>"
		if s.B {
			font += "<b/>"
		}
		if s.I {
			font += "<i/>"
		}
		if s.S {
			font += "<strike/>"
		}
		if s.U {
			font += "<u/>"
		}
		font += `<sz val="11"/>`
		if s.C != "" {
			font += `<color rgb="FF` + strings.ToUpper(s.C[1:]) + `"/>`
		}
		font += `<name val="Calibri"/></font>`
		fonts = append(fonts, font)
		fill := 0
		if s.BG != "" {
			fills = append(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF`+strings.ToUpper(s.BG[1:])+`"/><bgColor indexed="64"/></patternFill></fill>`)
			fill = len(fills) - 1
		}
		xf := fmt.Sprintf(`<xf numFmtId="0" fontId="%d" fillId="%d" borderId="0" xfId="0" applyFont="1"%s`, len(fonts)-1, fill, map[bool]string{true: ` applyFill="1"`, false: ""}[fill > 0])
		if s.A != "" {
			xf += ` applyAlignment="1"><alignment horizontal="` + s.A + `"/></xf>`
		} else {
			xf += "/>"
		}
		xfs = append(xfs, xf)
		index[k] = len(xfs) - 1
		return len(xfs) - 1
	}
	var sheets, wbRels, types strings.Builder
	for i, page := range b.Sheets {
		n := i + 1
		type entry struct {
			col, row int
			ref      string
			cell     sheetCell
		}
		var cells []entry
		for ref, c := range page.Cells {
			col, row, ok := parseRef(ref)
			if ok {
				cells = append(cells, entry{col, row, ref, c})
			}
		}
		sort.Slice(cells, func(i, j int) bool {
			if cells[i].row != cells[j].row {
				return cells[i].row < cells[j].row
			}
			return cells[i].col < cells[j].col
		})
		var x strings.Builder
		x.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
		if len(page.Cols) > 0 {
			names := make([]string, 0, len(page.Cols))
			for name := range page.Cols {
				names = append(names, name)
			}
			sort.Slice(names, func(i, j int) bool { return columnNumber(names[i]) < columnNumber(names[j]) })
			x.WriteString("<cols>")
			for _, name := range names {
				c := columnNumber(name)
				x.WriteString(fmt.Sprintf(`<col min="%d" max="%d" width="%.2f" customWidth="1"/>`, c, c, float64(page.Cols[name]-5)/7))
			}
			x.WriteString("</cols>")
		}
		x.WriteString("<sheetData>")
		row := 0
		for _, e := range cells {
			if e.row != row {
				if row != 0 {
					x.WriteString("</row>")
				}
				row = e.row
				x.WriteString(fmt.Sprintf(`<row r="%d">`, row))
			}
			style := ""
			if s := styleOf(e.cell.S); s > 0 {
				style = fmt.Sprintf(` s="%d"`, s)
			}
			v := e.cell.V
			switch {
			case strings.HasPrefix(v, "=") && len(v) > 1:
				x.WriteString(`<c r="` + e.ref + `"` + style + `><f>` + xmlText(v[1:]) + `</f></c>`)
			case numberPattern.MatchString(v):
				x.WriteString(`<c r="` + e.ref + `"` + style + `><v>` + v + `</v></c>`)
			case strings.EqualFold(v, "TRUE") || strings.EqualFold(v, "FALSE"):
				bv := "0"
				if strings.EqualFold(v, "TRUE") {
					bv = "1"
				}
				x.WriteString(`<c r="` + e.ref + `"` + style + ` t="b"><v>` + bv + `</v></c>`)
			case v == "":
				x.WriteString(`<c r="` + e.ref + `"` + style + `/>`)
			default:
				x.WriteString(`<c r="` + e.ref + `"` + style + ` t="inlineStr"><is><t xml:space="preserve">` + xmlText(v) + `</t></is></c>`)
			}
		}
		if row != 0 {
			x.WriteString("</row>")
		}
		x.WriteString("</sheetData></worksheet>")
		files[fmt.Sprintf("xl/worksheets/sheet%d.xml", n)] = x.String()
		sheets.WriteString(fmt.Sprintf(`<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlAttr(page.Name), n, n))
		wbRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, n, n))
		types.WriteString(fmt.Sprintf(`<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, n))
	}
	stylesRel := len(b.Sheets) + 1
	files["xl/workbook.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` + sheets.String() + `</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`
	files["xl/_rels/workbook.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + wbRels.String() + fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, stylesRel) + `</Relationships>`
	files["xl/styles.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` + fmt.Sprintf(`<fonts count="%d">%s</fonts><fills count="%d">%s</fills>`, len(fonts), strings.Join(fonts, ""), len(fills), strings.Join(fills, "")) + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` + fmt.Sprintf(`<cellXfs count="%d">%s</cellXfs>`, len(xfs), strings.Join(xfs, "")) + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
	files["_rels/.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
	files["[Content_Types].xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` + types.String() + `</Types>`
	return zipFiles(files)
}

func xlsxToSheet(raw []byte) (sheetBody, error) {
	files, err := readZip(raw)
	if err != nil {
		return sheetBody{}, err
	}
	workbook := files["xl/workbook.xml"]
	if workbook == nil {
		return sheetBody{}, errors.New("不是 Excel 工作簿")
	}
	rels := relationships(files["xl/_rels/workbook.xml.rels"])
	// Shared strings, each possibly made of rich text runs.
	var shared []string
	if data := files["xl/sharedStrings.xml"]; data != nil {
		d := xml.NewDecoder(bytes.NewReader(data))
		var cur strings.Builder
		inT, inPhonetic := false, false
		for {
			tok, err := d.Token()
			if err != nil {
				break
			}
			switch e := tok.(type) {
			case xml.StartElement:
				switch e.Name.Local {
				case "si":
					cur.Reset()
				case "t":
					inT = true
				case "rPh":
					inPhonetic = true
				}
			case xml.EndElement:
				switch e.Name.Local {
				case "si":
					shared = append(shared, cur.String())
				case "t":
					inT = false
				case "rPh":
					inPhonetic = false
				}
			case xml.CharData:
				if inT && !inPhonetic {
					cur.Write(e)
				}
			}
		}
	}
	// Cell formats → bold / italic / fill.
	var xfStyles []*sheetStyle
	if data := files["xl/styles.xml"]; data != nil {
		type font struct{ b, i, u, s bool }
		var fonts []font
		var fills []string
		d := xml.NewDecoder(bytes.NewReader(data))
		section := ""
		var f *font
		fill := ""
		var curXF *sheetStyle
		for {
			tok, err := d.Token()
			if err != nil {
				break
			}
			switch e := tok.(type) {
			case xml.StartElement:
				switch e.Name.Local {
				case "fonts", "fills", "cellXfs", "cellStyleXfs", "borders", "numFmts", "dxfs":
					section = e.Name.Local
				case "font":
					if section == "fonts" {
						f = &font{}
					}
				case "b", "i", "u", "strike":
					if f != nil && attr(e, "val") != "0" {
						switch e.Name.Local {
						case "b":
							f.b = true
						case "i":
							f.i = true
						case "u":
							f.u = true
						default:
							f.s = true
						}
					}
				case "fill":
					fill = ""
				case "fgColor":
					if section == "fills" {
						if rgb := attr(e, "rgb"); len(rgb) == 8 {
							fill = "#" + strings.ToLower(rgb[2:])
						}
					}
				case "xf":
					if section == "cellXfs" {
						s := &sheetStyle{}
						if id, err := strconv.Atoi(attr(e, "fontId")); err == nil && id < len(fonts) {
							s.B, s.I, s.U, s.S = fonts[id].b, fonts[id].i, fonts[id].u, fonts[id].s
						}
						if id, err := strconv.Atoi(attr(e, "fillId")); err == nil && id < len(fills) && fills[id] != "" {
							s.BG = fills[id]
						}
						curXF = s
						xfStyles = append(xfStyles, s)
					}
				case "alignment":
					if curXF != nil {
						if h := attr(e, "horizontal"); h == "left" || h == "center" || h == "right" {
							curXF.A = h
						}
					}
				}
			case xml.EndElement:
				switch e.Name.Local {
				case "font":
					if f != nil {
						fonts = append(fonts, *f)
						f = nil
					}
				case "fill":
					if section == "fills" {
						fills = append(fills, fill)
					}
				case "xf":
					curXF = nil
				}
			}
		}
		for i, s := range xfStyles {
			if *s == (sheetStyle{}) {
				xfStyles[i] = nil
			}
		}
	}
	type sheetRef struct{ name, target string }
	var refs []sheetRef
	d := xml.NewDecoder(bytes.NewReader(workbook))
	for {
		tok, err := d.Token()
		if err != nil {
			break
		}
		if e, ok := tok.(xml.StartElement); ok && e.Name.Local == "sheet" {
			target := rels[attr(e, "id")]
			if strings.HasPrefix(target, "/") {
				target = strings.TrimPrefix(target, "/")
			} else {
				target = pathpkg.Join("xl", target)
			}
			refs = append(refs, sheetRef{attr(e, "name"), target})
		}
	}
	if len(refs) == 0 {
		return sheetBody{}, errors.New("工作簿中没有工作表")
	}
	var body sheetBody
	total := 0
	for _, ref := range refs {
		if len(body.Sheets) >= sheetMaxPages {
			break
		}
		data := files[ref.target]
		if data == nil {
			continue
		}
		page := sheetPage{ID: newBlockID(), Name: ref.name, Cells: map[string]sheetCell{}}
		if validSheetName(&body, page.Name, "") != nil {
			page.Name = fmt.Sprintf("Sheet%d", len(body.Sheets)+1)
		}
		masters := map[string]struct {
			formula  string
			col, row int
		}{}
		d := xml.NewDecoder(bytes.NewReader(data))
		var ref, typ, value, formula, sharedID string
		style := 0
		inV, inF, inIS := false, false, false
		var inline strings.Builder
		for {
			tok, err := d.Token()
			if err != nil {
				break
			}
			switch e := tok.(type) {
			case xml.StartElement:
				switch e.Name.Local {
				case "col":
					lo, _ := strconv.Atoi(attr(e, "min"))
					hi, _ := strconv.Atoi(attr(e, "max"))
					width, err := strconv.ParseFloat(attr(e, "width"), 64)
					if err == nil && attr(e, "customWidth") != "" && lo >= 1 && hi-lo < 50 {
						for c := lo; c <= hi && c <= sheetMaxCols; c++ {
							if page.Cols == nil {
								page.Cols = map[string]int{}
							}
							page.Cols[columnName(c)] = min(1000, max(30, int(width*7+5)))
						}
					}
				case "c":
					ref, typ, value, formula, sharedID = attr(e, "r"), attr(e, "t"), "", "", ""
					style, _ = strconv.Atoi(attr(e, "s"))
					inline.Reset()
				case "v":
					inV = true
				case "f":
					inF = true
					if attr(e, "t") == "shared" {
						sharedID = attr(e, "si")
					}
				case "is":
					inIS = true
				}
			case xml.CharData:
				switch {
				case inV:
					value += string(e)
				case inF:
					formula += string(e)
				case inIS:
					inline.Write(e)
				}
			case xml.EndElement:
				switch e.Name.Local {
				case "v":
					inV = false
				case "f":
					inF = false
				case "is":
					inIS = false
				case "c":
					col, row, ok := parseRef(ref)
					if !ok {
						continue
					}
					if sharedID != "" {
						if formula != "" {
							masters[sharedID] = struct {
								formula  string
								col, row int
							}{formula, col, row}
						} else if m, found := masters[sharedID]; found {
							formula = offsetFormula(m.formula, col-m.col, row-m.row)
						}
					}
					v := value
					switch {
					case formula != "":
						v = "=" + formula
					case typ == "s":
						if i, err := strconv.Atoi(value); err == nil && i >= 0 && i < len(shared) {
							v = shared[i]
						}
					case typ == "inlineStr":
						v = inline.String()
					case typ == "b":
						v = map[string]string{"1": "TRUE", "0": "FALSE"}[value]
					case typ == "e":
						v = value
					}
					var st *sheetStyle
					if style > 0 && style < len(xfStyles) && xfStyles[style] != nil {
						copy := *xfStyles[style]
						st = &copy
					}
					if v == "" && st == nil {
						continue
					}
					if r := []rune(v); len(r) > 32000 {
						v = string(r[:32000])
					}
					if total >= sheetMaxCells {
						return sheetBody{}, fmt.Errorf("单元格超过 %d 个", sheetMaxCells)
					}
					page.Cells[cellName(col, row)] = sheetCell{V: v, S: st}
					total++
				}
			}
		}
		body.Sheets = append(body.Sheets, page)
	}
	if len(body.Sheets) == 0 {
		return newSheetBody(), nil
	}
	return body, nil
}

func csvToSheet(raw []byte) (sheetBody, error) {
	text := strings.TrimPrefix(string(raw), "\ufeff")
	if !utf8.ValidString(text) {
		return sheetBody{}, errors.New("请使用 UTF-8 编码的 CSV 文件")
	}
	r := csv.NewReader(strings.NewReader(text))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	body := newSheetBody()
	cells := body.Sheets[0].Cells
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return sheetBody{}, errors.New("CSV 格式错误")
		}
		// Blank lines are skipped by the reader but still count as rows.
		row, _ := r.FieldPos(0)
		if row > sheetMaxRows {
			return sheetBody{}, fmt.Errorf("最多 %d 行", sheetMaxRows)
		}
		for c, v := range rec {
			if c >= sheetMaxCols {
				break
			}
			if v != "" {
				if len(cells) >= sheetMaxCells {
					return sheetBody{}, fmt.Errorf("单元格超过 %d 个", sheetMaxCells)
				}
				cells[cellName(c+1, row)] = sheetCell{V: v}
			}
		}
	}
	return body, nil
}

func sheetToCSV(page sheetPage) []byte {
	maxCol, maxRow := 0, 0
	for ref := range page.Cells {
		if c, r, ok := parseRef(ref); ok {
			maxCol, maxRow = max(maxCol, c), max(maxRow, r)
		}
	}
	var buf bytes.Buffer
	buf.WriteString("\ufeff")
	w := csv.NewWriter(&buf)
	for r := 1; r <= maxRow; r++ {
		rec := make([]string, maxCol)
		for c := 1; c <= maxCol; c++ {
			rec[c-1] = page.Cells[cellName(c, r)].V
		}
		_ = w.Write(rec)
	}
	w.Flush()
	return buf.Bytes()
}
