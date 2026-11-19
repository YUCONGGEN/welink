package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMergeText(t *testing.T) {
	for _, c := range []struct{ base, mine, theirs, want string }{
		{"hello world", "hello brave world", "hello world!", "hello brave world!"},
		{"hello world", "hello world", "hi world", "hi world"},
		{"abc", "abXc", "abYc", "abYXc"},
		{"一二三四五", "一二三四五六", "零一二三四五", "零一二三四五六"},
		{"delete me please", "delete please", "delete me now please", "delete now please"},
		{"abcdef", "af", "abXYef", "aXYf"},
		{"😀a", "😀ab", "x😀a", "x😀ab"},
	} {
		if got := mergeText(c.base, c.mine, c.theirs); got != c.want {
			t.Errorf("merge(%q,%q,%q)=%q want %q", c.base, c.mine, c.theirs, got, c.want)
		}
	}
}

func TestShiftFormula(t *testing.T) {
	for _, c := range []struct {
		f          string
		rows       bool
		at, n      int
		want       string
		cur, sheet string
	}{
		{"=SUM(A1:A10)+B5", true, 3, 2, "=SUM(A1:A12)+B7", "S", "S"},
		{"=A2*$B$2", true, 2, -1, "=#REF!*#REF!", "S", "S"},
		{"=SUM(A1:A10)", true, 2, -3, "=SUM(A1:A7)", "S", "S"},
		{"=C1+D1", false, 3, 1, "=D1+E1", "S", "S"},
		{"=LOG10(A1)&\"A1\"", true, 1, 1, "=LOG10(A2)&\"A1\"", "S", "S"},
		{"=Data!A1+A1", true, 1, 1, "=Data!A2+A1", "S", "Data"},
		{"='销售 数据'!B2", true, 1, 2, "='销售 数据'!B4", "S", "销售 数据"},
	} {
		if got := shiftFormula(c.f, c.cur, c.sheet, c.rows, c.at, c.n); got != c.want {
			t.Errorf("shift(%q)=%q want %q", c.f, got, c.want)
		}
	}
	if got := offsetFormula("=A1+$B$1+B$2", 2, 3); got != "=C4+$B$1+D$2" {
		t.Errorf("offset: %s", got)
	}
	if got := renameInFormula("=Old!A1+'Old'!B2+A3", "X", "Old", "新 表"); got != "='新 表'!A1+'新 表'!B2+A3" {
		t.Errorf("rename: %s", got)
	}
}

type docState struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	Title     string          `json:"title"`
	Role      string          `json:"role"`
	Version   int64           `json:"version"`
	Content   json.RawMessage `json:"content"`
	CanExport bool            `json:"canExport"`
}

func (f *fixture) newDoc(a account, kind, title string) docState {
	var created map[string]string
	f.request("POST", "/api/docs", a.Token, map[string]string{"kind": kind, "title": title}, 200, &created)
	return f.openDoc(a, created["id"])
}
func (f *fixture) openDoc(a account, id string) docState {
	var d docState
	f.request("GET", "/api/docs/"+id, a.Token, nil, 200, &d)
	return d
}
func (f *fixture) docOps(a account, id, client, batch string, status int, ops ...docOp) map[string]any {
	var out map[string]any
	f.request("POST", "/api/docs/"+id+"/ops", a.Token, map[string]any{"clientId": client, "batch": batch, "ops": ops}, status, &out)
	return out
}
func strp(s string) *string { return &s }

func TestDocPermissions(t *testing.T) {
	f := setup(t)
	owner, reader, writer, stranger := f.register("doc_owner"), f.register("doc_reader"), f.register("doc_writer"), f.register("doc_stranger")
	d := f.newDoc(owner, "doc", "周报")
	if d.Role != "owner" || d.Kind != "doc" || d.Title != "周报" {
		t.Fatalf("created: %+v", d)
	}
	var body docBody
	json.Unmarshal(d.Content, &body)
	first := body.Blocks[0].ID

	f.request("GET", "/api/docs/"+d.ID, stranger.Token, nil, 403, nil)
	f.request("GET", "/api/docs/"+strings.Repeat("0", 32), owner.Token, nil, 404, nil)
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+reader.User.ID, owner.Token, map[string]string{"role": "view"}, 200, nil)
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+writer.User.ID, owner.Token, map[string]string{"role": "edit"}, 200, nil)
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+owner.User.ID, owner.Token, map[string]string{"role": "view"}, 400, nil)

	if got := f.openDoc(reader, d.ID); got.Role != "view" || !got.CanExport {
		t.Fatalf("reader: %+v", got)
	}
	f.docOps(reader, d.ID, "reader-client", "b1", 403, docOp{Op: "text", ID: first, Base: strp(""), Text: strp("偷偷改")})
	f.request("PATCH", "/api/docs/"+d.ID, reader.Token, map[string]string{"title": "改标题"}, 403, nil)
	f.docOps(writer, d.ID, "writer-client", "b1", 200, docOp{Op: "text", ID: first, Base: strp(""), Text: strp("本周完成")})
	f.request("PATCH", "/api/docs/"+d.ID, writer.Token, map[string]string{"title": "第 12 周周报"}, 200, nil)
	// Editors cannot share; only owner and managers can.
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+stranger.User.ID, writer.Token, map[string]string{"role": "view"}, 403, nil)
	f.request("PATCH", "/api/docs/"+d.ID, writer.Token, map[string]string{"linkRole": "edit"}, 403, nil)
	f.request("DELETE", "/api/docs/"+d.ID, writer.Token, nil, 403, nil)

	// Exports follow the owner's setting.
	f.request("PATCH", "/api/docs/"+d.ID, owner.Token, map[string]any{"viewerExport": false}, 200, nil)
	f.request("GET", "/api/docs/"+d.ID+"/export?format=md", reader.Token, nil, 403, nil)
	resp, _ := http.Get(f.url + "/api/docs/" + d.ID + "/export?format=md")
	if resp.StatusCode != 401 {
		t.Fatal("anonymous export allowed", resp.StatusCode)
	}

	// Link sharing gives any signed-in user the link role.
	f.request("PATCH", "/api/docs/"+d.ID, owner.Token, map[string]string{"linkRole": "view"}, 200, nil)
	if got := f.openDoc(stranger, d.ID); got.Role != "view" {
		t.Fatalf("link role: %+v", got)
	}
	var recent []docSummary
	f.request("GET", "/api/docs?scope=recent", stranger.Token, nil, 200, &recent)
	if len(recent) != 1 || recent[0].Title != "第 12 周周报" {
		t.Fatalf("recent: %+v", recent)
	}
	f.request("PATCH", "/api/docs/"+d.ID, owner.Token, map[string]string{"linkRole": "none"}, 200, nil)
	f.request("GET", "/api/docs/"+d.ID, stranger.Token, nil, 403, nil)
	f.request("GET", "/api/docs?scope=recent", stranger.Token, nil, 200, &recent)
	if len(recent) != 0 {
		t.Fatal("withdrawn document still listed")
	}

	// A manager may share further.
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+writer.User.ID, owner.Token, map[string]string{"role": "manage"}, 200, nil)
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+stranger.User.ID, writer.Token, map[string]string{"role": "edit"}, 200, nil)
	var shared []docSummary
	f.request("GET", "/api/docs?scope=shared", stranger.Token, nil, 200, &shared)
	if len(shared) != 1 || shared[0].Role != "edit" {
		t.Fatalf("shared: %+v", shared)
	}
	// Leaving needs no rights; removing others does.
	f.request("DELETE", "/api/docs/"+d.ID+"/members/"+writer.User.ID, reader.Token, nil, 403, nil)
	f.request("DELETE", "/api/docs/"+d.ID+"/members/"+reader.User.ID, reader.Token, nil, 200, nil)
	f.request("GET", "/api/docs/"+d.ID, reader.Token, nil, 403, nil)

	var members struct {
		People []struct{ ID, Role string }
	}
	f.request("GET", "/api/docs/"+d.ID+"/members", owner.Token, nil, 200, &members)
	if len(members.People) != 3 || members.People[0].Role != "owner" {
		t.Fatalf("members: %+v", members)
	}
	f.request("DELETE", "/api/docs/"+d.ID, owner.Token, nil, 200, nil)
	f.request("GET", "/api/docs/"+d.ID, owner.Token, nil, 404, nil)
}

func TestDocSharedWithChat(t *testing.T) {
	f := setup(t)
	owner, b, c := f.register("doc_chat_a"), f.register("doc_chat_b"), f.register("doc_chat_c")
	cid := f.group(owner, b)
	d := f.newDoc(owner, "sheet", "预算")
	f.request("GET", "/api/docs/"+d.ID, b.Token, nil, 403, nil)
	// Only members of the chat can share into it.
	f.request("PUT", "/api/docs/"+d.ID+"/chats/"+cid, c.Token, map[string]string{"role": "view"}, 403, nil)
	ws := f.socket(b)
	var m Message
	f.request("POST", "/api/docs/"+d.ID+"/send", owner.Token, map[string]string{"conversationId": cid, "grant": "edit", "clientId": "doc-send-0001"}, 200, &m)
	if !strings.Contains(m.Text, docMessageMarker+d.ID) || !strings.Contains(m.Text, "[表格] 预算") {
		t.Fatalf("message: %q", m.Text)
	}
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var event struct{ Type string }
		if err := ws.ReadJSON(&event); err != nil {
			t.Fatal("no message event", err)
		}
		if event.Type == "message" {
			break
		}
	}
	if got := f.openDoc(b, d.ID); got.Role != "edit" {
		t.Fatalf("chat member role: %+v", got)
	}
	// Leaving the chat ends the access that came from it.
	f.request("DELETE", "/api/conversations/"+cid+"/members/"+b.User.ID, owner.Token, nil, 200, nil)
	f.request("GET", "/api/docs/"+d.ID, b.Token, nil, 403, nil)
	// Without manage rights a document can be sent but not granted.
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+c.User.ID, owner.Token, map[string]string{"role": "view"}, 200, nil)
	f.befriend(c, owner)
	direct := f.direct(c, owner)
	f.request("POST", "/api/docs/"+d.ID+"/send", c.Token, map[string]string{"conversationId": direct, "grant": "view"}, 403, nil)
	f.request("POST", "/api/docs/"+d.ID+"/send", c.Token, map[string]string{"conversationId": direct}, 200, nil)
}

func TestDocCollaboration(t *testing.T) {
	f := setup(t)
	a, b := f.register("doc_collab_a"), f.register("doc_collab_b")
	d := f.newDoc(a, "doc", "方案")
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+b.User.ID, a.Token, map[string]string{"role": "edit"}, 200, nil)
	var body docBody
	json.Unmarshal(d.Content, &body)
	first := body.Blocks[0].ID
	f.docOps(a, d.ID, "client-a-1", "1", 200, docOp{Op: "text", ID: first, Base: strp(""), Text: strp("目标：上线")})

	// b opens the document and hears a's next change live.
	ws := f.socket(b)
	f.request("POST", "/api/docs/"+d.ID+"/presence", b.Token, map[string]string{"clientId": "client-b-1", "where": first}, 200, nil)
	// Both edit the same paragraph from the same base: both changes survive.
	f.docOps(a, d.ID, "client-a-1", "2", 200, docOp{Op: "text", ID: first, Base: strp("目标：上线"), Text: strp("目标：周五上线")})
	out := f.docOps(b, d.ID, "client-b-1", "1", 200, docOp{Op: "text", ID: first, Base: strp("目标：上线"), Text: strp("目标：上线并验收")})
	ops := out["ops"].([]any)
	if got := ops[0].(map[string]any)["text"]; got != "目标：周五上线并验收" {
		t.Fatalf("merged text %q", got)
	}
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var event struct {
			Type string
			Data struct {
				ClientID string
				Version  int64
			}
		}
		if err := ws.ReadJSON(&event); err != nil {
			t.Fatal("no live operation", err)
		}
		if event.Type == "doc-ops" && event.Data.ClientID == "client-a-1" {
			break
		}
	}
	// A retried batch is answered, not applied twice.
	again := f.docOps(b, d.ID, "client-b-1", "1", 200, docOp{Op: "text", ID: first, Base: strp("目标：上线"), Text: strp("目标：上线并验收")})
	if again["version"] != out["version"] {
		t.Fatal("retried batch applied again")
	}
	// Structure: insert after, move, delete, never an empty document.
	f.docOps(a, d.ID, "client-a-1", "3", 200,
		docOp{Op: "insert", After: strp(first), Block: &docBlock{ID: "n1", Type: "h2", Text: "排期"}},
		docOp{Op: "insert", After: strp("n1"), Block: &docBlock{ID: "n2", Type: "todo", Text: "联调"}},
		docOp{Op: "move", ID: "n2", After: strp("")},
		docOp{Op: "block", Block: &docBlock{ID: "n2", Type: "todo", Checked: true}})
	json.Unmarshal(f.openDoc(b, d.ID).Content, &body)
	if ids := body.order(); strings.Join(ids, ",") != "n2,"+first+",n1" || !body.Blocks[0].Checked || body.Blocks[0].Text != "联调" {
		t.Fatalf("structure: %+v", body.Blocks)
	}
	res := f.docOps(a, d.ID, "client-a-1", "4", 200, docOp{Op: "delete", ID: "n1"}, docOp{Op: "delete", ID: "n2"}, docOp{Op: "delete", ID: first})
	if order := res["order"].([]any); len(order) != 1 {
		t.Fatalf("empty document not refilled: %v", order)
	}
	f.docOps(a, d.ID, "client-a-1", "5", 400, docOp{Op: "insert", Block: &docBlock{ID: "bad id!", Type: "p"}})
	f.docOps(a, d.ID, "client-a-1", "6", 400, docOp{Op: "insert", Block: &docBlock{ID: "x1", Type: "script"}})

	var viewers struct{ Viewers []docViewer }
	f.request("POST", "/api/docs/"+d.ID+"/presence", a.Token, map[string]string{"clientId": "client-a-1", "where": "n1"}, 200, &viewers)
	if len(viewers.Viewers) != 2 {
		t.Fatalf("viewers: %+v", viewers)
	}
}

func TestSheetOpsAndHistory(t *testing.T) {
	f := setup(t)
	a := f.register("sheet_owner")
	d := f.newDoc(a, "sheet", "")
	if d.Title != "未命名表格" {
		t.Fatal(d.Title)
	}
	var body sheetBody
	json.Unmarshal(d.Content, &body)
	s1 := body.Sheets[0].ID
	cell := func(v string) *sheetCell { return &sheetCell{V: v} }
	f.docOps(a, d.ID, "sheet-client", "1", 200,
		docOp{Op: "cell", Sheet: s1, Ref: "A1", Cell: cell("1")},
		docOp{Op: "cell", Sheet: s1, Ref: "A2", Cell: cell("2")},
		docOp{Op: "cell", Sheet: s1, Ref: "A3", Cell: &sheetCell{V: "=SUM(A1:A2)", S: &sheetStyle{B: true, BG: "#fff2cc"}}},
		docOp{Op: "addSheet", Page: &sheetPage{ID: "s2", Name: "汇总"}},
		docOp{Op: "cell", Sheet: "s2", Ref: "B1", Cell: cell("=Sheet1!A3*2")},
		docOp{Op: "width", Sheet: s1, Col: "A", Width: 140})
	f.docOps(a, d.ID, "sheet-client", "bad", 400, docOp{Op: "cell", Sheet: s1, Ref: "ZZZ1", Cell: cell("x")})
	f.docOps(a, d.ID, "sheet-client", "bad2", 400, docOp{Op: "addSheet", Page: &sheetPage{ID: "s3", Name: "汇总"}})
	f.docOps(a, d.ID, "sheet-client", "2", 200, docOp{Op: "insertRows", Sheet: s1, At: 1, N: 2}, docOp{Op: "renameSheet", Sheet: s1, Name: "明细 表"})
	json.Unmarshal(f.openDoc(a, d.ID).Content, &body)
	if body.Sheets[0].Cells["A5"].V != "=SUM(A3:A4)" || body.Sheets[0].Cells["A3"].V != "1" || !body.Sheets[0].Cells["A5"].S.B {
		t.Fatalf("rows not shifted: %+v", body.Sheets[0].Cells)
	}
	if got := body.Sheets[1].Cells["B1"].V; got != "='明细 表'!A5*2" {
		t.Fatalf("cross-sheet formula %q", got)
	}

	// Round trip through Excel keeps values, formulas, styles and widths.
	raw, err := sheetToXLSX(body)
	if err != nil {
		t.Fatal(err)
	}
	back, err := xlsxToSheet(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Sheets) != 2 || back.Sheets[0].Name != "明细 表" || back.Sheets[0].Cells["A5"].V != "=SUM(A3:A4)" || back.Sheets[0].Cells["A5"].S == nil || !back.Sheets[0].Cells["A5"].S.B || back.Sheets[0].Cells["A5"].S.BG != "#fff2cc" || back.Sheets[1].Cells["B1"].V != "='明细 表'!A5*2" || back.Sheets[0].Cols["A"] != 140 {
		t.Fatalf("xlsx round trip: %+v", back)
	}
	csvBody, err := csvToSheet(sheetToCSV(body.Sheets[0]))
	if err != nil || csvBody.Sheets[0].Cells["A3"].V != "1" {
		t.Fatalf("csv round trip: %+v %v", csvBody, err)
	}

	// History: restoring an earlier version brings its content back.
	var versions []struct{ ID int64 }
	f.request("GET", "/api/docs/"+d.ID+"/versions", a.Token, nil, 200, &versions)
	if len(versions) == 0 {
		t.Fatal("no version kept")
	}
	f.request("POST", fmt.Sprintf("/api/docs/%s/versions/%d/restore", d.ID, versions[len(versions)-1].ID), a.Token, nil, 200, nil)
	var restored sheetBody
	json.Unmarshal(f.openDoc(a, d.ID).Content, &restored)
	if len(restored.Sheets) != 1 || len(restored.Sheets[0].Cells) != 0 {
		t.Fatalf("restore: %+v", restored)
	}
}

func uploadDoc(f *fixture, a account, name string, data []byte, status int) map[string]string {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", name)
	part.Write(data)
	mw.Close()
	req, _ := http.NewRequest("POST", f.url+"/api/docs/import", &buf)
	req.Header.Set("Authorization", "Bearer "+a.Token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		f.t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != status {
		raw, _ := io.ReadAll(resp.Body)
		f.t.Fatalf("import %s: %d %s", name, resp.StatusCode, raw)
	}
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	return out
}

func TestDocImportExport(t *testing.T) {
	f := setup(t)
	a := f.register("doc_porter")
	md := "# 发布计划\n\n第一段 **重点** 和 *说明*，见 [官网](https://example.com)。\n第二行\n\n## 步骤\n\n- 准备\n- 测试\n\n1. 打包\n2. 上传\n\n- [x] 已完成\n- [ ] 未完成\n\n> 引用\n\n```go\nfmt.Println(1)\n```\n\n---\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n"
	created := uploadDoc(f, a, "计划.md", []byte(md), 200)
	d := f.openDoc(a, created["id"])
	var body docBody
	json.Unmarshal(d.Content, &body)
	types := []string{}
	for _, b := range body.Blocks {
		types = append(types, b.Type)
	}
	if d.Title != "计划" || strings.Join(types, ",") != "h1,p,h2,bullet,bullet,ordered,ordered,todo,todo,quote,code,divider,table" || body.Blocks[1].Text != "第一段 **重点** 和 *说明*，见 [官网](https://example.com)。\n第二行" || !body.Blocks[7].Checked || body.Blocks[10].Lang != "go" || body.Blocks[12].Rows[1][0] != "苹果" {
		t.Fatalf("markdown import: %s", d.Content)
	}
	// Word round trip keeps headings, lists, marks, links and tables.
	raw, err := docToDocx(d.Title, body)
	if err != nil {
		t.Fatal(err)
	}
	created = uploadDoc(f, a, "计划.docx", raw, 200)
	var back docBody
	json.Unmarshal(f.openDoc(a, created["id"]).Content, &back)
	got := []string{}
	for _, b := range back.Blocks {
		got = append(got, b.Type+":"+b.Text)
	}
	joined := strings.Join(got, "\n")
	for _, want := range []string{"h1:计划", "h1:发布计划", "p:第一段 **重点** 和 *说明*，见 [官网](https://example.com)。\n第二行", "bullet:准备", "ordered:上传", "todo:已完成", "quote:引用", "p:fmt.Println(1)"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("docx round trip lost %q in:\n%s", want, joined)
		}
	}
	if last := back.Blocks[len(back.Blocks)-1]; last.Type != "table" || last.Rows[1][1] != "3" {
		t.Fatalf("docx table: %+v", last)
	}
	// Downloads.
	for _, format := range []string{"docx", "md"} {
		req, _ := http.NewRequest("GET", f.url+"/api/docs/"+d.ID+"/export?format="+format, nil)
		req.Header.Set("Authorization", "Bearer "+a.Token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil || resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Disposition"), "."+format) {
			t.Fatalf("export %s: %v %v", format, resp.StatusCode, err)
		}
		resp.Body.Close()
	}
	uploadDoc(f, a, "x.exe", []byte("MZ"), 400)
	uploadDoc(f, a, "broken.docx", []byte("not a zip"), 400)
	csvDoc := uploadDoc(f, a, "名单.csv", []byte("\ufeff姓名,分数\n张三,90\n"), 200)
	if csvDoc["kind"] != "sheet" {
		t.Fatal(csvDoc)
	}
}

func TestDocAIProposesEdits(t *testing.T) {
	var prompt string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p struct {
			Messages []aiContextMessage
		}
		json.NewDecoder(r.Body).Decode(&p)
		prompt = p.Messages[len(p.Messages)-1].Content
		reply, _ := json.Marshal("```json\n{\"reply\":\"发现 1 处错别字\",\"edits\":[{\"op\":\"replace\",\"id\":\"BLOCK\",\"type\":\"p\",\"text\":\"我们的目标\",\"original\":\"我们的木标\",\"reason\":\"错别字\"}]}\n```")
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%s}}]}\n\ndata: [DONE]\n\n", reply)
	}))
	defer provider.Close()
	settings := DefaultSettings()
	settings.Registration.Enabled = true
	settings.AI.Enabled, settings.AI.API, settings.AI.Model = true, "chat", "deepseek-chat"
	settings.AI.CredentialsFile = filepath.Join(t.TempDir(), "ai.json")
	raw, _ := json.Marshal(aiCredentials{BaseURL: provider.URL, Token: "sk-doc-test-key"})
	os.WriteFile(settings.AI.CredentialsFile, raw, 0600)
	s, err := New(Config{DataDir: t.TempDir(), Settings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	defer s.Close()
	f := &fixture{t: t, s: s, url: srv.URL, server: srv}
	a, reader := f.register("doc_ai_user"), f.register("doc_ai_reader")
	d := f.newDoc(a, "doc", "目标")
	var body docBody
	json.Unmarshal(d.Content, &body)
	f.docOps(a, d.ID, "ai-client-1", "1", 200, docOp{Op: "text", ID: body.Blocks[0].ID, Base: strp(""), Text: strp("我们的木标")})
	var out struct {
		Reply    string
		Edits    []docAIEdit
		CanApply bool
	}
	f.request("POST", "/api/docs/"+d.ID+"/ai", a.Token, map[string]any{"mode": "check"}, 200, &out)
	if out.Reply != "发现 1 处错别字" || len(out.Edits) != 1 || *out.Edits[0].Text != "我们的目标" || !out.CanApply {
		t.Fatalf("ai: %+v", out)
	}
	if !strings.Contains(prompt, "["+body.Blocks[0].ID+"] p: 我们的木标") || !strings.Contains(prompt, "检查错误") {
		t.Fatalf("prompt: %s", prompt)
	}
	f.request("POST", "/api/docs/"+d.ID+"/ai", a.Token, map[string]any{"mode": "ask"}, 400, nil)
	f.request("POST", "/api/docs/"+d.ID+"/ai", reader.Token, map[string]any{"mode": "summary"}, 403, nil)
	f.request("PUT", "/api/docs/"+d.ID+"/members/"+reader.User.ID, a.Token, map[string]string{"role": "view"}, 200, nil)
	f.request("POST", "/api/docs/"+d.ID+"/ai", reader.Token, map[string]any{"mode": "summary"}, 200, &out)
	if out.CanApply || len(out.Edits) != 0 {
		t.Fatalf("summary for reader: %+v", out)
	}
}
