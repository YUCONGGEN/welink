(() => {
  // internal/ui/src/me-ai.js
  function createMe({ S: S2, api: api2, action: action2, esc: esc4, icon: icon2, modal: modal2, closeModal: closeModal2, toast: toast2, refresh: refresh2, selectConversation: selectConversation2, renderSidebar: renderSidebar2, remote }) {
    const $2 = (s) => document.querySelector(s), localDesktop = () => ["windows", "darwin"].includes(S2.config.platform) && config?.localTasks !== false;
    let config = null, local = { workspace: "", available: false, linkmeTools: false, systemProxy: false }, handledLinkMe = /* @__PURE__ */ new Set(), generation = 0, timer, task = null, seen = /* @__PURE__ */ new Set(), starting = false;
    const active = () => S2.conversations.find((c) => c.id === S2.active), live = (g) => g === generation && S2.user && !S2.signingOut;
    async function start() {
      stop();
      const g = generation;
      try {
        const value = await api2("/api/ai/config");
        if (!live(g)) return;
        config = value;
        if (!value.enabled) return;
        if (localDesktop()) {
          try {
            const prefs = await api2("/local/ai/config");
            if (live(g)) local = prefs;
          } catch {
          }
        }
        if (live(g)) {
          renderSidebar2();
          poll();
        }
      } catch {
      }
    }
    function stop() {
      generation++;
      clearTimeout(timer);
      task = null;
      config = null;
      local = { workspace: "", available: false };
      seen.clear();
      starting = false;
      $2("#me-panel")?.remove();
    }
    function sidebar() {
      return config?.enabled && !S2.conversations.some((c) => c.peer?.id === config.user.id) ? '<button class="conversation-row me-entry" data-me-open><span class="me-avatar">M</span><div class="row-text"><b>Me <em class="ai-label">AI</em></b><div class="row-preview">你的 AI 助手</div></div></button>' : "";
    }
    function render() {
      const panel = $2("#me-panel");
      if (!panel || !active()?.peer?.ai) return;
      panel.classList.remove("hidden");
      if (!panel.querySelector(".me-config")) panel.innerHTML = '<div class="me-config"><span class="ai-label">AI</span><span data-me-workspace></span><button class="text-btn" data-me-workspace-button>工作目录</button></div><div class="me-progress" role="status"><span data-me-status></span><button class="text-btn hidden" data-me-cancel>停止</button></div><div class="me-approvals"></div>';
      panel.querySelector("[data-me-workspace]").textContent = config?.localTasks === false ? "对话模式 · 当前模型不支持本机任务" : localDesktop() ? local.workspace ? "本机：" + local.workspace : "对话模式 · 选择目录后可处理本机任务" : "记住本会话上下文 · 本机任务请在桌面端执行";
      panel.querySelector("[data-me-workspace-button]").classList.toggle("hidden", !localDesktop());
      const current = task?.conversationId === S2.active ? task : null, running = current?.state === "running", busy = starting || running, events = current?.events || [];
      const pending = events.filter((e) => e.type === "approval"), steps = events.map(stepView).filter(Boolean);
      panel.querySelector("[data-me-status]").textContent = starting || running ? "" : current?.error || (current?.state === "completed" ? "已完成" + summary(current, steps) : current?.state === "cancelled" ? "已停止" : "");
      panel.querySelector("[data-me-cancel]").classList.add("hidden");
      const area = $2("#messages"), near = area && area.scrollHeight - area.clientHeight - area.scrollTop < 120;
      let stream = $2("#me-stream");
      if ((starting || running) && area) {
        if (!stream) {
          stream = document.createElement("article");
          stream.id = "me-stream";
          stream.className = "message me-stream";
          stream.innerHTML = '<span class="avatar me-avatar">M</span><div class="message-body"><span class="message-name">Me · AI</span><div class="bubble me-live"><div class="me-live-head"><span class="me-dots"><i></i><i></i><i></i></span><span data-live-status></span><time data-live-time></time><button class="text-btn" data-me-cancel>停止</button></div><div class="me-thinking"></div><ol class="me-plan"></ol><ul class="me-steps"></ul><div class="me-approvals"></div><div class="me-reply"></div></div></div>';
          area.append(stream);
        }
        if (!current?.started && running && !current._t0) current._t0 = Date.now();
        if (starting && !startedAt) startedAt = Date.now();
        const t0 = current?.started || current?._t0 || startedAt, live2 = steps.filter((s) => s.status === "inProgress").pop(), text = current?.text || "", thinking = lastLine(current?.thinking);
        stream.querySelector("[data-live-status]").textContent = starting && !running ? "正在交给 Me…" : pending.length ? "等待你确认" : live2 ? live2.text : text ? "正在回复" : "正在思考";
        stream.querySelector("[data-live-time]").textContent = t0 ? fmtTime(Date.now() - t0) : "";
        const thinkingNode = stream.querySelector(".me-thinking");
        thinkingNode.textContent = text ? "" : thinking;
        thinkingNode.hidden = !thinkingNode.textContent;
        const plan = events.find((e) => e.type === "plan")?.details?.plan || [], planNode = stream.querySelector(".me-plan");
        planNode.hidden = !plan.length;
        planNode.innerHTML = plan.map((p) => '<li class="' + esc4(p.status || "pending") + '">' + esc4(p.step || "") + "</li>").join("");
        const shown = steps.slice(-6), stepsNode = stream.querySelector(".me-steps");
        stepsNode.hidden = !steps.length;
        stepsNode.innerHTML = (steps.length > shown.length ? '<li class="more">前面还有 ' + (steps.length - shown.length) + " 步</li>" : "") + shown.map((s) => '<li class="' + esc4(s.status || "completed") + '"><span>' + esc4(s.text) + "</span>" + (s.code ? "<code>" + esc4(s.code) + "</code>" : "") + (s.note ? "<small>" + esc4(s.note) + "</small>" : "") + "</li>").join("");
        const reply = stream.querySelector(".me-reply");
        reply.textContent = text;
        reply.hidden = !text;
        stream.querySelector("[data-me-cancel]").hidden = !running;
        const approvals = stream.querySelector(".me-approvals");
        let added = false;
        for (const node of approvals.children) if (!pending.some((e) => e.id === node.dataset.approvalId)) node.remove();
        for (const e of pending) {
          if ([...approvals.children].some((n) => n.dataset.approvalId === e.id)) continue;
          const node = document.createElement("section");
          node.className = "me-approval";
          node.dataset.approvalId = e.id;
          node.innerHTML = approvalHTML(e);
          approvals.append(node);
          added = true;
        }
        if (near || added) area.scrollTop = area.scrollHeight;
        if (added) approvals.querySelector("[data-me-approve]")?.focus({ preventScroll: true });
      } else {
        stream?.remove();
        startedAt = 0;
      }
    }
    function shellCommand(c) {
      let s = String(Array.isArray(c) ? c.join(" ") : c || "").trim();
      const m = s.match(/^"?[^"\s]*?(?:powershell|pwsh|cmd|bash|zsh|sh)(?:\.exe)?"?\s+(?:-NoProfile\s+|-NoLogo\s+)*(?:-Command|-lc|-c|\/c)\s+([\s\S]+)$/i);
      if (m) {
        s = m[1].trim();
        if (s.length > 1 && (s[0] === "'" && s.endsWith("'"))) s = s.slice(1, -1).replace(/''/g, "'");
        else if (s.length > 1 && s[0] === '"' && s.endsWith('"')) s = s.slice(1, -1).replace(/\\"/g, '"');
      }
      return s;
    }
    let startedAt = 0;
    const fmtTime = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1e3));
      return s < 60 ? s + " 秒" : Math.floor(s / 60) + " 分 " + String(s % 60).padStart(2, "0") + " 秒";
    };
    const base = (p) => String(p || "").split(/[\\/]/).pop();
    const lastLine = (t) => String(t || "").replace(/\*\*/g, "").split(/\n+/).map((s) => s.trim()).filter(Boolean).pop() || "";
    function stepView(e) {
      const d = e.details || {};
      if (e.type === "tool" && d.type === "linkmeTool") {
        const p = d.params || {}, who = [].concat(p.to || p.chat || []).join("、");
        return { text: "LinkMe：" + (toolNames[d.tool] || d.tool) + (who ? " → " + who : ""), status: "completed", kind: "linkme" };
      }
      if (e.type !== "step") return null;
      const status = d.status === "inProgress" ? "inProgress" : d.status === "failed" || d.status === "declined" ? "failed" : "completed";
      switch (d.kind) {
        case "commandExecution":
          return { kind: d.kind, status: status === "completed" && d.exitCode != null && d.exitCode !== 0 ? "failed" : status, text: "运行命令", code: shellCommand(d.command), note: d.status === "declined" ? "已拒绝" : d.exitCode != null && d.exitCode !== 0 ? "退出码 " + d.exitCode : d.durationMs >= 1e3 ? fmtTime(d.durationMs) : "" };
        case "fileChange": {
          const files = (d.files || []).map(base);
          return { kind: d.kind, status, text: (status === "inProgress" ? "正在修改 " : "修改了 ") + files.slice(0, 3).join("、") + ((d.count || files.length) > 3 ? " 等 " + (d.count || files.length) + " 个文件" : ""), note: d.status === "declined" ? "已拒绝" : "" };
        }
        case "webSearch":
          return { kind: d.kind, status, text: "搜索网页" + (d.query ? "：" + d.query : "") };
        case "imageView":
          return { kind: d.kind, status, text: "查看图片 " + base(d.path) };
        case "contextCompaction":
          return { kind: d.kind, status, text: "整理对话上下文" };
        default:
          return { kind: d.kind, status, text: "使用工具 " + (d.tool || "") };
      }
    }
    function summary(t, steps) {
      const parts = [];
      const ms = (t.finished || 0) - (t.started || 0);
      if (t.started && ms > 0) parts.push("用时 " + fmtTime(ms));
      const n = (k) => steps.filter((s) => s.kind === k).length;
      if (n("commandExecution")) parts.push("运行 " + n("commandExecution") + " 条命令");
      const files = steps.filter((s) => s.kind === "fileChange").length;
      if (files) parts.push("修改 " + files + " 处文件");
      if (n("linkme")) parts.push("操作 LinkMe " + n("linkme") + " 次");
      if (n("webSearch")) parts.push("搜索 " + n("webSearch") + " 次");
      return parts.length ? " · " + parts.join(" · ") : "";
    }
    function approvalHTML(e) {
      const d = e.details || {}, item = d.item || {};
      if (e.method === "item/tool/requestUserInput") return "<b>Me 需要你补充信息</b>" + (d.reason ? "<p>" + esc4(d.reason) + "</p>" : "") + (d.questions || []).map((q) => "<label>" + esc4(q.question || q.header) + '<textarea data-me-answer="' + esc4(q.id) + '" maxlength="4000" placeholder="' + esc4((q.options || []).map((o) => o.label).join(" / ")) + '"></textarea></label>').join("") + '<div><button class="primary" data-me-approve>提交回答</button><button class="secondary" data-me-deny>不回答</button></div>';
      let title = "Me 请求执行操作", body = "";
      if (e.method === "item/commandExecution/requestApproval") {
        title = "Me 想运行一条命令";
        const command = d.command || item.command;
        body = "<pre>" + esc4(shellCommand(command).slice(0, 4e3)) + "</pre>" + (d.cwd || item.cwd ? "<small>位置：" + esc4(d.cwd || item.cwd) + "</small>" : "");
      } else if (e.method === "item/fileChange/requestApproval") {
        title = "Me 想修改文件";
        const files = (item.changes || []).map((c) => c.path).filter(Boolean);
        body = files.length ? '<ul class="me-files">' + files.slice(0, 12).map((f) => "<li>" + esc4(f) + "</li>").join("") + (files.length > 12 ? "<li>等 " + files.length + " 个文件</li>" : "") + "</ul>" : "";
      } else if (e.method === "item/permissions/requestApproval") {
        title = "Me 需要额外权限";
        body = "<pre>" + esc4(JSON.stringify(d.permissions || d, null, 2)).slice(0, 4e3) + "</pre>";
      }
      const always = /commandExecution|fileChange/.test(e.method);
      return "<b>" + esc4(title) + "</b>" + (d.reason ? "<p>" + esc4(d.reason) + "</p>" : "") + body + '<div><button class="primary" data-me-approve>允许</button>' + (always ? '<button class="secondary" data-me-approve data-me-always title="本次任务中同类操作不再询问">本次任务都允许</button>' : "") + '<button class="secondary" data-me-deny>拒绝</button></div>';
    }
    async function poll() {
      const g = generation;
      if (!config?.enabled || !live(g)) return;
      try {
        if (task?.mode === "chat") {
          const result = await api2("/api/ai/runs/" + task.id);
          if (live(g)) {
            const text = task.text, version = task.version;
            Object.assign(task, result);
            if (version > (result.version || 0) && task.state === "running") {
              task.text = text;
              task.version = version;
            }
          }
        } else if (localDesktop()) {
          const result = await api2("/local/ai/status");
          if (live(g) && result.id) {
            task = { ...result, mode: "local" };
            linkmeActions(task);
          }
        }
        if (live(g)) render();
      } catch {
      } finally {
        if (live(g)) timer = setTimeout(poll, task?.state === "running" ? 400 : 3e3);
      }
    }
    function linkmeActions(t) {
      for (const e of t.events || []) {
        if (e.type !== "linkme" || handledLinkMe.has(e.id)) continue;
        handledLinkMe.add(e.id);
        if (e.method === "remote" && remote) remote(e.details || {}).catch((err) => toast2(err.message));
      }
    }
    const toolNames = { linkme_send_message: "发送消息", linkme_send_file: "发送文件", linkme_schedule_message: "设置定时消息", linkme_cancel_schedule: "取消定时消息", linkme_read_messages: "查看聊天", linkme_list_contacts: "查看联系人", linkme_list_schedules: "查看定时消息", linkme_remote_assist: "发起远程协助" };
    async function onSent(message) {
      if (!config?.enabled || message.sender !== S2.user?.id || seen.has(message.id)) return;
      const c = S2.conversations.find((c2) => c2.id === message.conversationId);
      if (!c?.peer?.ai) return;
      seen.add(message.id);
      if (seen.size > 200) seen.delete(seen.values().next().value);
      if (deferred) {
        clearTimeout(deferred.timer);
        deferred = null;
      }
      if (message.kind !== "text") {
        deferred = { timer: setTimeout(() => {
          deferred = null;
          run(message);
        }, 2e3) };
        return;
      }
      run(message);
    }
    let deferred = null;
    async function run(message) {
      const g = generation;
      starting = true;
      render();
      try {
        let result;
        if (localDesktop() && local.workspace) {
          if (!local.available) throw Error("本机任务组件未下载，请点“工作目录”下载；普通对话仍可使用。");
          result = await action2("/local/ai/start", { messageId: message.id });
          if (live(g)) task = { ...result, state: "running", mode: "local" };
        } else {
          result = await action2("/api/ai/runs", { messageId: message.id, mode: "chat" });
          if (live(g)) task = { ...task?.id === result.id ? task : {}, id: result.id, conversationId: result.conversationId, state: "running", mode: "chat" };
        }
      } catch (error) {
        if (live(g)) {
          task = { conversationId: message.conversationId, state: "failed", error: error.message };
          toast2(error.message);
        }
      } finally {
        if (live(g)) {
          starting = false;
          render();
          clearTimeout(timer);
          poll();
        }
      }
    }
    async function workspace() {
      modal2("Me 的本地工作目录", '<p class="hint">Me 可以在此目录内读写文件和运行任务。需要额外权限时，会在聊天中向你确认。</p><label>工作目录<input id="me-workspace" placeholder="例如 E:\\工作文件" value="' + esc4(local.workspace) + '"></label><p class="hint">清空目录后恢复为对话模式。</p><label class="me-allow"><input type="checkbox" id="me-linkme-tools" ' + (local.linkmeTools ? "checked" : "") + '><span><b>允许 linkme-AIdex 代我操作 LinkMe</b><small>以你的身份查看好友和聊天、发消息、发送工作目录中的文件和图片、设置定时消息、发起远程协助邀请（对方仍需接受）。定时消息可在“设置 → 定时消息”中查看和取消。</small></span></label><div class="me-codex" id="me-codex" aria-live="polite"></div><label class="me-allow me-proxy"><input type="checkbox" id="me-system-proxy" ' + (local.systemProxy ? "checked" : "") + "><span><b>linkme-AIdex 通过系统代理连接服务器</b><small>默认直接连接服务器，开不开系统代理（如 127.0.0.1:7897）都能用。只有服务器必须经代理才能访问时才勾选。</small></span></label>", '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="me-save-workspace">保存</button>');
      codexRow();
      $2("#me-save-workspace").onclick = async () => {
        try {
          const value = await action2("/local/ai/config", { workspace: $2("#me-workspace").value.trim(), linkmeTools: $2("#me-linkme-tools").checked, systemProxy: $2("#me-system-proxy").checked });
          local.systemProxy = !!value.systemProxy;
          local.workspace = value.workspace;
          local.linkmeTools = !!value.linkmeTools;
          closeModal2();
          render();
        } catch (error) {
          toast2(error.message);
        }
      };
    }
    const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB";
    let codexTimer;
    async function codexRow() {
      clearTimeout(codexTimer);
      const row = $2("#me-codex");
      if (!row) return;
      let st;
      try {
        st = await api2("/local/ai/codex");
      } catch {
        row.innerHTML = "";
        return;
      }
      if (!$2("#me-codex")) return;
      if (st.installed && !local.available) {
        local.available = true;
        render();
      }
      let html = "<b>本机任务组件</b>";
      if (!st.supported) html += "<p>当前系统暂不支持本机任务，普通对话仍可使用。</p>";
      else if (st.state === "downloading") {
        const pct = st.total ? Math.floor(st.done * 100 / st.total) : 0;
        html += "<p>正在下载 linkme-AIdex " + esc4(st.version) + "… " + mb(st.done) + " / " + mb(st.total) + '</p><progress max="100" value="' + pct + '"></progress><button class="text-btn" data-me-codex="cancel">取消下载</button>';
      } else if (st.state === "installed") html += "<p>已就绪" + (st.source === "downloaded" ? " · linkme-AIdex " + esc4(st.current) : " · 使用本机已安装的组件") + "</p>";
      else if (st.state === "unavailable") html += "<p>" + esc4(st.error || "服务器尚未提供 linkme-AIdex") + "</p>";
      else if (st.state === "outdated") html += "<p>已安装 linkme-AIdex " + esc4(st.current) + "，可更新到 " + esc4(st.version) + "（" + mb(st.size) + '）</p><button class="secondary" data-me-codex="install">更新</button>';
      else html += "<p>" + (st.state === "failed" ? esc4(st.error || "下载失败") : "处理本机文件需要先下载 linkme-AIdex " + esc4(st.version) + "（约 " + mb(st.size) + "），之后自动更新。") + '</p><button class="secondary" data-me-codex="install">' + (st.state === "failed" ? "重试" : "下载") + "</button>";
      row.innerHTML = html;
      if (st.state === "downloading") codexTimer = setTimeout(codexRow, 500);
    }
    document.addEventListener("click", async (e) => {
      const c = e.target.closest("[data-me-codex]");
      if (!c) return;
      c.disabled = true;
      try {
        await action2("/local/ai/codex/" + c.dataset.meCodex, {});
      } catch (error) {
        toast2(error.message);
      }
      codexRow();
    });
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-me-open],[data-me-workspace-button],[data-me-cancel],[data-me-approve],[data-me-deny]");
      if (!b) return;
      try {
        if (b.hasAttribute("data-me-open")) {
          if (!config?.user) return;
          const c = await action2("/api/conversations", { kind: "direct", members: [config.user.id] });
          await refresh2();
          await selectConversation2(c.id);
        } else if (b.hasAttribute("data-me-workspace-button")) await workspace();
        else if (b.hasAttribute("data-me-cancel") && task) {
          await action2(task.mode === "local" ? "/local/ai/cancel" : "/api/ai/runs/" + task.id + "/cancel");
          task.state = "cancelled";
          render();
        } else {
          const node = b.closest(".me-approval");
          if (!node || !task) return;
          const answers = {};
          for (const input of node.querySelectorAll("[data-me-answer]")) answers[input.dataset.meAnswer] = { answers: [input.value] };
          for (const x of node.querySelectorAll("button")) x.disabled = true;
          await action2("/local/ai/approve", { taskId: task.id, id: node.dataset.approvalId, accept: b.hasAttribute("data-me-approve"), always: b.hasAttribute("data-me-always"), answers });
          node.remove();
          render();
        }
      } catch (error) {
        toast2(error.message);
        b.disabled = false;
        for (const x of b.closest(".me-approval")?.querySelectorAll("button") || []) x.disabled = false;
      }
    });
    function changed(type, d) {
      if (!config?.enabled || !S2.conversations.some((c) => c.id === d.conversationId && c.peer?.ai)) return;
      if (task?.id !== d.id) task = { id: d.id, conversationId: d.conversationId, state: "running", mode: "chat", text: "", version: 0 };
      if (type === "ai-delta") {
        if (d.version <= (task.version || 0)) return;
        task.text = (task.text || "") + d.delta;
        task.version = d.version;
      } else {
        task.state = d.state;
        task.error = d.error;
      }
      render();
    }
    return { changed, start, stop, sidebar, mount: render, onSent, busy: () => active()?.peer?.ai && (starting || task?.state === "running" && task?.conversationId === S2.active) };
  }

  // internal/ui/src/remote-input.js
  function createRemoteInput(send, release, failed = () => {
  }) {
    let queue = [], busy = false, buttons = 0, generation = 0, stopped = false, resetting = null;
    async function drain() {
      if (busy || stopped || !queue.length) return;
      busy = true;
      const version = generation, batch = queue.splice(0, 64).map((item) => item.event);
      try {
        await send(batch);
      } catch (error) {
        queue = [];
        buttons = 0;
        generation++;
        await release().catch(() => {
        });
        failed(error);
      } finally {
        busy = false;
        if (version === generation) drain();
      }
    }
    function push(events) {
      if (stopped || resetting) return;
      for (const event of events) {
        const hover = event.type === "move" && buttons === 0, last = queue[queue.length - 1];
        if (hover && last?.hover) queue[queue.length - 1] = { event, hover };
        else queue.push({ event, hover });
        if (event.type === "down") buttons |= 1 << event.button;
        if (event.type === "up") buttons &= ~(1 << event.button);
      }
      if (queue.length > 256) {
        reset();
        failed(Error("输入暂时拥堵，已释放按键，请重试"));
        return;
      }
      drain();
    }
    function reset() {
      if (resetting) return resetting;
      queue = [];
      buttons = 0;
      generation++;
      resetting = (async () => {
        while (busy) await new Promise((resolve) => setTimeout(resolve, 5));
        await release().catch(() => {
        });
      })();
      return resetting.finally(() => {
        resetting = null;
      });
    }
    return { push, release: reset, async close() {
      stopped = true;
      await reset();
    } };
  }
  function remotePoint(event, image) {
    const box = image.getBoundingClientRect(), width = Number(image.dataset.width), height = Number(image.dataset.height);
    if (!width || !height || !box.width || !box.height) return { type: "move", x: 0, y: 0 };
    const scale = Math.min(box.width / width, box.height / height), left = box.left + (box.width - width * scale) / 2, top = box.top + (box.height - height * scale) / 2;
    return { type: "move", x: Math.max(0, Math.min(width - 1, Math.floor((event.clientX - left) / scale))), y: Math.max(0, Math.min(height - 1, Math.floor((event.clientY - top) / scale))) };
  }

  // internal/ui/src/remote-frames.js
  var ByteReader = class {
    constructor(reader) {
      this.reader = reader;
      this.chunk = new Uint8Array(0);
      this.offset = 0;
    }
    async read(size) {
      const result = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        if (this.offset === this.chunk.length) {
          const next = await this.reader.read();
          if (next.done) throw Error("画面传输已断开");
          this.chunk = next.value;
          this.offset = 0;
        }
        const count = Math.min(size - offset, this.chunk.length - this.offset);
        result.set(this.chunk.subarray(this.offset, this.offset + count), offset);
        offset += count;
        this.offset += count;
      }
      return result;
    }
    async header() {
      const sizes = new DataView((await this.read(8)).buffer), header = sizes.getUint32(0), size = sizes.getUint32(4);
      if (header < 1 || header > 1048576 || size > 33554432) throw Error("画面数据长度无效");
      return { meta: JSON.parse(new TextDecoder().decode(await this.read(header))), size };
    }
    async finish() {
      if (this.offset !== this.chunk.length) throw Error("画面包含多余数据");
      const next = await this.reader.read();
      if (!next.done) throw Error("画面包含多余数据");
    }
  };
  function validate(meta, size) {
    if (meta.tileSize !== void 0 && ![128, 256].includes(meta.tileSize)) throw Error("画面分块尺寸无效");
    if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width < 1 || meta.height < 1 || meta.width > 16384 || meta.height > 16384 || meta.width * meta.height > 33177600 || !Array.isArray(meta.tiles) || meta.tiles.length > 1024) throw Error("画面尺寸无效");
    let total = 0;
    for (const t of meta.tiles) {
      if (![t.x, t.y, t.w, t.h, t.size].every(Number.isInteger) || t.x < 0 || t.y < 0 || t.w < 1 || t.h < 1 || t.x + t.w > meta.width || t.y + t.h > meta.height || t.size < 1 || !["image/png", "image/jpeg"].includes(t.mime)) throw Error("画面区域无效");
      total += t.size;
    }
    if (total !== size) throw Error("画面数据不完整");
  }
  function decodeImage(part, mime) {
    const blob = new Blob([part], { type: mime });
    if (window.createImageBitmap) return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error("无法解码远程画面"));
      };
      image.src = url;
    });
  }
  async function paintStream(canvas, stream, meta, size, shouldPaint) {
    validate(meta, size);
    if (!meta.reset && (canvas.width !== meta.width || canvas.height !== meta.height)) throw Error("需要重新同步画面");
    let readTail = Promise.resolve();
    const readTile = (t) => {
      const part = readTail.then(() => stream.read(t.size));
      readTail = part;
      return part;
    };
    const images = [];
    let index = 0, failure;
    try {
      const decode = async () => {
        while (index < meta.tiles.length && !failure) {
          const i = index++, t = meta.tiles[i];
          try {
            const bitmap = await readTile(t).then((part) => decodeImage(part, t.mime));
            images[i] = { t, bitmap };
            if ((bitmap.width || bitmap.naturalWidth) !== t.w || (bitmap.height || bitmap.naturalHeight) !== t.h) throw Error("画面区域尺寸不匹配");
          } catch (error) {
            failure = error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, meta.tiles.length) }, decode));
      if (failure) throw failure;
      await stream.finish();
      if (!shouldPaint()) return false;
      if (canvas.width !== meta.width) canvas.width = meta.width;
      if (canvas.height !== meta.height) canvas.height = meta.height;
      const ctx = canvas.getContext("2d", { alpha: false });
      for (const { t, bitmap } of images) ctx.drawImage(bitmap, t.x, t.y);
      canvas.dataset.width = String(meta.width);
      canvas.dataset.height = String(meta.height);
      return true;
    } finally {
      for (const image of images) image?.bitmap.close?.();
    }
  }
  async function runRemoteFrames(canvas, live, onFrame, onError, endpoint = "/local/remote/tiles") {
    let revision = 0, failures = 0;
    while (live()) {
      let reader, failed = false;
      try {
        const response = await fetch(endpoint + "?after=" + revision, { cache: "no-store" });
        if (!live()) return;
        if (response.status === 204) {
          failures = 0;
          continue;
        }
        if (!response.ok) throw Error("远程画面暂时不可用");
        reader = response.body.getReader();
        const stream = new ByteReader(reader);
        const { meta, size } = await stream.header();
        if (!Number.isSafeInteger(meta.revision) || meta.revision < 1) throw Error("画面版本无效");
        const painted = await paintStream(canvas, stream, meta, size, live);
        if (painted === false) return;
        revision = meta.revision;
        failures = 0;
        onFrame?.(meta);
      } catch (error) {
        failed = true;
        revision = 0;
        if (!live()) return;
        if (++failures >= 20) {
          onError?.(error);
          return;
        }
      } finally {
        if (reader) {
          if (failed) await reader.cancel().catch(() => {
          });
          reader.releaseLock();
        }
      }
      if (failed) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  // internal/ui/src/remote-view.js
  function passes(width, height, targetWidth, targetHeight) {
    const result = [];
    for (const axis of [0, 1]) {
      const target = axis ? targetHeight : targetWidth;
      while ((axis ? height : width) !== target) {
        const size = axis ? height : width, next = size > target * 2 ? Math.ceil(size / 2) : target;
        result.push({ width: axis ? width : next, height: axis ? next : height, axis });
        if (axis) height = next;
        else width = next;
      }
    }
    return result;
  }
  function kernel(source, target) {
    const values = new Float32Array(target * 12), scale = Math.min(1, target / source);
    const sinc = (x) => Math.abs(x) < 1e-4 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    for (let x = 0; x < target; x++) {
      const p = (x + 0.5) * source / target - 0.5, base = Math.floor(p), weights = [];
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        const d = (base + i - 5 - p) * scale, w = Math.abs(d) < 3 ? sinc(d) * sinc(d / 3) : 0;
        weights.push(w);
        sum += w;
      }
      for (let i = 0; i < 12; i++) values[Math.floor(i / 4) * target * 4 + x * 4 + i % 4] = weights[i] / sum;
    }
    return values;
  }
  var vertex = "attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}";
  var fragment = `precision highp float;
varying vec2 uv;uniform sampler2D image;uniform sampler2D kernelWeights;uniform vec2 sourceSize;uniform vec2 targetSize;uniform vec2 axis;uniform float flipY;
vec4 pixel(vec2 p){p=clamp(p,vec2(0.0),sourceSize-1.0);if(flipY>0.5)p.y=sourceSize.y-1.0-p.y;return texture2D(image,(p+0.5)/sourceSize);}
void main(){
 vec2 p=uv*sourceSize-0.5;float ratio=dot(targetSize/sourceSize,axis);
 float base=floor(dot(p,axis));vec4 sum=vec4(0.0);
 float u=dot(uv,axis);vec4 a0=texture2D(kernelWeights,vec2(u,1.0/6.0)),a1=texture2D(kernelWeights,vec2(u,0.5)),a2=texture2D(kernelWeights,vec2(u,5.0/6.0));
 for(int i=0;i<12;i++){
  float offset=float(i)-5.0,w=i<4?a0[i]:i<8?a1[i-4]:a2[i-8];
  sum+=pixel(p+axis*(base+offset-dot(p,axis)))*w;
 }
 vec4 color=sum;
 if(ratio>1.0){vec4 a=pixel(p+axis*(base-dot(p,axis))),b=pixel(p+axis*(base+1.0-dot(p,axis)));color=clamp(color,min(a,b),max(a,b));}
 gl_FragColor=vec4(clamp(color.rgb,0.0,1.0),1.0);
}`;
  var GPUScaler = class {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
      if (!gl || !gl.getExtension("OES_texture_float")) throw Error("GPU scaling unavailable");
      this.kernels = /* @__PURE__ */ new Map();
      const shader = (type, code) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, code);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          const m = gl.getShaderInfoLog(s);
          gl.deleteShader(s);
          throw Error(m);
        }
        return s;
      };
      const program = this.program = gl.createProgram(), v = shader(gl.VERTEX_SHADER, vertex), f = shader(gl.FRAGMENT_SHADER, fragment);
      gl.attachShader(program, v);
      gl.attachShader(program, f);
      gl.linkProgram(program);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const location2 = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(location2);
      gl.vertexAttribPointer(location2, 2, gl.FLOAT, false, 0, 0);
      this.sourceUniform = gl.getUniformLocation(program, "sourceSize");
      this.targetUniform = gl.getUniformLocation(program, "targetSize");
      this.axisUniform = gl.getUniformLocation(program, "axis");
      this.flipUniform = gl.getUniformLocation(program, "flipY");
      const texture = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
        for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
        return t;
      };
      this.texture = texture;
      this.slots = Array.from({ length: 3 }, () => ({ texture: texture(), framebuffer: gl.createFramebuffer(), width: 0, height: 0 }));
      gl.uniform1i(gl.getUniformLocation(program, "image"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "kernelWeights"), 1);
      this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    }
    weights(source, target) {
      const gl = this.gl, key = source + ":" + target;
      let t = this.kernels.get(key);
      if (!t) {
        if (this.kernels.size >= 16) {
          const first = this.kernels.keys().next().value;
          gl.deleteTexture(this.kernels.get(first));
          this.kernels.delete(first);
        }
        t = this.texture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, target, 3, 0, gl.RGBA, gl.FLOAT, kernel(source, target));
        this.kernels.set(key, t);
      }
      gl.bindTexture(gl.TEXTURE_2D, t);
    }
    draw(image, width, height) {
      const gl = this.gl, sw = image.width, sh = image.height;
      if (gl.isContextLost() || Math.max(sw, sh, width, height) > this.maxSize) throw Error("GPU scaling size unavailable");
      const jobs = passes(sw, sh, width, height);
      if (!jobs.length) throw Error("identity needs no scaling");
      const source = this.slots[0];
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      gl.useProgram(this.program);
      let input = source, iw = sw, ih = sh;
      jobs.forEach((job, i) => {
        const last = i === jobs.length - 1, out = last ? null : this.slots[1 + i % 2];
        gl.bindFramebuffer(gl.FRAMEBUFFER, out?.framebuffer || null);
        if (out) {
          gl.bindTexture(gl.TEXTURE_2D, out.texture);
          if (out.width !== job.width || out.height !== job.height) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, job.width, job.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            out.width = job.width;
            out.height = job.height;
          }
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("GPU scaling framebuffer unavailable");
        }
        gl.activeTexture(gl.TEXTURE1);
        this.weights(job.axis ? ih : iw, job.axis ? job.height : job.width);
        gl.activeTexture(gl.TEXTURE0);
        gl.viewport(0, 0, job.width, job.height);
        gl.bindTexture(gl.TEXTURE_2D, input.texture);
        gl.uniform2f(this.sourceUniform, iw, ih);
        gl.uniform2f(this.targetUniform, job.width, job.height);
        gl.uniform2f(this.axisUniform, job.axis ? 0 : 1, job.axis ? 1 : 0);
        gl.uniform1f(this.flipUniform, i === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        input = out;
        iw = job.width;
        ih = job.height;
      });
      gl.flush();
      return jobs.length;
    }
    close() {
      const gl = this.gl;
      for (const s of this.slots) {
        gl.deleteTexture(s.texture);
        gl.deleteFramebuffer(s.framebuffer);
      }
      for (const t of this.kernels.values()) gl.deleteTexture(t);
      gl.deleteBuffer(this.buffer);
      gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
  var Presenter = class {
    constructor(source) {
      this.source = source;
      this.container = source.parentElement;
      this.failed = false;
      this.closed = false;
      this.output = document.createElement("canvas");
      this.output.className = "resampled-view";
      this.output.setAttribute("aria-hidden", "true");
      this.output.hidden = true;
      Object.assign(this.output.style, { position: "absolute", pointerEvents: "none", maxWidth: "none", maxHeight: "none", margin: "0", padding: "0", border: "0", flex: "none", zIndex: "0" });
      this.container.append(this.output);
    }
    fail() {
      this.failed = true;
      this.output.hidden = true;
      this.source.style.opacity = "";
      this.source.dataset.resampling = "browser";
    }
    update(nativePixels, newFrame) {
      if (this.closed) return;
      const source = this.source, box = source.getBoundingClientRect(), parent = this.container.getBoundingClientRect(), dpr = Number(window.devicePixelRatio) || 1;
      const width = Math.max(1, Math.round(box.width * dpr)), height = Math.max(1, Math.round(box.height * dpr));
      const key = [source.width, source.height, width, height].join(":"), changed = key !== this.key || newFrame;
      this.key = key;
      const enabled = !nativePixels && source.dataset.ready === "1" && (width !== source.width || height !== source.height);
      Object.assign(this.output.style, { left: box.left - parent.left - this.container.clientLeft + this.container.scrollLeft + "px", top: box.top - parent.top - this.container.clientTop + this.container.scrollTop + "px", width: box.width + "px", height: box.height + "px" });
      if (!enabled || this.failed) {
        this.output.hidden = true;
        source.style.opacity = "";
        if (!this.failed) source.dataset.resampling = nativePixels ? "native" : "identity";
        return;
      }
      if (!changed && !this.output.hidden) return;
      try {
        this.scaler ??= new GPUScaler(this.output);
        const started = performance.now(), count = this.scaler.draw(source, width, height);
        const ms = performance.now() - started;
        this.output.hidden = false;
        source.style.opacity = "0";
        source.dataset.resampling = "lanczos3";
        source.dataset.resamplePasses = String(count);
        source.dataset.resampleMs = ms.toFixed(2);
        this.slow = ms > SLOW_DRAW ? (this.slow || 0) + 1 : 0;
        if (this.slow >= SLOW_FRAMES) this.fail();
      } catch {
        this.fail();
      }
    }
    close() {
      this.closed = true;
      this.scaler?.close();
      this.output.remove();
      this.source.style.opacity = "";
    }
  };
  var SLOW_DRAW = 20;
  var SLOW_FRAMES = 5;
  var fitted = /* @__PURE__ */ new WeakMap();
  var presenters = /* @__PURE__ */ new WeakMap();
  function fitRemoteView(canvas, container, actualSize = false, newFrame = false) {
    if (!canvas || !container || canvas.width < 1 || canvas.height < 1) return;
    canvas.dataset.ready = "1";
    const dpr = Math.max(0.1, Number(window.devicePixelRatio) || 1), width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight), bounds = container.getBoundingClientRect();
    const key = [canvas.width, canvas.height, width, height, dpr, actualSize, bounds.left, bounds.top, container.scrollLeft, container.scrollTop].join(":");
    let nativePixels = fitted.get(canvas)?.nativePixels ?? actualSize;
    if (fitted.get(canvas)?.key !== key) {
      const left = Math.ceil((bounds.left + container.clientLeft) * dpr), top = Math.ceil((bounds.top + container.clientTop) * dpr), right = Math.floor((bounds.left + container.clientLeft + width) * dpr), bottom = Math.floor((bounds.top + container.clientTop + height) * dpr);
      const fit = Math.min(Math.max(1, right - left) / canvas.width, Math.max(1, bottom - top) / canvas.height);
      nativePixels = actualSize || Math.abs(fit - 1) * Math.max(canvas.width, canvas.height) <= 4;
      const scale = nativePixels ? 1 / dpr : fit / dpr;
      canvas.style.width = canvas.width * scale + "px";
      canvas.style.height = canvas.height * scale + "px";
      canvas.style.maxWidth = "none";
      canvas.style.maxHeight = "none";
      canvas.style.flex = "none";
      canvas.style.position = "relative";
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.transform = "none";
      canvas.style.imageRendering = Math.abs(scale * dpr - 1) < 1e-6 ? "pixelated" : "auto";
      const box = canvas.getBoundingClientRect();
      canvas.style.left = Math.round(box.left) - box.left + "px";
      canvas.style.top = Math.round(box.top) - box.top + "px";
      const origin = canvas.getBoundingClientRect();
      let px = Math.round(origin.left * dpr), py = Math.round(origin.top * dpr);
      if (!nativePixels) {
        px = Math.max(left, Math.min(Math.floor(right - origin.width * dpr + 1e-4), px));
        py = Math.max(top, Math.min(Math.floor(bottom - origin.height * dpr + 1e-4), py));
      }
      const x = px / dpr - origin.left, y = py / dpr - origin.top;
      canvas.style.transform = x || y ? `translate(${x}px,${y}px)` : "none";
      fitted.set(canvas, { key, nativePixels });
      newFrame = true;
    }
    let presenter = presenters.get(canvas);
    if (!presenter && !nativePixels) {
      presenter = new Presenter(canvas);
      presenters.set(canvas, presenter);
    }
    if (presenter) presenter.update(nativePixels, newFrame);
    else canvas.dataset.resampling = "native";
  }
  function disposeRemoteView(canvas) {
    presenters.get(canvas)?.close();
    presenters.delete(canvas);
    fitted.delete(canvas);
  }

  // internal/ui/src/branding.js
  var CLIENT_VERSION = "0.1.29";
  var APP_NAME = "LinkMe";
  var brandIconURL = "";
  function setBrand(name, iconVersion) {
    APP_NAME = String(name || "").trim() || "LinkMe";
    brandIconURL = iconVersion ? "/api/branding/icon?v=" + encodeURIComponent(iconVersion) : "";
  }
  function brandIcon() {
    return brandIconURL || "/assets/icon.svg";
  }
  function customBrandIcon() {
    return brandIconURL;
  }
  function authShowcase() {
    return '<div class="snowfall" aria-hidden="true"><span></span><span></span><span></span></div><aside class="auth-showcase"><p class="auth-kicker"><i aria-hidden="true"></i> ' + APP_NAME + ' · 即时通讯</p><h1>每一句，<br>都有回应。</h1><p class="auth-intro">从一句消息，到一次默契的协作。<br>让同事、想法和文件，在这里相遇。</p><div class="auth-features"><span>即时消息</span><span>音视频会议</span><span>文件共享</span></div></aside>';
  }

  // internal/ui/src/cartoon-catalog.js
  var cartoonAvatars = [{ "id": "cartoon:001", "name": "元气小猫", "animal": "小猫", "style": "元气" }, { "id": "cartoon:002", "name": "元气小狗", "animal": "小狗", "style": "元气" }, { "id": "cartoon:003", "name": "元气小熊", "animal": "小熊", "style": "元气" }, { "id": "cartoon:004", "name": "元气兔兔", "animal": "兔兔", "style": "元气" }, { "id": "cartoon:005", "name": "元气狐狸", "animal": "狐狸", "style": "元气" }, { "id": "cartoon:006", "name": "元气熊猫", "animal": "熊猫", "style": "元气" }, { "id": "cartoon:007", "name": "元气考拉", "animal": "考拉", "style": "元气" }, { "id": "cartoon:008", "name": "元气老虎", "animal": "老虎", "style": "元气" }, { "id": "cartoon:009", "name": "元气狮子", "animal": "狮子", "style": "元气" }, { "id": "cartoon:010", "name": "元气小猴", "animal": "小猴", "style": "元气" }, { "id": "cartoon:011", "name": "元气小猪", "animal": "小猪", "style": "元气" }, { "id": "cartoon:012", "name": "元气绵羊", "animal": "绵羊", "style": "元气" }, { "id": "cartoon:013", "name": "元气奶牛", "animal": "奶牛", "style": "元气" }, { "id": "cartoon:014", "name": "元气企鹅", "animal": "企鹅", "style": "元气" }, { "id": "cartoon:015", "name": "元气猫头鹰", "animal": "猫头鹰", "style": "元气" }, { "id": "cartoon:016", "name": "元气青蛙", "animal": "青蛙", "style": "元气" }, { "id": "cartoon:017", "name": "元气小鸡", "animal": "小鸡", "style": "元气" }, { "id": "cartoon:018", "name": "元气浣熊", "animal": "浣熊", "style": "元气" }, { "id": "cartoon:019", "name": "元气海豹", "animal": "海豹", "style": "元气" }, { "id": "cartoon:020", "name": "元气仓鼠", "animal": "仓鼠", "style": "元气" }, { "id": "cartoon:021", "name": "甜梦小猫", "animal": "小猫", "style": "甜梦" }, { "id": "cartoon:022", "name": "甜梦小狗", "animal": "小狗", "style": "甜梦" }, { "id": "cartoon:023", "name": "甜梦小熊", "animal": "小熊", "style": "甜梦" }, { "id": "cartoon:024", "name": "甜梦兔兔", "animal": "兔兔", "style": "甜梦" }, { "id": "cartoon:025", "name": "甜梦狐狸", "animal": "狐狸", "style": "甜梦" }, { "id": "cartoon:026", "name": "甜梦熊猫", "animal": "熊猫", "style": "甜梦" }, { "id": "cartoon:027", "name": "甜梦考拉", "animal": "考拉", "style": "甜梦" }, { "id": "cartoon:028", "name": "甜梦老虎", "animal": "老虎", "style": "甜梦" }, { "id": "cartoon:029", "name": "甜梦狮子", "animal": "狮子", "style": "甜梦" }, { "id": "cartoon:030", "name": "甜梦小猴", "animal": "小猴", "style": "甜梦" }, { "id": "cartoon:031", "name": "甜梦小猪", "animal": "小猪", "style": "甜梦" }, { "id": "cartoon:032", "name": "甜梦绵羊", "animal": "绵羊", "style": "甜梦" }, { "id": "cartoon:033", "name": "甜梦奶牛", "animal": "奶牛", "style": "甜梦" }, { "id": "cartoon:034", "name": "甜梦企鹅", "animal": "企鹅", "style": "甜梦" }, { "id": "cartoon:035", "name": "甜梦猫头鹰", "animal": "猫头鹰", "style": "甜梦" }, { "id": "cartoon:036", "name": "甜梦青蛙", "animal": "青蛙", "style": "甜梦" }, { "id": "cartoon:037", "name": "甜梦小鸡", "animal": "小鸡", "style": "甜梦" }, { "id": "cartoon:038", "name": "甜梦浣熊", "animal": "浣熊", "style": "甜梦" }, { "id": "cartoon:039", "name": "甜梦海豹", "animal": "海豹", "style": "甜梦" }, { "id": "cartoon:040", "name": "甜梦仓鼠", "animal": "仓鼠", "style": "甜梦" }, { "id": "cartoon:041", "name": "花园小猫", "animal": "小猫", "style": "花园" }, { "id": "cartoon:042", "name": "花园小狗", "animal": "小狗", "style": "花园" }, { "id": "cartoon:043", "name": "花园小熊", "animal": "小熊", "style": "花园" }, { "id": "cartoon:044", "name": "花园兔兔", "animal": "兔兔", "style": "花园" }, { "id": "cartoon:045", "name": "花园狐狸", "animal": "狐狸", "style": "花园" }, { "id": "cartoon:046", "name": "花园熊猫", "animal": "熊猫", "style": "花园" }, { "id": "cartoon:047", "name": "花园考拉", "animal": "考拉", "style": "花园" }, { "id": "cartoon:048", "name": "花园老虎", "animal": "老虎", "style": "花园" }, { "id": "cartoon:049", "name": "花园狮子", "animal": "狮子", "style": "花园" }, { "id": "cartoon:050", "name": "花园小猴", "animal": "小猴", "style": "花园" }, { "id": "cartoon:051", "name": "花园小猪", "animal": "小猪", "style": "花园" }, { "id": "cartoon:052", "name": "花园绵羊", "animal": "绵羊", "style": "花园" }, { "id": "cartoon:053", "name": "花园奶牛", "animal": "奶牛", "style": "花园" }, { "id": "cartoon:054", "name": "花园企鹅", "animal": "企鹅", "style": "花园" }, { "id": "cartoon:055", "name": "花园猫头鹰", "animal": "猫头鹰", "style": "花园" }, { "id": "cartoon:056", "name": "花园青蛙", "animal": "青蛙", "style": "花园" }, { "id": "cartoon:057", "name": "花园小鸡", "animal": "小鸡", "style": "花园" }, { "id": "cartoon:058", "name": "花园浣熊", "animal": "浣熊", "style": "花园" }, { "id": "cartoon:059", "name": "花园海豹", "animal": "海豹", "style": "花园" }, { "id": "cartoon:060", "name": "花园仓鼠", "animal": "仓鼠", "style": "花园" }, { "id": "cartoon:061", "name": "眼镜小猫", "animal": "小猫", "style": "眼镜" }, { "id": "cartoon:062", "name": "眼镜小狗", "animal": "小狗", "style": "眼镜" }, { "id": "cartoon:063", "name": "眼镜小熊", "animal": "小熊", "style": "眼镜" }, { "id": "cartoon:064", "name": "眼镜兔兔", "animal": "兔兔", "style": "眼镜" }, { "id": "cartoon:065", "name": "眼镜狐狸", "animal": "狐狸", "style": "眼镜" }, { "id": "cartoon:066", "name": "眼镜熊猫", "animal": "熊猫", "style": "眼镜" }, { "id": "cartoon:067", "name": "眼镜考拉", "animal": "考拉", "style": "眼镜" }, { "id": "cartoon:068", "name": "眼镜老虎", "animal": "老虎", "style": "眼镜" }, { "id": "cartoon:069", "name": "眼镜狮子", "animal": "狮子", "style": "眼镜" }, { "id": "cartoon:070", "name": "眼镜小猴", "animal": "小猴", "style": "眼镜" }, { "id": "cartoon:071", "name": "眼镜小猪", "animal": "小猪", "style": "眼镜" }, { "id": "cartoon:072", "name": "眼镜绵羊", "animal": "绵羊", "style": "眼镜" }, { "id": "cartoon:073", "name": "眼镜奶牛", "animal": "奶牛", "style": "眼镜" }, { "id": "cartoon:074", "name": "眼镜企鹅", "animal": "企鹅", "style": "眼镜" }, { "id": "cartoon:075", "name": "眼镜猫头鹰", "animal": "猫头鹰", "style": "眼镜" }, { "id": "cartoon:076", "name": "眼镜青蛙", "animal": "青蛙", "style": "眼镜" }, { "id": "cartoon:077", "name": "眼镜小鸡", "animal": "小鸡", "style": "眼镜" }, { "id": "cartoon:078", "name": "眼镜浣熊", "animal": "浣熊", "style": "眼镜" }, { "id": "cartoon:079", "name": "眼镜海豹", "animal": "海豹", "style": "眼镜" }, { "id": "cartoon:080", "name": "眼镜仓鼠", "animal": "仓鼠", "style": "眼镜" }, { "id": "cartoon:081", "name": "星光小猫", "animal": "小猫", "style": "星光" }, { "id": "cartoon:082", "name": "星光小狗", "animal": "小狗", "style": "星光" }, { "id": "cartoon:083", "name": "星光小熊", "animal": "小熊", "style": "星光" }, { "id": "cartoon:084", "name": "星光兔兔", "animal": "兔兔", "style": "星光" }, { "id": "cartoon:085", "name": "星光狐狸", "animal": "狐狸", "style": "星光" }, { "id": "cartoon:086", "name": "星光熊猫", "animal": "熊猫", "style": "星光" }, { "id": "cartoon:087", "name": "星光考拉", "animal": "考拉", "style": "星光" }, { "id": "cartoon:088", "name": "星光老虎", "animal": "老虎", "style": "星光" }, { "id": "cartoon:089", "name": "星光狮子", "animal": "狮子", "style": "星光" }, { "id": "cartoon:090", "name": "星光小猴", "animal": "小猴", "style": "星光" }, { "id": "cartoon:091", "name": "星光小猪", "animal": "小猪", "style": "星光" }, { "id": "cartoon:092", "name": "星光绵羊", "animal": "绵羊", "style": "星光" }, { "id": "cartoon:093", "name": "星光奶牛", "animal": "奶牛", "style": "星光" }, { "id": "cartoon:094", "name": "星光企鹅", "animal": "企鹅", "style": "星光" }, { "id": "cartoon:095", "name": "星光猫头鹰", "animal": "猫头鹰", "style": "星光" }, { "id": "cartoon:096", "name": "星光青蛙", "animal": "青蛙", "style": "星光" }, { "id": "cartoon:097", "name": "星光小鸡", "animal": "小鸡", "style": "星光" }, { "id": "cartoon:098", "name": "星光浣熊", "animal": "浣熊", "style": "星光" }, { "id": "cartoon:099", "name": "星光海豹", "animal": "海豹", "style": "星光" }, { "id": "cartoon:100", "name": "星光仓鼠", "animal": "仓鼠", "style": "星光" }];
  var cartoonURL = (value) => /^cartoon:(00[1-9]|0[1-9][0-9]|100)$/.test(value || "") ? "/assets/avatars/" + value.slice(8) + ".svg" : "";
  function cartoonChoices(count = 8, exclude = []) {
    const pool = cartoonAvatars.filter((a) => !exclude.includes(a.id)), random = new Uint32Array(pool.length);
    crypto.getRandomValues(random);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = random[i] % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }
  function cartoonOptions(items, selected) {
    return items.map((a) => '<button type="button" class="cartoon-option ' + (a.id === selected ? "selected" : "") + '" data-cartoon="' + a.id + '" role="radio" aria-checked="' + (a.id === selected) + '" aria-label="' + a.name + '" title="' + a.name + '"><img loading="lazy" src="' + cartoonURL(a.id) + '" alt=""><span>' + a.name + "</span></button>").join("");
  }

  // internal/ui/src/email-auth.js
  function createEmailAuth({ S: S2, action: action2, enter: enter2, QR: QR2, Desktop: Desktop2, windows: windows2, logo: logo2 }) {
    function serverLine() {
      let host = S2.config?.server || "";
      try {
        const u = new URL(host);
        host = u.port && u.port !== "8250" ? u.host : u.hostname;
      } catch {
      }
      const esc4 = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      return '<button type="button" class="auth-server" data-action="connection" title="切换服务器"><span class="auth-server-dot" aria-hidden="true"></span><span>服务器 <b>' + esc4(host || "未设置") + '</b></span><span class="auth-server-switch">切换</span></button>';
    }
    let timer;
    function render(mode = "login", emailValue = "") {
      clearInterval(timer);
      QR2.stop();
      S2.user = null;
      Desktop2.unread();
      const register = mode === "register", reset = mode === "reset", verify = register || reset;
      if (register && !S2.registrationEnabled) return render();
      const choices = register ? cartoonChoices(4) : [];
      document.querySelector("#app").innerHTML = `<main class="auth-shell email-auth ${register ? "registering" : ""}">${windows2()}${authShowcase()}<form class="auth-card" id="auth-form">${logo2()}<h2>${register ? "创建 " + APP_NAME + " 账号" : reset ? "找回密码" : "欢迎回来"}</h2><p class="subtitle">${reset ? "验证邮箱，设置新密码" : register ? "用邮箱，开启新的连接" : "使用邮箱或 " + APP_NAME + " 号登录"}</p>${verify ? "" : serverLine()}${register ? `<div class="register-avatars"><div class="cartoon-heading"><span>选一个喜欢的头像</span><button type="button" id="register-avatar-shuffle">换一批</button></div><input type="hidden" name="avatar" id="register-avatar" value="${choices[0].id}"><div class="cartoon-grid compact" id="register-avatar-options">${cartoonOptions(choices, choices[0].id)}</div></div>` : ""}<div class="auth-fields">${register ? '<input name="name" autocomplete="name" placeholder="姓名（别人能搜索到）" aria-label="姓名" maxlength="32" required>' : ""}${verify ? '<input name="email" type="email" autocomplete="username" inputmode="email" placeholder="邮箱地址" aria-label="邮箱" maxlength="254" required>' : '<input name="email" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="邮箱或 6 位 ' + APP_NAME + ' 号" aria-label="邮箱或 ' + APP_NAME + ' 号" maxlength="254" required>'}${verify ? '<div class="email-code-row"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位验证码" aria-label="验证码" pattern="[0-9]{6}" maxlength="6" required><button type="button" class="secondary" id="send-email-code">获取验证码</button></div>' : ""}<input name="password" type="password" autocomplete="${verify ? "new-password" : "current-password"}" placeholder="${verify ? "设置密码（至少 8 位）" : "密码"}" aria-label="密码" minlength="8" maxlength="72" required>${reset ? '<input name="repeatPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" aria-label="确认密码" minlength="8" maxlength="72" required>' : ""}</div><div class="auth-error" id="auth-error" role="status" aria-live="polite"></div><button type="submit" class="primary">${register ? "注册并登录" : reset ? "重设密码" : "登录"}</button>${!verify && S2.config.platform !== "android" ? '<button type="button" class="qr-login-entry" data-action="qr-login">使用二维码登录</button>' : ""}<div class="auth-links">${verify ? '<button type="button" data-email-mode="login">返回登录</button>' : `${S2.registrationEnabled ? '<button type="button" data-email-mode="register">注册账号</button>' : ""}<button type="button" data-email-mode="reset">忘记密码</button>`}<button type="button" data-action="connection">连接设置</button></div></form><small class="auth-footer">${APP_NAME} ${CLIENT_VERSION} · 让沟通更近一步</small></main>`;
      const form = document.querySelector("#auth-form"), email = form.elements.email, error = form.querySelector("#auth-error");
      email.value = emailValue;
      let challenge = "", challengeEmail = "";
      form.querySelectorAll("[data-email-mode]").forEach((b) => b.onclick = () => render(b.dataset.emailMode, email.value));
      if (register) {
        form.querySelector("#register-avatar-shuffle").onclick = () => {
          const next = cartoonChoices(4);
          form.elements.avatar.value = next[0].id;
          form.querySelector("#register-avatar-options").innerHTML = cartoonOptions(next, next[0].id);
        };
        form.querySelector("#register-avatar-options").onclick = (e) => {
          const b = e.target.closest("[data-cartoon]");
          if (!b) return;
          form.elements.avatar.value = b.dataset.cartoon;
          form.querySelectorAll("[data-cartoon]").forEach((n) => {
            n.classList.toggle("selected", n === b);
            n.setAttribute("aria-checked", String(n === b));
          });
        };
      }
      if (verify) form.querySelector("#send-email-code").onclick = async () => {
        if (!email.reportValidity()) return;
        const button = form.querySelector("#send-email-code");
        button.disabled = true;
        error.textContent = "";
        const address = email.value.trim().toLowerCase();
        try {
          const result = await action2("/api/auth/email/code", { email: address, purpose: mode });
          if (!form.isConnected) return;
          challenge = result.challengeId;
          challengeEmail = address;
          error.textContent = reset ? "如果该邮箱已注册，验证码将发送到邮箱，请查收。" : "验证码已发送，请查收邮箱（含垃圾邮件）。";
          const until = Date.now() + result.retryAfter * 1e3;
          const tick = () => {
            if (!form.isConnected) {
              clearInterval(timer);
              return;
            }
            const left = Math.max(0, Math.ceil((until - Date.now()) / 1e3));
            button.textContent = left ? `${left} 秒后重发` : "重新发送";
            button.disabled = left > 0;
            if (!left) clearInterval(timer);
          };
          tick();
          timer = setInterval(tick, 500);
        } catch (e) {
          if (form.isConnected) {
            error.textContent = e.message;
            button.disabled = false;
          }
        }
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector("[type=submit]");
        if (button.disabled) return;
        const p = [...new FormData(form)].reduce((value, [key, item]) => (value[key] = item, value), {});
        p.email = p.email.trim().toLowerCase();
        if (verify && (!challenge || p.email !== challengeEmail)) {
          error.textContent = "请先为当前邮箱获取验证码";
          return;
        }
        if (reset && p.password !== p.repeatPassword) {
          error.textContent = "两次输入的密码不一致";
          return;
        }
        delete p.repeatPassword;
        if (verify) p.challengeId = challenge;
        button.disabled = true;
        error.textContent = "";
        try {
          const result = await action2(reset ? "/api/auth/email/reset" : "/api/auth/" + mode, p);
          if (!form.isConnected) return;
          if (reset) {
            render("login", p.email);
            document.querySelector("#auth-error").textContent = "密码已重设，请使用新密码登录";
            return;
          }
          S2.token = result.token;
          localStorage.setItem("welink_token", S2.token);
          S2.user = result.user;
          clearInterval(timer);
          await enter2();
        } catch (e2) {
          if (form.isConnected) {
            error.textContent = e2.message;
            button.disabled = false;
          }
        }
      };
    }
    return { render };
  }

  // internal/appearance/atmosphere.js
  (() => {
    const root = document.documentElement;
    const pause = () => root.classList.add("snow-paused");
    const sync = () => root.classList.toggle("snow-paused", document.hidden || !document.hasFocus());
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", sync);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", sync);
    sync();
  })();

  // internal/ui/src/native-notifications.js
  function createNativeNotifications({ S: S2, action: action2, selectConversation: selectConversation2, refresh: refresh2, toast: toast2 }) {
    const supported = typeof window.welinkMessageNotifications === "function" || !!window.WeLinkAndroid?.messageNotifications;
    let active = false, draining = null;
    async function open2() {
      if (!S2.user) return;
      let raw = "";
      try {
        raw = window.WeLinkAndroid?.takeMessageNotification ? window.WeLinkAndroid.takeMessageNotification() : await window.welinkTakeMessageNotification?.();
        const n = raw ? JSON.parse(raw) : null;
        if (!n || n.userId !== S2.user.id || !/^[a-f0-9]{32}$/.test(n.conversationId)) return;
        await refresh2();
        await selectConversation2(n.conversationId);
      } catch {
        toast2("该聊天暂时无法打开，请在消息列表中查看");
      }
    }
    function drainInvites() {
      if (!S2.user) return Promise.resolve();
      if (draining) return draining;
      draining = (async () => {
        try {
          let raw, takeEvent = window.WeLinkAndroid?.takeNativeInviteEvent, takeAction = window.WeLinkAndroid?.takeNativeInviteAction || window.welinkTakeNativeInviteAction;
          if (takeEvent) while (raw = await takeEvent.call(window.WeLinkAndroid)) window.dispatchEvent(new CustomEvent("welink-native-invite-event", { detail: JSON.parse(raw) }));
          if (takeAction) while (raw = await takeAction.call(window.WeLinkAndroid || window)) window.dispatchEvent(new CustomEvent("welink-native-invite-action", { detail: JSON.parse(raw) }));
        } catch {
        } finally {
          draining = null;
        }
      })();
      return draining;
    }
    async function start() {
      if (!supported) return;
      await action2("/local/notifications", { token: S2.token });
      window.WeLinkAndroid?.messageNotifications(true);
      active = true;
      await open2();
    }
    async function stop() {
      if (!supported) return;
      active = false;
      window.WeLinkAndroid?.messageNotifications(false);
      await action2("/local/notifications", { token: "" });
    }
    window.addEventListener("welink-open-message", open2);
    window.addEventListener("welink-native-invite", drainInvites);
    window.addEventListener("welink-native-invite-action", (event) => {
      if (!event.detail) drainInvites();
    });
    window.addEventListener("focus", () => {
      if (active) {
        open2();
        drainInvites();
      } else if (S2.user) start().catch(() => {
      });
    });
    return { start, stop, drainInvites, active: () => active };
  }

  // internal/ui/src/meeting-window.js
  var owner = null;
  function meetingWindow({ active, changed, toast: toast2, nativeFullscreen }) {
    let nativeFull = false, busy = false, entry = null, leaving = null, native;
    const controller = { exit }, full = () => owner === controller && (nativeFull || !!document.fullscreenElement);
    async function exit() {
      if (leaving) return leaving;
      leaving = (async () => {
        if (entry) try {
          await entry;
        } catch {
        }
        if (owner !== controller) return;
        if (nativeFull) {
          await native(false);
          nativeFull = false;
        }
        if (document.fullscreenElement) await document.exitFullscreen();
        if (owner === controller) owner = null;
        changed(false);
      })();
      try {
        await leaving;
      } finally {
        leaving = null;
      }
    }
    async function toggle() {
      if (busy || !active()) return;
      busy = true;
      try {
        if (full()) {
          await exit();
          return;
        }
        if (owner && owner !== controller) await owner.exit();
        if (!active()) return;
        owner = controller;
        native = nativeFullscreen || window.welinkMeetingFullscreen;
        entry = (async () => {
          if (native) {
            await native(true);
            nativeFull = true;
          } else await document.documentElement.requestFullscreen();
        })();
        try {
          await entry;
        } finally {
          entry = null;
        }
        changed(full());
        if (!active()) await exit();
      } catch {
        if (owner === controller && !nativeFull && !document.fullscreenElement) owner = null;
        changed(full());
        toast2("无法切换全屏，请重试");
      } finally {
        busy = false;
      }
    }
    document.addEventListener("fullscreenchange", () => {
      if (owner !== controller) return;
      if (!nativeFull && !entry && !document.fullscreenElement) owner = null;
      changed(full());
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && full() && active()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exit().catch(() => toast2("退出全屏失败，请重试"));
      }
    }, true);
    return { toggle, exit, full };
  }

  // internal/ui/src/remote-window.js
  function createRemoteWindow({ active, action: action2, toast: toast2 }) {
    const display2 = meetingWindow({ active, toast: toast2, nativeFullscreen: window.WeLinkAndroid?.setRemoteFullscreen ? (enabled) => window.WeLinkAndroid.setRemoteFullscreen(enabled) : void 0, changed: (full) => {
      const b = document.querySelector("[data-action=remote-fullscreen]");
      if (b) {
        b.textContent = full ? "退出全屏" : "全屏";
        b.setAttribute("aria-pressed", String(full));
        b.title = full ? "退出全屏（Esc）" : "全屏";
      }
      document.querySelector(".remote-screen")?.classList.toggle("remote-fullscreen", full);
      action2("/local/remote/release").catch(() => {
      });
    } });
    window.WeLinkRemoteFullscreenExited = () => display2.exit().catch(() => {
    });
    return { ...display2, async minimize() {
      await display2.exit();
      if (active()) await action2("/local/window/min");
    }, back() {
      if (!display2.full()) return false;
      display2.exit().catch(() => {
      });
      return true;
    } };
  }

  // internal/ui/src/long-press.js
  function bindLongPress(selector, onHold, { delay = 500, distance = 10 } = {}) {
    let timer, start, held = false, ghostUntil = 0, target = null, started = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    const key = (node) => node?.dataset.message || node?.dataset.conversation || node?.dataset.profile;
    const fire = () => {
      const node = document.elementFromPoint(start.x, start.y)?.closest(selector);
      if (node && key(node) === key(target)) {
        held = true;
        onHold(node, start.x, start.y);
      }
    };
    document.addEventListener("touchstart", (event) => {
      cancel();
      ghostUntil = 0;
      held = false;
      start = null;
      target = null;
      const node = event.target.closest(selector);
      if (!node || event.touches.length !== 1) return;
      const p = event.touches[0];
      start = { x: p.clientX, y: p.clientY };
      target = node;
      started = Date.now();
      timer = setTimeout(fire, delay);
    }, { passive: true });
    document.addEventListener("touchmove", (event) => {
      const p = event.touches[0];
      if (!p || !start || Math.hypot(p.clientX - start.x, p.clientY - start.y) > distance) cancel();
    }, { passive: true });
    document.addEventListener("touchend", () => {
      if (timer && !held && Date.now() - started >= delay) fire();
      cancel();
      if (held) ghostUntil = Date.now() + 900;
      held = false;
    }, { passive: true });
    document.addEventListener("touchcancel", () => {
      cancel();
      held = false;
      ghostUntil = 0;
    }, { passive: true });
    document.addEventListener("click", (event) => {
      if ((held || Date.now() < ghostUntil) && event.detail !== 0 && event.sourceCapabilities?.firesTouchEvents !== false) {
        cancel();
        held = false;
        ghostUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  // internal/ui/src/directory-search.js
  function createDirectorySearch({ S: S2, api: api2, esc: esc4, av: av2, icon: icon2, renderSidebar: renderSidebar2, contextMenu: contextMenu2 }) {
    let key = "", version = 0, timer, data = null, loading = false, error = "";
    const matches = (u, q) => (u.name + " " + (u.remark || "") + " " + u.number).toLowerCase().includes(q.toLowerCase());
    const group = (g) => g.group ? { id: g.id, name: g.name, ...g.group, joined: true } : g;
    const unique = (items) => [...new Map(items.map((u) => [u.id, u])).values()];
    function render(query) {
      const q = query.trim(), next = S2.token + "\n" + q;
      const users = unique([S2.user, ...S2.friends].filter((u) => u && matches(u, q))), groups = unique([...S2.myGroups || [], ...S2.conversations.filter((c) => c.kind === "group").map(group)].filter((g) => matches(g, q)));
      if (next !== key) {
        key = next;
        data = null;
        loading = true;
        error = "";
        clearTimeout(timer);
        const v = ++version;
        timer = setTimeout(async () => {
          try {
            const [people, rooms] = await Promise.all([api2("/api/users?q=" + encodeURIComponent(q)), api2("/api/groups?q=" + encodeURIComponent(q))]);
            if (v !== version || key !== next) return;
            data = { users: people, groups: rooms };
          } catch (e) {
            if (v !== version) return;
            error = e.message;
          } finally {
            if (v === version) {
              loading = false;
              if (S2.search.trim() === q) renderSidebar2();
            }
          }
        }, 180);
      }
      const foundUsers = unique([...users, ...data?.users || []]), foundGroups = unique([...groups, ...data?.groups || []]);
      return '<div class="directory-results">' + (foundUsers.length ? '<div class="search-section-label">用户</div>' + foundUsers.map((u) => `<div class="user-search-result" data-search-user="${u.id}"><button class="conversation-row" ${u.id === S2.user.id ? "data-profile" : "data-start-chat"}="${u.id}">${av2(u, "", true)}<div class="row-text"><div class="row-title"><b>${esc4(u.remark || u.name)}${u.id === S2.user.id ? "（我）" : ""}</b></div><div class="row-preview">${esc4(u.number)}</div></div></button>${u.id !== S2.user.id ? '<div class="user-search-actions"><button data-user-call="' + u.id + '" data-user-call-mode="audio" title="语音通话">' + icon2("phone") + '</button><button data-user-call="' + u.id + '" data-user-call-mode="video" title="视频通话">' + icon2("video") + "</button></div>" : ""}</div>`).join("") : "") + (foundGroups.length ? '<div class="search-section-label">群聊</div>' + foundGroups.map((g) => `<button class="conversation-row directory-group" data-group-join="${g.id}" data-joined="${g.joined === true}" data-mode="${esc4(g.joinMode)}" data-name="${esc4(g.name)}" ${!g.joined && g.joinMode === "closed" ? "disabled" : ""}>${av2({ kind: "group", avatar: g.avatar })}<div class="row-text"><div class="row-title"><b>${esc4(g.name)}</b></div><div class="row-preview">${esc4(g.number)} · ${g.count || 0} 人 · ${g.joined ? "发消息" : g.joinMode === "closed" ? "暂不开放" : g.joinMode === "approval" ? "申请加入" : "加入群聊"}</div></div></button>`).join("") : "") + (loading ? '<div class="directory-status">正在搜索…</div>' : error ? '<div class="directory-status" role="status">' + esc4(error) + "</div>" : !foundUsers.length && !foundGroups.length ? '<div class="empty-list">没有找到用户或群聊</div>' : "") + "</div>";
    }
    function userMenu(id, x, y) {
      if (id === S2.user?.id) return;
      contextMenu2(x, y, '<button data-start-chat="' + id + '">发消息</button><button data-create-group-user="' + id + '">创建群聊</button>');
    }
    document.addEventListener("contextmenu", (e) => {
      const row = e.target.closest("[data-search-user]");
      if (row) {
        e.preventDefault();
        userMenu(row.dataset.searchUser, e.clientX, e.clientY);
      }
    });
    bindLongPress("[data-search-user]", (row, x, y) => userMenu(row.dataset.searchUser, x, y));
    return { render, changed() {
      key = "";
      version++;
      clearTimeout(timer);
    }, reset() {
      key = "";
      version++;
      clearTimeout(timer);
      data = null;
    } };
  }

  // internal/ui/src/theme.js
  function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    document.documentElement.style.backgroundColor = dark ? "#22252b" : "#f5f4f9";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.querySelector("meta[name=theme-color]")?.setAttribute("content", dark ? "#22252b" : "#0099ff");
    window.WeLinkAndroid?.setDarkTheme?.(dark);
    window.welinkTheme?.(dark).catch(() => {
    });
  }

  // internal/ui/src/unread-mark.js
  var ICON = "/assets/icon.svg";
  var UNREAD_ICON = "/assets/icon-unread.svg";
  var iconShown = null;
  function markUnread(count) {
    count = Math.max(0, Number(count) || 0);
    const custom = customBrandIcon(), href = custom || (count ? UNREAD_ICON : ICON), link = document.querySelector("link[rel~=icon]");
    if (link && iconShown !== href) {
      link.href = href;
      iconShown = href;
    }
    const base = document.title.replace(/^\(\d+\+?\)\s*/, ""), title = count ? `(${count > 99 ? "99+" : count}) ${base}` : base;
    if (document.title !== title) document.title = title;
  }

  // internal/ui/src/message-sounds.js
  function createMessageSounds({ toast: toast2, native, hidden }) {
    const key = "welink_message_sound";
    let enabled = localStorage.getItem(key) !== "false", context = null, last = 0;
    const ready = window.WeLinkAndroid?.getMessageSound ? Promise.resolve().then(() => {
      enabled = window.WeLinkAndroid.getMessageSound();
      localStorage.setItem(key, String(enabled));
    }) : native ? window.welinkDesktopSettings().then((p) => {
      enabled = p.messageSound !== false;
      localStorage.setItem(key, String(enabled));
    }).catch(() => {
    }) : Promise.resolve();
    function unlock() {
      if (!enabled) return;
      try {
        if (!context || context.state === "closed") {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (Audio) context = new Audio();
        }
        context?.resume().catch(() => {
        });
      } catch {
      }
    }
    async function set(value) {
      window.WeLinkAndroid?.setMessageSound?.(value);
      if (native) {
        const p = await window.welinkDesktopSettings();
        await window.welinkDesktopSave({ ...p, messageSound: value });
      }
      enabled = value;
      localStorage.setItem(key, String(value));
      if (!value) {
        context?.close().catch(() => {
        });
        context = null;
      } else unlock();
    }
    function notify() {
      if (!enabled || native && hidden() || Date.now() - last < 1500) return;
      last = Date.now();
      unlock();
      if (!context) return;
      try {
        [{ frequency: 1046.5, delay: 0, length: 0.13 }, { frequency: 880, delay: 0.19, length: 0.16 }].forEach((pulse) => {
          const oscillator = context.createOscillator(), gain = context.createGain(), at = context.currentTime + pulse.delay, end = at + pulse.length;
          oscillator.type = "sine";
          oscillator.frequency.value = pulse.frequency;
          gain.gain.setValueAtTime(1e-4, at);
          gain.gain.exponentialRampToValueAtTime(0.045, at + 8e-3);
          gain.gain.exponentialRampToValueAtTime(1e-3, end);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(at);
          oscillator.stop(end);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
          };
        });
      } catch {
      }
    }
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("change", async (e) => {
      if (e.target.id !== "pref-message-sound") return;
      const input = e.target, value = input.checked;
      input.disabled = true;
      try {
        await set(value);
        toast2(value ? "已开启消息提示音" : "已关闭消息提示音");
      } catch (error) {
        input.checked = enabled;
        toast2(String(error));
      } finally {
        input.disabled = false;
      }
    });
    window.addEventListener("storage", (e) => {
      if (e.key === key) enabled = e.newValue !== "false";
    });
    return { ready, notify, enabled: () => enabled, row: () => '<label class="prefs-row" for="pref-message-sound"><span>消息提示音</span><input type="checkbox" id="pref-message-sound" ' + (enabled ? "checked" : "") + '></label><p class="hint">立即生效，保存在本设备；关闭声音仍保留通知和未读标记。</p>', reset() {
      context?.close().catch(() => {
      });
      context = null;
      last = 0;
    } };
  }

  // internal/ui/src/navigation.js
  function createNavigation({ getHandler, setHandler, beforeOpen, esc: esc4, icon: icon2, onPageBack, beforeBack }) {
    const stack = [];
    const host = () => document.getElementById("overlays");
    const dialog = () => host().querySelector(".modal");
    const focus = (node) => {
      if (node?.isConnected) node.focus({ preventScroll: true });
    };
    function clear() {
      stack.length = 0;
      host().innerHTML = "";
      setHandler(null);
    }
    function open2(title, body, footer = "", wide = false) {
      beforeOpen();
      const current = dialog(), previousFocus = document.activeElement;
      const transient = /截图|录音|视频预览|语音消息|远程协助|邀请|来电|登录 Windows/.test(title) || current?.querySelector("canvas,video,audio,.qr-confirm,.remote-invite");
      if (transient) stack.length = 0;
      else if (current) {
        const previous = stack.findIndex((item) => item.title === title);
        if (previous >= 0) stack.splice(previous);
        else if (current.getAttribute("aria-label") !== title) {
          stack.push({ title: current.getAttribute("aria-label"), node: host().firstElementChild, handler: getHandler(), focus: previousFocus, scroll: current.querySelector(".modal-body")?.scrollTop || 0 });
          if (stack.length > 12) stack.shift();
        }
      } else stack.length = 0;
      host().innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc4(title)}"><header class="modal-head"><button type="button" class="dialog-back" data-action="modal-back" aria-label="返回${stack.length ? "上一页" : ""}" title="${stack.length ? "返回上一页" : "返回"}">${icon2("back")}<span>返回</span></button><h3>${esc4(title)}</h3><button type="button" class="icon-btn" data-action="close-modal" aria-label="关闭" title="关闭">${icon2("close")}</button></header><div class="modal-body">${body}<div class="form-error" id="modal-error" role="alert"></div></div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}</section></div>`;
      setHandler(null);
      if (!matchMedia("(max-width:700px)").matches) {
        const opened = dialog();
        setTimeout(() => {
          if (opened?.isConnected && !opened.contains(document.activeElement)) focus(opened.querySelector("input:not([type=checkbox]):not([type=file]):not([type=range])") || opened.querySelector(".dialog-back"));
        }, 40);
      }
    }
    function back() {
      if (!host().firstElementChild) return false;
      if (beforeBack?.()) return true;
      const cancelAvatar = dialog()?.querySelector("[data-avatar=cancel]");
      if (cancelAvatar) {
        cancelAvatar.click();
        return true;
      }
      beforeOpen();
      const prior = stack.pop();
      if (prior) {
        host().innerHTML = "";
        host().appendChild(prior.node);
        setHandler(prior.handler);
        const body = dialog()?.querySelector(".modal-body");
        if (body) body.scrollTop = prior.scroll;
        focus(prior.focus);
      } else clear();
      return true;
    }
    function handleBack() {
      const menu = document.querySelector(".context-menu,.popup");
      if (menu) {
        menu.remove();
        return true;
      }
      if (back()) return true;
      if (document.querySelector(".qr-auth")) {
        document.querySelector("[data-action=login]")?.click();
        return true;
      }
      return onPageBack();
    }
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || !dialog()) return;
      const controls = [...dialog().querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter((node) => !node.disabled && node.getClientRects().length), first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        focus(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focus(first);
      }
    });
    window.WeLinkGoBack = handleBack;
    function complete() {
      if (stack.some((item) => item.title === "设置")) back();
      else clear();
    }
    return { open: open2, clear, back, handleBack, complete };
  }

  // internal/ui/src/conversation-actions.js
  function createConversationActions({ S: S2, api: api2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc4, icon: icon2, contextMenu: contextMenu2, refresh: refresh2 }) {
    const find = (id) => S2.conversations.find((c) => c.id === id);
    function menu(id, x, y) {
      const c = find(id);
      if (!c) return;
      contextMenu2(x, y, `${c.kind === "direct" ? '<button data-create-group-user="' + c.peer.id + '">创建群聊</button>' : ""}<button data-conversation-action="pin" data-cid="${id}">${icon2("pin")}${c.pinned ? "取消置顶" : "置顶聊天"}</button><button data-conversation-action="mute" data-cid="${id}">${icon2("mute")}${c.muted ? "开启消息提醒" : "消息免打扰"}</button>${c.unread ? `<button data-conversation-action="read" data-cid="${id}">${icon2("check")}标为已读</button>` : ""}<button class="destructive" data-conversation-action="remove" data-cid="${id}">${icon2("trash")}从消息列表移除</button>`);
    }
    const removing = /* @__PURE__ */ new Set();
    async function remove(id) {
      if (!find(id) || removing.has(id)) return;
      removing.add(id);
      try {
        await api2("/api/conversations/" + id, { method: "DELETE" });
        closeModal2();
        await refresh2();
      } catch (error) {
        toast2(error.message);
      } finally {
        removing.delete(id);
      }
    }
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-conversation-menu],[data-conversation-action]");
      if (!button || !S2.user) return;
      if (button.dataset.conversationMenu) {
        const r = button.getBoundingClientRect();
        menu(button.dataset.conversationMenu, r.right - 180, r.bottom);
        return;
      }
      const id = button.dataset.cid, c = find(id);
      if (!c) return;
      try {
        const action2 = button.dataset.conversationAction;
        if (action2 === "remove") {
          remove(id);
          return;
        }
        button.disabled = true;
        if (action2 === "read") await api2("/api/conversations/" + id + "/read", { method: "POST", body: {} });
        else await api2("/api/conversations/" + id, { method: "PATCH", body: action2 === "pin" ? { pinned: !c.pinned } : { muted: !c.muted } });
        await refresh2();
      } catch (error) {
        toast2(error.message);
      } finally {
        button.disabled = false;
      }
    });
    document.addEventListener("contextmenu", (event) => {
      const row = event.target.closest("[data-conversation]");
      if (row) {
        event.preventDefault();
        menu(row.dataset.conversation, event.clientX, event.clientY);
      }
    });
    bindLongPress("[data-conversation]", (row, x, y) => menu(row.dataset.conversation, x, y));
    return { menu, remove };
  }

  // internal/ui/src/cloud.js
  function createCloud({ S: S2, api: api2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc4, icon: icon2, bytes: bytes2, fullTime: fullTime2, upload: upload2 }) {
    const $2 = (s) => document.querySelector(s);
    let drive = [], folders = [], path = [], folderID = "", offset = 0, driveQuery = "", searchDraft = "", driveGeneration = 0, uploading = false;
    const owns = (token) => S2.user && S2.token === token && !S2.signingOut;
    const request = api2;
    api2 = async (...args) => {
      const token = S2.token;
      const result = await request(...args);
      if (!owns(token)) throw Object.assign(Error("操作已结束"), { name: "AbortError" });
      return result;
    };
    async function copy(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.append(input);
        input.select();
        const ok = document.execCommand("copy");
        input.remove();
        if (!ok) throw Error("复制失败，请手动选择文本复制");
      }
      toast2("已复制");
    }
    function fail(error) {
      if (error.name === "AbortError") return;
      const target = $2("#modal-error");
      if (target) target.textContent = error.message;
      else toast2(error.message);
    }
    function bind(id, fn) {
      const button = $2("#" + id);
      if (button) button.onclick = async () => {
        button.disabled = true;
        try {
          await fn();
        } catch (error) {
          fail(error);
        } finally {
          button.disabled = false;
        }
      };
    }
    const crumbs = (items, attr) => `<button ${attr}="">全部文件</button>` + items.map((f) => `<span> / </span><button ${attr}="${f.id}">${esc4(f.name)}</button>`).join("");
    function enter2(id) {
      if ($2(".cloud-page")) $2(".cloud-page").scrollTop = 0;
      folderID = id;
      driveQuery = "";
      searchDraft = "";
      renderDrive().catch(fail);
    }
    async function renderDrive(reset = true) {
      const token = S2.token, g = ++driveGeneration;
      let result;
      if (reset) offset = 0;
      try {
        result = await api2("/api/drive?folder=" + encodeURIComponent(folderID) + "&q=" + encodeURIComponent(driveQuery) + "&offset=" + offset);
      } catch (error) {
        if (g !== driveGeneration || S2.tab !== "drive") return;
        if (error.status === 404 && folderID) {
          toast2("文件夹已删除，已返回全部文件");
          enter2("");
          return;
        }
        throw error;
      }
      if (!owns(token) || g !== driveGeneration || S2.tab !== "drive") return;
      drive = reset ? result.files : [...drive, ...result.files];
      folders = result.folders || [];
      path = result.path || [];
      const prior = $2("#drive-search"), focused = document.activeElement === prior, selection = focused ? [prior.selectionStart, prior.selectionEnd] : null, scroll = $2(".cloud-page")?.scrollTop || 0;
      $2("#main-content").innerHTML = `<section class="cloud-page"><header class="cloud-heading"><div><h2>我的网盘</h2><p>文件随账号保存，随时取用和分享</p></div><div class="drive-heading-actions"><button class="secondary" id="drive-new-folder">${icon2("folder")}新建文件夹</button><button class="primary" id="drive-upload" ${uploading ? "disabled" : ""}>${icon2("plus")}${uploading ? "上传中…" : "上传文件"}</button></div><input type="file" multiple id="drive-file-input" hidden></header><div class="drive-capacity"><div><b>免费 ${bytes2(result.quota)} 空间</b><span>${bytes2(result.used)} / ${bytes2(result.quota)}</span></div><progress value="${result.used}" max="${result.quota}"></progress><small>聊天附件不占用这份容量</small></div><div id="drive-upload-status" class="cloud-upload-status"></div><nav class="drive-breadcrumb" aria-label="网盘路径">${crumbs(path, "data-drive-folder")}</nav><label class="cloud-search">${icon2("search")}<input id="drive-search" placeholder="搜索当前文件夹" value="${esc4(searchDraft)}"><button id="drive-search-submit" aria-label="搜索当前文件夹">搜索</button>${driveQuery ? '<button id="drive-search-clear" aria-label="清除网盘搜索">' + icon2("close") + "</button>" : ""}</label><div class="cloud-file-list">${folders.map((f) => `<article class="cloud-file cloud-folder"><button class="drive-folder-open" data-drive-folder="${f.id}">${icon2("folder")}<span><b>${esc4(f.name)}</b><small>文件夹</small></span></button><div class="cloud-file-actions"><button data-folder-action="rename" data-id="${f.id}">重命名</button><button data-folder-action="delete" data-id="${f.id}" aria-label="删除文件夹">${icon2("trash")}</button></div></article>`).join("")}${drive.map((f) => `<article class="cloud-file"><span class="cloud-file-icon">${icon2("file")}</span><div class="cloud-file-name"><b>${esc4(f.name)}</b><small>${bytes2(f.size)} · ${fullTime2(f.updated)}</small></div><div class="cloud-file-actions"><button data-drive="download" data-id="${f.id}" title="下载" aria-label="下载">${icon2("download")}</button><button data-drive="share" data-id="${f.id}" title="分享" aria-label="分享">${icon2("copy")}</button><button data-drive="move" data-id="${f.id}">移动</button><button data-drive="rename" title="重命名" data-id="${f.id}">重命名</button><button data-drive="delete" data-id="${f.id}" title="删除" aria-label="删除">${icon2("trash")}</button></div></article>`).join("")}${!drive.length && !folders.length ? '<div class="cloud-empty">' + icon2("folder") + "<h3>" + (driveQuery ? "没有匹配的文件或文件夹" : "这个文件夹还是空的") + "</h3><p>" + (driveQuery ? "换个关键词试试，或清除搜索" : "新建文件夹，或上传、拖入文件") + "</p></div>" : ""}</div>${result.hasMore ? '<button id="drive-more" class="secondary cloud-more">加载更多</button>' : ""}</section>`;
      bind("drive-new-folder", () => editName());
      bind("drive-upload", () => $2("#drive-file-input").click());
      $2("#drive-file-input").onchange = (e) => {
        sendFiles([...e.target.files]);
        e.target.value = "";
      };
      $2("#drive-search").oninput = (e) => {
        searchDraft = e.target.value;
      };
      const search = () => {
        driveQuery = searchDraft.trim();
        searchDraft = driveQuery;
        return renderDrive();
      };
      $2("#drive-search").onkeydown = (e) => {
        if (e.key === "Enter") search().catch(fail);
      };
      bind("drive-search-submit", search);
      bind("drive-search-clear", () => {
        driveQuery = "";
        searchDraft = "";
        return renderDrive();
      });
      bind("drive-more", () => {
        offset = drive.length;
        return renderDrive(false);
      });
      $2(".cloud-page").scrollTop = scroll;
      if (focused) {
        $2("#drive-search").focus({ preventScroll: true });
        $2("#drive-search").setSelectionRange(...selection);
      }
    }
    async function sendFiles(files) {
      if (!files.length) return;
      if (uploading) {
        toast2("正在上传，请稍后再添加文件");
        return;
      }
      const token = S2.token, targetFolder = folderID;
      uploading = true;
      $2("#drive-upload")?.setAttribute("disabled", "");
      try {
        for (const file of files) {
          if (!owns(token)) return;
          const display2 = (percent) => {
            const target = S2.tab === "drive" && folderID === targetFolder ? $2("#drive-upload-status") : null;
            if (target) target.textContent = file.name + " · " + (percent === 100 ? "正在保存" : percent === null ? "正在上传" : "已上传 " + percent + "%");
          };
          await upload2("/api/drive/files?folder=" + encodeURIComponent(targetFolder), file, {}, display2);
        }
        if (owns(token)) toast2("上传完成");
      } catch (error) {
        fail(error);
      } finally {
        uploading = false;
        if (owns(token) && S2.tab === "drive") await renderDrive().catch(fail);
      }
    }
    function downloadDrive(f) {
      if (window.WeLinkAndroid?.downloadDriveFile) {
        window.WeLinkAndroid.downloadDriveFile(f.id, f.name);
        return;
      }
      const a = document.createElement("a");
      a.href = "/api/drive/files/" + f.id;
      a.download = f.name;
      document.body.append(a);
      a.click();
      a.remove();
    }
    function share(f) {
      modal2("分享文件", `<p class="hint">${esc4(f.name)}</p><p><b>永久有效</b></p><p class="hint">拿到链接的人可以下载这个文件。重复获取会使用同一链接；主动取消分享、删除文件或账号后失效。</p><div id="drive-share-result"></div>`, '<button class="secondary" id="drive-revoke">取消已有分享</button><button class="primary" id="drive-create-share">获取分享链接</button>');
      const host = $2("#drive-share-result");
      bind("drive-create-share", async () => {
        const result = await api2("/api/drive/files/" + f.id + "/share", { method: "POST", body: {} });
        if (!host.isConnected) return;
        host.innerHTML = '<textarea id="drive-share-url" readonly>' + esc4(result.url) + '</textarea><button class="secondary" id="drive-copy-share">复制分享链接</button>';
        bind("drive-copy-share", () => copy(result.url));
      });
      bind("drive-revoke", async () => {
        await api2("/api/drive/files/" + f.id + "/share", { method: "DELETE" });
        if (host.isConnected) closeModal2();
        toast2("分享链接已失效");
      });
    }
    function editName(f, isFolder = true) {
      const creating = !f, parentID = folderID;
      modal2(creating ? "新建文件夹" : isFolder ? "重命名文件夹" : "重命名文件", '<label>名称</label><input id="drive-rename" maxlength="240" value="' + esc4(f?.name || "") + '" placeholder="' + (isFolder ? "文件夹名称" : "文件名") + '">', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="drive-save-name">' + (creating ? "创建" : "保存") + "</button>");
      const input = $2("#drive-rename");
      bind("drive-save-name", async () => {
        const name = input.value.trim();
        if (!name) throw Error("请输入名称");
        await api2(creating ? "/api/drive/folders" : "/api/drive/" + (isFolder ? "folders/" : "files/") + f.id, { method: creating ? "POST" : "PATCH", body: creating ? { name, parentId: parentID } : { name } });
        if (input.isConnected) closeModal2();
        await renderDrive();
      });
      input.onkeydown = (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          $2("#drive-save-name")?.click();
        }
      };
    }
    async function move(f) {
      modal2("移动文件", '<p class="hint">选择目标文件夹：' + esc4(f.name) + '</p><div id="drive-move-folders"></div>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="drive-move-confirm" disabled>移动到这里</button>');
      const host = $2("#drive-move-folders"), confirm = $2("#drive-move-confirm");
      let target = f.folderId || "", generation = 0;
      async function load(id) {
        const g = ++generation;
        confirm.disabled = true;
        try {
          const result = await api2("/api/drive?folder=" + encodeURIComponent(id));
          if (!host.isConnected || g !== generation) return;
          target = id;
          host.innerHTML = '<nav class="drive-breadcrumb">' + crumbs(result.path || [], "data-move-folder") + '</nav><div class="drive-picker-list">' + (result.folders || []).map((item) => '<button data-move-folder="' + item.id + '">' + icon2("folder") + "<span>" + esc4(item.name) + "</span>" + icon2("chevron") + "</button>").join("") + "</div>";
          confirm.disabled = target === (f.folderId || "");
        } catch (error) {
          if (host.isConnected && g === generation) fail(error);
        }
      }
      host.onclick = (e) => {
        const button = e.target.closest("[data-move-folder]");
        if (button) load(button.dataset.moveFolder);
      };
      bind("drive-move-confirm", async () => {
        await api2("/api/drive/files/" + f.id + "/move", { method: "POST", body: { folderId: target } });
        if (host.isConnected) closeModal2();
        toast2("已移动");
        await renderDrive();
      });
      await load(target);
    }
    document.addEventListener("click", async (event) => {
      if (!S2.user || S2.tab !== "drive") return;
      const open2 = event.target.closest("[data-drive-folder]");
      if (open2) {
        enter2(open2.dataset.driveFolder);
        return;
      }
      const button = event.target.closest("[data-drive],[data-folder-action]");
      if (!button) return;
      try {
        const isFolder = !!button.dataset.folderAction, f = (isFolder ? folders : drive).find((f2) => f2.id === button.dataset.id);
        if (!f) return;
        switch (button.dataset.drive || button.dataset.folderAction) {
          case "download":
            downloadDrive(f);
            break;
          case "share":
            share(f);
            break;
          case "move":
            await move(f);
            break;
          case "rename":
            editName(f, isFolder);
            break;
          case "delete":
            modal2(isFolder ? "删除文件夹" : "删除网盘文件", "<p>确定删除「" + esc4(f.name) + "」？" + (isFolder ? "其子文件夹和文件也会一并删除。" : "") + "相关分享链接将失效，此操作无法撤销。</p>", '<button class="secondary" data-action="close-modal">取消</button><button class="primary danger" id="drive-confirm-delete">删除</button>');
            bind("drive-confirm-delete", async () => {
              await api2("/api/drive/" + (isFolder ? "folders/" : "files/") + f.id, { method: "DELETE", ...isFolder ? { body: { confirmName: f.name } } : {} });
              closeModal2();
              await renderDrive();
            });
            break;
        }
      } catch (error) {
        fail(error);
      }
    });
    return { renderDrive, sendFiles, back() {
      if (!folderID) return false;
      enter2(path.length > 1 ? path[path.length - 2].id : "");
      return true;
    }, reset() {
      driveGeneration++;
      drive = [];
      folders = [];
      path = [];
      folderID = "";
      driveQuery = "";
      searchDraft = "";
    }, changed(type) {
      if (type === "drive" && S2.tab === "drive" && !uploading) renderDrive().catch(fail);
    } };
  }

  // internal/ui/src/transfers.js
  function createTransfers({ S: S2, api: api2, esc: esc4, av: av2, bytes: bytes2, randomID: randomID2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, toast: toast2 }) {
    let generation = 0, entries = [];
    const requests = /* @__PURE__ */ new Set();
    const active = (owner2, g) => S2.user && S2.token === owner2 && generation === g && !S2.signingOut;
    function stop() {
      generation++;
      for (const xhr of requests) xhr.abort();
      requests.clear();
      entries = [];
    }
    function upload2(path, file, fields = {}, onProgress = () => {
    }) {
      const owner2 = S2.token, g = generation;
      if (!S2.user) return Promise.reject(Error("请先登录"));
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(), form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
        form.append("file", file, file.name);
        requests.add(xhr);
        const finish = (error, result) => {
          requests.delete(xhr);
          if (error) reject(error);
          else if (!active(owner2, g)) reject(Object.assign(Error("账号已切换"), { name: "AbortError" }));
          else resolve(result);
        };
        xhr.open("POST", path);
        xhr.setRequestHeader("Authorization", "Bearer " + owner2);
        xhr.upload.onprogress = (e) => {
          if (active(owner2, g)) onProgress(e.lengthComputable ? Math.min(99, Math.floor(e.loaded / e.total * 100)) : null);
        };
        xhr.onload = () => {
          let result;
          try {
            result = JSON.parse(xhr.responseText);
          } catch {
            return finish(Error("上传响应无效"));
          }
          if (xhr.status < 200 || xhr.status >= 300) return finish(Object.assign(Error(result.error || "上传失败"), { status: xhr.status }));
          onProgress(100);
          finish(null, result);
        };
        xhr.onerror = () => finish(Error("上传连接中断，请重新选择文件重试"));
        xhr.onabort = () => finish(Object.assign(Error("上传已取消"), { name: "AbortError" }));
        xhr.send(form);
      });
    }
    async function chat(cid, body, file, metadata2 = {}) {
      const owner2 = S2.token, g = generation, id = randomID2(), entry = { id, cid, name: file.name, size: file.size, progress: 0 };
      entries.push(entry);
      renderMessages2(true);
      try {
        const attachment = await upload2("/api/files", file, { conversationId: cid, clientId: id, ...["voice", "video"].includes(body.kind) ? { mediaKind: body.kind } : {}, ...metadata2 }, (percent) => {
          entry.progress = percent;
          renderMessages2(true);
        });
        if (!active(owner2, g)) return;
        const payload = { ...body, clientId: id, attachmentId: attachment.id };
        if (payload.kind === "auto") payload.kind = /^image\/(png|jpeg|gif|webp)$/.test(attachment.mime) ? "image" : "file";
        const message = await api2("/api/conversations/" + cid + "/messages", { method: "POST", body: payload });
        if (!active(owner2, g)) return;
        if (S2.active === cid && !S2.historyMode && !S2.messages.some((m) => m.id === message.id)) S2.messages.push(message);
        queueRefresh2(true);
      } catch (error) {
        if (active(owner2, g) && error.name !== "AbortError") {
          entry.error = error.message;
          toast2(error.message);
          throw error;
        }
      } finally {
        if (active(owner2, g)) {
          if (!entry.error) entries = entries.filter((x) => x !== entry);
          renderMessages2(true);
        }
      }
    }
    function html(cid) {
      return entries.filter((e) => e.cid === cid).map((e) => `<article class="message mine pending-message">${av2(S2.user)}<div class="message-body"><div class="bubble"><b>${esc4(e.name)}</b><small>${bytes2(e.size)}</small></div><div class="outbox-status">${e.error ? esc4(e.error) : e.progress === 100 ? "正在生成消息…" : "正在上传 " + (e.progress === null ? "" : e.progress + "%")}</div><small>大文件直接上传，请保持客户端运行</small></div></article>`).join("");
    }
    return { upload: upload2, chat, html, stop };
  }

  // internal/ui/src/calls.js
  function createCalls({ S: S2, api: api2, action: action2, esc: esc4, av: av2, icon: icon2, toast: toast2, modal: modal2, closeModal: closeModal2, randomID: randomID2, Meetings: Meetings2, Desktop: Desktop2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, fullTime: fullTime2 }) {
    const $2 = (s) => document.querySelector(s);
    let active = null, scope = "", generation = 0, shape = "", ending = "", refreshTimer2, clock, ringTimer, audio, joining = "", dialing = false, history = null, closingTask = null;
    const permitted = /* @__PURE__ */ new Set(), seen = /* @__PURE__ */ new Set(), dismissed = /* @__PURE__ */ new Set();
    const identity = () => JSON.stringify([S2.config.server, S2.config.fingerprint, S2.user?.id, S2.token]);
    const live = (g) => g === generation && scope === identity() && S2.user && !S2.signingOut;
    const reasons = { busy: "对方忙线", rejected: "已拒绝", cancelled: "已取消", no_answer: "无人接听", failed: "未能接通", completed: "通话结束", offline: "设备已离线", unavailable: "好友关系已变化", interrupted: "通话中断", disconnected: "连接已断开", expired: "通话已到时限" };
    const duration = (n) => Math.floor(Math.max(0, n) / 60).toString().padStart(2, "0") + ":" + (Math.floor(Math.max(0, n)) % 60).toString().padStart(2, "0");
    function description(c) {
      if (c.state === "ringing") return c.caller === S2.user?.id ? "正在等待对方接听…" : "邀请你" + (c.mode === "video" ? "视频" : "语音") + "通话";
      if (c.state === "connecting") return "正在连接…";
      if (c.state === "connected") return duration((Date.now() - c.started) / 1e3);
      return c.started ? duration((c.ended - c.started) / 1e3) : reasons[c.reason] || "通话已结束";
    }
    function summary(value) {
      let c = value;
      try {
        if (value.kind) c = JSON.parse(value.text);
      } catch {
        return "[通话]";
      }
      return "[" + (c.mode === "video" ? "视频" : "语音") + "通话] " + (c.state === "ended" ? c.started ? duration((c.ended - c.started) / 1e3) : reasons[c.reason] || "已结束" : c.state === "ringing" ? "等待接听" : c.state === "connecting" ? "正在连接" : "通话中");
    }
    function card(m) {
      let c;
      try {
        c = JSON.parse(m.text);
      } catch {
        return esc4("[通话]");
      }
      ;
      return `<button class="call-message-card" data-call-redial="${esc4(m.conversationId || "")}" data-call-mode="${c.mode === "video" ? "video" : "audio"}">${icon2(c.mode === "video" ? "video" : "phone")}<span>${esc4(summary(c))}</span></button>`;
    }
    function stopRing() {
      clearInterval(ringTimer);
      ringTimer = null;
      window.WeLinkAndroid?.stopCallRinging?.();
      if (audio) {
        audio.close().catch(() => {
        });
        audio = null;
      }
    }
    function nativeIncoming(c) {
      return S2.config.platform === "windows" && typeof window.welinkTakeNativeInviteAction === "function" && !!c?.canRespond && c.state === "ringing";
    }
    function startRing(incoming) {
      if (ringTimer) return;
      if (incoming && nativeIncoming(active)) {
        ringTimer = setInterval(() => {
        }, 6e4);
        return;
      }
      if (window.WeLinkAndroid?.callRinging) {
        window.WeLinkAndroid.callRinging(incoming);
        ringTimer = setInterval(() => {
        }, 6e4);
        return;
      }
      try {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        const tone = () => {
          if (!audio) return;
          for (let i = 0; i < 2; i++) {
            const oscillator = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * 0.32;
            oscillator.frequency.value = incoming ? 660 : 440;
            gain.gain.setValueAtTime(0.025, at);
            gain.gain.exponentialRampToValueAtTime(1e-3, at + 0.22);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start(at);
            oscillator.stop(at + 0.23);
          }
        };
        audio.resume().catch(() => {
        });
        tone();
        ringTimer = setInterval(tone, incoming ? 2200 : 3200);
      } catch {
      }
    }
    function layer() {
      let n = $2("#call-layer");
      if (!n) {
        n = document.createElement("div");
        n.id = "call-layer";
        document.body.append(n);
      }
      return n;
    }
    function hideLayer() {
      shape = "";
      $2("#call-layer")?.remove();
    }
    function render() {
      if (!active || nativeIncoming(active) || active.state === "ended" || joining === active.id || dismissed.has(active.id)) {
        hideLayer();
        return;
      }
      const c = active, incoming = c.canRespond, other = !incoming && !c.canEnd, busy = ending === c.id;
      const status = busy ? c.state === "ringing" ? "正在取消…" : "正在挂断…" : other ? "已在其他设备接听" : description(c);
      const next = JSON.stringify([c.id, c.mode, c.state, incoming, c.canJoin, c.canEnd, other, busy, c.peer.id, c.peer.name, c.peer.remark, c.peer.avatar]);
      if (next === shape && $2("#call-layer .call-dialog")) {
        const node = $2(".call-status");
        if (node && node.textContent !== status) node.textContent = status;
        const mini = $2(".call-mini span");
        const text = c.peer.name + " · " + status;
        if (mini && mini.textContent !== text) mini.textContent = text;
        return;
      }
      shape = next;
      const hang = c.state === "ringing" ? "取消" : "挂断";
      layer().innerHTML = `<section class="call-dialog ${c.mode === "video" ? "call-video" : "call-audio"} ${incoming ? "is-incoming" : "is-outgoing"}" role="dialog" aria-label="${incoming ? "来电" : "通话"}"><header><b>${APP_NAME} · ${c.mode === "video" ? "视频" : "语音"}通话</b><button data-call-minimize title="收起">${icon2("minus")}</button></header><div class="call-person">${av2(c.peer, "large")}<h2>${esc4(c.peer.remark || c.peer.name)}</h2><p class="call-kind">${c.mode === "video" ? "视频通话" : "语音通话"}</p><p class="call-status" role="status">${esc4(status)}</p></div><div class="call-buttons">${incoming ? `<button class="call-decline" data-call-reject>${icon2("phone")}<span>拒绝</span></button>${c.mode === "video" ? '<button class="call-audio-answer" data-call-answer="audio">' + icon2("phone") + "<span>语音接听</span></button>" : ""}<button class="call-answer" data-call-answer="${c.mode}">${icon2(c.mode === "video" ? "video" : "phone")}<span>接听</span></button>` : c.canJoin ? '<button class="call-answer" data-call-resume>' + icon2("phone") + "<span>继续通话</span></button>" : ""}${c.canEnd ? '<button class="call-decline" data-call-end' + (busy ? " disabled" : "") + ">" + icon2("phone") + "<span>" + hang + "</span></button>" : ""}${other ? '<button class="secondary" data-call-dismiss>知道了</button>' : ""}</div></section><div class="call-mini-bar"><button class="call-mini" data-call-expand title="展开通话">${icon2("phone")}<span>${esc4(c.peer.name)} · ${esc4(status)}</span></button>${c.canEnd && !incoming ? '<button class="call-mini-end" data-call-mini-end title="' + hang + '" aria-label="' + hang + '"' + (busy ? " disabled" : "") + ">" + icon2("phone") + "</button>" : ""}</div>`;
    }
    async function refreshConversation(c, g) {
      if (S2.active !== c.conversationId || S2.historyMode) return;
      const messages = await api2("/api/conversations/" + c.conversationId + "/messages");
      if (live(g) && S2.active === c.conversationId && !S2.historyMode) {
        S2.messages = messages;
        renderMessages2(true);
      }
    }
    async function apply(c, g = generation) {
      if (!live(g) || c.state !== "ended" && seen.has(c.id)) return;
      if (active?.id === c.id && active.revision > c.revision) return;
      const missed = c.state === "ended" && c.started === 0 && c.callee === S2.user?.id && ["no_answer", "offline", "interrupted"].includes(c.reason);
      Desktop2?.activity("call/" + c.id, c.state === "ringing" && c.canRespond || missed);
      if (c.state === "ended") {
        if (active?.id === c.id) {
          active = null;
          joining = "";
          stopRing();
          render();
          Meetings2.closeCall(c.id);
        }
        if (!seen.has(c.id) && permitted.has(c.id)) toast2(description(c));
        permitted.delete(c.id);
        seen.add(c.id);
        refreshConversation(c, g).catch(() => {
        });
        queueRefresh2();
        if (history) loadHistory().catch(() => {
        });
        return;
      }
      if (active && active.id !== c.id) return;
      const updated = active?.revision !== c.revision;
      active = c;
      if (updated) {
        const message = S2.messages.find((m) => m.id === c.messageId && !m.recalled);
        if (message) {
          message.text = JSON.stringify({ id: c.id, mode: c.mode, state: c.state, reason: c.reason, started: c.started, ended: c.ended });
          const span = document.querySelector(`[data-message="${c.messageId}"] .call-message-card span`);
          if (span) span.textContent = summary(c);
        }
        queueRefresh2();
      }
      render();
      if (c.state === "ringing" && (c.canRespond || c.canEnd)) {
        startRing(c.canRespond);
      } else stopRing();
      if (c.canJoin && permitted.has(c.id) && joining !== c.id) {
        joining = c.id;
        render();
        try {
          await Meetings2.joinCall(c);
        } catch (error) {
          if (live(g)) {
            joining = "";
            toast2("无法开启通话：" + error.message);
            try {
              await action2("/api/calls/" + c.id + "/end");
            } catch {
            }
            await sync();
          }
        }
      }
    }
    async function sync() {
      const g = generation;
      if (!S2.user || !scope) return;
      try {
        const calls = await api2("/api/calls/active");
        if (!live(g)) return;
        for (const c of calls) await apply(c, g);
        if (active && !calls.some((c) => c.id === active.id)) {
          const old = active;
          await changed({ id: old.id });
        }
      } catch {
      } finally {
        if (live(g)) {
          clearTimeout(refreshTimer2);
          refreshTimer2 = setTimeout(sync, active ? 1500 : 5e3);
        }
      }
    }
    async function changed(event) {
      const g = generation;
      if (!scope) return;
      try {
        const c = await api2("/api/calls/" + event.id);
        if (live(g)) await apply(c, g);
      } catch {
      }
    }
    function start() {
      stop();
      scope = identity();
      clock = setInterval(() => {
        if (active) render();
      }, 1e3);
      sync();
    }
    function stop() {
      generation++;
      scope = "";
      clearTimeout(refreshTimer2);
      clearInterval(clock);
      stopRing();
      const closing = active?.id;
      active = null;
      if (closing) Meetings2.closeCall(closing);
      joining = "";
      ending = "";
      shape = "";
      dialing = false;
      closingTask = null;
      permitted.clear();
      seen.clear();
      dismissed.clear();
      history = null;
      $2("#call-layer")?.remove();
    }
    async function dial(cid, mode) {
      if (dialing) return;
      const g = generation;
      dialing = true;
      try {
        if (closingTask) await closingTask;
        if (!live(g)) return;
        if (active || Meetings2.busy()) {
          toast2("请先结束当前通话或会议");
          return;
        }
        const c = await action2("/api/calls", { conversationId: cid, mode, clientId: randomID2() });
        if (!live(g)) return;
        permitted.add(c.id);
        await apply(c, g);
      } catch (error) {
        if (live(g)) {
          toast2(error.message);
          sync();
        }
      } finally {
        if (live(g)) dialing = false;
      }
    }
    async function answer(audioOnly = false) {
      if (!active?.canRespond) return;
      const c = active, g = generation;
      permitted.add(c.id);
      stopRing();
      try {
        const result = await action2("/api/calls/" + c.id + "/respond", { accept: true, audioOnly });
        if (live(g)) await apply(result, g);
      } catch (error) {
        permitted.delete(c.id);
        if (live(g)) {
          toast2(error.message);
          await changed(c);
        }
      }
    }
    async function end(reject = false) {
      const c = active;
      if (!c || ending === c.id) return;
      const g = generation;
      stopRing();
      ending = c.id;
      render();
      try {
        const result = await action2("/api/calls/" + c.id + (reject ? "/respond" : "/end"), reject ? { accept: false } : {});
        if (live(g)) await apply(result, g);
      } catch (error) {
        if (live(g)) {
          toast2(error.message);
          await changed(c);
        }
      } finally {
        if (ending === c.id) {
          ending = "";
          if (live(g)) render();
        }
      }
    }
    async function mediaClosed(id) {
      Meetings2.closedNativeCall(id);
      if (joining === id) joining = "";
      if (active?.id !== id) return;
      const g = generation;
      active = null;
      seen.add(id);
      stopRing();
      render();
      const task = (async () => {
        try {
          await action2("/api/calls/" + id + "/end");
        } catch {
        }
        if (live(g)) await sync();
      })();
      closingTask = task;
      try {
        await task;
      } finally {
        if (closingTask === task) closingTask = null;
      }
    }
    function historyRow(c) {
      return `<article class="call-history-row" data-call-record="${c.id}">${av2(c.peer)}<div><b>${esc4(c.peer.name)}</b><p class="${c.started === 0 && c.callee === S2.user.id ? "call-missed" : ""}">${c.caller === S2.user.id ? "呼出" : "呼入"} · ${esc4(summary(c))}</p><small>${esc4(fullTime2(c.created))}</small></div><button title="再次呼叫" aria-label="再次呼叫" data-call-redial="${c.conversationId}" data-call-mode="${c.mode}">${icon2(c.mode === "video" ? "video" : "phone")}</button><button title="删除通话记录" aria-label="删除通话记录" data-call-delete="${c.id}">${icon2("trash")}</button></article>`;
    }
    async function loadHistory(older = false) {
      const h = history, g = generation;
      if (!h || !$2("#call-history-list")) return;
      const query = new URLSearchParams();
      if (h.missed) query.set("missed", "true");
      if (older && h.items.length) query.set("before", String(h.items[h.items.length - 1].seq));
      const items = await api2("/api/calls/history?" + query);
      if (history !== h || !live(g) || !$2("#call-history-list")) return;
      h.items = older ? [...h.items, ...items] : items;
      $2("#call-history-list").innerHTML = h.items.map(historyRow).join("") || '<div class="empty-list">暂无通话记录</div>';
      if (items.length === 50) $2("#call-history-list").insertAdjacentHTML("beforeend", '<button class="secondary" data-call-more>加载更多</button>');
    }
    function openHistory() {
      Desktop2?.clearActivities("call/");
      history = { missed: false, items: [] };
      modal2("通话记录", '<div class="call-history-tabs"><button class="active" data-call-filter="all">全部</button><button data-call-filter="missed">未接来电</button></div><div id="call-history-list"></div>', "", true);
      loadHistory().catch((e) => toast2(e.message));
    }
    document.addEventListener("click", async (event) => {
      const b = event.target.closest("[data-call-mode],[data-call-answer],[data-call-end],[data-call-mini-end],[data-call-reject],[data-call-resume],[data-call-minimize],[data-call-expand],[data-call-dismiss],[data-call-history],[data-call-delete],[data-call-filter],[data-call-more]");
      if (!b) return;
      try {
        if (b.dataset.callMode) {
          closeModal2();
          await dial(b.dataset.callRedial || S2.active, b.dataset.callMode);
        } else if (b.dataset.callAnswer) await answer(b.dataset.callAnswer === "audio");
        else if (b.hasAttribute("data-call-end") || b.hasAttribute("data-call-mini-end")) await end();
        else if (b.hasAttribute("data-call-reject")) await end(true);
        else if (b.hasAttribute("data-call-resume") && active) {
          permitted.add(active.id);
          await apply(active);
        } else if (b.hasAttribute("data-call-minimize")) layer().classList.add("call-minimized");
        else if (b.hasAttribute("data-call-expand")) layer().classList.remove("call-minimized");
        else if (b.hasAttribute("data-call-dismiss")) {
          if (active) dismissed.add(active.id);
          hideLayer();
        } else if (b.hasAttribute("data-call-history")) openHistory();
        else if (b.dataset.callFilter) {
          history = { missed: b.dataset.callFilter === "missed", items: [] };
          document.querySelectorAll("[data-call-filter]").forEach((x) => x.classList.toggle("active", x === b));
          await loadHistory();
        } else if (b.hasAttribute("data-call-more")) await loadHistory(true);
        else if (b.dataset.callDelete) {
          const id = b.dataset.callDelete;
          modal2("删除通话记录", '<p class="hint">仅删除你的通话列表记录，聊天中的记录卡片保留。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="call-delete-confirm">删除</button>');
          $2("#call-delete-confirm").onclick = async () => {
            try {
              await api2("/api/calls/" + id, { method: "DELETE" });
              openHistory();
            } catch (error) {
              toast2(error.message);
            }
          };
        }
      } catch (error) {
        toast2(error.message);
      }
    });
    window.WeLinkCallNativeClosed = (id) => mediaClosed(id);
    async function nativeAction(id, accept) {
      await changed({ id });
      if (active?.id !== id) return;
      if (accept) await answer(false);
      else await end(true);
    }
    return { dial, start, stop, changed, sync, card, summary, mediaClosed, nativeAction, isCurrent: (id) => active?.id === id && active.canJoin, historyChanged: () => {
      if (history) loadHistory().catch(() => {
      });
    }, historyEntry: () => '<button class="call-history-entry" data-call-history>' + icon2("phone") + "<span>通话记录</span>" + icon2("chevron") + "</button>" };
  }

  // internal/ui/src/desktop.js
  function createDesktop({ S: S2, modal: modal2, closeModal: closeModal2, toast: toast2, markRead: markRead2, esc: esc4 }) {
    const native = typeof window.welinkDesktopSettings === "function";
    let lastCount = -1, nativeHidden = !!window.welinkNativeHidden;
    const hidden = () => document.hidden || nativeHidden || !document.hasFocus();
    function unread() {
      if (!native) return;
      const count = S2.user ? S2.conversations.reduce((n, c) => n + Number((c.muted ? c.mentionCount : c.unread) || 0), 0) : 0;
      lastCount = count;
      window.welinkDesktopUnread(count).catch(() => {
        lastCount = -1;
      });
    }
    function activity(key, active) {
      if (!native) return;
      window.welinkDesktopActivity(key, !!active).catch(() => {
      });
    }
    function clearActivities(prefix = "") {
      if (!native) return;
      window.welinkDesktopClearActivities(prefix).catch(() => {
      });
    }
    async function settings2() {
      try {
        const p = await window.welinkDesktopSettings();
        const toggle = (id, label, checked) => `<label class="prefs-row" for="${id}"><span>${label}</span><input id="${id}" type="checkbox" ${checked ? "checked" : ""}></label>`;
        const shortcut = (id, label, value, error) => `<label class="prefs-row desktop-shortcut" for="${id}"><span>${label}</span><span class="shortcut-control"><input id="${id}" class="shortcut-input" readonly value="${esc4(value || "")}" placeholder="点击后按下快捷键" aria-label="${label}快捷键"><button class="secondary" type="button" data-clear-shortcut="${id}">清除</button></span></label>${error ? '<p class="shortcut-error" data-shortcut-error="' + id + '">' + esc4(error) + "</p>" : ""}`;
        modal2("Windows 桌面设置", toggle("desktop-auto-start", "登录 Windows 后启动 " + APP_NAME, p.autoStart) + toggle("desktop-start-minimized", "开机启动时最小化到托盘", p.startMinimized ?? true) + `<p class="hint">仅对当前 Windows 用户生效，默认关闭。${p.autoStart && !p.autoStartRegistered ? "启动项尚未注册，请重新保存。" : ""}</p>` + toggle("desktop-close-tray", "关闭窗口后留在系统托盘", p.closeToTray) + '<p class="hint">关闭窗口后继续接收消息，双击托盘图标即可恢复。</p><p class="hint">普通聊天只通过任务栏图标提示未读；来电、远程和会议邀请会在右下角显示。</p>' + toggle("desktop-hotkeys-enabled", "启用全局快捷键", p.hotkeysEnabled ?? true) + shortcut("desktop-show-hotkey", "显示主界面", p.showHotkey ?? "Ctrl+Alt+W", p.hotkeyErrors?.show) + shortcut("desktop-capture-hotkey", "截图", p.captureHotkey ?? "Ctrl+Alt+A", p.hotkeyErrors?.capture) + '<p class="hint">点击输入框后按下组合键，须包含 Ctrl 或 Alt。可清除某一项；被 QQ 等其他程序占用时可换一个组合键。</p>' + (p.trayAvailable ? "" : '<p class="hint">系统托盘暂不可用，关闭窗口时会最小化到任务栏。</p>') + '<p class="hint">完全退出可使用托盘右键菜单中的“退出 ' + APP_NAME + '”。</p><p id="desktop-save-error" class="shortcut-error" role="alert"></p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="desktop-save">保存</button>');
        document.querySelector(".modal").classList.add("desktop-settings");
        const $2 = (id) => document.getElementById(id), availability = () => {
          $2("desktop-start-minimized").disabled = !$2("desktop-auto-start").checked;
          for (const input of document.querySelectorAll(".shortcut-input")) input.disabled = !$2("desktop-hotkeys-enabled").checked;
          for (const b of document.querySelectorAll("[data-clear-shortcut]")) b.disabled = !$2("desktop-hotkeys-enabled").checked;
        };
        $2("desktop-auto-start").onchange = availability;
        $2("desktop-hotkeys-enabled").onchange = availability;
        availability();
        for (const input of document.querySelectorAll(".shortcut-input")) input.onkeydown = (event) => {
          if (event.key === "Tab") return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            input.blur();
            return;
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            input.value = "";
            return;
          }
          if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
          const code = event.code || "", key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d+$/.test(event.key) ? event.key : "";
          if (event.metaKey || !event.ctrlKey && !event.altKey || !key || key === "F12") {
            $2("desktop-save-error").textContent = "请选择 Ctrl / Alt 与字母、数字或功能键的组合，F12 不可用。";
            return;
          }
          document.querySelector('[data-shortcut-error="' + input.id + '"]')?.remove();
          input.value = [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
          $2("desktop-save-error").textContent = "";
        };
        for (const button2 of document.querySelectorAll("[data-clear-shortcut]")) button2.onclick = () => {
          $2(button2.dataset.clearShortcut).value = "";
          document.querySelector('[data-shortcut-error="' + button2.dataset.clearShortcut + '"]')?.remove();
        };
        const button = $2("desktop-save");
        button.onclick = async () => {
          button.disabled = true;
          try {
            await window.welinkDesktopSave({ closeToTray: $2("desktop-close-tray").checked, messageAlerts: false, messageSound: p.messageSound !== false, autoStart: $2("desktop-auto-start").checked, startMinimized: $2("desktop-start-minimized").checked, hotkeysEnabled: $2("desktop-hotkeys-enabled").checked, showHotkey: $2("desktop-show-hotkey").value, captureHotkey: $2("desktop-capture-hotkey").value });
            closeModal2();
            toast2("桌面设置已保存");
          } catch (error) {
            $2("desktop-save-error").textContent = String(error);
            button.disabled = false;
          }
        };
      } catch (error) {
        toast2(String(error));
      }
    }
    function quit() {
      modal2("退出 " + APP_NAME, "<p>退出后将停止接收消息，并结束当前通话和远程协助。</p>", '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="desktop-exit">退出</button>');
      document.querySelector("#desktop-exit").onclick = () => window.welinkDesktopExit();
    }
    window.addEventListener("welink-native-visibility", (event) => {
      nativeHidden = !!event.detail?.hidden;
      if (!hidden() && S2.user) {
        document.title = "" + APP_NAME;
        markRead2().catch(() => {
        });
      }
    });
    document.addEventListener("click", (event) => {
      if (!native) return;
      const action2 = event.target.closest("[data-desktop]")?.dataset.desktop;
      if (action2 === "settings") settings2();
      if (action2 === "quit") quit();
    });
    return { native, hidden, unread, activity, clearActivities, settingsRow: () => native ? '<div class="prefs-row"><span>Windows 桌面设置</span><button class="secondary" data-desktop="settings">管理</button></div>' : "", exitMenu: () => native ? '<button data-desktop="quit">退出 ' + APP_NAME + "</button>" : "" };
  }

  // internal/ui/src/screenshots.js
  function createScreenshots({ S: S2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc4, attach }) {
    let pending = null, editor = null, generation = 0, stream = null;
    const own = (state) => editor === state && state.canvas.isConnected;
    function reset() {
      generation++;
      pending = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (editor) {
        editor.observer?.disconnect();
        cancelAnimationFrame(editor.frame);
        editor.image.src = "";
        editor.canvas.width = editor.canvas.height = 1;
        editor = null;
      }
      window.welinkScreenshotCancel?.().catch(() => {
      });
    }
    async function start() {
      if (pending || editor) return;
      const state = pending = { token: S2.token, cid: S2.user && S2.active && S2.tab === "messages" ? S2.active : null, name: S2.conversations.find((c) => c.id === S2.active)?.name || "" }, version = generation;
      if (typeof window.welinkScreenshotCapture === "function") {
        try {
          if (await window.welinkScreenshotCapture() === false) {
            pending = null;
            toast2("截图仍在处理中，请稍后重试");
          }
        } catch (error) {
          pending = null;
          toast2(String(error));
        }
        return;
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        pending = null;
        toast2("此设备请使用系统截图后发送图片");
        return;
      }
      let captureStream;
      try {
        captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        if (version !== generation) return;
        stream = captureStream;
        const video = document.createElement("video");
        video.srcObject = captureStream;
        await video.play();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (version !== generation) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const image = canvas.toDataURL("image/png");
        canvas.width = canvas.height = 1;
        video.srcObject = null;
        if (version === generation && pending === state) await preview2(state, image);
      } catch (error) {
        if (version === generation && error.name !== "NotAllowedError") toast2("截图失败：" + error.message);
      } finally {
        captureStream?.getTracks().forEach((track) => track.stop());
        if (stream === captureStream) stream = null;
        if (pending === state) pending = null;
      }
    }
    function redraw(state) {
      if (!own(state)) return;
      const { canvas, ctx, image } = state;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      for (const item of [...state.items, ...state.current ? [state.current] : []]) {
        ctx.strokeStyle = ctx.fillStyle = item.color;
        ctx.lineWidth = item.width;
        ctx.lineCap = ctx.lineJoin = "round";
        const [a, b] = item.points;
        if (item.tool === "pen") {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (const point of item.points.slice(1)) ctx.lineTo(point.x, point.y);
          if (item.points.length === 1) ctx.lineTo(a.x + 0.1, a.y + 0.1);
          ctx.stroke();
        } else if (item.tool === "text") {
          ctx.font = `${Math.max(18, item.width * 6)}px "Microsoft YaHei",sans-serif`;
          ctx.textBaseline = "top";
          ctx.fillText(item.text, a.x, a.y);
        } else if (b) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
          if (item.tool === "rectangle") ctx.strokeRect(x, y, w, h);
          if (item.tool === "arrow") {
            const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.max(12, item.width * 4);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.moveTo(b.x - length * Math.cos(angle - 0.5), b.y - length * Math.sin(angle - 0.5));
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(b.x - length * Math.cos(angle + 0.5), b.y - length * Math.sin(angle + 0.5));
            ctx.stroke();
          }
          if (item.tool === "mosaic" && w >= 1 && h >= 1) {
            const small = document.createElement("canvas"), size = Math.max(8, item.width * 5);
            small.width = Math.max(1, Math.ceil(w / size));
            small.height = Math.max(1, Math.ceil(h / size));
            small.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(small, x, y, w, h);
            ctx.imageSmoothingEnabled = true;
            small.width = small.height = 1;
          }
        }
      }
      document.querySelector("#screenshot-undo").disabled = !state.items.length;
      document.querySelector("#screenshot-clear").disabled = !state.items.length;
    }
    function paint(state) {
      cancelAnimationFrame(state.frame);
      state.frame = requestAnimationFrame(() => redraw(state));
    }
    async function blob(state) {
      if (!own(state)) throw Error("截图预览已关闭");
      redraw(state);
      const result = await new Promise((resolve) => state.canvas.toBlob(resolve, "image/png"));
      if (!result) throw Error("无法生成截图");
      if (!own(state)) throw Error("截图预览已关闭");
      return result;
    }
    async function preview2(intent, url) {
      intent.loading = true;
      const version = generation, image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error("无法读取截图"));
        image.src = url;
      });
      if (version !== generation) return;
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024) throw Error("截图尺寸过大");
      pending = null;
      const canSend = !!intent.cid && !!S2.user && S2.token === intent.token;
      modal2(
        "截图预览",
        `<div class="screenshot-tools" role="toolbar" aria-label="截图标注">${[["pen", "画笔"], ["rectangle", "矩形"], ["arrow", "箭头"], ["text", "文字"], ["mosaic", "马赛克"]].map(([tool, label]) => `<button type="button" data-shot-tool="${tool}" class="${tool === "pen" ? "selected" : ""}" aria-pressed="${tool === "pen"}">${label}</button>`).join("")}<label>颜色<input id="screenshot-color" type="color" value="#ff5454" aria-label="标注颜色"></label><label>粗细<select id="screenshot-width" aria-label="标注粗细"><option value="2">细</option><option value="4" selected>中</option><option value="8">粗</option></select></label><button id="screenshot-undo" type="button">撤销</button><button id="screenshot-clear" type="button">清空标注</button></div><div class="screenshot-canvas-wrap"><canvas id="screenshot-canvas" aria-label="截图标注画布"></canvas></div><div class="screenshot-text-row hidden"><input id="screenshot-text" maxlength="200" placeholder="输入标注文字后，点击图中要放置的位置" aria-label="截图标注文字"></div><p class="hint">${image.naturalWidth} × ${image.naturalHeight} · ${canSend ? "完成后放入「" + esc4(intent.name) + "」的输入框，按发送才发出" : "可保存到电脑或复制到剪贴板"}。Esc 关闭，Ctrl + Z 撤销。</p>`,
        '<button class="secondary" data-action="close-modal">取消</button><button class="secondary" id="screenshot-save">保存图片</button><button class="secondary" id="screenshot-copy">复制</button>' + (canSend ? '<button class="primary" id="screenshot-send" title="放入「' + esc4(intent.name) + '」的输入框">完成</button>' : ""),
        true
      );
      document.querySelector(".modal").classList.add("screenshot-editor");
      const canvas = document.querySelector("#screenshot-canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const state = editor = { ...intent, canvas, ctx: canvas.getContext("2d"), image, items: [], current: null, tool: "pen", frame: 0, pointer: null };
      state.observer = new MutationObserver(() => {
        if (editor === state && !canvas.isConnected) reset();
      });
      state.observer.observe(document.querySelector("#overlays"), { childList: true, subtree: true });
      const position = (event) => {
        const rect = canvas.getBoundingClientRect();
        return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)) };
      };
      canvas.onpointerdown = (event) => {
        if (event.button !== 0 || state.pointer !== null) return;
        event.preventDefault();
        if (state.items.length >= 250) {
          toast2("标注数量较多，请先撤销或清空部分内容");
          return;
        }
        const item = { tool: state.tool, color: document.querySelector("#screenshot-color").value, width: Number(document.querySelector("#screenshot-width").value), points: [position(event)] };
        if (item.tool === "text") {
          item.text = document.querySelector("#screenshot-text").value.trim();
          if (!item.text) {
            document.querySelector("#screenshot-text").focus();
            return;
          }
          state.items.push(item);
          paint(state);
          return;
        }
        state.current = item;
        state.pointer = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        paint(state);
      };
      canvas.onpointermove = (event) => {
        if (state.pointer !== event.pointerId || !state.current) return;
        const point = position(event);
        if (state.current.tool === "pen") {
          if (state.current.points.length < 1e4) state.current.points.push(point);
        } else state.current.points[1] = point;
        paint(state);
      };
      const finish = (event, cancelled = false) => {
        if (state.pointer !== event.pointerId) return;
        state.pointer = null;
        if (!cancelled && state.current) state.items.push(state.current);
        state.current = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        paint(state);
      };
      canvas.onpointerup = (event) => finish(event);
      canvas.onpointercancel = (event) => finish(event, true);
      canvas.onlostpointercapture = (event) => finish(event, true);
      for (const button of document.querySelectorAll("[data-shot-tool]")) button.onclick = () => {
        state.tool = button.dataset.shotTool;
        for (const b of document.querySelectorAll("[data-shot-tool]")) {
          b.classList.toggle("selected", b === button);
          b.setAttribute("aria-pressed", String(b === button));
        }
        document.querySelector(".screenshot-text-row").classList.toggle("hidden", state.tool !== "text");
      };
      document.querySelector("#screenshot-undo").onclick = () => {
        state.items.pop();
        paint(state);
      };
      document.querySelector("#screenshot-clear").onclick = () => {
        state.items = [];
        paint(state);
      };
      const perform = (id, work) => {
        const button = document.getElementById(id);
        if (button) button.onclick = async () => {
          button.disabled = true;
          try {
            await work();
          } catch (error) {
            toast2(String(error.message || error));
          } finally {
            if (own(state)) button.disabled = false;
          }
        };
      };
      perform("screenshot-save", async () => {
        const data = await blob(state), href = URL.createObjectURL(data), link = document.createElement("a");
        link.href = href;
        link.download = "LinkMe-截图-" + Date.now() + ".png";
        link.click();
        setTimeout(() => URL.revokeObjectURL(href), 6e4);
      });
      perform("screenshot-copy", async () => {
        const data = await blob(state);
        if (typeof window.welinkScreenshotCopy === "function") {
          const encoded = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(data);
          });
          if (!own(state)) return;
          await window.welinkScreenshotCopy(encoded);
        } else if (navigator.clipboard?.write && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "image/png": data })]);
        else throw Error("此设备请先保存图片");
        if (own(state)) toast2("截图已复制");
      });
      perform("screenshot-send", async () => {
        if (!S2.user || S2.token !== state.token) throw Error("登录账号已变化，请重新选择聊天后截图");
        const data = await blob(state);
        if (S2.token !== state.token) throw Error("登录账号已变化");
        const file = new File([data], "截图-" + Date.now() + ".png", { type: "image/png" });
        if (own(state)) closeModal2();
        if (attach(file, state.cid) && state.cid !== S2.active) toast2("截图已放入「" + state.name + "」的输入框");
      });
      redraw(state);
    }
    window.addEventListener("welink-screenshot-request", () => start().catch((error) => toast2(String(error))));
    window.addEventListener("welink-screenshot-result", (event) => {
      const state = pending;
      if (!state || state.loading) return;
      const result = event.detail || {};
      if (result.cancelled || result.error) {
        pending = null;
        if (result.error) toast2(result.error);
        return;
      }
      if (typeof result.image === "string" && result.image.startsWith("data:image/png;base64,")) preview2(state, result.image).catch((error) => {
        pending = null;
        toast2(String(error.message || error));
      });
    });
    document.addEventListener("keydown", (event) => {
      if (!editor || !own(editor)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModal2();
        reset();
      } else if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "z" && !event.target.closest("input")) {
        event.preventDefault();
        editor.items.pop();
        paint(editor);
      }
    }, true);
    return { start, reset };
  }

  // internal/ui/src/avatars.js
  function createAvatars({ S: S2, api: api2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc4, av: av2, refresh: refresh2, renderMessages: renderMessages2, renderMain: renderMain2, updateRail: updateRail2, profile: profile2, groupDetail }) {
    const $2 = (s) => document.querySelector(s);
    let current = null;
    const endpoint = (s) => s.scope === "user" ? "/api/me/avatar" : "/api/groups/" + s.target + "/avatar";
    function release() {
      current?.image?.close?.();
      current = null;
    }
    function finish(changed2 = false) {
      const s = current;
      if (!s) return;
      release();
      closeModal2();
      s.back?.(changed2);
    }
    function choose() {
      const s = current;
      if (!s) return;
      if (s.scope === "user") {
        chooseCartoon();
        return;
      }
      modal2(s.scope === "user" ? "个人头像" : "群头像", `<div class="avatar-selection"><div>${av2(s.info, "large")}</div><h4>${esc4(s.info.name || "更换头像")}</h4><p>选择照片后可移动、缩放和旋转裁剪。</p><button class="primary" data-avatar="pick">选择图片</button><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden><small>最多 8 MB，4096 × 4096 像素；保存为静态头像</small>${s.info.avatar?.startsWith("image:") ? '<button class="avatar-reset" data-avatar="reset">恢复默认头像</button>' : ""}</div>`, '<button class="secondary" data-avatar="cancel">返回</button>');
      $2("#avatar-file").onchange = (e) => {
        if (e.target.files[0]) load(e.target.files[0]);
      };
    }
    function chooseCartoon() {
      const s = current;
      if (!s) return;
      s.selected = s.selected || s.info.avatar;
      s.choices = s.choices || cartoonChoices(8);
      const items = s.all ? cartoonAvatars : s.choices;
      modal2("个人头像", `<div class="cartoon-picker"><div class="cartoon-preview">${av2({ ...s.info, avatar: s.selected }, "large")}<div><b>选一个喜欢的头像</b><p>100 个卡通形象，也可以上传自己的照片</p></div></div><div class="cartoon-heading"><div class="cartoon-tabs"><button data-avatar="recommended" class="${s.all ? "" : "active"}">为你推荐</button><button data-avatar="all-cartoons" class="${s.all ? "active" : ""}">全部 100 个</button></div><button data-avatar="shuffle">换一批</button></div><div class="cartoon-grid ${s.all ? "all" : ""}" id="cartoon-options" role="radiogroup" aria-label="卡通头像">${cartoonOptions(items, s.selected)}</div><div class="cartoon-upload"><button class="secondary" data-avatar="pick">上传自己的照片</button><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden><small>支持移动、缩放和旋转裁剪</small>${s.info.avatar?.startsWith("image:") ? '<button class="avatar-reset" data-avatar="reset">恢复默认头像</button>' : ""}</div></div>`, '<button class="secondary" data-avatar="cancel">取消</button><button class="primary" data-avatar="save-cartoon" ' + (!s.selected?.startsWith("cartoon:") ? "disabled" : "") + ">使用这个头像</button>", true);
      $2(".modal").classList.add("cartoon-modal");
      $2("#avatar-file").onchange = (e) => {
        if (e.target.files[0]) load(e.target.files[0]);
      };
    }
    async function load(file) {
      const s = current;
      if (!s) return;
      if (file.size > 8 * 1024 * 1024) {
        toast2("图片不能超过 8 MB");
        return;
      }
      let img, url;
      try {
        if (window.createImageBitmap) img = await createImageBitmap(file, { imageOrientation: "from-image" });
        else {
          url = URL.createObjectURL(file);
          img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
          });
        }
        if (current !== s) {
          img.close?.();
          return;
        }
        if (img.width > 4096 || img.height > 4096 || img.width * img.height > 16 * 1024 * 1024) {
          img.close?.();
          throw Error("请选择不超过 4096 × 4096 像素的图片");
        }
        s.image?.close?.();
        s.image = img;
        s.angle = 0;
        s.zoom = 1;
        s.x = s.y = 0;
        editor();
      } catch (e) {
        toast2(e?.message || "无法读取图片，请选择 JPEG、PNG、WebP 或 GIF");
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
    function geometry(s) {
      const rotated = s.angle % 180 !== 0, w = rotated ? s.image.height : s.image.width, h = rotated ? s.image.width : s.image.height, scale = Math.max(512 / w, 512 / h) * s.zoom;
      return { scale, wide: w * scale, tall: h * scale };
    }
    function draw() {
      const s = current, canvas = $2("#avatar-canvas");
      if (!s?.image || !canvas) return;
      const g = geometry(s);
      s.x = Math.max(-(g.wide - 512) / 2, Math.min((g.wide - 512) / 2, s.x));
      s.y = Math.max(-(g.tall - 512) / 2, Math.min((g.tall - 512) / 2, s.y));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 512, 512);
      ctx.save();
      ctx.translate(256 + s.x, 256 + s.y);
      ctx.rotate(s.angle * Math.PI / 180);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(s.image, -s.image.width * g.scale / 2, -s.image.height * g.scale / 2, s.image.width * g.scale, s.image.height * g.scale);
      ctx.restore();
    }
    function editor() {
      const s = current;
      if (!s) return;
      modal2("裁剪头像", `<div id="avatar-editor"><p class="hint">拖动图片调整位置，缩放后选择头像区域</p><div class="avatar-crop-frame"><canvas id="avatar-canvas" width="512" height="512" role="img" aria-label="头像裁剪预览"></canvas><div class="avatar-crop-guide"></div></div><label class="avatar-zoom-label" for="avatar-zoom">缩放<input id="avatar-zoom" type="range" min="1" max="4" step="0.01" value="1"></label><div class="avatar-crop-actions"><button class="secondary" data-avatar="rotate">向右旋转</button><button class="secondary" data-avatar="reselect">重新选择</button></div></div>`, '<button class="secondary" data-avatar="cancel">取消</button><button class="primary" data-avatar="save">保存头像</button>');
      const canvas = $2("#avatar-canvas");
      let drag = null;
      canvas.onpointerdown = (e) => {
        canvas.setPointerCapture(e.pointerId);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: s.x, dy: s.y };
      };
      canvas.onpointermove = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const scale = 512 / canvas.getBoundingClientRect().width;
        s.x = drag.dx + (e.clientX - drag.x) * scale;
        s.y = drag.dy + (e.clientY - drag.y) * scale;
        draw();
      };
      canvas.onpointerup = canvas.onpointercancel = (e) => {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        drag = null;
      };
      $2("#avatar-zoom").oninput = (e) => {
        s.zoom = Number(e.target.value);
        draw();
      };
      draw();
    }
    async function save(reset = false, preset = false) {
      const s = current;
      if (!s || s.busy) return;
      s.busy = true;
      document.querySelectorAll(".modal button,.modal input").forEach((e) => e.disabled = true);
      try {
        let result;
        if (preset) result = await api2(endpoint(s), { method: "PATCH", body: { avatar: s.selected } });
        else if (reset) result = await api2(endpoint(s), { method: "DELETE" });
        else {
          const canvas = $2("#avatar-canvas");
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
          if (current !== s || S2.user?.id !== s.actor) return;
          if (!blob) throw Error("无法生成头像，请重新选择图片");
          const body = new FormData();
          body.append("file", blob, "avatar.jpg");
          result = await api2(endpoint(s), { method: "POST", body });
        }
        if (current !== s || S2.user?.id !== s.actor) return;
        if (s.scope === "user") {
          const user = await api2("/api/me");
          if (current !== s || S2.user?.id !== s.actor) return;
          S2.user = user;
        }
        await refresh2();
        if (current !== s || S2.user?.id !== s.actor) return;
        s.info.avatar = result.avatar;
        toast2(reset ? "已恢复默认头像" : "头像已更新");
        finish(true);
      } catch (e) {
        if (current === s) {
          s.busy = false;
          document.querySelectorAll(".modal button,.modal input").forEach((e2) => e2.disabled = false);
          toast2(e.message);
        }
      }
    }
    function openUser() {
      const draft = { name: $2("#profile-name")?.value ?? S2.user.name, bio: $2("#profile-bio")?.value ?? S2.user.bio, phone: $2("#profile-phone")?.value ?? S2.user.phone, gender: $2("#profile-gender")?.value ?? S2.user.gender, jobTitle: $2("#profile-job")?.value ?? S2.user.jobTitle, avatar: $2(".color-list .selected")?.dataset.color || S2.user.avatar };
      release();
      current = { scope: "user", actor: S2.user.id, target: S2.user.id, info: { ...S2.user }, back: (changed2) => profile2({ ...draft, avatar: changed2 ? S2.user.avatar : draft.avatar }) };
      choose();
    }
    async function openGroup(id) {
      const actor = S2.user?.id;
      try {
        const c = await api2("/api/conversations/" + id);
        if (S2.user?.id !== actor) return;
        if (!["owner", "admin"].includes(c.group?.role)) throw Error("只有群主和管理员可以修改群头像");
        release();
        current = { scope: "group", actor, target: id, info: { name: c.name, kind: "group", avatar: c.group.avatar }, back: () => groupDetail(id) };
        choose();
      } catch (e) {
        toast2(e.message);
      }
    }
    function changed(d) {
      if (!S2.user) return;
      if (d.userId === S2.user.id) Object.assign(S2.user, { name: d.name, avatar: d.avatar, bio: d.bio, phone: d.phone, gender: d.gender, jobTitle: d.jobTitle });
      for (const u of S2.friends) if (u.id === d.userId) Object.assign(u, { name: d.name, avatar: d.avatar, bio: d.bio, phone: d.phone, gender: d.gender, jobTitle: d.jobTitle });
      for (const m of S2.messages) if (m.sender === d.userId) m.avatar = d.avatar;
      document.querySelectorAll(`.avatar[data-avatar-user="${d.userId}"]`).forEach((node) => {
        const online = !!node.querySelector(".dot"), size = node.classList.contains("large") ? "large" : node.classList.contains("small") ? "small" : "";
        node.outerHTML = av2({ ...d, id: d.userId, online }, size, online);
      });
      updateRail2();
      renderMessages2(true);
      if (S2.tab === "profile") renderMain2();
    }
    document.addEventListener("error", (e) => {
      if (e.target.classList?.contains("avatar-photo")) e.target.hidden = true;
    }, true);
    document.addEventListener("click", (e) => {
      if (current && e.target.closest('[data-action="close-modal"]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!current.busy) finish();
      }
    }, true);
    document.addEventListener("click", (e) => {
      const option = e.target.closest("[data-cartoon]");
      if (option && current?.scope === "user" && !current.busy) {
        current.selected = option.dataset.cartoon;
        document.querySelectorAll("#cartoon-options [data-cartoon]").forEach((n) => {
          n.classList.toggle("selected", n === option);
          n.setAttribute("aria-checked", String(n === option));
        });
        $2(".cartoon-preview .avatar").outerHTML = av2({ ...current.info, avatar: current.selected }, "large");
        $2("[data-avatar=save-cartoon]").disabled = false;
        return;
      }
      const b = e.target.closest("[data-avatar]");
      if (!b) return;
      const action2 = b.dataset.avatar;
      if (action2 === "user") {
        openUser();
        return;
      }
      if (action2 === "group") {
        openGroup(b.dataset.groupId);
        return;
      }
      const s = current;
      if (!s || s.busy) return;
      if (action2 === "cancel") finish();
      if (action2 === "shuffle") {
        s.choices = cartoonChoices(8, s.choices?.map((a) => a.id) || []);
        s.all = false;
        chooseCartoon();
      }
      if (action2 === "recommended") {
        s.all = false;
        chooseCartoon();
      }
      if (action2 === "all-cartoons") {
        s.all = true;
        chooseCartoon();
      }
      if (action2 === "save-cartoon") save(false, true);
      if (action2 === "pick") $2("#avatar-file")?.click();
      if (action2 === "reselect") choose();
      if (action2 === "rotate") {
        s.angle = (s.angle + 90) % 360;
        s.x = s.y = 0;
        s.zoom = 1;
        $2("#avatar-zoom").value = "1";
        draw();
      }
      if (action2 === "save") save();
      if (action2 === "reset") {
        modal2("恢复默认头像", "<p>确定移除当前照片，恢复默认头像？</p>", '<button class="secondary" data-avatar="cancel">取消</button><button class="primary" data-avatar="reset-confirm">确定</button>');
      }
      if (action2 === "reset-confirm") save(true);
    });
    new MutationObserver(() => {
      if (current && !$2("#avatar-editor") && !$2("#avatar-file") && !document.querySelector('[data-avatar="reset-confirm"]')) release();
    }).observe($2("#overlays"), { childList: true });
    return { changed, reset: release };
  }

  // internal/ui/src/local-store.js
  var database;
  function openLocalStore() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("welink-local", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["queue", "drafts", "cache"]) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          store.createIndex("scope", "scope");
        }
        db.createObjectStore("blobs");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error("请关闭其他 " + APP_NAME + " 窗口后重试"));
    }).catch((error) => {
      database = null;
      throw error;
    });
    return database;
  }
  async function transaction(names, mode, work) {
    const db = await openLocalStore();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode), stores = {};
      for (const name of names) stores[name] = tx.objectStore(name);
      let result, error;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(error || tx.error || Error("本地保存失败"));
      tx.onerror = () => {
      };
      try {
        work(stores, (value) => {
          result = value;
        }, (reason) => {
          error = reason;
          tx.abort();
        });
      } catch (reason) {
        error = reason;
        tx.abort();
      }
    });
  }
  var scopedRows = (name, scope) => transaction([name], "readonly", (stores, done) => {
    const r = stores[name].index("scope").getAll(scope);
    r.onsuccess = () => done(r.result);
  });
  var localGet = (name, id) => transaction([name], "readonly", (stores, done) => {
    const r = stores[name].get(id);
    r.onsuccess = () => done(r.result);
  });
  var localPut = (name, value) => transaction([name], "readwrite", (stores) => stores[name].put(value));

  // internal/ui/src/outbox.js
  function createOutbox({ onSent = () => {
  }, sendLarge, S: S2, api: api2, toast: toast2, esc: esc4, av: av2, bytes: bytes2, randomID: randomID2, Mentions: Mentions2, renderMessages: renderMessages2, renderReply: renderReply2, queueRefresh: queueRefresh2, modal: modal2, closeModal: closeModal2 }) {
    const $2 = (selector) => document.querySelector(selector);
    let scope = "", generation = 0, rows = [], drafts = /* @__PURE__ */ new Map(), timer, working = false, controller, saveChain = Promise.resolve(), storageWarning = false;
    const scopeFor = () => JSON.stringify([new URL(S2.config.server).href.replace(/\/$/, ""), (S2.config.fingerprint || "").toLowerCase(), S2.user?.id]);
    const alive = (g, key) => g === generation && key === scope && S2.user && !S2.signingOut;
    const draftID = (cid) => JSON.stringify([scope, cid]);
    function storageError(error) {
      if (!storageWarning) {
        storageWarning = true;
        toast2("无法保存到本机：" + (error.name === "QuotaExceededError" ? "存储空间不足，请清理待发送文件" : error.message));
      }
    }
    async function refreshRows(g = generation, key = scope) {
      if (!key) return;
      const result = await scopedRows("queue", key);
      if (alive(g, key)) {
        const next = result.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
        if (JSON.stringify(rows) !== JSON.stringify(next)) {
          rows = next;
          renderMessages2(true);
          updatePanel();
        }
      }
    }
    function stop() {
      generation++;
      scope = "";
      clearTimeout(timer);
      controller?.abort();
      controller = null;
      rows = [];
      drafts.clear();
      working = false;
    }
    async function start() {
      stop();
      const g = generation, key = scope = scopeFor();
      try {
        await openLocalStore();
        const saved = await scopedRows("drafts", key);
        if (!alive(g, key)) return;
        for (const d of saved) {
          drafts.set(d.cid, d);
          S2.drafts[d.cid] = d.text;
          Mentions2.restore(d.cid, d.text, d.mentions);
        }
        await refreshRows(g, key);
        storageWarning = false;
        kick();
      } catch (error) {
        storageError(error);
      }
    }
    function saveDraft() {
      if (!scope || !S2.active || S2.signingOut) return Promise.resolve();
      const cid = S2.active, el = $2("#composer");
      if (!el) return Promise.resolve();
      const d = { id: draftID(cid), scope, cid, text: el.value, mentions: Mentions2.payload().map((m) => ({ ...m })), replyId: S2.reply?.id || "", updated: Date.now(), revision: randomID2() };
      drafts.set(cid, d);
      const task = saveChain.then(() => localPut("drafts", d));
      saveChain = task.catch(storageError);
      return task;
    }
    async function restoreReply(cid) {
      const d = drafts.get(cid), g = generation, key = scope;
      if (!d?.replyId) return;
      try {
        let m = S2.messages.find((m2) => m2.id === d.replyId);
        if (!m) {
          const messages = await api2("/api/conversations/" + cid + "/messages?around=" + encodeURIComponent(d.replyId));
          m = messages.find((m2) => m2.id === d.replyId);
        }
        if (!alive(g, key) || S2.active !== cid || drafts.get(cid) !== d) return;
        if (m && !m.recalled) {
          S2.reply = m;
          renderReply2();
        } else {
          d.replyId = "";
          S2.reply = null;
          renderReply2();
          await localPut("drafts", d);
          toast2("草稿引用的消息已撤回或不可访问");
        }
      } catch (error) {
        if (!alive(g, key) || S2.active !== cid || drafts.get(cid) !== d) return;
        if (error.status === 400 || error.status === 403 || error.status === 404) {
          d.replyId = "";
          S2.reply = null;
          renderReply2();
          await localPut("drafts", d);
        } else toast2("引用暂未恢复，请联网后重试");
      }
    }
    async function enqueue(cid, body, file, metadata2 = {}, clearDraft = false) {
      if (!scope || !S2.user || S2.signingOut) throw Error("请先登录再发送");
      if (file && S2.policy?.chatMaxAttachmentBytes > 0 && file.size > S2.policy.chatMaxAttachmentBytes) throw Error("文件超过服务器配置的大小限制");
      if (file?.size > (S2.policy.chatPersistAttachmentBytes ?? 50 * 1024 * 1024)) return sendLarge(cid, body, file, metadata2);
      const g = generation, key = scope, id = randomID2(), draftRevision = drafts.get(cid)?.revision, record = { id, scope: key, cid, body: { ...body, clientId: id }, created: Date.now(), state: "waiting", attempts: 0, next: 0, file: file ? { name: file.name, type: file.type, size: file.size } : null, metadata: metadata2 };
      await saveChain;
      if (!alive(g, key)) throw Error("登录账号已变化，请重新选择内容");
      try {
        await transaction(["queue", "blobs", "drafts"], "readwrite", (stores, done, abort) => {
          const request2 = stores.queue.index("scope").getAll(key);
          request2.onsuccess = () => {
            if (request2.result.length >= (S2.policy.chatOfflineQueueMessages || 100) || request2.result.reduce((n, r) => n + (r.file?.size || 0), 0) + (file?.size || 0) > (S2.policy.chatOfflineQueueBytes ?? 250 * 1024 * 1024)) {
              abort(Error("本机待发送队列已满，请先处理已有消息"));
              return;
            }
            stores.queue.add(record);
            if (file) stores.blobs.put(file, id);
            if (clearDraft) {
              const draft = stores.drafts.get(JSON.stringify([key, cid]));
              draft.onsuccess = () => {
                if (draft.result?.revision === draftRevision) stores.drafts.delete(JSON.stringify([key, cid]));
              };
            }
          };
        });
      } catch (error) {
        if (file && alive(g, key)) return sendLarge(cid, body, file, metadata2);
        throw error;
      }
      if (!alive(g, key)) return;
      storageWarning = false;
      if (clearDraft && drafts.get(cid)?.revision === draftRevision) {
        drafts.delete(cid);
        S2.drafts[cid] = "";
        Mentions2.clear(cid);
      }
      await refreshRows(g, key).catch(storageError);
      kick();
    }
    async function update(id, changes) {
      await transaction(["queue"], "readwrite", (stores) => {
        const r = stores.queue.get(id);
        r.onsuccess = () => {
          if (r.result) stores.queue.put({ ...r.result, ...changes });
        };
      });
    }
    async function remove(id) {
      await transaction(["queue", "blobs"], "readwrite", (stores) => {
        stores.queue.delete(id);
        stores.blobs.delete(id);
      });
    }
    async function ack(message) {
      if (!scope || message.sender !== S2.user?.id || !message.clientId) return;
      const g = generation, key = scope;
      const row = await localGet("queue", message.clientId);
      if (row?.scope !== key || row.cid !== message.conversationId) return;
      await remove(row.id);
      if (alive(g, key)) Promise.resolve(onSent(message)).catch(() => {
      });
      await refreshRows(g, key);
    }
    function kick() {
      clearTimeout(timer);
      if (scope && !working) timer = setTimeout(() => work().catch(storageError), 100);
    }
    async function request(path, options, g, key) {
      if (!alive(g, key)) throw Error("账号已切换");
      const native = typeof AbortController === "function" ? new AbortController() : null;
      let rejectAbort;
      const cancelled = new Promise((resolve, reject) => {
        rejectAbort = reject;
      }), pending = { abort() {
        native?.abort();
        rejectAbort(Object.assign(Error("请求已中断"), { name: "AbortError" }));
      } };
      controller = pending;
      const timeout = setTimeout(() => pending.abort(), 65e3);
      try {
        return await Promise.race([api2(path, { ...options, ...native ? { signal: native.signal } : {} }), cancelled]);
      } finally {
        clearTimeout(timeout);
        if (controller === pending) controller = null;
      }
    }
    async function work() {
      if (working || !scope || !S2.user || S2.signingOut) return;
      working = true;
      const g = generation, key = scope;
      try {
        const pending = (await scopedRows("queue", key)).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
        if (!alive(g, key)) return;
        const seen = /* @__PURE__ */ new Set(), candidate = pending.find((r) => {
          if (seen.has(r.cid)) return false;
          seen.add(r.cid);
          return r.state !== "failed" && r.next <= Date.now();
        });
        if (!candidate) return;
        const row = candidate;
        await update(row.id, { state: "sending", attempts: row.attempts + 1 });
        await refreshRows(g, key);
        try {
          if (row.attempts) {
            const receipt = await request("/api/outbox/" + row.id, {}, g, key);
            if (receipt.delivered) {
              if (receipt.conversationId !== row.cid) throw Object.assign(Error("消息标识与会话不一致"), { status: 409 });
              await remove(row.id);
              if (alive(g, key)) {
                if (S2.active === row.cid && !S2.historyMode) {
                  const messages = await request("/api/conversations/" + row.cid + "/messages", {}, g, key);
                  if (alive(g, key) && S2.active === row.cid && !S2.historyMode) S2.messages = messages;
                }
                queueRefresh2(true);
              }
              return;
            }
          }
          let body = { ...row.body };
          if (row.file && !row.attachment) {
            const file = await localGet("blobs", row.id);
            if (!file) throw Object.assign(Error("本机附件已丢失，请重新选择文件"), { status: 400 });
            const form = new FormData();
            form.append("conversationId", row.cid);
            form.append("clientId", row.id);
            form.append("file", file, row.file.name);
            if (body.kind === "voice" || body.kind === "video") form.append("mediaKind", body.kind);
            for (const [k, v] of Object.entries(row.metadata)) form.append(k, String(v));
            row.attachment = await request("/api/files", { method: "POST", body: form }, g, key);
            if (!alive(g, key)) return;
            await update(row.id, { attachment: row.attachment });
          }
          if (row.attachment) {
            body.attachmentId = row.attachment.id;
            if (body.kind === "auto") body.kind = /^image\/(png|jpeg|gif|webp)$/.test(row.attachment.mime) ? "image" : "file";
          }
          if (!await localGet("queue", row.id)) return;
          const message = await request("/api/conversations/" + row.cid + "/messages", { method: "POST", body }, g, key);
          if (!alive(g, key)) return;
          await remove(row.id);
          Promise.resolve(onSent(message)).catch(() => {
          });
          if (S2.active === row.cid && !S2.historyMode && !S2.messages.some((m) => m.id === message.id)) {
            S2.messages.push(message);
            S2.messages.sort((a, b) => a.seq - b.seq);
          }
          queueRefresh2(true);
        } catch (error) {
          if (!alive(g, key)) return;
          const permanent = error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
          await update(row.id, { state: permanent ? "failed" : "waiting", error: permanent ? error.message : "网络异常，等待重试", next: Date.now() + (error.status === 429 ? 6e4 : Math.min(3e4, 2e3 * 2 ** Math.min(row.attempts, 4))) });
        }
      } finally {
        if (alive(g, key)) {
          working = false;
          await refreshRows(g, key);
          timer = setTimeout(() => work().catch(storageError), 1e3);
        }
      }
    }
    const status = (row) => row.state === "sending" ? "正在发送…" : row.state === "failed" ? row.error : row.error || "已保存，等待发送";
    function item(row, panel = false) {
      const content = row.file ? `<b>${esc4(row.body.kind === "voice" ? "语音" : row.file.name)}</b><small>${bytes2(row.file.size)}</small>` : esc4(row.body.text);
      return `<article class="${panel ? "outbox-row" : "message mine pending-message"}" data-outbox="${row.id}">${panel ? "" : av2(S2.user)}<div class="message-body">${panel ? "<b>" + esc4(S2.conversations.find((c) => c.id === row.cid)?.name || "原会话已不可访问") + "</b>" : ""}<div class="bubble">${content}</div><div class="outbox-status ${row.state === "failed" ? "failed" : ""}" role="status">${esc4(status(row))}</div><div class="outbox-actions">${row.state !== "sending" ? '<button data-outbox-retry="' + row.id + '">重试</button>' : ""}<button data-outbox-remove="${row.id}">移除待发送</button></div></div></article>`;
    }
    function html(cid) {
      return S2.historyMode ? "" : rows.filter((r) => r.cid === cid && !S2.messages.some((m) => m.clientId === r.id && m.sender === S2.user?.id)).map((r) => item(r)).join("");
    }
    function updatePanel() {
      const panel = $2("#outbox-list");
      if (panel) panel.innerHTML = rows.map((r) => item(r, true)).join("") || '<p class="empty-list">没有待发送消息</p>';
    }
    function show() {
      modal2("待发送消息", '<p class="hint">保存在此设备，登录同一服务器和账号后继续发送。每个会话依次发送；失败消息需重试或移除。</p><div id="outbox-list"></div>', "", true);
      updatePanel();
    }
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-outbox-open],[data-outbox-retry],[data-outbox-remove]");
      if (!button || !scope) return;
      const g = generation, key = scope;
      try {
        if (button.hasAttribute("data-outbox-open")) {
          show();
          return;
        }
        const id = button.dataset.outboxRetry || button.dataset.outboxRemove, row = rows.find((r) => r.id === id);
        if (!row) return;
        if (button.dataset.outboxRetry) {
          await update(id, { state: "waiting", next: 0, error: "" });
          await refreshRows(g, key);
          kick();
          return;
        }
        modal2("移除待发送消息", '<p class="hint">只移除此设备的待发送副本。如果服务器已经收到，这条消息仍会保留在聊天记录中，可在聊天里撤回。</p>', '<button class="secondary" data-action="close-modal">保留</button><button class="primary" id="outbox-confirm-remove">移除</button>');
        $2("#outbox-confirm-remove").onclick = async () => {
          if (!alive(g, key)) return;
          await remove(id);
          closeModal2();
          await refreshRows(g, key);
          kick();
        };
      } catch (error) {
        toast2(error.message);
      }
    });
    window.addEventListener("online", kick);
    return { start, stop, kick, ack, html, saveDraft, restoreReply, enqueue, replyPlaceholder: (cid) => drafts.get(cid)?.replyId ? { id: drafts.get(cid).replyId, name: "原消息", text: "正在恢复引用…", kind: "text" } : null, scope: () => scope, settingsRow: () => '<div class="prefs-row"><span>本机待发送消息</span><button class="secondary" data-outbox-open>管理</button></div>' };
  }

  // internal/ui/src/received-cache.js
  var metadata = /* @__PURE__ */ new Set(["/api/me", "/api/config", "/api/public-config", "/api/conversations", "/api/friends", "/api/requests", "/api/group-requests", "/api/contact-groups"]);
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var clone = (value) => JSON.parse(JSON.stringify(value));
  var classify = (path) => {
    const url = new URL(path, location.origin), match = url.pathname.match(/^\/api\/conversations\/([a-f0-9]{32})(\/messages)?$/);
    return metadata.has(url.pathname) ? { name: url.pathname, url } : match ? { name: match[2] ? "messages:" + match[1] : url.pathname, cid: match[1], messages: !!match[2], url } : null;
  };
  var temporary = (error) => !error.status && error.name !== "AbortError" || [408, 502, 503, 504].includes(error.status);
  function createReceivedCache({ S: S2, toast: toast2, modal: modal2, closeModal: closeModal2, esc: esc4, bytes: bytes2, connectionState: connectionState2, onReconciled }) {
    let current = null;
    const identity = () => JSON.stringify([new URL(S2.config.server).href.replace(/\/$/, ""), (S2.config.fingerprint || "").toLowerCase(), S2.token]);
    const alive = (ctx) => current === ctx && !ctx.dead && ctx.token === S2.token && !S2.signingOut && ctx.identity === identity();
    const limits = (ctx) => {
      const p = ctx.records.get("/api/config")?.data || S2.policy || {};
      return { messages: p.receivedCacheMessages ?? 5e3, bytes: p.receivedCacheBytes ?? 20 * 1024 * 1024, days: p.receivedCacheDays ?? 30, conversations: p.receivedCacheConversations ?? 100 };
    };
    function warning(ctx) {
      if (!ctx.warned && alive(ctx)) {
        ctx.warned = true;
        toast2("本机聊天缓存暂时不可用，联网聊天不受影响");
      }
    }
    async function context() {
      if (!/^[a-f0-9]{64}$/.test(S2.token) || !S2.config.server || !crypto.subtle) return null;
      const key = identity();
      if (current?.identity === key) return current.ready;
      const ctx = current = { identity: key, token: S2.token, records: /* @__PURE__ */ new Map(), revision: 0, chain: Promise.resolve(), dead: false };
      ctx.ready = (async () => {
        const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
        ctx.scope = "received:" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
        ctx.key = await crypto.subtle.importKey("raw", Uint8Array.from(ctx.token.match(/../g), (b) => parseInt(b, 16)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
        await transaction(["cache"], "readwrite", (stores) => {
          const r = stores.cache.openCursor();
          r.onsuccess = () => {
            const cursor = r.result;
            if (cursor) {
              if (cursor.value.scope?.startsWith("received:") && cursor.value.expires < Date.now()) cursor.delete();
              cursor.continue();
            }
          };
        });
        for (const row of await scopedRows("cache", ctx.scope)) {
          try {
            const plain2 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData: encoder.encode(ctx.scope + "\n" + row.name) }, ctx.key, row.cipher), value = JSON.parse(decoder.decode(plain2));
            ctx.records.set(row.name, { ...value, versions: /* @__PURE__ */ new Map(), revision: 0, size: plain2.byteLength });
          } catch {
            ctx.records.set(row.name, { invalid: true, updated: 0, size: 0 });
          }
        }
        if (alive(ctx)) await flush(ctx, /* @__PURE__ */ new Set());
        return ctx;
      })().catch(() => {
        warning(ctx);
        return null;
      });
      return ctx.ready;
    }
    function serial2(ctx, work) {
      const next = ctx.chain.then(() => alive(ctx) ? work() : void 0);
      ctx.chain = next.catch(() => warning(ctx));
      return next;
    }
    function record(ctx, name, data) {
      let row = ctx.records.get(name);
      if (!row || row.invalid) {
        row = { data, versions: /* @__PURE__ */ new Map(), revision: 0, updated: Date.now(), size: 0 };
        ctx.records.set(name, row);
      }
      return row;
    }
    function prune(ctx, changed) {
      const policy = limits(ctx), now = Date.now(), allowed = policy.messages > 0 && policy.bytes > 0;
      for (const [name, row] of ctx.records) if (!allowed || row.invalid || now - row.updated > policy.days * 864e5) {
        ctx.records.delete(name);
        changed.add(name);
      }
      let chats = [...ctx.records].filter(([name]) => name.startsWith("messages:")).sort((a, b) => b[1].updated - a[1].updated);
      for (const [name] of chats.slice(policy.conversations)) {
        ctx.records.delete(name);
        changed.add(name);
      }
      chats = chats.slice(0, policy.conversations);
      let count = chats.reduce((n, [, r]) => n + r.data.items.length, 0);
      for (const [name, row] of [...chats].reverse()) if (count > policy.messages) {
        const remove = Math.min(row.data.items.length, count - policy.messages);
        row.data.items.splice(0, remove);
        count -= remove;
        changed.add(name);
      }
      for (const [, row] of chats) {
        const retained = /* @__PURE__ */ new Set([...row.data.items.map((m) => m.id), ...row.data.deleted]);
        for (const id of row.versions.keys()) if (!retained.has(id)) row.versions.delete(id);
      }
      for (const name of changed) {
        const row = ctx.records.get(name);
        if (row) row.size = encoder.encode(JSON.stringify({ data: row.data, updated: row.updated })).byteLength;
      }
      let total = [...ctx.records.values()].reduce((n, r) => n + r.size, 0);
      const ordered = [...ctx.records].sort((a, b) => Number(!a[0].startsWith("messages:")) - Number(!b[0].startsWith("messages:")) || a[1].updated - b[1].updated);
      for (const [name, row] of ordered) if (total > policy.bytes) {
        ctx.records.delete(name);
        changed.add(name);
        total -= row.size;
      }
    }
    async function flush(ctx, changed) {
      prune(ctx, changed);
      const writes = [];
      for (const name of changed) {
        const row = ctx.records.get(name), id = JSON.stringify([ctx.scope, name]);
        if (!row) {
          writes.push({ id });
          continue;
        }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(ctx.scope + "\n" + name) }, ctx.key, encoder.encode(JSON.stringify({ data: row.data, updated: row.updated })));
        writes.push({ id, scope: ctx.scope, name, iv, cipher, expires: row.updated + limits(ctx).days * 864e5 });
      }
      if (!writes.length || !alive(ctx)) return;
      await transaction(["cache"], "readwrite", (stores) => {
        if (!alive(ctx)) return;
        for (const row of writes) if (row.cipher) stores.cache.put(row);
        else stores.cache.delete(row.id);
      });
    }
    function merge(ctx, cid, items, ticket, changed, checked) {
      const name = "messages:" + cid, row = record(ctx, name, { items: [], deleted: [] }), map = new Map(row.data.items.map((m) => [m.id, m])), deleted = new Set(row.data.deleted);
      const returned = new Set(items.map((m) => m.id));
      if (checked) {
        for (const id of checked) if (!returned.has(id) && (row.versions.get(id) || 0) <= ticket) {
          map.delete(id);
          deleted.add(id);
          row.versions.set(id, ticket);
        }
      }
      for (const message of items) {
        if (message.conversationId !== cid || deleted.has(message.id) || (row.versions.get(message.id) || 0) > ticket) continue;
        if (map.get(message.id)?.recalled && !message.recalled) continue;
        map.set(message.id, clone(message));
        row.versions.set(message.id, ticket);
      }
      row.data = { items: [...map.values()].sort((a, b) => a.seq - b.seq), deleted: [...deleted].slice(-limits(ctx).messages) };
      row.updated = Date.now();
      changed.add(name);
      const conversations = ctx.records.get("/api/conversations");
      for (const conversation of conversations?.data || []) {
        if (conversation.id !== cid || !conversation.last) continue;
        if (deleted.has(conversation.last.id)) conversation.last = row.data.items[row.data.items.length - 1] || null;
        else if (map.has(conversation.last.id)) conversation.last = clone(map.get(conversation.last.id));
        conversations.revision = Math.max(conversations.revision, ticket);
        changed.add("/api/conversations");
      }
    }
    async function remember(ctx, info, value, ticket) {
      return serial2(ctx, async () => {
        const changed = /* @__PURE__ */ new Set();
        let result = value;
        if (info.messages) {
          merge(ctx, info.cid, value, ticket, changed);
          const row = ctx.records.get(info.name), returned = new Set(value.map((m) => m.id));
          const candidates = row.data.items.filter((m) => returned.has(m.id) || (row.versions.get(m.id) || 0) > ticket), around = info.url.searchParams.get("around");
          result = around && !candidates.some((m) => m.id === around) ? [] : selectMessages(ctx, info, candidates);
        } else {
          const row = record(ctx, info.name, value);
          if (row.revision > ticket) return clone(row.data);
          row.data = clone(value);
          row.revision = ticket;
          row.updated = Date.now();
          changed.add(info.name);
          if (info.name === "/api/conversations") {
            const ids = new Set(value.map((c) => c.id));
            for (const name of ctx.records.keys()) if (name.startsWith("messages:") && !ids.has(name.slice(9)) || /^\/api\/conversations\/[a-f0-9]{32}$/.test(name) && !ids.has(name.slice(19))) {
              ctx.records.delete(name);
              changed.add(name);
            }
          }
        }
        await flush(ctx, changed);
        return result;
      });
    }
    function selectMessages(ctx, info, source) {
      const row = ctx.records.get(info.name);
      if (!row) return void 0;
      const q = info.url.searchParams;
      let items = (source || row.data.items).slice();
      const around = q.get("around");
      if (around) {
        const at = items.findIndex((m) => m.id === around);
        if (at < 0) throw Error("本机尚未缓存这条消息，请联网后查看");
        items = items.slice(Math.max(0, at - 30), at + 31);
      }
      const text = (q.get("q") || "").trim().toLowerCase(), kind = q.get("kind"), sender = q.get("sender"), before = Number(q.get("before") || Infinity), after = Number(q.get("after") || 0), from = Number(q.get("from") || 0), to = Number(q.get("to") || Infinity), user = ctx.records.get("/api/me")?.data?.id;
      items = items.filter((m) => m.seq < before && m.seq > after && m.created >= from && m.created < to && (!text || !m.recalled && (m.text + " " + (m.fileName || "")).toLowerCase().includes(text)) && (!kind || !m.recalled && m.kind === kind) && (!sender || m.sender === sender) && (!q.get("mentions") || !m.recalled && (m.mentionRecipients || []).includes(user)));
      return clone(around ? items : after ? items.slice(0, 60) : items.slice(-60));
    }
    async function cached(ctx, info) {
      return serial2(ctx, async () => {
        await flush(ctx, /* @__PURE__ */ new Set());
        const data = info.messages ? selectMessages(ctx, info) : ctx.records.get(info.name)?.data;
        return data === void 0 ? void 0 : clone(data);
      });
    }
    async function dropConversation(ctx, cid) {
      return serial2(ctx, async () => {
        const changed = /* @__PURE__ */ new Set(["messages:" + cid, "/api/conversations/" + cid]);
        for (const name of changed) ctx.records.delete(name);
        const row = ctx.records.get("/api/conversations");
        if (row) {
          row.data = row.data.filter((c) => c.id !== cid);
          changed.add("/api/conversations");
        }
        await flush(ctx, changed);
      });
    }
    async function run(path, options, network) {
      const method = options.method || "GET", info = method === "GET" ? classify(path) : null, sent = method === "POST" && /^\/api\/conversations\/[a-f0-9]{32}\/messages$/.test(path) ? classify(path) : null, ctx = info || sent ? await context() : null, ticket = ctx ? ++ctx.revision : 0;
      let timer;
      try {
        const request = network().then(async (value) => {
          if (ctx && alive(ctx)) try {
            if (sent) {
              await serial2(ctx, async () => {
                const changed = /* @__PURE__ */ new Set();
                merge(ctx, sent.cid, [value], ticket, changed);
                await flush(ctx, changed);
              });
            } else {
              const canonical = await remember(ctx, info, value, ticket);
              if (canonical !== void 0) return canonical;
            }
          } catch {
            warning(ctx);
          }
          return value;
        });
        if (!ctx || !info || !ctx.records.has(info.name) || options.signal) return await request;
        return await Promise.race([request, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(Error("连接暂时不可用"), { status: 504 })), S2.cacheView ? 0 : 6e3);
        })]);
      } catch (error) {
        if (error.status === 401 && current === ctx) await forget();
        if (ctx && info && alive(ctx)) {
          if (error.status === 404 && info.messages && info.url.searchParams.get("around")) await event("message-deleted", { id: info.url.searchParams.get("around"), conversationId: info.cid }).catch(() => {
          });
          else if ((error.status === 403 || error.status === 404) && info.cid) await dropConversation(ctx, info.cid).catch(() => {
          });
          if (temporary(error)) {
            const value = await cached(ctx, info).catch(() => void 0);
            if (value !== void 0 && alive(ctx)) {
              S2.offline = true;
              S2.cacheView = true;
              connectionState2();
              if (info.name === "/api/friends") return value.map((u) => ({ ...u, online: false }));
              if (info.name === "/api/conversations") return value.map((c) => ({ ...c, ...c.peer ? { peer: { ...c.peer, online: false } } : {} }));
              return value;
            }
          }
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    async function identified(user) {
      const ctx = await context();
      if (ctx) {
        await remember(ctx, { name: "/api/me" }, user, ++ctx.revision).catch(() => warning(ctx));
        await remember(ctx, { name: "/api/public-config" }, { registrationEnabled: S2.registrationEnabled }, ++ctx.revision).catch(() => warning(ctx));
      }
    }
    async function event(type, message) {
      const ctx = await context();
      if (!ctx || !alive(ctx) || !message?.conversationId) return;
      const ticket = ++ctx.revision;
      await serial2(ctx, async () => {
        const changed = /* @__PURE__ */ new Set();
        merge(ctx, message.conversationId, type === "message-deleted" ? [] : [message], ticket, changed, type === "message-deleted" ? [message.id] : null);
        if (type === "recall") {
          for (const [name, row] of ctx.records) if (name.startsWith("messages:")) {
            for (const item of row.data.items) if (item.reply?.id === message.id) {
              item.reply = { ...item.reply, text: "", fileName: "", recalled: true };
              row.versions.set(item.id, ticket);
              changed.add(name);
            }
          }
        }
        if (type === "recall") {
          const row = ctx.records.get("/api/conversations");
          for (const c of row?.data || []) if (c.last?.reply?.id === message.id) {
            c.last.reply = { ...c.last.reply, text: "", fileName: "", recalled: true };
            row.revision = Math.max(row.revision, ticket);
            changed.add("/api/conversations");
          }
        }
        await flush(ctx, changed);
      });
    }
    async function reconcile(network) {
      const ctx = await context();
      if (!ctx || !alive(ctx)) return;
      await ctx.chain;
      const batches = [...ctx.records].filter(([name]) => name.startsWith("messages:")).map(([name, row]) => ({ cid: name.slice(9), ids: row.data.items.map((m) => m.id) }));
      for (const { cid, ids } of batches) {
        let denied = false;
        for (let at = 0; at < ids.length; at += 200) {
          if (!alive(ctx)) return;
          const checked = ids.slice(at, at + 200), ticket = ++ctx.revision;
          try {
            const items = await network("/api/conversations/" + cid + "/messages/sync", { method: "POST", body: { ids: checked } });
            await serial2(ctx, async () => {
              const changed = /* @__PURE__ */ new Set();
              merge(ctx, cid, items, ticket, changed, checked);
              await flush(ctx, changed);
            });
          } catch (error) {
            if ([403, 404, 405].includes(error.status)) {
              denied = true;
              await dropConversation(ctx, cid);
              break;
            }
            throw error;
          }
        }
        if (alive(ctx)) onReconciled(cid, clone(ctx.records.get("messages:" + cid)?.data.items || []), ids, denied);
      }
    }
    async function forget() {
      const ctx = current;
      current = null;
      if (!ctx) return;
      ctx.dead = true;
      await ctx.ready;
      await ctx.chain.catch(() => {
      });
      if (ctx.scope) await transaction(["cache"], "readwrite", (stores) => {
        const request = stores.cache.index("scope").openCursor(ctx.scope);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }).catch(() => {
      });
      ctx.records.clear();
    }
    async function show() {
      const ctx = await context();
      if (!ctx) {
        toast2("此设备暂不支持加密聊天缓存");
        return;
      }
      await ctx.chain;
      const count = [...ctx.records].filter(([name]) => name.startsWith("messages:")).reduce((n, [, r]) => n + r.data.items.length, 0), size = [...ctx.records.values()].reduce((n, r) => n + r.size, 0), policy = limits(ctx);
      modal2("本机聊天缓存", `<p>已缓存 <b>${count}</b> 条消息 · ${esc4(bytes2(size))}</p><p class="hint">断网时可查看本机已加载的聊天记录。图片、语音、视频和文件内容仍需联网打开。</p><p class="hint">当前上限 ${policy.messages} 条消息、${esc4(bytes2(policy.bytes))}，保留 ${policy.days} 天。缓存与此服务器和登录会话绑定，退出登录会清除；不会删除服务器记录、草稿或待发送消息。</p>`, '<button class="secondary" data-action="close-modal">关闭</button><button class="primary" id="clear-received-cache">清理本机缓存</button>');
      document.querySelector("#clear-received-cache").onclick = async () => {
        await forget();
        closeModal2();
        toast2("本机聊天缓存已清理，服务器记录仍保留");
      };
    }
    document.addEventListener("click", (event2) => {
      if (event2.target.closest("[data-received-cache]")) show().catch(() => toast2("无法读取本机聊天缓存"));
    });
    return { run, identified, event, reconcile, forget, settingsRow: () => '<div class="prefs-row"><span>本机聊天缓存</span><button class="secondary" data-received-cache>管理</button></div>' };
  }

  // internal/ui/src/mentions.js
  function createMentions({ S: S2, api: api2, esc: esc4, av: av2, toast: toast2, jump }) {
    const $2 = (s) => document.querySelector(s), drafts = /* @__PURE__ */ new Map();
    let popup = null, revision = 0, pending = null, cache = null;
    const group = () => S2.conversations.find((c) => c.id === S2.active)?.kind === "group";
    const input = () => $2("#composer");
    function state() {
      const cid = S2.active, text2 = input()?.value || "";
      if (!drafts.has(cid)) drafts.set(cid, { text: text2, spans: [] });
      return drafts.get(cid);
    }
    function reconcile() {
      const d = state(), text2 = input()?.value || "";
      if (text2 === d.text) return d;
      let left = 0;
      while (left < text2.length && left < d.text.length && text2[left] === d.text[left]) left++;
      let oldEnd = d.text.length, newEnd = text2.length;
      while (oldEnd > left && newEnd > left && d.text[oldEnd - 1] === text2[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      const delta = newEnd - oldEnd;
      d.spans = d.spans.reduce((kept, m) => {
        if (m.end <= left) kept.push(m);
        else if (m.start >= oldEnd) kept.push({ ...m, start: m.start + delta, end: m.end + delta });
        return kept;
      }, []);
      d.text = text2;
      return d;
    }
    function hide() {
      revision++;
      popup = null;
      $2("#mention-picker")?.remove();
      input()?.setAttribute("aria-expanded", "false");
      input()?.removeAttribute("aria-activedescendant");
    }
    async function members() {
      if (cache?.cid === S2.active && Date.now() - cache.at < 1e4) return cache.value;
      const cid = S2.active, value = await api2("/api/conversations/" + cid);
      if (cid === S2.active) cache = { cid, at: Date.now(), value };
      return value;
    }
    function render() {
      const p = popup;
      if (!p) return;
      $2("#mention-picker")?.remove();
      const node = document.createElement("div");
      node.id = "mention-picker";
      node.className = "mention-picker";
      node.setAttribute("role", "listbox");
      node.setAttribute("aria-label", "选择要提醒的成员");
      node.innerHTML = '<div class="mention-picker-title">选择要提醒的成员</div>' + p.items.map((u, i) => `<button type="button" id="mention-option-${i}" role="option" aria-selected="${i === p.index}" data-mention-index="${i}" class="${i === p.index ? "selected" : ""}">${u.id === "all" ? '<span class="mention-all-avatar">@</span>' : av2(u)}<span><b>${esc4(u.nickname || u.name)}</b><small>${u.id === "all" ? "提醒群内所有成员" : esc4(u.number)}</small></span></button>`).join("") + (p.items.length ? "" : '<p class="hint">没有找到成员</p>');
      node.onpointerdown = (e) => e.preventDefault();
      node.onclick = (e) => {
        const b = e.target.closest("[data-mention-index]");
        if (b) choose(p.items[Number(b.dataset.mentionIndex)]);
      };
      $2(".composer")?.append(node);
      input()?.setAttribute("aria-expanded", "true");
      if (p.items.length) {
        input()?.setAttribute("aria-activedescendant", "mention-option-" + p.index);
        node.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
      }
    }
    async function show(start, end, query = "") {
      if (!group() || input()?.disabled) return;
      const request = ++revision, cid = S2.active;
      try {
        const c = await members();
        if (request !== revision || cid !== S2.active || !input()) return;
        const q = query.toLocaleLowerCase();
        const all = c.group?.role === "owner" || c.group?.role === "admin";
        let users = c.members.filter((u) => u.id !== S2.user.id);
        if (all) users.unshift({ id: "all", name: "全体成员" });
        users = users.filter((u) => [u.name, u.nickname, u.number].some((v) => (v || "").toLocaleLowerCase().includes(q)));
        popup = { start, end, items: users, index: 0 };
        render();
      } catch (e) {
        if (request === revision) {
          hide();
          toast2(e.message);
        }
      }
    }
    function changed() {
      reconcile();
      if (!group() || input()?.disabled) {
        hide();
        return;
      }
      const el = input(), caret = el.selectionStart;
      if (caret !== el.selectionEnd) {
        hide();
        return;
      }
      const d = state();
      if (d.spans.some((m) => m.start < caret && m.end >= caret)) {
        hide();
        return;
      }
      const match = el.value.slice(0, caret).match(/@([^@\s]{0,32})$/u);
      if (match) show(caret - match[0].length, caret, match[1]);
      else hide();
    }
    function choose(user) {
      const el = input(), p = popup;
      if (!el || !p || !user) return;
      const label = "@" + (user.nickname || user.name), start = p.start, end = p.end;
      el.value = el.value.slice(0, start) + label + " " + el.value.slice(end);
      reconcile();
      state().spans.push({ userId: user.id, start, end: start + label.length });
      state().spans.sort((a, b) => a.start - b.start);
      hide();
      el.focus();
      el.setSelectionRange(start + label.length + 1, start + label.length + 1);
      el.oninput?.();
      hide();
    }
    function key(e) {
      if (!popup || e.isComposing) return false;
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        if (popup.items.length) popup.index = (popup.index + (e.key === "ArrowDown" ? 1 : -1) + popup.items.length) % popup.items.length;
        render();
        return true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        choose(popup.items[popup.index]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return true;
      }
      return false;
    }
    function open2() {
      const el = input();
      if (!el || el.disabled) return;
      show(el.selectionStart, el.selectionEnd);
    }
    async function mentionUser(id) {
      try {
        const c = await members(), u = c.members.find((u2) => u2.id === id);
        if (!u) throw Error("该成员已离开群聊");
        const el = input();
        if (!el || el.disabled) return;
        popup = { start: el.selectionStart, end: el.selectionEnd, items: [u], index: 0 };
        choose(u);
      } catch (e) {
        toast2(e.message);
      }
    }
    function text(m) {
      if (!m.mentions?.length) return esc4(m.text);
      let at = 0, out = "";
      for (const span of m.mentions) {
        if (span.start < at || span.end > m.text.length) continue;
        out += esc4(m.text.slice(at, span.start)) + `<span class="message-mention">${esc4(m.text.slice(span.start, span.end))}</span>`;
        at = span.end;
      }
      return out + esc4(m.text.slice(at));
    }
    function applies(m) {
      return m.sender !== S2.user?.id && !m.recalled && (m.mentionRecipients || []).includes(S2.user?.id);
    }
    function mount() {
      hide();
      reconcile();
      const el = input();
      el?.setAttribute("aria-controls", "mention-picker");
      el?.addEventListener("compositionend", () => changed());
      const target = $2("#mention-jump");
      if (target && pending?.cid === S2.active) {
        target.innerHTML = '<button data-mention="jump">有人 @我 · 查看消息 ↑</button>';
      }
    }
    function select(cid) {
      hide();
      cache = null;
      const c = S2.conversations.find((x) => x.id === cid);
      pending = c?.firstMentionId ? { cid, id: c.firstMentionId } : null;
    }
    function clear(cid) {
      drafts.delete(cid);
      hide();
    }
    function reset() {
      drafts.clear();
      pending = null;
      cache = null;
      hide();
    }
    function invalidated(id) {
      if (pending?.id === id) {
        pending = null;
        $2("#mention-jump")?.replaceChildren();
      }
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mention],[data-mention-user]");
      if (b) {
        if (b.dataset.mention === "open") open2();
        if (b.dataset.mentionUser) mentionUser(b.dataset.mentionUser);
        if (b.dataset.mention === "jump" && pending) {
          const p = pending;
          pending = null;
          $2("#mention-jump")?.replaceChildren();
          jump(p.cid, p.id).catch((e2) => toast2(e2.message));
        }
      } else if (!e.target.closest("#mention-picker,#composer")) hide();
    });
    return { restore: (cid, text2, spans = []) => drafts.set(cid, { text: text2, spans: spans.map((m) => ({ ...m })) }), changed, key, mount, select, clear, reset, invalidated, text, applies, failed: () => {
      cache = null;
    }, payload: () => reconcile().spans, tool: () => group() ? '<button type="button" class="icon-btn mention-tool" title="@成员" aria-label="@成员" data-mention="open">@</button>' : "", menu: (m) => group() && m.sender !== S2.user.id ? `<button data-mention-user="${m.sender}">@TA</button>` : "" };
  }

  // internal/ui/src/attachments.js
  function createAttachments({ S: S2, esc: esc4, icon: icon2, bytes: bytes2, toast: toast2 }) {
    const $2 = (s) => document.querySelector(s), pending = /* @__PURE__ */ new Map(), limit = 20;
    let next = 0;
    const list = (cid) => pending.get(cid) || [];
    const picture = (file) => /^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type);
    const video = (file) => /^video\//.test(file.type) || /\.(mp4|webm|m4v|mov)$/i.test(file.name);
    const release = (items) => {
      for (const item2 of items) if (item2.url) URL.revokeObjectURL(item2.url);
    };
    function add(files, cid = S2.active) {
      files = [...files].filter(Boolean);
      if (!cid || !files.length) return 0;
      const box = $2(".composer");
      if (cid === S2.active && box && (box.classList.contains("group-muted") || box.classList.contains("contact-unavailable"))) {
        toast2("当前聊天无法发送文件");
        return 0;
      }
      const items = list(cid).slice();
      let added = 0;
      for (const file of files) {
        if (items.length >= limit) {
          toast2(`一次最多添加 ${limit} 个文件`);
          break;
        }
        items.push({ id: ++next, file, url: picture(file) ? URL.createObjectURL(file) : "" });
        added++;
      }
      pending.set(cid, items);
      if (cid === S2.active) {
        render();
        $2("#composer")?.focus();
      }
      return added;
    }
    function remove(id) {
      const cid = S2.active, items = list(cid), gone = items.filter((item2) => item2.id === id);
      release(gone);
      const kept = items.filter((item2) => item2.id !== id);
      if (kept.length) pending.set(cid, kept);
      else pending.delete(cid);
      render();
      $2("#composer")?.focus();
    }
    function take(cid) {
      const items = list(cid);
      pending.delete(cid);
      if (cid === S2.active) render();
      return items;
    }
    function sync() {
      const button = $2("#send-message"), input = $2("#composer");
      if (button && input) button.disabled = !input.value.trim() && !list(S2.active).length;
    }
    function item(entry) {
      const { file } = entry, name = esc4(file.name || "未命名文件");
      const body = entry.url ? `<img src="${entry.url}" alt="">` : `<span class="attach-icon">${icon2(video(file) ? "video" : "file")}</span><span class="attach-meta"><b>${name}</b><small>${bytes2(file.size)}</small></span>`;
      return `<div class="attach-item${entry.url ? " is-image" : ""}" title="${name} · ${bytes2(file.size)}">${body}<button type="button" class="attach-remove" data-attach-remove="${entry.id}" aria-label="移除 ${name}">×</button></div>`;
    }
    function render() {
      const tray = $2("#attach-draft");
      if (!tray) return;
      const items = list(S2.active);
      tray.classList.toggle("hidden", !items.length);
      tray.closest(".composer")?.classList.toggle("has-attachments", items.length > 0);
      tray.innerHTML = items.length ? items.map(item).join("") + `<span class="attach-hint">${items.length} 个待发送，按发送一起发出</span>` : "";
      tray.onclick = (e) => {
        const b = e.target.closest("[data-attach-remove]");
        if (b) remove(Number(b.dataset.attachRemove));
      };
      sync();
    }
    function reset() {
      for (const items of pending.values()) release(items);
      pending.clear();
      render();
    }
    return { add, take, release, render, sync, reset, count: (cid) => list(cid).length };
  }

  // internal/ui/src/receipts.js
  function createReceipts({ S: S2, api: api2, esc: esc4, av: av2, modal: modal2 }) {
    const $2 = (s) => document.querySelector(s);
    let state = { cid: "", members: /* @__PURE__ */ new Map() }, loading = 0, frame = 0;
    const conversation = (cid) => S2.conversations.find((c) => c.id === cid);
    const applies = (cid) => {
      const c = conversation(cid);
      return !!c && !c.peer?.ai;
    };
    function audience(m) {
      if (state.cid !== m.conversationId || !m.seq) return null;
      return [...state.members.values()].filter((x) => x.joined < m.seq);
    }
    function counts(m) {
      const people = audience(m);
      if (!people?.length) return null;
      const unread = people.filter((x) => x.seq < m.seq);
      return { people, unread, read: people.filter((x) => x.seq >= m.seq) };
    }
    function text(m) {
      const c = counts(m);
      if (!c) return null;
      const direct = conversation(m.conversationId)?.kind === "direct";
      if (direct) return { label: c.unread.length ? "未读" : "已读", done: !c.unread.length };
      return { label: c.unread.length ? `${c.unread.length} 人未读` : "全部已读", done: !c.unread.length };
    }
    function label(m) {
      if (m.sender !== S2.user?.id || m.recalled || !m.seq) return "";
      const t = text(m);
      const group = conversation(m.conversationId)?.kind === "group";
      return `<button type="button" class="receipt${t?.done ? " done" : ""}${t ? "" : " hidden"}" data-receipt="${esc4(m.id)}" data-seq="${m.seq}" ${group ? "" : 'tabindex="-1"'}>${t ? esc4(t.label) : ""}</button>`;
    }
    function paint() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const node of document.querySelectorAll("#messages .receipt[data-receipt]")) {
          const m = S2.messages.find((x) => x.id === node.dataset.receipt);
          if (!m) continue;
          const t = text(m);
          node.classList.toggle("hidden", !t);
          node.classList.toggle("done", !!t?.done);
          if (t && node.textContent !== t.label) node.textContent = t.label;
        }
      });
    }
    async function load(cid = S2.active) {
      if (!cid || !applies(cid)) {
        if (state.cid !== cid) state = { cid: "", members: /* @__PURE__ */ new Map() };
        return;
      }
      const ticket = ++loading;
      try {
        const list = await api2("/api/conversations/" + cid + "/reads");
        if (ticket !== loading || S2.active !== cid) return;
        state = { cid, members: new Map(list.map((x) => [x.userId, x])) };
        paint();
      } catch {
      }
    }
    function event(d) {
      if (!d || d.conversationId !== state.cid) return;
      const member = state.members.get(d.userId);
      if (!member) {
        if (d.userId !== S2.user?.id) load(state.cid);
        return;
      }
      if (d.seq > member.seq) {
        member.seq = d.seq;
        paint();
      }
    }
    function row(x) {
      return `<div class="receipt-person">${av2({ id: x.userId, name: x.name, avatar: x.avatar })}<span>${esc4(x.name)}</span></div>`;
    }
    function open2(id) {
      const m = S2.messages.find((x) => x.id === id);
      if (!m || conversation(m.conversationId)?.kind !== "group") return;
      const c = counts(m);
      if (!c) return;
      const column = (title, people, empty2) => `<section><h4>${title} · ${people.length}</h4>${people.length ? people.map(row).join("") : `<p class="hint">${empty2}</p>`}</section>`;
      modal2("消息接收人", `<div class="receipt-lists">${column("未读", c.unread, "全部已读")}${column("已读", c.read, "暂时还没有人读")}</div>`, '<button class="primary" data-action="close-modal">知道了</button>');
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest("#messages .receipt[data-receipt]");
      if (b) {
        e.preventDefault();
        open2(b.dataset.receipt);
      }
    });
    return { label, load, event, paint, reset() {
      loading++;
      state = { cid: "", members: /* @__PURE__ */ new Map() };
    } };
  }

  // internal/ui/src/dialogs.js
  var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function open({ title, message, input, ok, cancel, danger }) {
    return new Promise((resolve) => {
      const layer = document.createElement("div");
      layer.className = "lm-dialog-layer";
      layer.innerHTML = `<div class="lm-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">${title ? `<h3>${esc(title)}</h3>` : ""}${message ? `<p>${esc(message).replace(/\n/g, "<br>")}</p>` : ""}${input ? `<input class="lm-dialog-input" maxlength="${input.max || 200}" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value || "")}">` : ""}<div class="lm-dialog-actions"><button class="secondary" data-dialog="cancel">${esc(cancel || "取消")}</button><button class="primary${danger ? " danger-fill" : ""}" data-dialog="ok">${esc(ok || "确定")}</button></div></div>`;
      document.body.append(layer);
      const field = layer.querySelector(".lm-dialog-input"), okBtn = layer.querySelector("[data-dialog=ok]");
      const done = (value) => {
        document.removeEventListener("keydown", key, true);
        layer.remove();
        resolve(value);
      };
      const accept = () => done(input ? field.value : true), reject = () => done(input ? null : false);
      const key = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          reject();
        } else if (e.key === "Enter" && !e.isComposing && (document.activeElement === field || document.activeElement === okBtn || !input)) {
          e.preventDefault();
          e.stopPropagation();
          accept();
        }
      };
      document.addEventListener("keydown", key, true);
      layer.addEventListener("mousedown", (e) => {
        if (e.target === layer) reject();
      });
      okBtn.onclick = accept;
      layer.querySelector("[data-dialog=cancel]").onclick = reject;
      setTimeout(() => {
        if (field) {
          field.focus();
          field.select();
        } else okBtn.focus();
      }, 0);
    });
  }
  var confirmDialog = (message, options = {}) => open({ title: options.title || "请确认", message, ok: options.ok, cancel: options.cancel, danger: options.danger });
  var inputDialog = (message, options = {}) => open({ title: options.title || message, message: options.title ? message : "", input: { value: options.value, placeholder: options.placeholder, max: options.max }, ok: options.ok, cancel: options.cancel });

  // internal/ui/src/docs-text.js
  var chars = (s) => Array.from(s);
  function splice(a, b) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let ea = a.length, eb = b.length;
    while (ea > p && eb > p && a[ea - 1] === b[eb - 1]) {
      ea--;
      eb--;
    }
    return { pos: p, del: ea - p, ins: b.slice(p, eb) };
  }
  function mergeText(base, mine, theirs) {
    if (mine === base || theirs === mine) return theirs;
    if (theirs === base) return mine;
    const b = chars(base), m = chars(mine), t = chars(theirs), d1 = splice(b, m), d2 = splice(b, t);
    const startAt = (p) => p < d2.pos ? p : p >= d2.pos + d2.del ? p + d2.ins.length - d2.del : d2.pos + d2.ins.length;
    const endAt = (p) => p < d2.pos ? p : p <= d2.pos + d2.del ? d2.pos : p + d2.ins.length - d2.del;
    let start = startAt(d1.pos), end = endAt(d1.pos + d1.del);
    if (end < start) end = start;
    const keep = d2.ins.length && d2.pos >= start && d2.pos + d2.ins.length <= end ? t.slice(d2.pos, d2.pos + d2.ins.length) : [];
    return [...t.slice(0, start), ...d1.ins, ...keep, ...t.slice(end)].join("");
  }
  function shiftOffset(old, next, offset) {
    const a = chars(old), b = chars(next), d = splice(a, b);
    if (offset <= d.pos) return offset;
    if (offset >= d.pos + d.del) return offset + d.ins.length - d.del;
    return d.pos + d.ins.length;
  }
  var same = (a, b) => a.b === b.b && a.i === b.i && a.s === b.s && a.u === b.u && a.code === b.code && a.link === b.link;
  var plainMark = (r) => ({ b: !!r.b, i: !!r.i, s: !!r.s, u: !!r.u, code: !!r.code, link: r.link || "" });
  function runs(md) {
    const out = [];
    let cur = "", st = { b: false, i: false, s: false, u: false, code: false, link: "" };
    const emit = () => {
      if (cur) {
        out.push({ ...st, text: cur });
        cur = "";
      }
    };
    for (let i = 0; i < md.length; ) {
      const rest = md.slice(i);
      if (rest[0] === "\\" && rest.length > 1 && "\\*_`~[]()<>#|-".includes(rest[1])) {
        cur += rest[1];
        i += 2;
        continue;
      }
      if (st.code) {
        if (rest[0] === "`") {
          emit();
          st.code = false;
          i++;
        } else {
          cur += rest[0];
          i++;
        }
        continue;
      }
      if (rest[0] === "`" && rest.indexOf("`", 1) > 0) {
        emit();
        st.code = true;
        i++;
        continue;
      }
      if (rest.startsWith("**")) {
        emit();
        st.b = !st.b;
        i += 2;
        continue;
      }
      if (rest.startsWith("~~")) {
        emit();
        st.s = !st.s;
        i += 2;
        continue;
      }
      if (rest.startsWith("<u>")) {
        emit();
        st.u = true;
        i += 3;
        continue;
      }
      if (rest.startsWith("</u>")) {
        emit();
        st.u = false;
        i += 4;
        continue;
      }
      if (rest[0] === "*") {
        emit();
        st.i = !st.i;
        i++;
        continue;
      }
      if (rest[0] === "[") {
        const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
        if (m) {
          emit();
          for (const r of runs(m[1])) out.push({ ...r, b: r.b || st.b, i: r.i || st.i, s: r.s || st.s, u: r.u || st.u, link: m[2] });
          i += m[0].length;
          continue;
        }
      }
      cur += rest[0];
      i++;
    }
    emit();
    return out;
  }
  var escapeMd = (t) => t.replace(/[\\*`~\[\]<]/g, (c) => "\\" + c);
  function toMarkdown(list) {
    const merged = [];
    for (const r of list) {
      if (!r.text) continue;
      const last = merged[merged.length - 1];
      if (last && same(last, r)) last.text += r.text;
      else merged.push({ ...plainMark(r), text: r.text });
    }
    let out = "";
    for (const r of merged) {
      let text = r.code ? "`" + r.text.replace(/`/g, "'") + "`" : escapeMd(r.text);
      const lead = text.length - text.replace(/^[ \n]+/, "").length, trail = text.length - text.replace(/[ \n]+$/, "").length;
      if (lead === text.length) {
        out += text;
        continue;
      }
      let core = text.slice(lead, text.length - trail);
      if (r.i) core = "*" + core + "*";
      if (r.b) core = "**" + core + "**";
      if (r.s) core = "~~" + core + "~~";
      if (r.u) core = "<u>" + core + "</u>";
      if (r.link) core = "[" + core + "](" + r.link.replace(/\)/g, "%29") + ")";
      out += text.slice(0, lead) + core + text.slice(text.length - trail);
    }
    return out;
  }
  var plain = (md) => runs(md).map((r) => r.text).join("");
  var esc2 = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var safeLink = (u) => /^(https?:|mailto:)/i.test(u) ? u : /^www\./i.test(u) ? "https://" + u : "";
  function toHTML(md) {
    return runs(md).map((r) => {
      let h = esc2(r.text).replace(/\n/g, "<br>");
      if (r.code) h = "<code>" + h + "</code>";
      if (r.b) h = "<b>" + h + "</b>";
      if (r.i) h = "<i>" + h + "</i>";
      if (r.s) h = "<s>" + h + "</s>";
      if (r.u) h = "<u>" + h + "</u>";
      if (r.link) {
        const href = safeLink(r.link);
        h = href ? `<a href="${esc2(href)}" data-href="${esc2(r.link)}" target="_blank" rel="noopener noreferrer">${h}</a>` : `<a data-href="${esc2(r.link)}" class="unsafe-link" title="不支持的链接">${h}</a>`;
      }
      return h;
    }).join("") || "";
  }
  function domRuns(root) {
    const out = [];
    const walk = (node, st) => {
      if (node.nodeType === 3) {
        if (node.data) out.push({ ...st, text: node.data.replace(/\u200b/g, "") });
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === "BR") {
        if (node.nextSibling || node.parentNode !== root) out.push({ ...st, text: "\n" });
        return;
      }
      if (node.dataset?.skip != null) return;
      const s = { ...st }, style = node.style || {};
      if (tag === "B" || tag === "STRONG" || +style.fontWeight >= 600 || style.fontWeight === "bold") s.b = true;
      if (tag === "I" || tag === "EM" || style.fontStyle === "italic") s.i = true;
      if (tag === "S" || tag === "STRIKE" || tag === "DEL" || /line-through/.test(style.textDecoration || "")) s.s = true;
      if (tag === "U" || /underline/.test(style.textDecoration || "")) s.u = true;
      if (tag === "CODE") s.code = true;
      if (tag === "A") s.link = node.dataset.href || node.getAttribute("href") || "";
      const block = (tag === "DIV" || tag === "P") && node !== root;
      if (block && out.length && !out[out.length - 1].text.endsWith("\n")) out.push({ ...st, text: "\n" });
      for (const c of node.childNodes) walk(c, s);
    };
    for (const c of root.childNodes) walk(c, { b: false, i: false, s: false, u: false, code: false, link: "" });
    return out;
  }
  var domMarkdown = (el) => toMarkdown(domRuns(el));
  function caretOffset(el, node, offset) {
    const r = document.createRange();
    r.selectNodeContents(el);
    try {
      r.setEnd(node, offset);
    } catch {
      return 0;
    }
    const frag = r.cloneContents(), box = document.createElement("div");
    box.append(frag);
    return chars(domRuns(box).map((x) => x.text).join("")).length;
  }
  function placeCaret(el, offset, focus = true) {
    const sel = getSelection();
    if (!sel) return;
    let left = offset;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node, target = null, at = 0;
    while (node = walker.nextNode()) {
      if (node.nodeType === 3) {
        const len = chars(node.data).length;
        if (left <= len) {
          target = node;
          at = chars(node.data).slice(0, left).join("").length;
          break;
        }
        left -= len;
      } else if (node.tagName === "BR") {
        if (left === 0) {
          target = node.parentNode;
          at = [...node.parentNode.childNodes].indexOf(node);
          break;
        }
        left -= 1;
      }
    }
    const r = document.createRange();
    if (target) r.setStart(target, at);
    else {
      r.selectNodeContents(el);
      r.collapse(false);
    }
    r.collapse(true);
    if (focus && document.activeElement !== el.closest("[contenteditable=true]")) el.closest("[contenteditable=true]")?.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function sliceRuns(list, from, to = Infinity) {
    const out = [];
    let pos = 0;
    for (const r of list) {
      const t = chars(r.text), s = Math.max(0, from - pos), e = Math.min(t.length, to - pos);
      if (e > s) out.push({ ...r, text: t.slice(s, e).join("") });
      pos += t.length;
    }
    return out;
  }
  function toggleMark(md, from, to, mark, value = true) {
    const list = runs(md), inside = sliceRuns(list, from, to);
    const on = mark === "link" ? !!value : !inside.length || !inside.every((r) => r[mark]);
    const changed = inside.map((r) => ({ ...r, [mark]: mark === "link" ? value || "" : on }));
    return toMarkdown([...sliceRuns(list, 0, from), ...changed, ...sliceRuns(list, to)]);
  }
  function markdownBlocks(src, id) {
    const lines = src.replace(/\r\n?/g, "\n").split("\n"), out = [];
    let para = [];
    const add = (type, text, extra = {}) => out.push({ id: id(), type, text, ...extra });
    const flush = () => {
      if (para.length) {
        add("p", para.join("\n"));
        para = [];
      }
    };
    const row = (l) => l.trim().replace(/^\||\|$/g, "").split(new RegExp("(?<!\\\\)\\|")).map((c) => c.trim().replace(/\\\|/g, "|"));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], t = line.trim();
      let m;
      if (/^(```|~~~)/.test(t)) {
        flush();
        const fence = t.slice(0, 3), lang = t.slice(3).trim(), code = [];
        for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) code.push(lines[i]);
        add("code", code.join("\n"), { lang });
      } else if (!t) flush();
      else if (m = /^(#{1,6})\s+(.*)$/.exec(t)) {
        flush();
        add("h" + Math.min(3, m[1].length), m[2].replace(/\s*#+$/, ""));
      } else if (/^([-*_])(\s*[-*_]){2,}$/.test(t)) {
        flush();
        add("divider", "");
      } else if (m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)) {
        flush();
        add("todo", m[2], { checked: m[1] !== " " });
      } else if (m = /^\s*[-*+]\s+(.*)$/.exec(line)) {
        flush();
        add("bullet", m[1]);
      } else if (m = /^\s*\d+[.)]\s+(.*)$/.exec(line)) {
        flush();
        add("ordered", m[1]);
      } else if (t.startsWith(">")) {
        flush();
        const q = [];
        for (; i < lines.length && lines[i].trim().startsWith(">"); i++) q.push(lines[i].trim().replace(/^>\s?/, ""));
        i--;
        add("quote", q.join("\n"));
      } else if (t.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
        flush();
        const rows = [row(line)];
        for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(row(lines[i]));
        i--;
        add("table", "", { rows });
      } else para.push(line.replace(/\s+$/, ""));
    }
    flush();
    return out;
  }
  function blocksMarkdown(blocks) {
    let n = 0;
    return blocks.map((b) => {
      n = b.type === "ordered" ? n + 1 : 0;
      switch (b.type) {
        case "h1":
          return "# " + b.text;
        case "h2":
          return "## " + b.text;
        case "h3":
          return "### " + b.text;
        case "bullet":
          return "- " + b.text;
        case "ordered":
          return n + ". " + b.text;
        case "todo":
          return `- [${b.checked ? "x" : " "}] ` + b.text;
        case "quote":
          return "> " + b.text.replace(/\n/g, "\n> ");
        case "code":
          return "```" + (b.lang || "") + "\n" + b.text + "\n```";
        case "divider":
          return "---";
        case "table":
          return (b.rows || []).map((r, i) => "| " + r.join(" | ") + " |" + (i === 0 ? "\n|" + " --- |".repeat(r.length) : "")).join("\n");
        default:
          return b.text;
      }
    }).join("\n\n");
  }
  function replyHTML(md) {
    const inline = (t) => toHTML(t.replace(/(^|[^\\])_([^_]+)_/g, "$1*$2*"));
    return markdownBlocks(md || "", () => "").map((b) => {
      switch (b.type) {
        case "h1":
        case "h2":
        case "h3":
          return `<h4>${inline(b.text)}</h4>`;
        case "bullet":
        case "todo":
          return `<li>${inline(b.text)}</li>`;
        case "ordered":
          return `<li class="num">${inline(b.text)}</li>`;
        case "code":
          return `<pre>${esc2(b.text)}</pre>`;
        case "quote":
          return `<blockquote>${inline(b.text)}</blockquote>`;
        case "divider":
          return "<hr>";
        case "table":
          return "<table>" + (b.rows || []).map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</table>";
        default:
          return `<p>${inline(b.text)}</p>`;
      }
    }).join("").replace(/(<li( class="num")?>[\s\S]*?<\/li>)+/g, (m) => m.includes('class="num"') ? `<ol>${m}</ol>` : `<ul>${m}</ul>`);
  }

  // internal/ui/src/doc-editor.js
  var TYPES = [["p", "正文", "T"], ["h1", "一级标题", "H1"], ["h2", "二级标题", "H2"], ["h3", "三级标题", "H3"], ["bullet", "无序列表", "•"], ["ordered", "有序列表", "1."], ["todo", "待办事项", "☐"], ["quote", "引用", "❝"], ["code", "代码块", "</>"], ["divider", "分割线", "—"], ["table", "表格", "▦"]];
  var TEXTUAL = /* @__PURE__ */ new Set(["p", "h1", "h2", "h3", "bullet", "ordered", "todo", "quote", "code"]);
  var LISTS = /* @__PURE__ */ new Set(["bullet", "ordered", "todo"]);
  var PALETTE = ["#3370ff", "#f54a45", "#ff8800", "#2ea121", "#7f3bf5", "#00a3a3", "#d136a2", "#8f959e"];
  var peerColor = (id) => {
    let h = 0;
    for (const c of id || "") h = h * 31 + c.charCodeAt(0) >>> 0;
    return PALETTE[h % PALETTE.length];
  };
  function createDocEditor({ mount, outline, content, editable, newId, onChange, onWhere, toast: toast2, esc: esc4, askAI }) {
    const conf = /* @__PURE__ */ new Map(), els = /* @__PURE__ */ new Map(), dirty = /* @__PURE__ */ new Set(), inflight = /* @__PURE__ */ new Map(), localOnly = /* @__PURE__ */ new Set();
    let pending = [], canEdit = editable, menu = null, bar = null, composing = false, whereTimer = 0, lastWhere = "", peers = [], outlineTimer = 0;
    const undo = [], redo = [];
    let burst = null;
    const root = document.createElement("div");
    root.className = "doc-blocks";
    root.spellcheck = true;
    mount.append(root);
    const textEl = (id) => els.get(id)?.querySelector(":scope > .blk-text");
    const typeOf = (id) => els.get(id)?.dataset.type;
    const domOrder = () => [...root.children].map((e) => e.dataset.id).filter(Boolean);
    function localText(id) {
      const t = textEl(id);
      if (!t) return conf.get(id)?.text ?? "";
      return typeOf(id) === "code" ? domRuns(t).map((r) => r.text).join("") : domMarkdown(t);
    }
    const blockOf = (node) => {
      const el = (node?.nodeType === 1 ? node : node?.parentElement)?.closest(".blk");
      return el && el.parentElement === root ? el : null;
    };
    const prevId = (id) => {
      const el = els.get(id)?.previousElementSibling;
      return el?.dataset.id || "";
    };
    const nextId = (id) => els.get(id)?.nextElementSibling?.dataset.id || "";
    function snapshot(id) {
      const c = conf.get(id) || {};
      const el = els.get(id);
      return { id, type: el?.dataset.type || c.type, text: localText(id), checked: el?.dataset.checked === "1", lang: c.lang || "", rows: c.rows ? JSON.parse(JSON.stringify(c.rows)) : void 0 };
    }
    const queue = (op) => {
      pending.push(op);
      onChange();
    };
    const touch = (id) => {
      dirty.add(id);
      onChange();
    };
    function marker(b) {
      if (b.type === "bullet") return '<span class="blk-mark" contenteditable="false">•</span>';
      if (b.type === "ordered") return '<span class="blk-mark num" contenteditable="false">1.</span>';
      if (b.type === "todo") return `<span class="blk-mark" contenteditable="false"><input type="checkbox" class="blk-check" ${b.checked ? "checked" : ""} ${canEdit ? "" : "disabled"} aria-label="完成"></span>`;
      return "";
    }
    function tableHTML(b) {
      const rows = b.rows?.length ? b.rows : [["", ""], ["", ""]];
      const cols = Math.max(...rows.map((r) => r.length), 1);
      return `<div class="blk-table-wrap"><table class="blk-table"><tbody>${rows.map((r, i) => `<tr>${Array.from({ length: cols }, (_, j) => `<td contenteditable="${canEdit}" data-r="${i}" data-c="${j}">${esc4(r[j] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>${canEdit ? '<div class="blk-table-tools"><button data-table="row">+ 行</button><button data-table="col">+ 列</button><button data-table="-row">− 行</button><button data-table="-col">− 列</button></div>' : ""}</div>`;
    }
    function build(b) {
      const el = document.createElement("div");
      el.className = "blk";
      el.dataset.id = b.id;
      el.dataset.type = b.type;
      el.dataset.checked = b.checked ? "1" : "0";
      const handle = canEdit ? `<span class="blk-gutter" contenteditable="false"><button class="blk-handle" draggable="true" title="拖动或点击" aria-label="段落操作">⋮⋮</button></span>` : "";
      if (b.type === "divider") {
        el.contentEditable = "false";
        el.innerHTML = handle + "<hr>";
      } else if (b.type === "table") {
        el.contentEditable = "false";
        el.innerHTML = handle + tableHTML(b);
      } else if (b.type === "code") {
        el.innerHTML = `${handle}<pre class="blk-text" spellcheck="false"></pre>`;
        el.querySelector(".blk-text").textContent = b.text || "";
      } else {
        el.innerHTML = `${handle}${marker(b)}<div class="blk-text" data-placeholder="${b.type === "p" ? "输入“/”快速插入内容" : TYPES.find((t) => t[0] === b.type)?.[1] || ""}"></div>`;
        el.querySelector(".blk-text").innerHTML = toHTML(b.text || "");
      }
      els.set(b.id, el);
      return el;
    }
    function setText(id, md) {
      const t = textEl(id);
      if (!t) return;
      const had = t.contains(getSelection()?.anchorNode);
      let off = 0, old = "";
      if (had) {
        off = caretOffset(t, getSelection().anchorNode, getSelection().anchorOffset);
        old = typeOf(id) === "code" ? localText(id) : plain(localText(id));
      }
      if (typeOf(id) === "code") t.textContent = md;
      else t.innerHTML = toHTML(md);
      if (conf.get(id)) conf.get(id).lastLocal = md;
      if (had) placeCaret(t, shiftOffset(old, typeOf(id) === "code" ? md : plain(md), off));
    }
    function rebuild(id, b) {
      const old = els.get(id);
      if (!old) return;
      const t = textEl(id), sel = getSelection();
      let off = -1;
      if (t && sel?.anchorNode && t.contains(sel.anchorNode)) off = caretOffset(t, sel.anchorNode, sel.anchorOffset);
      const el = build(b);
      old.replaceWith(el);
      renumber();
      if (off >= 0 && textEl(id)) placeCaret(textEl(id), off);
    }
    function renumber() {
      let n = 0;
      for (const el of root.children) {
        if (el.dataset.type === "ordered") {
          n++;
          const m = el.querySelector(".blk-mark");
          if (m) m.textContent = n + ".";
        } else n = 0;
      }
      scheduleOutline();
    }
    function render(blocks) {
      root.textContent = "";
      els.clear();
      conf.clear();
      for (const b of blocks) {
        conf.set(b.id, { ...b });
        root.append(build(b));
      }
      renumber();
      paintPeers();
    }
    function scheduleOutline() {
      clearTimeout(outlineTimer);
      outlineTimer = setTimeout(drawOutline, 120);
    }
    function drawOutline() {
      if (!outline) return;
      const heads = [...root.children].filter((e) => /^h[123]$/.test(e.dataset.type));
      outline.innerHTML = heads.length ? "<h5>目录</h5>" + heads.map((e) => `<button class="lvl-${e.dataset.type}" data-outline="${e.dataset.id}">${esc4(plain(localText(e.dataset.id)) || "无标题")}</button>`).join("") : "";
    }
    function record(group) {
      if (!group.length) return;
      undo.push(group);
      if (undo.length > 200) undo.shift();
      redo.length = 0;
    }
    function insertBlock(b, after, { focus = true, history = true, caret = 0 } = {}) {
      const el = build(b);
      const ref = after ? els.get(after) : null;
      if (after === "") {
        root.prepend(el);
      } else if (ref) ref.after(el);
      else root.append(el);
      conf.set(b.id, { ...b });
      localOnly.add(b.id);
      queue({ op: "insert", after: after || "", block: { ...b } });
      renumber();
      if (history) record([{ kind: "insert", id: b.id }]);
      if (focus && textEl(b.id)) placeCaret(textEl(b.id), caret);
      return b.id;
    }
    function removeBlock(id, { history = true } = {}) {
      const el = els.get(id);
      if (!el) return;
      const snap = snapshot(id), after = prevId(id);
      el.remove();
      els.delete(id);
      dirty.delete(id);
      queue({ op: "delete", id });
      renumber();
      if (history) record([{ kind: "delete", block: snap, after }]);
      if (!root.children.length) insertBlock({ id: newId(), type: "p", text: "" }, "", { history: false });
    }
    function setType(id, type, extra = {}) {
      const b = snapshot(id);
      if (b.type === type && !Object.keys(extra).length) return;
      const before = { type: b.type, checked: b.checked, lang: b.lang, rows: b.rows };
      let text = b.text;
      if (type === "code" && b.type !== "code") text = plain(b.text);
      if (b.type === "code" && type !== "code") text = toMarkdown([{ text: b.text }]);
      const next = { ...b, type, text, ...extra };
      if (type !== "todo") next.checked = false;
      if (type === "table" && !next.rows) next.rows = [["", ""], ["", ""]];
      rebuild(id, next);
      queue({ op: "block", block: { id, type, checked: !!next.checked, lang: next.lang || "", rows: type === "table" ? next.rows : void 0 } });
      if (text !== b.text) {
        touch(id);
      }
      record([{ kind: "attrs", id, before, after: { type, checked: !!next.checked, lang: next.lang || "", rows: next.rows } }]);
    }
    function textChanged(id) {
      const now = localText(id), c = conf.get(id), before = c?.lastLocal ?? c?.text ?? "", g = undo[undo.length - 1];
      if (burst && burst.id === id && Date.now() - burst.at < 1200 && g && g[0] === burst.entry) {
        burst.entry._a = now;
        burst.at = Date.now();
      } else {
        const entry = { kind: "text", id, _b: before, _a: now };
        record([entry]);
        burst = { id, at: Date.now(), entry };
      }
      if (c) c.lastLocal = now;
      touch(id);
      scheduleOutline();
    }
    function writeText(id, md, { history = true, caret } = {}) {
      const before = localText(id);
      if (before === md) return;
      const t = textEl(id);
      if (!t) return;
      if (typeOf(id) === "code") t.textContent = md;
      else t.innerHTML = toHTML(md);
      if (caret !== void 0) placeCaret(t, caret);
      if (history) record([{ kind: "text", id, _b: before, _a: md }]);
      if (conf.get(id)) conf.get(id).lastLocal = md;
      touch(id);
      scheduleOutline();
    }
    function revert(group, dir) {
      const list = dir === "undo" ? [...group].reverse() : group;
      for (const c of list) {
        if (c.kind === "text") {
          if (!els.has(c.id)) continue;
          const cur = localText(c.id), from = dir === "undo" ? c._a : c._b, to = dir === "undo" ? c._b : c._a;
          writeText(c.id, mergeText(from, to, cur), { history: false });
          const t = textEl(c.id);
          if (t) placeCaret(t, (typeOf(c.id) === "code" ? to : plain(to)).length);
        } else if (c.kind === "insert") {
          if (dir === "undo") removeBlock(c.id, { history: false });
          else if (c.block) insertBlock(c.block, c.after, { history: false });
        } else if (c.kind === "delete") {
          if (dir === "undo") {
            if (!els.has(c.block.id)) insertBlock(c.block, c.after && els.has(c.after) ? c.after : "", { history: false });
          } else removeBlock(c.block.id, { history: false });
        } else if (c.kind === "move") {
          if (els.has(c.id)) moveRaw(c.id, dir === "undo" ? c.from : c.to);
        } else if (c.kind === "attrs") {
          if (!els.has(c.id)) continue;
          const a = dir === "undo" ? c.before : c.after;
          const b = snapshot(c.id);
          rebuild(c.id, { ...b, ...a });
          queue({ op: "block", block: { id: c.id, type: a.type, checked: !!a.checked, lang: a.lang || "", rows: a.type === "table" ? a.rows : void 0 } });
        }
      }
    }
    const remember = (group) => group.map((c) => c.kind === "insert" && els.has(c.id) ? { ...c, block: snapshot(c.id), after: prevId(c.id) } : c);
    function doUndo() {
      const g = undo.pop();
      if (!g) return;
      burst = null;
      const full = remember(g);
      revert(full, "undo");
      redo.push(full);
    }
    function doRedo() {
      const g = redo.pop();
      if (!g) return;
      burst = null;
      revert(g, "redo");
      undo.push(g);
    }
    function point(node, offset) {
      const el = blockOf(node);
      if (!el) return null;
      const id = el.dataset.id, t = textEl(id);
      if (!t || !t.contains(node) && t !== node) {
        const pos = node === el ? offset : 0;
        return { id, off: pos > 0 && t ? plain(localText(id)).length : 0, atom: !t };
      }
      return { id, off: caretOffset(t, node, offset) };
    }
    function range() {
      const sel = getSelection();
      if (!sel?.rangeCount || !root.contains(sel.anchorNode)) return null;
      const r = sel.getRangeAt(0);
      const a = point(r.startContainer, r.startOffset), b = point(r.endContainer, r.endOffset);
      if (!a || !b) return null;
      return { start: a, end: b, collapsed: r.collapsed, single: a.id === b.id };
    }
    function selectedIds() {
      const r = range();
      if (!r) return [];
      const ids = domOrder();
      const i = ids.indexOf(r.start.id), j = ids.indexOf(r.end.id);
      return i < 0 || j < 0 ? [] : ids.slice(i, j + 1);
    }
    function deleteRange(r) {
      const ids = domOrder(), i = ids.indexOf(r.start.id), j = ids.indexOf(r.end.id);
      if (r.single) {
        const id = r.start.id;
        if (!textEl(id)) return { id, off: 0 };
        const md = localText(id);
        const code = typeOf(id) === "code";
        const next = code ? [...md].slice(0, r.start.off).join("") + [...md].slice(r.end.off).join("") : toMarkdown([...sliceRuns(runs(md), 0, r.start.off), ...sliceRuns(runs(md), r.end.off)]);
        writeText(id, next, { caret: r.start.off });
        return { id, off: r.start.off };
      }
      const first = ids[i], last = ids[j];
      const group = [];
      const head = textEl(first) ? sliceRuns(runs(localText(first)), 0, r.start.off) : null, tail = textEl(last) ? sliceRuns(runs(localText(last)), r.end.off) : [];
      for (const id of ids.slice(i + 1, j + 1)) {
        group.push({ kind: "delete", block: snapshot(id), after: prevId(id) });
        const el = els.get(id);
        el.remove();
        els.delete(id);
        dirty.delete(id);
        queue({ op: "delete", id });
      }
      if (head) {
        const before = localText(first), md = toMarkdown([...head, ...tail]);
        writeText(first, md, { history: false, caret: r.start.off });
        group.unshift({ kind: "text", id: first, _b: before, _a: md });
        record(group);
        renumber();
        return { id: first, off: r.start.off };
      }
      group.unshift({ kind: "delete", block: snapshot(first), after: prevId(first) });
      const keep = prevId(first);
      els.get(first).remove();
      els.delete(first);
      queue({ op: "delete", id: first });
      record(group);
      renumber();
      if (!root.children.length) insertBlock({ id: newId(), type: "p", text: "" }, "", { history: false });
      const target = keep && els.has(keep) ? keep : root.firstElementChild.dataset.id;
      if (textEl(target)) placeCaret(textEl(target), plain(localText(target)).length);
      return { id: target, off: 0 };
    }
    function split(id, off) {
      const type = typeOf(id), md = localText(id), code = type === "code";
      if (code) {
        insertAt(id, off, "\n", true);
        return;
      }
      const list = runs(md), textLen = plain(md).length;
      if (LISTS.has(type) || type === "quote") {
        if (!textLen) {
          setType(id, "p");
          return;
        }
      }
      const nextType = LISTS.has(type) ? type : "p";
      if (off === 0 && textLen) {
        const nb2 = { id: newId(), type: /^h[123]$/.test(type) ? "p" : nextType, text: "" };
        insertBlock(nb2, prevId(id), { focus: false });
        placeCaret(textEl(id), 0);
        return;
      }
      const before = toMarkdown(sliceRuns(list, 0, off)), after = toMarkdown(sliceRuns(list, off));
      writeText(id, before, { history: false });
      const nb = { id: newId(), type: nextType, text: after };
      insertBlock(nb, id, { history: false, caret: 0 });
      record([{ kind: "text", id, _b: md, _a: before }, { kind: "insert", id: nb.id }]);
    }
    function insertAt(id, off, text, raw = false) {
      const md = localText(id);
      if (typeOf(id) === "code") {
        const c = [...md];
        writeText(id, c.slice(0, off).join("") + text + c.slice(off).join(""), { caret: off + [...text].length });
        return;
      }
      const add = raw ? [{ text }] : runs(text);
      const list = runs(md);
      writeText(id, toMarkdown([...sliceRuns(list, 0, off), ...add, ...sliceRuns(list, off)]), { caret: off + [...add.map((r) => r.text).join("")].length });
    }
    function mergeBack(id) {
      const type = typeOf(id);
      if (type !== "p" && type !== "code" && TEXTUAL.has(type)) {
        setType(id, "p");
        return true;
      }
      if (type === "code" && localText(id) === "") {
        setType(id, "p");
        return true;
      }
      const prev = prevId(id);
      if (!prev) return false;
      const pt = typeOf(prev);
      if (pt === "divider") {
        removeBlock(prev);
        return true;
      }
      if (!textEl(prev)) {
        return true;
      }
      const a = localText(prev), b = localText(id), joined = pt === "code" ? a + plain(b) : toMarkdown([...runs(a), ...runs(b)]);
      const at = pt === "code" ? [...a].length : plain(a).length;
      const snap = snapshot(id);
      writeText(prev, joined, { history: false, caret: at });
      els.get(id).remove();
      els.delete(id);
      dirty.delete(id);
      queue({ op: "delete", id });
      renumber();
      record([{ kind: "text", id: prev, _b: a, _a: joined }, { kind: "delete", block: snap, after: prev }]);
      placeCaret(textEl(prev), at);
      return true;
    }
    function mergeForward(id) {
      const next = nextId(id);
      if (!next) return false;
      if (!textEl(next)) {
        if (typeOf(next) === "divider") removeBlock(next);
        return true;
      }
      placeCaret(textEl(next), 0);
      return mergeBack(next);
    }
    let typing = null;
    function typeWithMarks(id, off, text) {
      const list = runs(localText(id)), at = sliceRuns(list, off - 1, off)[0] || {};
      const marks = { b: !!at.b, i: !!at.i, s: !!at.s, u: !!at.u, code: !!at.code, link: at.link || "", ...typing.marks };
      writeText(id, toMarkdown([...sliceRuns(list, 0, off), { ...marks, text }, ...sliceRuns(list, off)]), { caret: off + [...text].length });
      typing.off = off + [...text].length;
    }
    function markSelection(mark, value) {
      const r0 = range();
      if (r0 && r0.collapsed && r0.single && textEl(r0.start.id) && typeOf(r0.start.id) !== "code" && mark !== "link") {
        const cur = sliceRuns(runs(localText(r0.start.id)), r0.start.off - 1, r0.start.off)[0] || {};
        const base = typing && typing.id === r0.start.id && typing.off === r0.start.off ? typing.marks : {};
        typing = { id: r0.start.id, off: r0.start.off, marks: { ...base, [mark]: !(mark in base ? base[mark] : cur[mark]) } };
        return;
      }
      const r = range();
      if (!r || r.collapsed || !r.single || typeOf(r.start.id) === "code" || !textEl(r.start.id)) return;
      const id = r.start.id, md = localText(id), next = toggleMark(md, r.start.off, r.end.off, mark, value);
      writeText(id, next);
      selectText(id, r.start.off, r.end.off);
      showBar();
    }
    function selectText(id, a, b) {
      const t = textEl(id);
      placeCaret(t, a);
      const s = getSelection(), start = s.getRangeAt(0).cloneRange();
      placeCaret(t, b);
      const e = s.getRangeAt(0);
      const rr = document.createRange();
      rr.setStart(start.startContainer, start.startOffset);
      rr.setEnd(e.endContainer, e.endOffset);
      s.removeAllRanges();
      s.addRange(rr);
    }
    function paste(text, r) {
      const pos = r.collapsed ? r.start : deleteRange(r);
      const id = pos.id;
      if (!textEl(id)) return;
      if (typeOf(id) === "code") {
        insertAt(id, pos.off, text, true);
        return;
      }
      const lines = text.replace(/\r\n?/g, "\n");
      if (!lines.includes("\n")) {
        insertAt(id, pos.off, lines);
        return;
      }
      const blocks = markdownBlocks(lines, newId);
      if (!blocks.length) return;
      const md = localText(id), list = runs(md), before = sliceRuns(list, 0, pos.off), after = toMarkdown(sliceRuns(list, pos.off));
      const group = [];
      let first = 0;
      if (blocks[0].type === "p") {
        const joined = toMarkdown([...before, ...runs(blocks[0].text)]);
        writeText(id, joined, { history: false });
        group.push({ kind: "text", id, _b: md, _a: joined });
        first = 1;
      } else {
        const cut = toMarkdown(before);
        writeText(id, cut, { history: false });
        group.push({ kind: "text", id, _b: md, _a: cut });
      }
      let at = id;
      for (const b of blocks.slice(first)) {
        insertBlock(b, at, { focus: false, history: false });
        group.push({ kind: "insert", id: b.id });
        at = b.id;
      }
      const last = at;
      if (after) {
        if (textEl(last) && typeOf(last) !== "code") {
          const end = plain(localText(last)).length;
          writeText(last, toMarkdown([...runs(localText(last)), ...runs(after)]), { history: false, caret: end });
        } else {
          const nb = { id: newId(), type: "p", text: after };
          insertBlock(nb, last, { history: false });
          group.push({ kind: "insert", id: nb.id });
        }
      }
      record(group);
      const t = textEl(last) || textEl(id);
      if (t && !after) placeCaret(t, (typeOf(last) === "code" ? localText(last) : plain(localText(last))).length);
    }
    function closeMenu() {
      menu?.el.remove();
      menu = null;
    }
    function openMenu(id, off) {
      closeMenu();
      const el = document.createElement("div");
      el.className = "doc-slash";
      el.setAttribute("role", "listbox");
      document.body.append(el);
      menu = { el, id, start: off, index: 0, items: [] };
      drawMenu("");
      const rect = getSelection().getRangeAt(0).getBoundingClientRect();
      const top = Math.min(rect.bottom + 6, innerHeight - 320);
      el.style.left = Math.min(rect.left, innerWidth - 230) + "px";
      el.style.top = Math.max(8, top) + "px";
    }
    function drawMenu(q) {
      if (!menu) return;
      menu.q = q;
      const query = q.trim().toLowerCase();
      menu.items = TYPES.filter(([t, label, short]) => !query || label.includes(query) || t.includes(query) || short.toLowerCase().includes(query) || ({ p: "zw text", h1: "bt1 title", h2: "bt2", h3: "bt3", bullet: "lb list wx", ordered: "yx num", todo: "db rw task", quote: "yy", code: "dm", divider: "fgx line hr", table: "bg table" }[t] || "").includes(query));
      menu.index = Math.min(menu.index, Math.max(0, menu.items.length - 1));
      menu.el.innerHTML = menu.items.length ? menu.items.map(([t, label, short], i) => `<button role="option" class="${i === menu.index ? "active" : ""}" data-slash="${t}"><span>${esc4(short)}</span>${label}</button>`).join("") : "<p>没有匹配的内容</p>";
    }
    function chooseMenu(type) {
      if (!menu) return;
      const { id, start } = menu;
      closeMenu();
      const t = textEl(id);
      if (!t) return;
      const md = localText(id), list = runs(md), end = caretOffset(t, getSelection().anchorNode, getSelection().anchorOffset);
      const rest = toMarkdown([...sliceRuns(list, 0, start - 1), ...sliceRuns(list, Math.max(end, start))]);
      writeText(id, rest, { caret: start - 1 });
      if (type === "divider" || type === "table") {
        const empty2 = !plain(rest).trim(), nb = { id: newId(), type, text: "", rows: type === "table" ? [["", "", ""], ["", "", ""], ["", "", ""]] : void 0 };
        insertBlock(nb, id, { focus: false });
        if (empty2) removeBlock(id);
        if (type === "divider") insertBlock({ id: newId(), type: "p", text: "" }, nb.id);
        else els.get(nb.id)?.querySelector("td")?.focus();
        return;
      }
      if (!plain(rest).trim()) setType(id, type);
      else {
        insertBlock({ id: newId(), type, text: "" }, id);
      }
    }
    function showBar() {
      const sel = getSelection(), r = range();
      if (!canEdit || !r || r.collapsed || !sel.rangeCount) {
        bar?.remove();
        bar = null;
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        bar?.remove();
        bar = null;
        return;
      }
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "doc-toolbar";
        bar.addEventListener("mousedown", (e) => e.preventDefault());
        document.body.append(bar);
      }
      const inline = r.single && typeOf(r.start.id) !== "code" && textEl(r.start.id);
      bar.innerHTML = (inline ? [["b", "<b>B</b>", "粗体 Ctrl+B"], ["i", "<i>I</i>", "斜体 Ctrl+I"], ["s", "<s>S</s>", "删除线"], ["u", "<u>U</u>", "下划线 Ctrl+U"], ["code", "&lt;/&gt;", "行内代码 Ctrl+E"], ["link", "🔗", "链接 Ctrl+K"]].map(([m, l, t]) => `<button data-mark="${m}" title="${t}">${l}</button>`).join("") + '<span class="sep"></span>' : "") + [["h1", "H1"], ["h2", "H2"], ["h3", "H3"], ["bullet", "•"], ["ordered", "1."], ["todo", "☐"]].map(([t, l]) => `<button data-turn="${t}" title="${TYPES.find((x) => x[0] === t)[1]}">${l}</button>`).join("") + (askAI ? '<span class="sep"></span><button data-bar-ai class="ai">✦ AI</button>' : "");
      const w = bar.offsetWidth || 360;
      bar.style.left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + "px";
      bar.style.top = Math.max(8, rect.top - 46) + "px";
    }
    async function linkPrompt() {
      const r = range();
      if (!r || r.collapsed || !r.single) return;
      const current = runs(localText(r.start.id));
      const has = sliceRuns(current, r.start.off, r.end.off).find((x) => x.link)?.link || "";
      const url = await inputDialog("留空则移除链接", { title: "链接地址", value: has || "https://", placeholder: "https://" });
      if (url === null) return;
      selectText(r.start.id, r.start.off, r.end.off);
      const clean = url.trim();
      if (clean && !/^(https?:\/\/|mailto:|www\.)/i.test(clean)) {
        toast2("请输入以 http:// 或 https:// 开头的链接");
        return;
      }
      markSelection("link", clean === "" || clean === "https://" ? "" : clean);
    }
    let composeFrom = null;
    root.addEventListener("compositionstart", () => {
      composing = true;
      const r = range();
      composeFrom = r && r.collapsed && typing && typing.id === r.start.id && typing.off === r.start.off ? { ...typing } : null;
    });
    root.addEventListener("compositionend", () => {
      composing = false;
      afterInput();
      const r = range();
      if (composeFrom && r && r.collapsed && r.start.id === composeFrom.id && r.start.off > composeFrom.off) {
        const id = r.start.id, list = runs(localText(id)), typed = sliceRuns(list, composeFrom.off, r.start.off).map((x) => ({ ...x, ...composeFrom.marks }));
        writeText(id, toMarkdown([...sliceRuns(list, 0, composeFrom.off), ...typed, ...sliceRuns(list, r.start.off)]), { caret: r.start.off });
        typing = { ...composeFrom, off: r.start.off };
      }
      composeFrom = null;
    });
    root.addEventListener("beforeinput", (e) => {
      if (!canEdit) {
        e.preventDefault();
        return;
      }
      const cell = e.target.closest?.("td");
      if (cell) {
        if (e.inputType === "insertParagraph" || e.inputType === "insertFromPaste" && /\n/.test(e.dataTransfer?.getData("text/plain") || "")) e.preventDefault();
        return;
      }
      const r = range();
      if (!r) {
        e.preventDefault();
        return;
      }
      const type = e.inputType;
      if (type === "historyUndo") {
        e.preventDefault();
        doUndo();
        return;
      }
      if (type === "historyRedo") {
        e.preventDefault();
        doRedo();
        return;
      }
      if (type.startsWith("format")) {
        e.preventDefault();
        const m = { formatBold: "b", formatItalic: "i", formatUnderline: "u", formatStrikeThrough: "s" }[type];
        if (m) markSelection(m);
        return;
      }
      if (type === "insertFromDrop" || type === "deleteByDrag") {
        e.preventDefault();
        return;
      }
      if (type === "insertFromPaste" || type === "insertReplacementText" && !r.single) {
        return;
      }
      if (type === "insertParagraph") {
        e.preventDefault();
        const p = r.collapsed ? r.start : deleteRange(r);
        if (textEl(p.id)) split(p.id, p.off);
        return;
      }
      if (type === "insertLineBreak") {
        e.preventDefault();
        const p = r.collapsed ? r.start : deleteRange(r);
        if (textEl(p.id)) insertAt(p.id, p.off, "\n", true);
        return;
      }
      if (!r.single || r.start.atom || r.end.atom) {
        if (type.startsWith("delete")) {
          e.preventDefault();
          if (!r.collapsed) deleteRange(r);
          return;
        }
        if (type === "insertText" && e.data) {
          e.preventDefault();
          const p = deleteRange(r);
          if (textEl(p.id)) insertAt(p.id, p.off, e.data, true);
          return;
        }
        e.preventDefault();
        return;
      }
      if (type === "insertText" && e.data && r.collapsed && typing && typing.id === r.start.id && typing.off === r.start.off) {
        e.preventDefault();
        typeWithMarks(r.start.id, r.start.off, e.data);
        return;
      }
      if (r.collapsed && (type === "deleteContentBackward" || type === "deleteWordBackward" || type === "deleteSoftLineBackward") && r.start.off === 0) {
        e.preventDefault();
        mergeBack(r.start.id);
        return;
      }
      if (r.collapsed && (type === "deleteContentForward" || type === "deleteWordForward") && r.start.off === (typeOf(r.start.id) === "code" ? [...localText(r.start.id)].length : plain(localText(r.start.id)).length)) {
        e.preventDefault();
        mergeForward(r.start.id);
        return;
      }
    });
    function afterInput() {
      if (composing) return;
      const sel = getSelection();
      const el = blockOf(sel?.anchorNode);
      for (const node of [...root.childNodes]) if (!(node.nodeType === 1 && node.classList.contains("blk"))) {
        node.remove();
      }
      if (!el) return;
      const id = el.dataset.id, t = textEl(id);
      if (!t) return;
      for (const stray of [...el.childNodes]) if (stray.nodeType === 3 && stray.data.trim()) {
        t.append(stray);
      }
      textChanged(id);
      const off = caretOffset(t, sel.anchorNode, sel.anchorOffset), txt = plain(localText(id));
      if (typeOf(id) === "p") {
        const rules = [[/^#\s/, "h1"], [/^##\s/, "h2"], [/^###\s/, "h3"], [/^[-*+]\s/, "bullet"], [/^1[.)]\s/, "ordered"], [/^(\[\s?\]|【\s?】)\s/, "todo"], [/^>\s/, "quote"], [/^```$/, "code"], [/^---$/, "divider"]];
        for (const [re, type] of rules) {
          const m = re.exec(txt);
          if (m && off === m[0].length) {
            const rest = toMarkdown(sliceRuns(runs(localText(id)), m[0].length));
            writeText(id, rest, { history: false });
            if (type === "divider") {
              setType(id, "divider");
              const nb = { id: newId(), type: "p", text: "" };
              insertBlock(nb, id);
            } else {
              setType(id, type);
              placeCaret(textEl(id), 0);
            }
            return;
          }
        }
      }
      if (menu && menu.id === id) {
        const q = [...txt].slice(menu.start, off).join("");
        if (off < menu.start || /\s/.test(q) || q.length > 12) closeMenu();
        else drawMenu(q);
      } else if (txt[off - 1] === "/" && (off === 1 || /\s/.test(txt[off - 2])) && typeOf(id) !== "code") openMenu(id, off);
    }
    root.addEventListener("input", (e) => {
      const cell = e.target.closest?.("td");
      if (cell) {
        tableEdited(cell);
        return;
      }
      afterInput();
    });
    root.addEventListener("paste", (e) => {
      if (!canEdit) {
        e.preventDefault();
        return;
      }
      if (e.target.closest?.("td")) {
        e.preventDefault();
        const t = (e.clipboardData.getData("text/plain") || "").replace(/\s*\n\s*/g, " ");
        document.execCommand("insertText", false, t);
        return;
      }
      e.preventDefault();
      const r = range();
      if (!r) return;
      if ([...e.clipboardData?.files || []].length && !e.clipboardData.getData("text/plain")) {
        toast2("文档暂不支持粘贴图片，可以把图片发到聊天或网盘");
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (text) paste(text, r);
    });
    function copySelection(e, cut) {
      const r = range();
      if (!r || r.collapsed || r.single) return;
      e.preventDefault();
      const ids = domOrder(), i = ids.indexOf(r.start.id), j = ids.indexOf(r.end.id);
      const blocks = ids.slice(i, j + 1).map((id, k) => {
        const b = snapshot(id);
        if (textEl(id) && b.type !== "code") {
          const list = runs(b.text);
          b.text = toMarkdown(sliceRuns(list, k === 0 ? r.start.off : 0, k === j - i ? r.end.off : Infinity));
        }
        return b;
      });
      e.clipboardData.setData("text/plain", blocksMarkdown(blocks));
      const box = document.createElement("div");
      box.append(getSelection().getRangeAt(0).cloneContents());
      box.querySelectorAll("[contenteditable=false] .blk-gutter,.blk-gutter,.blk-peer").forEach((n) => n.remove());
      e.clipboardData.setData("text/html", box.innerHTML);
      if (cut && canEdit) deleteRange(r);
    }
    root.addEventListener("copy", (e) => copySelection(e, false));
    root.addEventListener("cut", (e) => {
      if (!canEdit) {
        e.preventDefault();
        return;
      }
      copySelection(e, true);
    });
    root.addEventListener("keydown", (e) => {
      if (menu) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          menu.index = (menu.index + (e.key === "ArrowDown" ? 1 : -1) + menu.items.length) % Math.max(1, menu.items.length);
          drawMenu(menu.q || "");
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          if (menu.items.length) {
            e.preventDefault();
            chooseMenu(menu.items[menu.index][0]);
            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeMenu();
          return;
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          doUndo();
          return;
        }
        if (k === "y" || k === "z" && e.shiftKey) {
          e.preventDefault();
          doRedo();
          return;
        }
        if (!canEdit) return;
        if (k === "b" || k === "i" || k === "u") {
          e.preventDefault();
          markSelection(k);
          return;
        }
        if (k === "e") {
          e.preventDefault();
          markSelection("code");
          return;
        }
        if (k === "x" && e.shiftKey) {
          e.preventDefault();
          markSelection("s");
          return;
        }
        if (k === "k") {
          e.preventDefault();
          linkPrompt();
          return;
        }
        if (k === "s") {
          e.preventDefault();
          toast2("文档会自动保存");
          return;
        }
        if (k === "enter") {
          const r = range();
          if (r?.collapsed && typeOf(r.start.id) === "code") {
            e.preventDefault();
            insertBlock({ id: newId(), type: "p", text: "" }, r.start.id);
          }
          return;
        }
      }
      if (mod && e.altKey && /^[0-3]$/.test(e.key) && canEdit) {
        e.preventDefault();
        const r = range();
        if (r) {
          for (const id of selectedIds()) if (TEXTUAL.has(typeOf(id))) setType(id, e.key === "0" ? "p" : "h" + e.key);
        }
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !e.shiftKey && !mod) {
        const r = range();
        if (!r || !r.collapsed) return;
        const id = r.start.id, t = textEl(id);
        if (!t) return;
        const len = typeOf(id) === "code" ? [...localText(id)].length : plain(localText(id)).length;
        const caret = getSelection().getRangeAt(0).getBoundingClientRect(), box = t.getBoundingClientRect();
        const firstLine = !caret.height || caret.top - box.top < 18, lastLine = !caret.height || box.bottom - caret.bottom < 18;
        const go = (target, end) => {
          if (!target) return false;
          let x = target;
          while (x && !textEl(x)) {
            x = e.key === "ArrowUp" || e.key === "ArrowLeft" ? prevId(x) : nextId(x);
          }
          if (!x) return false;
          e.preventDefault();
          placeCaret(textEl(x), end ? typeOf(x) === "code" ? [...localText(x)].length : plain(localText(x)).length : 0);
          return true;
        };
        if (e.key === "ArrowUp" && firstLine) go(prevId(id), true);
        else if (e.key === "ArrowDown" && lastLine) go(nextId(id), false);
        else if (e.key === "ArrowLeft" && r.start.off === 0) go(prevId(id), true);
        else if (e.key === "ArrowRight" && r.start.off === len) go(nextId(id), false);
      }
      if (e.key === "Tab" && canEdit) {
        const r = range();
        if (r && typeOf(r.start.id) === "code") {
          e.preventDefault();
          insertAt(r.start.id, r.start.off, "  ", true);
        } else if (r) e.preventDefault();
      }
    });
    root.addEventListener("click", (e) => {
      const check = e.target.closest(".blk-check");
      if (check) {
        const id = blockOf(check)?.dataset.id;
        if (!id || !canEdit) {
          e.preventDefault();
          return;
        }
        const b = snapshot(id);
        const checked = check.checked;
        els.get(id).dataset.checked = checked ? "1" : "0";
        queue({ op: "block", block: { id, type: "todo", checked } });
        record([{ kind: "attrs", id, before: { type: "todo", checked: !checked }, after: { type: "todo", checked } }]);
        return;
      }
      const link = e.target.closest("a[data-href]");
      if (link && (!canEdit || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (link.getAttribute("href")) window.open(link.getAttribute("href"), "_blank", "noopener");
      }
      const tool = e.target.closest("[data-table]");
      if (tool) {
        e.preventDefault();
        tableTool(blockOf(tool).dataset.id, tool.dataset.table);
        return;
      }
      const handle = e.target.closest(".blk-handle");
      if (handle) {
        e.preventDefault();
        blockMenu(blockOf(handle).dataset.id, handle);
        return;
      }
      if (e.target === root && canEdit) {
        const last = root.lastElementChild?.dataset.id;
        if (last && textEl(last) && !localText(last)) placeCaret(textEl(last), 0);
        else if (last) {
          insertBlock({ id: newId(), type: "p", text: "" }, last);
        }
      }
    });
    document.addEventListener("mousedown", globalDown, true);
    function globalDown(e) {
      if (menu && !menu.el.contains(e.target)) closeMenu();
      const slash = e.target.closest?.("[data-slash]");
      if (slash) {
        e.preventDefault();
        chooseMenu(slash.dataset.slash);
        return;
      }
      const mark = e.target.closest?.(".doc-toolbar [data-mark]");
      if (mark) {
        e.preventDefault();
        if (mark.dataset.mark === "link") linkPrompt();
        else markSelection(mark.dataset.mark);
        return;
      }
      const turn = e.target.closest?.(".doc-toolbar [data-turn]");
      if (turn) {
        e.preventDefault();
        for (const id of selectedIds()) if (TEXTUAL.has(typeOf(id))) setType(id, turn.dataset.turn);
        showBar();
        return;
      }
      const ai = e.target.closest?.(".doc-toolbar [data-bar-ai]");
      if (ai) {
        e.preventDefault();
        askAI?.(selectedIds());
        return;
      }
      const opt = e.target.closest?.(".doc-block-menu [data-block-op]");
      if (opt) {
        e.preventDefault();
        blockOp(opt.dataset.id, opt.dataset.blockOp);
        document.querySelector(".doc-block-menu")?.remove();
        return;
      }
      if (!e.target.closest?.(".doc-block-menu")) document.querySelector(".doc-block-menu")?.remove();
    }
    function selectionChanged() {
      if (!root.isConnected) return;
      const sel = getSelection();
      if (!sel?.anchorNode || !root.contains(sel.anchorNode)) {
        if (bar && !bar.matches(":hover")) {
          bar.remove();
          bar = null;
        }
        return;
      }
      showBar();
      const id = blockOf(sel.anchorNode)?.dataset.id || "";
      root.querySelector(".blk.current")?.classList.remove("current");
      if (id) els.get(id)?.classList.add("current");
      if (id !== lastWhere) {
        lastWhere = id;
        clearTimeout(whereTimer);
        whereTimer = setTimeout(() => onWhere(id), 250);
      }
      if (menu && id !== menu.id) closeMenu();
    }
    document.addEventListener("selectionchange", selectionChanged);
    function blockMenu(id, anchor) {
      document.querySelector(".doc-block-menu")?.remove();
      const box = document.createElement("div");
      box.className = "doc-block-menu";
      const type = typeOf(id);
      box.innerHTML = (TEXTUAL.has(type) ? '<h6>转换为</h6><div class="turn-grid">' + TYPES.filter((t) => TEXTUAL.has(t[0])).map(([t, l, s]) => `<button data-block-op="turn:${t}" data-id="${id}" class="${t === type ? "active" : ""}" title="${l}">${esc4(s)}</button>`).join("") + "</div>" : "") + `<button data-block-op="up" data-id="${id}">上移</button><button data-block-op="down" data-id="${id}">下移</button><button data-block-op="copy" data-id="${id}">复制内容</button>${askAI ? `<button data-block-op="ai" data-id="${id}">✦ 让 AI 处理这段</button>` : ""}<button data-block-op="delete" data-id="${id}" class="danger">删除</button>`;
      document.body.append(box);
      const r = anchor.getBoundingClientRect();
      box.style.left = Math.max(8, r.left) + "px";
      box.style.top = Math.min(r.bottom + 4, innerHeight - box.offsetHeight - 8) + "px";
    }
    function moveRaw(id, after) {
      const el = els.get(id);
      if (!el || after === id) return;
      if (after === "") root.prepend(el);
      else if (els.has(after)) els.get(after).after(el);
      else return;
      queue({ op: "move", id, after });
      renumber();
    }
    function moveBlock(id, after) {
      const from = prevId(id);
      moveRaw(id, after);
      record([{ kind: "move", id, from, to: after }]);
    }
    function blockOp(id, op) {
      if (op.startsWith("turn:")) {
        setType(id, op.slice(5));
        return;
      }
      if (op === "delete") {
        removeBlock(id);
        return;
      }
      if (op === "up") {
        const p = prevId(id);
        if (p) moveBlock(id, prevId(p));
        return;
      }
      if (op === "down") {
        const n = nextId(id);
        if (n) moveBlock(id, n);
        return;
      }
      if (op === "copy") {
        navigator.clipboard?.writeText(blocksMarkdown([snapshot(id)])).then(() => toast2("已复制"), () => toast2("复制失败"));
        return;
      }
      if (op === "ai") {
        askAI?.([id]);
      }
    }
    let dragging = "";
    root.addEventListener("dragstart", (e) => {
      const h = e.target.closest?.(".blk-handle");
      if (!h) {
        e.preventDefault();
        return;
      }
      dragging = blockOf(h).dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/x-linkme-block", dragging);
      els.get(dragging).classList.add("dragging");
    });
    root.addEventListener("dragover", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const el = blockOf(e.target);
      root.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
      if (el && el.dataset.id !== dragging) {
        const r = el.getBoundingClientRect();
        el.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
      }
    });
    root.addEventListener("drop", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const el = root.querySelector(".drop-before,.drop-after");
      if (el) {
        const target = el.dataset.id;
        moveBlock(dragging, el.classList.contains("drop-before") ? prevId(target) : target);
      }
    });
    root.addEventListener("dragend", () => {
      if (dragging) els.get(dragging)?.classList.remove("dragging");
      dragging = "";
      root.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
    });
    const tableRows = (id) => [...els.get(id).querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\n+$/, "").replace(/\n/g, " ")));
    let tableTimer = 0;
    function tableEdited(cell) {
      const id = blockOf(cell)?.dataset.id;
      if (!id) return;
      clearTimeout(tableTimer);
      tableTimer = setTimeout(() => {
        const rows = tableRows(id);
        if (conf.get(id)) conf.get(id).rows = rows;
        queue({ op: "block", block: { id, type: "table", rows } });
      }, 300);
    }
    function tableTool(id, tool) {
      const rows = tableRows(id), focus = document.activeElement?.closest?.("td");
      const r = focus ? +focus.dataset.r : rows.length - 1, c = focus ? +focus.dataset.c : rows[0].length - 1;
      if (tool === "row" && rows.length < 500) rows.splice(r + 1, 0, rows[0].map(() => ""));
      if (tool === "col" && rows[0].length < 50) rows.forEach((row) => row.splice(c + 1, 0, ""));
      if (tool === "-row" && rows.length > 1) rows.splice(r, 1);
      if (tool === "-col" && rows[0].length > 1) rows.forEach((row) => row.splice(c, 1));
      const b = snapshot(id);
      b.rows = rows;
      rebuild(id, b);
      queue({ op: "block", block: { id, type: "table", rows } });
    }
    function reorder(order) {
      const want = order.filter((id) => els.has(id));
      const local = domOrder().filter((id) => localOnly.has(id) && !order.includes(id));
      for (const id of local) {
        const prev2 = prevId(id);
        const i = want.indexOf(prev2);
        want.splice(i + 1, 0, id);
      }
      for (const id of domOrder()) if (!want.includes(id) && !localOnly.has(id)) {
        els.get(id).remove();
        els.delete(id);
      }
      const now = domOrder();
      if (now.join() === want.join()) {
        renumber();
        return;
      }
      const sel = getSelection(), focus = sel?.anchorNode && blockOf(sel.anchorNode)?.dataset.id, t = focus && textEl(focus);
      let off = -1;
      if (t) off = caretOffset(t, sel.anchorNode, sel.anchorOffset);
      let prev = null;
      for (const id of want) {
        const el = els.get(id);
        if (!el) continue;
        if (prev ? prev.nextElementSibling !== el : root.firstElementChild !== el) {
          if (prev) prev.after(el);
          else root.prepend(el);
        }
        prev = el;
      }
      renumber();
      if (off >= 0 && textEl(focus)) placeCaret(textEl(focus), off);
    }
    function applyText(id, text, own) {
      const c = conf.get(id);
      if (!c || !els.has(id)) return;
      if (own) {
        const sent = inflight.get(id);
        c.text = text;
        if (sent === void 0) return;
        const L2 = localText(id), merged2 = L2 === sent ? text : mergeText(sent, L2, text);
        if (merged2 !== L2) setText(id, merged2);
        if (merged2 !== text) dirty.add(id);
        return;
      }
      if (inflight.has(id)) {
        c.text = text;
        return;
      }
      const L = localText(id), C = c.text, merged = L === C ? text : mergeText(C, L, text);
      c.text = text;
      if (merged !== L) setText(id, merged);
      if (merged !== text) dirty.add(id);
      else dirty.delete(id);
    }
    function apply(msg, own) {
      for (const op of msg.ops || []) {
        if (op.op === "insert") {
          const b = op.block, known = els.has(b.id);
          localOnly.delete(b.id);
          if (!known) {
            conf.set(b.id, { ...b });
            const el = build(b), ref = op.after ? els.get(op.after) : null;
            if (op.after === "") root.prepend(el);
            else if (ref) ref.after(el);
            else root.append(el);
          } else if (!conf.has(b.id)) conf.set(b.id, { ...b });
        } else if (op.op === "delete") {
          conf.delete(op.id);
          dirty.delete(op.id);
          inflight.delete(op.id);
          localOnly.delete(op.id);
          const el = els.get(op.id);
          if (el) {
            const had = el.contains(getSelection()?.anchorNode);
            const p = prevId(op.id) || nextId(op.id);
            el.remove();
            els.delete(op.id);
            if (had && p && textEl(p)) placeCaret(textEl(p), plain(localText(p)).length);
          }
        } else if (op.op === "text") applyText(op.id, op.text, own);
        else if (op.op === "block") {
          const b = op.block, c = conf.get(b.id);
          if (!c) continue;
          Object.assign(c, { type: b.type, checked: !!b.checked, lang: b.lang || "", rows: b.rows });
          const el = els.get(b.id);
          if (!el) continue;
          if (own) continue;
          if (el.dataset.type !== b.type || b.type === "table" && !el.contains(document.activeElement)) {
            rebuild(b.id, { ...snapshot(b.id), type: b.type, checked: !!b.checked, lang: b.lang, rows: b.rows, text: b.type === "code" && el.dataset.type !== "code" ? plain(localText(b.id)) : localText(b.id) });
          } else if (b.type === "todo") {
            el.dataset.checked = b.checked ? "1" : "0";
            const box = el.querySelector(".blk-check");
            if (box) box.checked = !!b.checked;
          }
        }
      }
      if (own) inflight.clear();
      if (msg.order) reorder(msg.order);
      else renumber();
      paintPeers();
    }
    function collect() {
      const ops = pending;
      pending = [];
      for (const id of dirty) {
        if (!els.has(id)) continue;
        const text = localText(id), base = conf.get(id)?.text ?? "";
        if (text !== base) {
          ops.push({ op: "text", id, base, text });
          inflight.set(id, text);
        }
      }
      dirty.clear();
      return ops;
    }
    function reset(content2) {
      const blocks = content2.blocks || [];
      const keep = new Set(blocks.map((b) => b.id));
      for (const b of blocks) {
        const old = conf.get(b.id);
        if (els.has(b.id) && old) {
          const L = localText(b.id), merged = L === old.text ? b.text : mergeText(old.text, L, b.text);
          conf.set(b.id, { ...b });
          if (els.get(b.id).dataset.type !== b.type) rebuild(b.id, { ...b, text: merged });
          else if (merged !== L) setText(b.id, merged);
          if (merged !== b.text) dirty.add(b.id);
        } else {
          conf.set(b.id, { ...b });
          root.append(build(b));
        }
      }
      for (const id of [...els.keys()]) if (!keep.has(id) && !localOnly.has(id)) {
        els.get(id).remove();
        els.delete(id);
        conf.delete(id);
      }
      reorder(blocks.map((b) => b.id));
      inflight.clear();
    }
    function paintPeers() {
      root.querySelectorAll(".blk-peer").forEach((n) => n.remove());
      root.querySelectorAll(".has-peer").forEach((n) => {
        n.classList.remove("has-peer");
        n.style.removeProperty("--peer");
      });
      const seen = /* @__PURE__ */ new Set();
      for (const v of peers) {
        const el = els.get(v.where);
        if (!el || seen.has(v.where + v.userId)) continue;
        seen.add(v.where + v.userId);
        const color = peerColor(v.userId);
        el.classList.add("has-peer");
        el.style.setProperty("--peer", color);
        const tag = document.createElement("span");
        tag.className = "blk-peer";
        tag.contentEditable = "false";
        tag.dataset.skip = "";
        tag.style.background = color;
        tag.textContent = v.name;
        tag.style.top = el.querySelectorAll(".blk-peer").length * 20 + "px";
        el.append(tag);
      }
    }
    render(content.blocks || []);
    if (canEdit) root.contentEditable = "true";
    return {
      collect,
      apply,
      reset,
      selectedIds,
      discardInflight() {
        inflight.clear();
      },
      hasPending: () => pending.length > 0 || dirty.size > 0,
      setEditable(v) {
        if (v === canEdit) return;
        canEdit = v;
        root.contentEditable = v ? "true" : "false";
        for (const id of domOrder()) rebuild(id, snapshot(id));
        paintPeers();
      },
      viewers(list) {
        peers = list;
        paintPeers();
      },
      focusEnd() {
        const last = root.lastElementChild?.dataset.id;
        if (last && textEl(last)) placeCaret(textEl(last), plain(localText(last)).length);
      },
      focusStart() {
        const first = root.firstElementChild?.dataset.id;
        if (first && textEl(first)) placeCaret(textEl(first), 0);
      },
      scrollTo(id) {
        els.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      blocks: () => domOrder().map((id) => snapshot(id)),
      // AI edits arrive as {op:replace|insert|delete,...}; returns false if stale.
      applyEdit(edit) {
        if (!canEdit) return false;
        if (edit.op === "replace") {
          if (!els.has(edit.id)) return false;
          const group = [];
          const b = snapshot(edit.id);
          if (edit.type && edit.type !== b.type && TEXTUAL.has(edit.type) && TEXTUAL.has(b.type)) setType(edit.id, edit.type);
          if (typeof edit.text === "string" && textEl(edit.id)) {
            writeText(edit.id, edit.text);
          }
          els.get(edit.id).classList.add("ai-flash");
          setTimeout(() => els.get(edit.id)?.classList.remove("ai-flash"), 1600);
          return true;
        }
        if (edit.op === "delete") {
          if (!els.has(edit.id)) return false;
          removeBlock(edit.id);
          return true;
        }
        if (edit.op === "insert") {
          let at = edit.after && els.has(edit.after) ? edit.after : edit.after === "" ? "" : domOrder().pop();
          const group = [];
          for (const raw of edit.blocks || []) {
            const type = TYPES.some((t) => t[0] === raw.type) ? raw.type : "p";
            const b = { id: newId(), type, text: String(raw.text || ""), checked: !!raw.checked, rows: type === "table" ? raw.rows : void 0 };
            insertBlock(b, at, { focus: false, history: false });
            group.push({ kind: "insert", id: b.id });
            at = b.id;
            els.get(b.id).classList.add("ai-flash");
            setTimeout(() => els.get(b.id)?.classList.remove("ai-flash"), 1600);
          }
          record(group);
          return group.length > 0;
        }
        return false;
      },
      insertMarkdown(md) {
        const blocks = markdownBlocks(md, newId);
        if (!blocks.length) return;
        const r = range();
        let at = r ? r.end.id : domOrder().pop();
        const group = [];
        for (const b of blocks) {
          insertBlock(b, at, { focus: false, history: false });
          group.push({ kind: "insert", id: b.id });
          at = b.id;
        }
        record(group);
        els.get(at)?.scrollIntoView({ block: "nearest" });
      },
      undo: doUndo,
      redo: doRedo,
      destroy() {
        document.removeEventListener("selectionchange", selectionChanged);
        document.removeEventListener("mousedown", globalDown, true);
        closeMenu();
        bar?.remove();
        bar = null;
        document.querySelector(".doc-block-menu")?.remove();
        clearTimeout(whereTimer);
        clearTimeout(outlineTimer);
      }
    };
  }

  // internal/ui/src/formula.js
  var FormulaError = class {
    constructor(code, why = "") {
      this.code = code;
      this.why = why;
    }
    toString() {
      return this.code;
    }
  };
  var E = (code, why) => new FormulaError(code, why);
  var isError = (v) => v instanceof FormulaError;
  var colName = (n) => {
    let s = "";
    while (n > 0) {
      n--;
      s = String.fromCharCode(65 + n % 26) + s;
      n = Math.floor(n / 26);
    }
    return s;
  };
  var colNumber = (s) => {
    let n = 0;
    for (const c of s) n = n * 26 + c.charCodeAt(0) - 64;
    return n;
  };
  function parseRef(ref) {
    const m = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,5})$/.exec(ref || "");
    return m ? { col: colNumber(m[1]), row: +m[2] } : null;
  }
  var refName = (col, row) => colName(col) + row;
  function tokenize(src) {
    const out = [];
    let i = 0;
    const sheetRef = /^(?:'((?:[^']|'')+)'|([A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*))!(\$?[A-Z]{1,3}\$?[0-9]+(?::\$?[A-Z]{1,3}\$?[0-9]+)?|[A-Z]{1,3}:[A-Z]{1,3}|[0-9]+:[0-9]+)/;
    while (i < src.length) {
      const rest = src.slice(i), c = src[i];
      let m;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '"') {
        let j = i + 1, s = "";
        while (j < src.length) {
          if (src[j] === '"') {
            if (src[j + 1] === '"') {
              s += '"';
              j += 2;
              continue;
            }
            break;
          }
          s += src[j++];
        }
        if (j >= src.length) throw E("#ERROR!", "引号没有闭合");
        out.push({ t: "str", v: s });
        i = j + 1;
        continue;
      }
      if (m = sheetRef.exec(rest)) {
        out.push({ t: "ref", sheet: m[1] ? m[1].replace(/''/g, "'") : m[2], v: m[3].replace(/\$/g, "") });
        i += m[0].length;
        continue;
      }
      if (m = /^\$?[A-Z]{1,3}\$?[0-9]+(?::\$?[A-Z]{1,3}\$?[0-9]+)?(?![A-Za-z0-9_(])/.exec(rest)) {
        out.push({ t: "ref", v: m[0].replace(/\$/g, "") });
        i += m[0].length;
        continue;
      }
      if ((m = /^[A-Z]{1,3}:[A-Z]{1,3}(?![A-Za-z0-9_(])/.exec(rest)) || (m = /^[0-9]+:[0-9]+(?![0-9.])/.exec(rest))) {
        out.push({ t: "ref", v: m[0] });
        i += m[0].length;
        continue;
      }
      if (m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(rest)) {
        out.push({ t: "num", v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (m = /^#(DIV\/0!|REF!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.exec(rest)) {
        out.push({ t: "err", v: m[0] });
        i += m[0].length;
        continue;
      }
      if (m = /^(TRUE|FALSE)(?![A-Za-z0-9_(])/i.exec(rest)) {
        out.push({ t: "bool", v: m[1].toUpperCase() === "TRUE" });
        i += m[0].length;
        continue;
      }
      if (m = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(rest)) {
        out.push({ t: "fn", v: m[1].toUpperCase() });
        i += m[0].length;
        continue;
      }
      if (m = /^(<=|>=|<>|[-+*\/^&=<>%(),;:])/.exec(rest)) {
        out.push({ t: "op", v: m[1] === ";" ? "," : m[1] });
        i += m[1].length;
        continue;
      }
      if (m = /^[A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*/.exec(rest)) {
        throw E("#NAME?", "无法识别 " + m[0]);
      }
      throw E("#ERROR!", "无法识别的字符 " + c);
    }
    return out;
  }
  function parse(src) {
    const tok = tokenize(src);
    let p = 0;
    const peek = () => tok[p], take = () => tok[p++], isOp = (v) => peek()?.t === "op" && peek().v === v;
    const expect = (v) => {
      if (!isOp(v)) throw E("#ERROR!", "缺少 " + v);
      p++;
    };
    const levels = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"], ["^"]];
    function binary(l) {
      if (l >= levels.length) return unary();
      let left = binary(l + 1);
      while (peek()?.t === "op" && levels[l].includes(peek().v)) {
        const op = take().v;
        left = { k: "bin", op, a: left, b: binary(l + 1) };
      }
      return left;
    }
    function unary() {
      if (isOp("-")) {
        p++;
        return { k: "neg", a: unary() };
      }
      if (isOp("+")) {
        p++;
        return unary();
      }
      return percent();
    }
    function percent() {
      let e = primary();
      while (isOp("%")) {
        p++;
        e = { k: "pct", a: e };
      }
      return e;
    }
    function primary() {
      const t = take();
      if (!t) throw E("#ERROR!", "公式不完整");
      if (t.t === "num") return { k: "val", v: t.v };
      if (t.t === "str") return { k: "val", v: t.v };
      if (t.t === "bool") return { k: "val", v: t.v };
      if (t.t === "err") return { k: "val", v: E(t.v) };
      if (t.t === "ref") return { k: "ref", sheet: t.sheet, v: t.v };
      if (t.t === "fn") {
        const args = [];
        if (!isOp(")")) {
          do {
            if (isOp(",") || isOp(")")) args.push({ k: "val", v: null });
            else args.push(binary(0));
          } while (isOp(",") && ++p);
        }
        expect(")");
        return { k: "fn", name: t.v, args };
      }
      if (t.t === "op" && t.v === "(") {
        const e = binary(0);
        expect(")");
        return e;
      }
      throw E("#ERROR!", "公式有误");
    }
    const tree = binary(0);
    if (p < tok.length) throw E("#ERROR!", "公式有多余内容");
    return tree;
  }
  var blank = (v) => v === null || v === void 0 || v === "";
  function toNumber(v) {
    if (isError(v)) return v;
    if (blank(v)) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    const s = String(v).trim().replace(/,/g, "");
    if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?$/.test(s)) return s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s);
    return E("#VALUE!", "“" + v + "”不是数字");
  }
  var toText = (v) => isError(v) ? v : blank(v) ? "" : typeof v === "boolean" ? v ? "TRUE" : "FALSE" : typeof v === "number" ? formatNumber(v) : String(v);
  var toBool = (v) => {
    if (isError(v)) return v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (blank(v)) return false;
    const s = String(v).toUpperCase();
    if (s === "TRUE") return true;
    if (s === "FALSE") return false;
    return E("#VALUE!");
  };
  function formatNumber(n) {
    if (!isFinite(n)) return "#NUM!";
    if (Number.isInteger(n)) return String(n);
    const r = +n.toPrecision(12);
    return Math.abs(r) >= 1e15 || Math.abs(r) < 1e-9 && r !== 0 ? r.toExponential(6).replace(/\.?0+e/, "e") : String(r);
  }
  var flat = (args) => args.flatMap((a) => a && a.range ? a.values.flat() : [a]);
  var firstError = (list) => list.find(isError);
  function literal(raw) {
    if (raw === void 0 || raw === null || raw === "") return null;
    const s = String(raw).trim();
    if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);
    if (/^-?(\d+\.?\d*|\.\d+)%$/.test(s)) return parseFloat(s) / 100;
    if (/^(TRUE|FALSE)$/i.test(s)) return s.toUpperCase() === "TRUE";
    if (/^#(DIV\/0!|REF!|VALUE!|NAME\?|N\/A|NUM!|NULL!)$/.test(s)) return E(s);
    return String(raw);
  }
  function criteria(c) {
    if (typeof c === "number" || typeof c === "boolean") return (v) => v === c || typeof c === "number" && toNumber(v) === c && !blank(v);
    const s = String(c ?? "");
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s);
    const op = m[1] || "=", rhs = m[2];
    const num = rhs !== "" && !isError(toNumber(rhs)) ? toNumber(rhs) : null;
    const wild = new RegExp("^" + rhs.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
    return (v) => {
      if (num !== null && !blank(v) && !isError(toNumber(v))) {
        const x = toNumber(v);
        return { "=": x === num, "<>": x !== num, "<": x < num, ">": x > num, "<=": x <= num, ">=": x >= num }[op];
      }
      const t = toText(v);
      if (op === "=") return rhs === "" ? blank(v) : wild.test(t);
      if (op === "<>") return rhs === "" ? !blank(v) : !wild.test(t);
      if (num !== null) return false;
      const cmp = t.localeCompare(rhs);
      return { "<": cmp < 0, ">": cmp > 0, "<=": cmp <= 0, ">=": cmp >= 0 }[op];
    };
  }
  var num1 = (f) => (a) => {
    const n = toNumber(a);
    return isError(n) ? n : f(n);
  };
  var round = (n, d, mode) => {
    const k = 10 ** d, x = n * k, r = mode === "up" ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9) : mode === "down" ? Math.trunc(x) : Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
    return r / k;
  };
  var numbers = (args) => flat(args).filter((v) => typeof v === "number");
  var numbersStrict = (args) => {
    const out = [];
    for (const a of args) {
      if (a && a.range) {
        for (const v of a.values.flat()) if (typeof v === "number") out.push(v);
        else if (isError(v)) return v;
      } else {
        const n = toNumber(a);
        if (isError(n)) return n;
        out.push(n);
      }
    }
    return out;
  };
  var pad = (n) => String(n).padStart(2, "0");
  var serial = (d) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5;
  var fromSerial = (n) => {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5);
    return d;
  };
  var FN = {
    SUM: (a) => {
      const n = numbersStrict(a);
      return isError(n) ? n : n.reduce((x, y) => x + y, 0);
    },
    AVERAGE: (a) => {
      const n = numbersStrict(a);
      return isError(n) ? n : n.length ? n.reduce((x, y) => x + y, 0) / n.length : E("#DIV/0!", "没有可平均的数字");
    },
    MIN: (a) => {
      const n = numbersStrict(a);
      return isError(n) ? n : n.length ? Math.min(...n) : 0;
    },
    MAX: (a) => {
      const n = numbersStrict(a);
      return isError(n) ? n : n.length ? Math.max(...n) : 0;
    },
    PRODUCT: (a) => {
      const n = numbersStrict(a);
      return isError(n) ? n : n.reduce((x, y) => x * y, 1);
    },
    MEDIAN: (a) => {
      const n = numbersStrict(a);
      if (isError(n)) return n;
      if (!n.length) return E("#NUM!");
      n.sort((x, y) => x - y);
      const m = n.length >> 1;
      return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
    },
    COUNT: (a) => numbers(a).length,
    COUNTA: (a) => flat(a).filter((v) => !blank(v)).length,
    COUNTBLANK: (a) => flat(a).filter(blank).length,
    ABS: (a) => num1(Math.abs)(a[0]),
    SQRT: (a) => num1((n) => n < 0 ? E("#NUM!") : Math.sqrt(n))(a[0]),
    INT: (a) => num1(Math.floor)(a[0]),
    ROUND: (a) => {
      const n = toNumber(a[0]), d = toNumber(a[1] ?? 0);
      return firstError([n, d]) || round(n, d);
    },
    ROUNDUP: (a) => {
      const n = toNumber(a[0]), d = toNumber(a[1] ?? 0);
      return firstError([n, d]) || round(n, d, "up");
    },
    ROUNDDOWN: (a) => {
      const n = toNumber(a[0]), d = toNumber(a[1] ?? 0);
      return firstError([n, d]) || round(n, d, "down");
    },
    MOD: (a) => {
      const n = toNumber(a[0]), d = toNumber(a[1]);
      return firstError([n, d]) || (d === 0 ? E("#DIV/0!") : n - d * Math.floor(n / d));
    },
    POWER: (a) => {
      const n = toNumber(a[0]), d = toNumber(a[1]);
      return firstError([n, d]) || n ** d;
    },
    IF: (a) => {
      const c = toBool(a[0]);
      return isError(c) ? c : c ? a[1] ?? true : a.length > 2 ? a[2] : false;
    },
    IFS: (a) => {
      for (let i = 0; i + 1 < a.length; i += 2) {
        const c = toBool(a[i]);
        if (isError(c)) return c;
        if (c) return a[i + 1];
      }
      return E("#N/A", "没有满足的条件");
    },
    IFERROR: (a) => isError(a[0]) ? a[1] : a[0],
    AND: (a) => {
      const v = flat(a).filter((x) => !blank(x)).map(toBool);
      return firstError(v) || v.every(Boolean);
    },
    OR: (a) => {
      const v = flat(a).filter((x) => !blank(x)).map(toBool);
      return firstError(v) || v.some(Boolean);
    },
    NOT: (a) => {
      const v = toBool(a[0]);
      return isError(v) ? v : !v;
    },
    LEN: (a) => {
      const t = toText(a[0]);
      return isError(t) ? t : Array.from(t).length;
    },
    LEFT: (a) => {
      const t = toText(a[0]), n = toNumber(a[1] ?? 1);
      return firstError([t, n]) || Array.from(t).slice(0, n).join("");
    },
    RIGHT: (a) => {
      const t = toText(a[0]), n = toNumber(a[1] ?? 1);
      return firstError([t, n]) || (n ? Array.from(t).slice(-n).join("") : "");
    },
    MID: (a) => {
      const t = toText(a[0]), s = toNumber(a[1]), n = toNumber(a[2]);
      return firstError([t, s, n]) || Array.from(t).slice(s - 1, s - 1 + n).join("");
    },
    UPPER: (a) => {
      const t = toText(a[0]);
      return isError(t) ? t : t.toUpperCase();
    },
    LOWER: (a) => {
      const t = toText(a[0]);
      return isError(t) ? t : t.toLowerCase();
    },
    TRIM: (a) => {
      const t = toText(a[0]);
      return isError(t) ? t : t.trim().replace(/\s+/g, " ");
    },
    CONCAT: (a) => {
      const v = flat(a).map(toText);
      return firstError(v) || v.join("");
    },
    CONCATENATE: (a) => FN.CONCAT(a),
    TEXTJOIN: (a) => {
      const sep = toText(a[0]), skip = toBool(a[1]);
      const v = flat(a.slice(2)).filter((x) => !skip || !blank(x)).map(toText);
      return firstError([sep, skip, ...v]) || v.join(sep);
    },
    VALUE: (a) => toNumber(a[0]),
    TEXT: (a) => {
      const n = toNumber(a[0]), f = toText(a[1]);
      if (isError(n)) return toText(a[0]);
      const dec = (/0\.(0+)/.exec(f) || [, ""])[1].length;
      let s = n.toFixed(dec);
      if (/,/.test(f)) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      if (f.endsWith("%")) s = (n * 100).toFixed(dec) + "%";
      if (/yyyy|mm|dd/i.test(f)) {
        const d = fromSerial(n);
        s = f.replace(/yyyy/i, d.getUTCFullYear()).replace(/mm/i, pad(d.getUTCMonth() + 1)).replace(/dd/i, pad(d.getUTCDate()));
      }
      return s;
    },
    TODAY: () => serial(/* @__PURE__ */ new Date()),
    NOW: () => {
      const d = /* @__PURE__ */ new Date();
      return serial(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
    },
    DATE: (a) => {
      const [y, m, d] = a.map(toNumber);
      return firstError([y, m, d]) || serial(new Date(y, m - 1, d));
    },
    YEAR: (a) => num1((n) => fromSerial(n).getUTCFullYear())(a[0]),
    MONTH: (a) => num1((n) => fromSerial(n).getUTCMonth() + 1)(a[0]),
    DAY: (a) => num1((n) => fromSerial(n).getUTCDate())(a[0]),
    SUMIF: (a) => {
      const r = a[0], test = criteria(a[1]), s = a[2] || r;
      if (!r?.range || !s?.range) return E("#VALUE!");
      let t = 0;
      r.values.forEach((row, i) => row.forEach((v, j) => {
        if (test(v)) {
          const x = s.values[i]?.[j];
          if (typeof x === "number") t += x;
        }
      }));
      return t;
    },
    COUNTIF: (a) => {
      const r = a[0], test = criteria(a[1]);
      if (!r?.range) return E("#VALUE!");
      return r.values.flat().filter(test).length;
    },
    AVERAGEIF: (a) => {
      const r = a[0], test = criteria(a[1]), s = a[2] || r;
      if (!r?.range || !s?.range) return E("#VALUE!");
      let t = 0, n = 0;
      r.values.forEach((row, i) => row.forEach((v, j) => {
        if (test(v)) {
          const x = s.values[i]?.[j];
          if (typeof x === "number") {
            t += x;
            n++;
          }
        }
      }));
      return n ? t / n : E("#DIV/0!");
    },
    VLOOKUP: (a) => {
      const key = a[0], t = a[1], c = toNumber(a[2]), approx = a.length > 3 ? toBool(a[3]) : true;
      if (!t?.range) return E("#VALUE!");
      if (isError(c)) return c;
      if (c < 1 || c > (t.values[0]?.length || 0)) return E("#REF!", "列号超出查找范围");
      let hit = -1;
      for (let i = 0; i < t.values.length; i++) {
        const v = t.values[i][0];
        if (approx === false ? equal(v, key) : compare(v, key) <= 0) {
          hit = i;
          if (approx === false) break;
        } else if (approx !== false && hit >= 0) break;
      }
      return hit < 0 ? E("#N/A", "找不到 " + toText(key)) : t.values[hit][c - 1];
    },
    HLOOKUP: (a) => {
      const t = a[1];
      if (!t?.range) return E("#VALUE!");
      const rot = { range: true, values: t.values[0].map((_, j) => t.values.map((r) => r[j])) };
      return FN.VLOOKUP([a[0], rot, a[2], a[3]]);
    },
    INDEX: (a) => {
      const t = a[0];
      if (!t?.range) return E("#VALUE!");
      const r = toNumber(a[1] ?? 1), c = toNumber(a[2] ?? 1);
      if (isError(r) || isError(c)) return E("#VALUE!");
      const row = t.values[(r || 1) - 1];
      return row && (c || 1) <= row.length ? row[(c || 1) - 1] : E("#REF!");
    },
    MATCH: (a) => {
      const key = a[0], t = a[1], type = a.length > 2 ? toNumber(a[2]) : 1;
      if (!t?.range) return E("#N/A");
      const list = t.values.length === 1 ? t.values[0] : t.values.map((r) => r[0]);
      if (type === 0) {
        const i = list.findIndex((v) => equal(v, key));
        return i < 0 ? E("#N/A") : i + 1;
      }
      let hit = -1;
      for (let i = 0; i < list.length; i++) {
        if (type > 0 ? compare(list[i], key) <= 0 : compare(list[i], key) >= 0) hit = i;
        else break;
      }
      return hit < 0 ? E("#N/A") : hit + 1;
    },
    RANK: (a) => {
      const n = toNumber(a[0]), t = a[1], desc = !(a.length > 2 && toNumber(a[2]));
      if (!t?.range || isError(n)) return E("#N/A");
      const list = numbers([t]);
      if (!list.includes(n)) return E("#N/A");
      return list.filter((x) => desc ? x > n : x < n).length + 1;
    },
    ISBLANK: (a) => blank(a[0]),
    ISNUMBER: (a) => typeof a[0] === "number",
    ISTEXT: (a) => typeof a[0] === "string" && a[0] !== "",
    ISERROR: (a) => isError(a[0])
  };
  var functionNames = Object.keys(FN).sort();
  function equal(a, b) {
    if (typeof a === "number" || typeof b === "number") return toNumber(a) === toNumber(b);
    return toText(a).toLowerCase() === toText(b).toLowerCase();
  }
  function compare(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return toText(a).localeCompare(toText(b));
  }
  function createCalculator({ raw, exists }) {
    const cache = /* @__PURE__ */ new Map(), trees = /* @__PURE__ */ new Map(), busy = /* @__PURE__ */ new Set();
    function value(sheet, col, row) {
      const key = sheet + "!" + col + ":" + row;
      if (cache.has(key)) return cache.get(key);
      const input = raw(sheet, col, row);
      let v;
      if (typeof input === "string" && input.startsWith("=") && input.length > 1) {
        if (busy.has(key)) return E("#CYCLE!", "公式循环引用了自己");
        busy.add(key);
        try {
          v = evaluate(input, sheet);
        } finally {
          busy.delete(key);
        }
      } else v = literal(input);
      cache.set(key, v);
      return v;
    }
    function range(sheet, ref) {
      if (sheet !== void 0 && !exists(sheet)) return E("#REF!", "工作表不存在");
      let [a, b] = ref.split(":");
      if (/^[A-Z]+$/.test(a)) {
        a += "1";
        b += "5000";
      } else if (/^[0-9]+$/.test(a)) {
        a = "A" + a;
        b = "GR" + b;
      }
      const p = parseRef(a), q = parseRef(b || a);
      if (!p || !q) return E("#REF!");
      if (!b) return value(sheet, p.col, p.row);
      const r1 = Math.min(p.row, q.row), r2 = Math.max(p.row, q.row), c1 = Math.min(p.col, q.col), c2 = Math.max(p.col, q.col);
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > 2e5) return E("#REF!", "范围过大");
      const values = [];
      for (let r = r1; r <= r2; r++) {
        const row = [];
        for (let c = c1; c <= c2; c++) row.push(value(sheet, c, r));
        values.push(row);
      }
      return { range: true, values };
    }
    function run(n, sheet) {
      switch (n.k) {
        case "val":
          return n.v;
        case "ref": {
          const v = range(n.sheet ?? sheet, n.v);
          return v === null ? null : v;
        }
        case "neg": {
          const x = toNumber(scalar(run(n.a, sheet)));
          return isError(x) ? x : -x;
        }
        case "pct": {
          const x = toNumber(scalar(run(n.a, sheet)));
          return isError(x) ? x : x / 100;
        }
        case "bin": {
          const a = scalar(run(n.a, sheet)), b = scalar(run(n.b, sheet));
          if (isError(a)) return a;
          if (isError(b)) return b;
          switch (n.op) {
            case "&":
              return toText(a) + toText(b);
            case "=":
              return equal(a, b);
            case "<>":
              return !equal(a, b);
            case "<":
              return compare(a, b) < 0;
            case ">":
              return compare(a, b) > 0;
            case "<=":
              return compare(a, b) <= 0;
            case ">=":
              return compare(a, b) >= 0;
          }
          const x = toNumber(a), y = toNumber(b);
          if (isError(x)) return x;
          if (isError(y)) return y;
          switch (n.op) {
            case "+":
              return x + y;
            case "-":
              return x - y;
            case "*":
              return x * y;
            case "/":
              return y === 0 ? E("#DIV/0!", "除数为 0") : x / y;
            case "^":
              return x ** y;
          }
          return E("#ERROR!");
        }
        case "fn": {
          const f = FN[n.name];
          if (!f) return E("#NAME?", "没有函数 " + n.name);
          if (n.name === "IF") {
            const c = toBool(scalar(run(n.args[0], sheet)));
            if (isError(c)) return c;
            return c ? n.args[1] ? scalar(run(n.args[1], sheet)) : true : n.args[2] ? scalar(run(n.args[2], sheet)) : false;
          }
          if (n.name === "IFERROR") {
            const v = scalar(run(n.args[0], sheet));
            return isError(v) ? scalar(run(n.args[1], sheet)) : v;
          }
          const args = n.args.map((a) => run(a, sheet));
          const bad = args.find((a) => isError(a) && !["IFERROR", "ISERROR", "IFS"].includes(n.name));
          if (bad && !["COUNT", "COUNTA", "COUNTBLANK"].includes(n.name)) return bad;
          try {
            const v = f(args);
            return v === void 0 ? null : v;
          } catch {
            return E("#VALUE!");
          }
        }
      }
      return E("#ERROR!");
    }
    const scalar = (v) => v && v.range ? v.values.length === 1 && v.values[0].length === 1 ? v.values[0][0] : E("#VALUE!", "需要单个单元格") : v;
    function evaluate(input, sheet) {
      let tree = trees.get(input);
      if (!tree) {
        try {
          tree = parse(input.slice(1));
        } catch (e) {
          tree = { k: "val", v: isError(e) ? e : E("#ERROR!") };
        }
        trees.set(input, tree);
      }
      const v = scalar(run(tree, sheet));
      return typeof v === "number" && !isFinite(v) ? E("#NUM!") : v;
    }
    return { value, clear() {
      cache.clear();
    }, evaluate };
  }
  var display = (v) => v === null || v === void 0 ? "" : isError(v) ? v.code : typeof v === "boolean" ? v ? "TRUE" : "FALSE" : typeof v === "number" ? formatNumber(v) : String(v);

  // internal/ui/src/sheet-editor.js
  var ROW_H = 28;
  var COL_W = 100;
  function moveRefs(formula, dc, dr) {
    let out = "", inString = false;
    const re = /((?:'(?:[^']|'')+'|[A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*)!)?(\$?)([A-Z]{1,3})(\$?)([0-9]+)/g;
    const fix = (chunk) => chunk.replace(re, (m, sheet, ac, col, ar, row, offset, all) => {
      const before = all[offset - 1] || "", after = all[offset + m.length] || "";
      if (/[A-Za-z0-9_.]/.test(before) || /[A-Za-z_(]/.test(after)) return m;
      let c = 0;
      for (const ch of col) c = c * 26 + ch.charCodeAt(0) - 64;
      let r = +row;
      if (!ac) c += dc;
      if (!ar) r += dr;
      if (c < 1 || r < 1) return (sheet || "") + "#REF!";
      return (sheet || "") + ac + colName(c) + ar + r;
    });
    let start = 0;
    for (let i = 0; i < formula.length; i++) {
      if (formula[i] !== '"') continue;
      if (!inString) {
        out += fix(formula.slice(start, i));
        start = i;
        inString = true;
      } else if (formula[i + 1] === '"') {
        i++;
      } else {
        out += formula.slice(start, i + 1);
        start = i + 1;
        inString = false;
      }
    }
    return out + (inString ? formula.slice(start) : fix(formula.slice(start)));
  }
  function createSheetEditor({ mount, content, editable, newId, onChange, onWhere, toast: toast2, esc: esc4, askAI }) {
    let pages = (content.sheets || []).map((p) => ({ ...p, cells: { ...p.cells || {} }, cols: { ...p.cols || {} } }));
    let active = 0, canEdit = editable, queueOps = [], seq = 0, peers = [], editing = null, clip = null, frame = 0, afterAdd = "";
    const pendingKeys = /* @__PURE__ */ new Map(), inflight = /* @__PURE__ */ new Map(), undo = [], redo = [];
    let sel = { r1: 1, c1: 1, r2: 1, c2: 1, ar: 1, ac: 1 };
    const page = () => pages[active];
    const byName = (name) => pages.find((p) => p.name === name);
    const calc = createCalculator({ raw: (name, col, row) => byName(name)?.cells[refName(col, row)]?.v, exists: (name) => !!byName(name) });
    const value = (p, c, r) => calc.value(p.name, c, r);
    mount.innerHTML = `<div class="sheet">
  <div class="sheet-toolbar" role="toolbar" aria-label="表格工具">
   <button data-sh="undo" title="撤销 Ctrl+Z">↶</button><button data-sh="redo" title="重做 Ctrl+Y">↷</button><span class="sep"></span>
   <button data-sh="b" title="粗体 Ctrl+B"><b>B</b></button><button data-sh="i" title="斜体 Ctrl+I"><i>I</i></button><button data-sh="u" title="下划线 Ctrl+U"><u>U</u></button><button data-sh="s" title="删除线"><s>S</s></button><span class="sep"></span>
   <button data-sh="left" title="左对齐">⇤</button><button data-sh="center" title="居中">↔</button><button data-sh="right" title="右对齐">⇥</button><span class="sep"></span>
   <label class="sheet-color" title="填充颜色">▧<input type="color" data-sh-color="bg" value="#fff2cc"></label><label class="sheet-color" title="文字颜色">A<input type="color" data-sh-color="c" value="#d83931"></label><button data-sh="clearStyle" title="清除格式">⌫</button><span class="sep"></span>
   <button data-sh="rowAbove" title="在上方插入行">+行</button><button data-sh="colLeft" title="在左侧插入列">+列</button><button data-sh="delRows" title="删除所选行">−行</button><button data-sh="delCols" title="删除所选列">−列</button><span class="sep"></span>
   <button data-sh="sum" title="自动求和">Σ</button>${askAI ? '<button data-sh="ai" class="ai" title="让 AI 分析或修改所选区域">✦ AI</button>' : ""}
  </div>
  <div class="sheet-formula"><span class="sheet-ref" aria-label="当前单元格">A1</span><span class="fx">fx</span><input class="sheet-input" aria-label="单元格内容或公式" spellcheck="false" autocomplete="off"></div>
  <div class="sheet-grid" tabindex="0" aria-label="表格">
   <div class="sheet-corner"></div><div class="sheet-colhead"></div><div class="sheet-rowhead"></div>
   <div class="sheet-scroll"><div class="sheet-space"><div class="sheet-cells"></div><div class="sheet-peers"></div><div class="sheet-sel"></div><textarea class="sheet-editor hidden" spellcheck="false"></textarea></div></div>
  </div>
  <div class="sheet-tabs"></div>
 </div>`;
    const $2 = (s) => mount.querySelector(s);
    const grid = $2(".sheet-grid"), scroll = $2(".sheet-scroll"), space = $2(".sheet-space"), cellsEl = $2(".sheet-cells"), colhead = $2(".sheet-colhead"), rowhead = $2(".sheet-rowhead"), selEl = $2(".sheet-sel"), editor = $2(".sheet-editor"), bar = $2(".sheet-input"), refBox = $2(".sheet-ref");
    const colW = (c) => page().cols?.[colName(c)] || COL_W;
    function extent() {
      let mr = 0, mc = 0;
      for (const ref in page().cells) {
        const p = parseRef(ref);
        if (p) {
          mr = Math.max(mr, p.row);
          mc = Math.max(mc, p.col);
        }
      }
      return { rows: Math.min(5e4, Math.max(200, mr + 100, sel.r2 + 50)), cols: Math.min(200, Math.max(26, mc + 8, sel.c2 + 5)) };
    }
    let xs = [0], size = { rows: 200, cols: 26 };
    function measure() {
      size = extent();
      xs = [0];
      for (let c = 1; c <= size.cols; c++) xs.push(xs[c - 1] + colW(c));
      space.style.width = xs[size.cols] + "px";
      space.style.height = size.rows * ROW_H + "px";
    }
    const colAt = (x) => {
      let lo = 1, hi = size.cols;
      while (lo < hi) {
        const m = lo + hi + 1 >> 1;
        if (xs[m - 1] <= x) lo = m;
        else hi = m - 1;
      }
      return lo;
    };
    function cellHTML(c, r) {
      const p = page(), ref = refName(c, r), cell = p.cells[ref], v = cell ? value(p, c, r) : null, s = cell?.s || {};
      const text = display(v), num = typeof v === "number", err = isError(v);
      const cls = ["c", num ? "num" : "", err ? "err" : "", typeof v === "boolean" ? "bool" : "", s.b ? "b" : "", s.i ? "i" : "", s.u ? "u" : "", s.s ? "s" : "", s.a ? "a-" + s.a : ""].filter(Boolean).join(" ");
      const style2 = `left:${xs[c - 1]}px;top:${(r - 1) * ROW_H}px;width:${colW(c)}px;${s.bg ? "background:" + s.bg + ";" : ""}${s.c ? "color:" + s.c + ";" : ""}`;
      return `<div class="${cls}" style="${style2}"${err && v.why ? ` title="${esc4(v.why)}"` : ""}>${esc4(text)}</div>`;
    }
    function draw() {
      frame = 0;
      measure();
      const top = scroll.scrollTop, left = scroll.scrollLeft, h = scroll.clientHeight, w = scroll.clientWidth;
      const r1 = Math.max(1, Math.floor(top / ROW_H) + 1), r2 = Math.min(size.rows, Math.ceil((top + h) / ROW_H) + 1), c1 = colAt(left), c2 = Math.min(size.cols, colAt(left + w) + 1);
      let html = "";
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) html += cellHTML(c, r);
      cellsEl.innerHTML = html;
      let ch = "";
      for (let c = c1; c <= c2; c++) ch += `<div class="h${c >= Math.min(sel.c1, sel.c2) && c <= Math.max(sel.c1, sel.c2) ? " on" : ""}" data-col="${c}" style="left:${xs[c - 1] - left}px;width:${colW(c)}px">${colName(c)}<span class="resize" data-resize="${c}"></span></div>`;
      colhead.innerHTML = ch;
      let rh = "";
      for (let r = r1; r <= r2; r++) rh += `<div class="h${r >= Math.min(sel.r1, sel.r2) && r <= Math.max(sel.r1, sel.r2) ? " on" : ""}" data-row="${r}" style="top:${(r - 1) * ROW_H - top}px">${r}</div>`;
      rowhead.innerHTML = rh;
      drawSel();
      drawPeers();
    }
    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    function drawSel() {
      const r1 = Math.min(sel.r1, sel.r2), r2 = Math.max(sel.r1, sel.r2), c1 = Math.min(sel.c1, sel.c2), c2 = Math.max(sel.c1, sel.c2);
      Object.assign(selEl.style, { left: xs[c1 - 1] + "px", top: (r1 - 1) * ROW_H + "px", width: xs[c2] - xs[c1 - 1] + "px", height: (r2 - r1 + 1) * ROW_H + "px" });
      const ref = refName(sel.ac, sel.ar);
      refBox.textContent = r1 === r2 && c1 === c2 ? ref : `${refName(c1, r1)}:${refName(c2, r2)}`;
      if (!editing) bar.value = page().cells[ref]?.v || "";
    }
    function drawPeers() {
      const box = $2(".sheet-peers");
      box.innerHTML = peers.filter((v) => v.where?.startsWith(page().id + "!")).map((v) => {
        const p = parseRef(v.where.split("!")[1]);
        if (!p || p.col > size.cols) return "";
        const color = peerColor(v.userId);
        return `<div class="peer" style="left:${xs[p.col - 1]}px;top:${(p.row - 1) * ROW_H}px;width:${colW(p.col)}px;border-color:${color}"><span style="background:${color}">${esc4(v.name)}</span></div>`;
      }).join("");
    }
    function drawTabs() {
      $2(".sheet-tabs").innerHTML = pages.map((p, i) => `<button class="tab${i === active ? " active" : ""}" data-tab="${i}" title="双击重命名，右键更多">${esc4(p.name)}</button>`).join("") + (canEdit ? '<button class="add" data-sh="addSheet" title="新建工作表">＋</button>' : "");
    }
    function select(r, c, extend = false) {
      r = Math.max(1, Math.min(5e4, r));
      c = Math.max(1, Math.min(200, c));
      if (extend) {
        sel.r2 = r;
        sel.c2 = c;
      } else sel = { r1: r, c1: c, r2: r, c2: c, ar: r, ac: c };
      if (!extend) {
        sel.ar = r;
        sel.ac = c;
      }
      const y = (r - 1) * ROW_H;
      if (y < scroll.scrollTop) scroll.scrollTop = y;
      else if (y + ROW_H > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = y + ROW_H - scroll.clientHeight;
      measure();
      const x = xs[c - 1];
      if (x < scroll.scrollLeft) scroll.scrollLeft = x;
      else if (xs[c] > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = xs[c] - scroll.clientWidth;
      redraw();
      onWhere(page().id + "!" + refName(sel.ac, sel.ar));
    }
    const bounds = () => ({ r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2) });
    const same2 = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    function setCell(p, ref, cell, group) {
      const before = p.cells[ref] ? JSON.parse(JSON.stringify(p.cells[ref])) : null;
      const clean = cell && (cell.v || cell.s && Object.keys(cell.s).length) ? { ...cell.v ? { v: cell.v } : {}, ...cell.s && Object.keys(cell.s).length ? { s: cell.s } : {} } : null;
      if (same2(before, clean)) return;
      if (clean) p.cells[ref] = clean;
      else delete p.cells[ref];
      const key = p.id + "!" + ref;
      pendingKeys.set(key, ++seq);
      queueOps.push({ op: "cell", sheet: p.id, ref, cell: clean || void 0 });
      group?.push({ sheet: p.id, ref, before, after: clean });
    }
    function commit(group) {
      if (!group.length) return;
      undo.push(group);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
      calc.clear();
      redraw();
      onChange();
    }
    function revert(group, back) {
      const g = [];
      for (const ch of back ? [...group].reverse() : group) {
        const p = pages.find((x) => x.id === ch.sheet);
        if (p) setCell(p, ch.ref, back ? ch.before : ch.after, g);
      }
      calc.clear();
      redraw();
      onChange();
    }
    function writeValue(r, c, v) {
      const p = page(), ref = refName(c, r), old = p.cells[ref];
      const g = [];
      setCell(p, ref, { ...old || {}, v: String(v) }, g);
      commit(g);
    }
    function eachSelected(fn) {
      const b = bounds(), g = [];
      for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) fn(r, c, g);
      commit(g);
    }
    function style(patch) {
      if (!canEdit) return;
      const p = page(), b = bounds();
      const ref = refName(b.c1, b.r1);
      const toggle = Object.keys(patch).length === 1 && typeof Object.values(patch)[0] === "boolean" ? Object.keys(patch)[0] : null;
      const on = toggle ? !p.cells[ref]?.s?.[toggle] : null;
      eachSelected((r, c, g) => {
        const ref2 = refName(c, r), old = p.cells[ref2] || {};
        const s = { ...old.s || {} };
        for (const [k, v] of Object.entries(toggle ? { [toggle]: on } : patch)) {
          if (v === false || v === "" || v === null) delete s[k];
          else s[k] = v;
        }
        setCell(p, ref2, { ...old, s }, g);
      });
    }
    function clearRange() {
      if (!canEdit) return;
      const p = page();
      eachSelected((r, c, g) => {
        const ref = refName(c, r), old = p.cells[ref];
        if (old?.v) setCell(p, ref, old.s ? { s: old.s } : null, g);
      });
    }
    function startEdit(initial) {
      if (!canEdit) return;
      const r = sel.ar, c = sel.ac;
      editing = { r, c, sheet: page().id };
      Object.assign(editor.style, { left: xs[c - 1] + "px", top: (r - 1) * ROW_H + "px", minWidth: colW(c) + "px", height: ROW_H + "px" });
      editor.value = initial ?? page().cells[refName(c, r)]?.v ?? "";
      editor.classList.remove("hidden");
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      bar.value = editor.value;
    }
    function finishEdit(save, move2) {
      if (!editing) return;
      const { r, c, sheet } = editing;
      editing = null;
      editor.classList.add("hidden");
      if (save && page().id === sheet) {
        let v = editor.value;
        if (v.startsWith("=")) {
          v = v.replace(/\s+$/, "");
          const open2 = (v.match(/\(/g) || []).length - (v.match(/\)/g) || []).length;
          if (open2 > 0) v += ")".repeat(open2);
        }
        writeValue(r, c, v);
      }
      grid.focus({ preventScroll: true });
      if (move2) select(r + (move2 === "down" ? 1 : move2 === "up" ? -1 : 0), c + (move2 === "right" ? 1 : move2 === "left" ? -1 : 0));
      else redraw();
    }
    editor.addEventListener("input", () => {
      bar.value = editor.value;
    });
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.altKey) {
        e.preventDefault();
        finishEdit(true, e.shiftKey ? "up" : "down");
      } else if (e.key === "Enter" && e.altKey) {
        e.preventDefault();
        const s = editor.selectionStart;
        editor.setRangeText("\n", s, editor.selectionEnd, "end");
      } else if (e.key === "Tab") {
        e.preventDefault();
        finishEdit(true, e.shiftKey ? "left" : "right");
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(false);
      }
    });
    editor.addEventListener("blur", () => {
      setTimeout(() => {
        if (editing && document.activeElement !== editor && document.activeElement !== bar) finishEdit(true);
      }, 0);
    });
    bar.addEventListener("focus", () => {
      if (!canEdit) {
        bar.blur();
        return;
      }
      if (!editing) {
        startEdit();
        bar.focus();
      }
    });
    bar.addEventListener("input", () => {
      if (editing) editor.value = bar.value;
    });
    bar.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        editor.value = bar.value;
        finishEdit(true, "down");
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(false);
      }
    });
    const cellAt = (e) => {
      const rect = space.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      return { r: Math.max(1, Math.floor(y / ROW_H) + 1), c: colAt(Math.max(0, x)) };
    };
    let dragging = false;
    space.addEventListener("mousedown", (e) => {
      if (e.target === editor) return;
      const { r, c } = cellAt(e);
      if (editing && editor.value.startsWith("=") && /[=(,+\-*/^&<>:]$/.test(editor.value.slice(0, editor.selectionStart).trimEnd())) {
        e.preventDefault();
        const ref = refName(c, r);
        editor.setRangeText(ref, editor.selectionStart, editor.selectionEnd, "end");
        bar.value = editor.value;
        editor.focus();
        return;
      }
      if (editing) finishEdit(true);
      e.preventDefault();
      grid.focus({ preventScroll: true });
      select(r, c, e.shiftKey);
      dragging = true;
    });
    space.addEventListener("dblclick", (e) => {
      if (e.target !== editor) startEdit();
    });
    const move = (e) => {
      if (dragging) {
        const { r, c } = cellAt(e);
        if (r !== sel.r2 || c !== sel.c2) {
          sel.r2 = r;
          sel.c2 = c;
          redraw();
        }
      }
    };
    const up = () => {
      dragging = false;
      resizing = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    scroll.addEventListener("scroll", redraw, { passive: true });
    const ro = new ResizeObserver(redraw);
    ro.observe(scroll);
    let resizing = null;
    colhead.addEventListener("mousedown", (e) => {
      const handle = e.target.closest("[data-resize]");
      if (handle && canEdit) {
        e.preventDefault();
        const c = +handle.dataset.resize, start = e.clientX, w0 = colW(c);
        resizing = { c };
        const onMove = (ev) => {
          const w = Math.max(30, Math.min(1e3, w0 + ev.clientX - start));
          page().cols = { ...page().cols, [colName(c)]: w };
          redraw();
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          queueOps.push({ op: "width", sheet: page().id, col: colName(c), width: colW(c) });
          onChange();
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return;
      }
      const h = e.target.closest("[data-col]");
      if (h) {
        e.preventDefault();
        const c = +h.dataset.col;
        if (e.shiftKey) {
          sel.c2 = c;
          sel.r1 = 1;
          sel.r2 = size.rows;
        } else sel = { r1: 1, r2: size.rows, c1: c, c2: c, ar: 1, ac: c };
        grid.focus();
        redraw();
      }
    });
    rowhead.addEventListener("mousedown", (e) => {
      const h = e.target.closest("[data-row]");
      if (h) {
        e.preventDefault();
        const r = +h.dataset.row;
        if (e.shiftKey) {
          sel.r2 = r;
          sel.c1 = 1;
          sel.c2 = size.cols;
        } else sel = { r1: r, r2: r, c1: 1, c2: size.cols, ar: r, ac: 1 };
        grid.focus();
        redraw();
      }
    });
    colhead.addEventListener("contextmenu", (e) => {
      const h = e.target.closest("[data-col]");
      if (!h || !canEdit) return;
      e.preventDefault();
      headerMenu(e, [["在左侧插入列", "colLeft"], ["在右侧插入列", "colRight"], ["删除所选列", "delCols"]]);
    });
    rowhead.addEventListener("contextmenu", (e) => {
      const h = e.target.closest("[data-row]");
      if (!h || !canEdit) return;
      e.preventDefault();
      headerMenu(e, [["在上方插入行", "rowAbove"], ["在下方插入行", "rowBelow"], ["删除所选行", "delRows"]]);
    });
    space.addEventListener("contextmenu", (e) => {
      if (!canEdit) return;
      e.preventDefault();
      const { r, c } = cellAt(e);
      const b = bounds();
      if (r < b.r1 || r > b.r2 || c < b.c1 || c > b.c2) select(r, c);
      headerMenu(e, [["在上方插入行", "rowAbove"], ["在下方插入行", "rowBelow"], ["在左侧插入列", "colLeft"], ["在右侧插入列", "colRight"], ["删除所选行", "delRows"], ["删除所选列", "delCols"], ["清除内容", "clear"]]);
    });
    function headerMenu(e, items) {
      document.querySelector(".sheet-menu")?.remove();
      const m = document.createElement("div");
      m.className = "sheet-menu doc-block-menu";
      m.innerHTML = items.map(([l, a]) => `<button data-sh="${a}">${l}</button>`).join("");
      document.body.append(m);
      m.style.left = Math.min(e.clientX, innerWidth - 180) + "px";
      m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 8) + "px";
      m.addEventListener("mousedown", (ev) => {
        const b = ev.target.closest("[data-sh]");
        if (b) {
          ev.preventDefault();
          command(b.dataset.sh);
          m.remove();
        }
      });
      setTimeout(() => document.addEventListener("mousedown", function off(ev) {
        if (!m.contains(ev.target)) {
          m.remove();
          document.removeEventListener("mousedown", off);
        }
      }), 0);
    }
    grid.addEventListener("keydown", (e) => {
      if (editing || e.target === bar) return;
      const mod = e.ctrlKey || e.metaKey;
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[e.key]) {
        e.preventDefault();
        const [dr, dc] = moves[e.key];
        if (mod) {
          let r = e.shiftKey ? sel.r2 : sel.ar, c = e.shiftKey ? sel.c2 : sel.ac;
          const p = page();
          const filled = (r2, c2) => !!p.cells[refName(c2, r2)]?.v;
          const step = () => {
            r += dr;
            c += dc;
          };
          const start = filled(r, c);
          step();
          if (start && filled(r, c)) {
            while (r > 1 && c > 1 && r < size.rows && c < size.cols && filled(r + dr, c + dc)) step();
          } else {
            while (r > 1 && c > 1 && r < size.rows && c < size.cols && !filled(r, c)) step();
          }
          select(r, c, e.shiftKey);
          return;
        }
        if (e.shiftKey) select(sel.r2 + dr, sel.c2 + dc, true);
        else select(sel.ar + dr, sel.ac + dc);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) select(sel.ar - 1, sel.ac);
        else startEdit();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        select(sel.ar, sel.ac + (e.shiftKey ? -1 : 1));
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        startEdit();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        select(mod ? 1 : sel.ar, 1);
        return;
      }
      if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        const n = Math.floor(scroll.clientHeight / ROW_H);
        select(sel.ar + (e.key === "PageDown" ? n : -n), sel.ac);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        clearRange();
        return;
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          command("undo");
          return;
        }
        if (k === "y" || k === "z" && e.shiftKey) {
          e.preventDefault();
          command("redo");
          return;
        }
        if (k === "b" || k === "i" || k === "u") {
          e.preventDefault();
          style({ [k]: true });
          return;
        }
        if (k === "a") {
          e.preventDefault();
          sel = { r1: 1, c1: 1, r2: size.rows, c2: size.cols, ar: sel.ar, ac: sel.ac };
          redraw();
          return;
        }
        return;
      }
      if (e.key.length === 1 && !mod && !e.altKey && canEdit) {
        e.preventDefault();
        startEdit(e.key);
      }
    });
    grid.addEventListener("copy", (e) => {
      if (editing) return;
      e.preventDefault();
      copy(e.clipboardData, false);
    });
    grid.addEventListener("cut", (e) => {
      if (editing) return;
      e.preventDefault();
      copy(e.clipboardData, true);
    });
    grid.addEventListener("paste", (e) => {
      if (editing || !canEdit) return;
      e.preventDefault();
      paste(e.clipboardData.getData("text/plain"));
    });
    function copy(data, cut) {
      const b = bounds(), p = page();
      const rows = [], raws = [];
      for (let r = b.r1; r <= Math.min(b.r2, size.rows); r++) {
        const line = [], raw = [];
        for (let c = b.c1; c <= Math.min(b.c2, size.cols); c++) {
          const cell = p.cells[refName(c, r)];
          line.push(display(cell ? value(p, c, r) : null));
          raw.push(cell ? { ...cell } : null);
        }
        rows.push(line);
        raws.push(raw);
      }
      const text = rows.map((r) => r.map((v) => /[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join("	")).join("\n");
      data.setData("text/plain", text);
      clip = { text, raws, r: b.r1, c: b.c1 };
      if (cut) clearRange();
    }
    function parseTSV(text) {
      const rows = [];
      let row = [], cur = "", q = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
          if (ch === '"') {
            if (text[i + 1] === '"') {
              cur += '"';
              i++;
            } else q = false;
          } else cur += ch;
        } else if (ch === '"' && cur === "") q = true;
        else if (ch === "	") {
          row.push(cur);
          cur = "";
        } else if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && text[i + 1] === "\n") i++;
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        } else cur += ch;
      }
      if (cur !== "" || row.length) {
        row.push(cur);
        rows.push(row);
      }
      return rows;
    }
    function paste(text) {
      const p = page(), g = [], r0 = sel.ar, c0 = sel.ac;
      if (clip && clip.text === text) {
        clip.raws.forEach((row, i) => row.forEach((cell, j) => {
          const ref = refName(c0 + j, r0 + i);
          if (c0 + j > 200 || r0 + i > 5e4) return;
          const v = cell?.v?.startsWith("=") ? moveRefs(cell.v, c0 - clip.c, r0 - clip.r) : cell?.v;
          setCell(p, ref, cell ? { ...cell, v } : null, g);
        }));
      } else {
        const rows = parseTSV(text.replace(/\n$/, ""));
        if (rows.length * Math.max(...rows.map((r) => r.length)) > 5e4) {
          toast2("一次最多粘贴 5 万个单元格");
          return;
        }
        rows.forEach((row, i) => row.forEach((v, j) => {
          if (c0 + j > 200 || r0 + i > 5e4) return;
          const ref = refName(c0 + j, r0 + i), old = p.cells[ref];
          setCell(p, ref, { ...old || {}, v }, g);
        }));
      }
      commit(g);
    }
    function structural(op, at, n) {
      queueOps.push({ op, sheet: page().id, at, n });
      onChange();
    }
    function command(cmd) {
      const b = bounds();
      switch (cmd) {
        case "undo": {
          const g = undo.pop();
          if (g) {
            revert(g, true);
            redo.push(g);
          }
          break;
        }
        case "redo": {
          const g = redo.pop();
          if (g) {
            revert(g, false);
            undo.push(g);
          }
          break;
        }
        case "b":
        case "i":
        case "u":
        case "s":
          style({ [cmd]: true });
          break;
        case "left":
        case "center":
        case "right":
          style({ a: cmd });
          break;
        case "clearStyle":
          if (canEdit) {
            const p = page();
            eachSelected((r, c, g) => {
              const ref = refName(c, r), old = p.cells[ref];
              if (old?.s) setCell(p, ref, old.v ? { v: old.v } : null, g);
            });
          }
          break;
        case "clear":
          clearRange();
          break;
        case "rowAbove":
          structural("insertRows", b.r1, b.r2 - b.r1 + 1);
          break;
        case "rowBelow":
          structural("insertRows", b.r2 + 1, b.r2 - b.r1 + 1);
          break;
        case "colLeft":
          structural("insertCols", b.c1, b.c2 - b.c1 + 1);
          break;
        case "colRight":
          structural("insertCols", b.c2 + 1, b.c2 - b.c1 + 1);
          break;
        case "delRows":
          if (b.r2 - b.r1 + 1 >= size.rows - 1) {
            toast2("请先选择要删除的行");
            break;
          }
          structural("deleteRows", b.r1, b.r2 - b.r1 + 1);
          break;
        case "delCols":
          if (b.c2 - b.c1 + 1 >= size.cols - 1) {
            toast2("请先选择要删除的列");
            break;
          }
          structural("deleteCols", b.c1, b.c2 - b.c1 + 1);
          break;
        case "sum": {
          if (!canEdit) break;
          const p = page();
          let r = b.r2 + 1, c = b.c1;
          if (b.r1 === b.r2 && b.c1 === b.c2) {
            let top = b.r1 - 1;
            while (top >= 1 && typeof value(p, c, top) === "number") top--;
            if (top === b.r1 - 1) {
              toast2("上方没有可以求和的数字");
              break;
            }
            writeValue(b.r1, c, `=SUM(${refName(c, top + 1)}:${refName(c, b.r1 - 1)})`);
            break;
          }
          const g = [];
          for (let col = b.c1; col <= b.c2; col++) setCell(p, refName(col, r), { v: `=SUM(${refName(col, b.r1)}:${refName(col, b.r2)})` }, g);
          commit(g);
          select(r, b.c1);
          break;
        }
        case "addSheet": {
          let n = pages.length + 1;
          while (byName("Sheet" + n)) n++;
          const id = newId();
          afterAdd = id;
          queueOps.push({ op: "addSheet", page: { id, name: "Sheet" + n } });
          onChange();
          break;
        }
        case "ai":
          askAI?.();
          break;
      }
    }
    mount.querySelector(".sheet-toolbar").addEventListener("mousedown", (e) => {
      const b = e.target.closest("[data-sh]");
      if (b) {
        e.preventDefault();
        if (!canEdit && !["ai"].includes(b.dataset.sh)) {
          toast2("你只有阅读权限");
          return;
        }
        command(b.dataset.sh);
        grid.focus({ preventScroll: true });
      }
    });
    mount.querySelectorAll("[data-sh-color]").forEach((input) => input.addEventListener("change", () => {
      style({ [input.dataset.shColor]: input.value });
      grid.focus({ preventScroll: true });
    }));
    const tabs = $2(".sheet-tabs");
    tabs.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) {
        switchTo(+t.dataset.tab);
        return;
      }
      const a = e.target.closest("[data-sh]");
      if (a) command(a.dataset.sh);
    });
    tabs.addEventListener("dblclick", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t && canEdit) rename(+t.dataset.tab);
    });
    tabs.addEventListener("contextmenu", (e) => {
      const t = e.target.closest("[data-tab]");
      if (!t || !canEdit) return;
      e.preventDefault();
      const i = +t.dataset.tab;
      document.querySelector(".sheet-menu")?.remove();
      const m = document.createElement("div");
      m.className = "sheet-menu doc-block-menu";
      m.innerHTML = `<button data-tab-op="rename">重命名</button><button data-tab-op="left">左移</button><button data-tab-op="right">右移</button><button data-tab-op="delete" class="danger">删除工作表</button>`;
      document.body.append(m);
      m.style.left = e.clientX + "px";
      m.style.top = Math.max(8, e.clientY - m.offsetHeight) + "px";
      m.addEventListener("mousedown", async (ev) => {
        const b = ev.target.closest("[data-tab-op]");
        if (!b) return;
        ev.preventDefault();
        m.remove();
        const op = b.dataset.tabOp, p = pages[i];
        if (op === "rename") rename(i);
        else if (op === "delete") {
          if (pages.length === 1) {
            toast2("至少保留一个工作表");
            return;
          }
          if (await confirmDialog("引用它的公式会显示 #REF!。", { title: `删除工作表“${p.name}”`, ok: "删除", danger: true })) {
            queueOps.push({ op: "deleteSheet", sheet: p.id });
            onChange();
          }
        } else {
          const at = op === "left" ? i - 1 : i + 1;
          if (at >= 0 && at < pages.length) {
            queueOps.push({ op: "moveSheet", sheet: p.id, at });
            onChange();
          }
        }
      });
      setTimeout(() => document.addEventListener("mousedown", function off(ev) {
        if (!m.contains(ev.target)) {
          m.remove();
          document.removeEventListener("mousedown", off);
        }
      }), 0);
    });
    async function rename(i) {
      const p = pages[i];
      const name = await inputDialog("工作表名称", { value: p.name, max: 31 });
      if (name === null || !name.trim() || name.trim() === p.name) return;
      queueOps.push({ op: "renameSheet", sheet: p.id, name: name.trim() });
      onChange();
    }
    function switchTo(i) {
      if (editing) finishEdit(true);
      active = Math.max(0, Math.min(pages.length - 1, i));
      sel = { r1: 1, c1: 1, r2: 1, c2: 1, ar: 1, ac: 1 };
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
      drawTabs();
      redraw();
      onWhere(page().id + "!A1");
    }
    function collect() {
      const ops = queueOps;
      queueOps = [];
      for (const op of ops) if (op.op === "cell") inflight.set(op.sheet + "!" + op.ref, pendingKeys.get(op.sheet + "!" + op.ref));
      return ops;
    }
    function reapply(p) {
      for (const [key] of pendingKeys) {
        const [sid, ref] = key.split("!");
        if (sid !== p.id) continue;
        const local = localCells.get(key);
        if (local === null) delete p.cells[ref];
        else if (local) p.cells[ref] = local;
      }
    }
    const localCells = /* @__PURE__ */ new Map();
    const trackLocal = () => {
      for (const [key] of pendingKeys) {
        const [sid, ref] = key.split("!");
        const p = pages.find((x) => x.id === sid);
        localCells.set(key, p?.cells[ref] ?? null);
      }
    };
    function apply(msg, own) {
      trackLocal();
      const curId = page()?.id;
      for (const op of msg.ops || []) {
        if (op.op === "cell") {
          const key = op.sheet + "!" + op.ref;
          if (own) {
            if (pendingKeys.get(key) === inflight.get(key)) pendingKeys.delete(key);
            continue;
          }
          if (pendingKeys.has(key)) continue;
          const p = pages.find((x) => x.id === op.sheet);
          if (!p) continue;
          if (op.cell) p.cells[op.ref] = op.cell;
          else delete p.cells[op.ref];
        } else if (op.op === "width") {
          const p = pages.find((x) => x.id === op.sheet);
          if (p) p.cols = { ...p.cols, [op.col]: op.width };
        } else if (op.op === "page") {
          const next = { ...op.page, cells: { ...op.page.cells || {} }, cols: { ...op.page.cols || {} } };
          const i2 = pages.findIndex((x) => x.id === next.id);
          if (i2 >= 0) pages[i2] = next;
          else pages.push(next);
          reapply(next);
        } else if (op.op === "pages") {
          const byId = new Map(pages.map((p) => [p.id, p]));
          pages = op.pages.map((m) => {
            const p = byId.get(m.id) || { id: m.id, cells: {}, cols: {} };
            p.name = m.name;
            return p;
          });
        }
      }
      if (own) inflight.clear();
      let i = pages.findIndex((p) => p.id === (afterAdd && pages.some((p2) => p2.id === afterAdd) ? afterAdd : curId));
      if (afterAdd && pages.some((p) => p.id === afterAdd)) afterAdd = "";
      active = i < 0 ? Math.min(active, pages.length - 1) : i;
      calc.clear();
      drawTabs();
      redraw();
    }
    function reset(content2) {
      trackLocal();
      pages = (content2.sheets || []).map((p) => ({ ...p, cells: { ...p.cells || {} }, cols: { ...p.cols || {} } }));
      for (const p of pages) reapply(p);
      active = Math.min(active, pages.length - 1);
      calc.clear();
      drawTabs();
      redraw();
    }
    drawTabs();
    requestAnimationFrame(draw);
    return {
      collect,
      apply,
      reset,
      discardInflight() {
        inflight.clear();
      },
      hasPending: () => queueOps.length > 0,
      setEditable(v) {
        canEdit = v;
        mount.querySelector(".sheet").classList.toggle("readonly", !v);
        drawTabs();
      },
      viewers(list) {
        peers = list;
        drawPeers();
      },
      selection() {
        const b = bounds();
        return `${page().name}!${refName(b.c1, b.r1)}:${refName(b.c2, b.r2)}`;
      },
      values() {
        const out = {};
        let n = 0;
        for (const p of pages) for (const ref in p.cells) {
          if (n >= 5e4) break;
          if (p.cells[ref].v?.startsWith("=")) {
            const q = parseRef(ref);
            out[p.id + "!" + ref] = display(calc.value(p.name, q.col, q.row));
            n++;
          }
        }
        return out;
      },
      applyEdit(edit) {
        if (!canEdit || edit.op !== "cell") return false;
        const p = byName(edit.sheet) || page();
        const q = parseRef(edit.ref || "");
        if (!q) return false;
        const g = [];
        setCell(p, refName(q.col, q.row), { ...p.cells[refName(q.col, q.row)] || {}, v: String(edit.v ?? "") }, g);
        commit(g);
        if (p === page()) select(q.row, q.col);
        return true;
      },
      focus() {
        grid.focus({ preventScroll: true });
      },
      activeSheet: () => page().id,
      functions: functionNames,
      destroy() {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        ro.disconnect();
        cancelAnimationFrame(frame);
        document.querySelector(".sheet-menu")?.remove();
      }
    };
  }

  // internal/ui/src/docs.js
  var ROLE_LABEL = { owner: "所有者", manage: "可管理", edit: "可编辑", view: "可阅读" };
  var RANK = { view: 1, edit: 2, manage: 3, owner: 4 };
  var DOC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6Z"/><path d="M14 2v6h6M9 13h8M9 17h6"/></svg>';
  var SHEET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16v18H4ZM4 9h16M4 15h16M10 3v18"/></svg>';
  var docIcon = (kind) => `<span class="docs-icon ${kind === "sheet" ? "is-sheet" : "is-doc"}">${kind === "sheet" ? SHEET_ICON : DOC_ICON}</span>`;
  var DOC_MARK = /^\[(文档|表格)\] ([^\n]*)\nlinkme-doc:([a-f0-9]{32})$/;
  function createDocs({ S: S2, api: api2, esc: esc4, av: av2, modal: modal2, closeModal: closeModal2, toast: toast2, downloadURL: downloadURL2, showDocsTab: showDocsTab2, when }) {
    const $2 = (s) => document.querySelector(s);
    let scope = "recent", query = "", list = null, loading = 0, current = null, listTimer = 0;
    const clientId = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
    const timeText = (t) => t ? when(t) : "";
    async function loadList() {
      const ticket = ++loading;
      try {
        const items = await api2(`/api/docs?scope=${scope}${query ? "&q=" + encodeURIComponent(query) : ""}`);
        if (ticket !== loading) return;
        list = items;
        if (S2.tab === "docs" && !current) drawHome();
      } catch (e) {
        if (ticket === loading) {
          list = [];
          toast2(e.message);
          if (S2.tab === "docs" && !current) drawHome();
        }
      }
    }
    function row(d) {
      const mine = d.ownerId === S2.user.id;
      return `<div class="docs-row" data-open-doc="${d.id}" role="button" tabindex="0">${docIcon(d.kind)}<span class="docs-name"><b>${esc4(d.title)}</b><small>${mine ? "我" : esc4(d.ownerName || "")} · ${scope === "recent" && d.opened ? "最近打开 " + timeText(d.opened) : "更新于 " + timeText(d.updated)}${d.updatedByName && d.updatedByName !== S2.user.name ? " · " + esc4(d.updatedByName) + " 修改" : ""}</small></span><span class="docs-role role-${d.role}">${ROLE_LABEL[d.role] || ""}</span><button class="icon-btn docs-more" data-docs-more="${d.id}" aria-label="更多操作">⋯</button></div>`;
    }
    function drawHome() {
      const main = $2("#main-content");
      if (!main) return;
      const items = list || [];
      main.innerHTML = `<section class="docs-home">
   <header class="docs-head"><div><h2>云文档</h2><p>多人实时协作的文档和表格，可导入导出 Word、Excel 和 Markdown</p></div>
   <div class="docs-actions"><button class="primary" data-docs="new-doc">${DOC_ICON}新建文档</button><button class="secondary" data-docs="new-sheet">${SHEET_ICON}新建表格</button><button class="secondary" data-docs="import">导入</button><input type="file" id="docs-import" hidden accept=".md,.markdown,.txt,.docx,.xlsx,.csv"></div></header>
   <div class="docs-filter"><nav class="docs-tabs" role="tablist">${[["recent", "最近"], ["mine", "我的"], ["shared", "与我共享"]].map(([k, l]) => `<button role="tab" aria-selected="${scope === k}" class="${scope === k ? "active" : ""}" data-docs-scope="${k}">${l}</button>`).join("")}</nav>
   <label class="docs-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4"/></svg><input id="docs-search" placeholder="搜索文档标题" value="${esc4(query)}" maxlength="100"></label></div>
   <div class="docs-list">${list === null ? '<p class="docs-empty">正在加载…</p>' : items.length ? items.map(row).join("") : `<div class="docs-empty"><b>${query ? "没有找到相关文档" : scope === "shared" ? "还没有人与你共享文档" : "还没有文档"}</b><p>${scope === "shared" ? "别人分享给你或分享到群里的文档会出现在这里" : "新建一篇文档或表格，邀请同事一起编辑"}</p></div>`}</div>
  </section>`;
      const search = $2("#docs-search");
      search.oninput = () => {
        query = search.value.trim();
        clearTimeout(listTimer);
        listTimer = setTimeout(loadList, 250);
      };
      $2("#docs-import").onchange = (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f) importFile(f);
      };
    }
    async function create(kind) {
      try {
        const { id } = await api2("/api/docs", { method: "POST", body: { kind, title: "" } });
        await open2(id, { fresh: true });
      } catch (e) {
        toast2(e.message);
      }
    }
    async function importFile(file) {
      if (file.size > 20 * 1024 * 1024) {
        toast2("请选择 20 MB 以内的文件");
        return;
      }
      const form = new FormData();
      form.append("file", file);
      toast2("正在导入 " + file.name + "…");
      try {
        const { id } = await api2("/api/docs/import", { method: "POST", body: form });
        toast2("导入完成");
        await open2(id);
      } catch (e) {
        toast2(e.message);
      }
    }
    function moreMenu(id, anchor) {
      const d = (list || []).find((x) => x.id === id);
      if (!d) return;
      document.querySelector(".doc-block-menu")?.remove();
      const box = document.createElement("div");
      box.className = "doc-block-menu";
      box.innerHTML = `<button data-docs-op="open">打开</button>${RANK[d.role] >= 2 ? '<button data-docs-op="rename">重命名</button>' : ""}${d.role === "owner" ? '<button data-docs-op="delete" class="danger">删除</button>' : '<button data-docs-op="leave" class="danger">移出我的列表</button>'}`;
      document.body.append(box);
      const r = anchor.getBoundingClientRect();
      box.style.left = Math.min(r.left, innerWidth - 170) + "px";
      box.style.top = Math.min(r.bottom + 4, innerHeight - box.offsetHeight - 8) + "px";
      box.addEventListener("mousedown", async (e) => {
        const b = e.target.closest("[data-docs-op]");
        if (!b) return;
        e.preventDefault();
        box.remove();
        const op = b.dataset.docsOp;
        try {
          if (op === "open") await open2(id);
          else if (op === "rename") {
            const t = await inputDialog("文档标题", { value: d.title, max: 100 });
            if (t !== null && t.trim() && t.trim() !== d.title) {
              await api2("/api/docs/" + id, { method: "PATCH", body: { title: t.trim() } });
              await loadList();
            }
          } else if (op === "delete") {
            if (await confirmDialog("所有协作者都将无法再打开，且无法恢复。", { title: `删除“${d.title}”`, ok: "删除", danger: true })) {
              await api2("/api/docs/" + id, { method: "DELETE" });
              toast2("已删除");
              await loadList();
            }
          } else if (op === "leave") {
            if (await confirmDialog("如果是直接分享给你的，你将失去访问权限。", { title: `将“${d.title}”移出列表`, ok: "移出" })) {
              await api2(`/api/docs/${id}/members/${S2.user.id}`, { method: "DELETE" });
              await loadList();
            }
          }
        } catch (err) {
          toast2(err.message);
        }
      });
      setTimeout(() => document.addEventListener("mousedown", function off(ev) {
        if (!box.contains(ev.target)) {
          box.remove();
          document.removeEventListener("mousedown", off);
        }
      }), 0);
    }
    function createSync(doc) {
      let version = doc.version, inflight = null, timer = 0, gap = 0, batch = 0, closed = false, retry = 0;
      const buffer = /* @__PURE__ */ new Map();
      const state = (s) => {
        const el = $2(".doc-save");
        if (el && current?.sync === api_) {
          el.textContent = s;
          el.dataset.state = s;
        }
      };
      const api_ = {
        schedule(delay = 120) {
          if (closed && !doc.editor.hasPending()) return;
          clearTimeout(timer);
          timer = setTimeout(flush, delay);
          state("保存中…");
        },
        receive(msg) {
          if (msg.clientId === clientId || msg.version <= version) return;
          buffer.set(msg.version, msg);
          drain();
        },
        close() {
          closed = true;
          if (doc.editor.hasPending()) flush();
        },
        get version() {
          return version;
        }
      };
      async function flush() {
        if (inflight || current?.sync !== api_ && !closed) return;
        const ops = doc.editor.collect();
        if (!ops.length) {
          if (!inflight) state("已保存");
          return;
        }
        inflight = { batch: String(++batch), ops };
        send();
      }
      async function send() {
        const sending = inflight;
        try {
          const r = await api2(`/api/docs/${doc.id}/ops`, { method: "POST", body: { clientId, batch: sending.batch, ops: sending.ops } });
          retry = 0;
          buffer.set(r.version, { ...r, own: true });
          drain();
        } catch (e) {
          if (e.name === "AbortError") return;
          if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
            inflight = null;
            doc.editor.discardInflight();
            toast2(e.message);
            state("未保存");
            if (e.status === 403) refreshAccess();
            else resync();
            return;
          }
          state("网络异常，正在重试…");
          setTimeout(() => {
            if (inflight === sending) send();
          }, Math.min(1e4, 1e3 * 2 ** retry++));
        }
      }
      function drain() {
        clearTimeout(gap);
        for (const v of [...buffer.keys()]) if (v <= version) buffer.delete(v);
        while (buffer.has(version + 1)) {
          const m = buffer.get(version + 1);
          buffer.delete(version + 1);
          version++;
          doc.editor.apply(m, !!m.own);
          if (m.own) {
            inflight = null;
            state(doc.editor.hasPending() ? "保存中…" : "已保存");
            api_.schedule(30);
          }
        }
        if (buffer.size) gap = setTimeout(() => {
          if (buffer.size) resync();
        }, 2500);
      }
      async function resync() {
        if (inflight) {
          gap = setTimeout(resync, 1e3);
          return;
        }
        try {
          const fresh = await api2("/api/docs/" + doc.id);
          if (current?.sync !== api_) return;
          version = fresh.version;
          for (const v of [...buffer.keys()]) if (v <= version) buffer.delete(v);
          doc.editor.reset(fresh.content);
          drain();
          api_.schedule(30);
        } catch (e) {
          toast2(e.message);
        }
      }
      return api_;
    }
    let presenceTimer = 0, where = "";
    async function presence(leave = false) {
      const doc = current;
      if (!doc) return;
      try {
        const r = await api2(`/api/docs/${doc.id}/presence`, { method: "POST", body: { clientId, where: leave ? "" : where, leave } });
        if (!leave && current === doc) viewers(r.viewers);
      } catch {
      }
    }
    function viewers(list2) {
      if (!current) return;
      const others = list2.filter((v) => v.clientId !== clientId);
      current.viewers = others;
      const seen = /* @__PURE__ */ new Map();
      for (const v of others) if (!seen.has(v.userId)) seen.set(v.userId, v);
      const box = $2(".doc-viewers");
      if (box) box.innerHTML = [...seen.values()].slice(0, 6).map((v) => `<span class="doc-viewer" style="--peer:${peerColor(v.userId)}" title="${esc4(v.name)} 正在${current.kind === "sheet" ? "查看" : "编辑"}">${av2({ id: v.userId, name: v.name, avatar: v.avatar })}</span>`).join("") + (seen.size > 6 ? `<span class="doc-viewer more">+${seen.size - 6}</span>` : "");
      current.editor.viewers(others);
    }
    let whereTimer = 0;
    function setWhere(w) {
      where = w;
      clearTimeout(whereTimer);
      whereTimer = setTimeout(() => presence(), 150);
    }
    async function open2(id, { fresh = false } = {}) {
      if (S2.tab !== "docs") {
        showDocsTab2(id);
        return;
      }
      closeDoc();
      const main = $2("#main-content");
      if (main) main.innerHTML = '<section class="docs-home"><p class="docs-empty">正在打开文档…</p></section>';
      let doc;
      try {
        doc = await api2("/api/docs/" + id);
      } catch (e) {
        toast2(e.message);
        current = null;
        drawHome();
        loadList();
        return;
      }
      if (S2.tab !== "docs") return;
      current = { ...doc, viewers: [], fresh };
      drawDoc();
    }
    function drawDoc() {
      const doc = current, main = $2("#main-content");
      if (!main || !doc) return;
      const canEdit = RANK[doc.role] >= 2, manage = RANK[doc.role] >= 3;
      main.innerHTML = `<section class="doc-page kind-${doc.kind}">
   <header class="doc-bar">
    <button class="icon-btn" data-docs="back" title="返回文档列表" aria-label="返回文档列表"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
    ${docIcon(doc.kind)}<div class="doc-crumb"><span class="doc-bar-title">${esc4(doc.title)}</span><small class="doc-save">已保存</small></div>
    <span class="doc-role-tag role-${doc.role}">${ROLE_LABEL[doc.role]}</span>
    <div class="doc-viewers"></div>
    ${doc.aiEnabled ? '<button class="secondary doc-ai-btn" data-docs="ai" title="AI 检查、整理、分析和修改">✦ AI 助手</button>' : ""}
    <button class="primary" data-docs="share">${manage ? "分享" : "协作者"}</button>
    <button class="icon-btn" data-docs="more" aria-label="更多操作" title="导出、历史版本等">⋯</button>
   </header>
   <div class="doc-main">
    ${doc.kind === "doc" ? '<nav class="doc-outline" aria-label="目录"></nav>' : ""}
    <div class="doc-scroll">${doc.kind === "doc" ? `<article class="doc-paper"><h1 class="doc-title" ${canEdit ? 'contenteditable="plaintext-only"' : ""} data-placeholder="请输入标题" spellcheck="false">${esc4(doc.title)}</h1><div class="doc-info">${av2(doc.owner)}<span>${esc4(doc.owner.name)} 创建 · 更新于 ${timeText(doc.updated)}</span></div><div class="doc-mount"></div></article>` : '<div class="doc-mount sheet-mount"></div>'}</div>
    <aside class="doc-ai hidden" aria-label="AI 助手"></aside>
   </div></section>`;
      const mount = main.querySelector(".doc-mount");
      const options = { mount, content: doc.content, editable: canEdit, newId, onChange: () => doc.sync?.schedule(), onWhere: setWhere, toast: toast2, esc: esc4, askAI: doc.aiEnabled ? (ids) => openAI(ids) : null };
      doc.editor = doc.kind === "sheet" ? createSheetEditor(options) : createDocEditor({ ...options, outline: main.querySelector(".doc-outline") });
      doc.sync = createSync(doc);
      const title = main.querySelector(".doc-title");
      if (title) {
        title.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            doc.kind === "doc" ? doc.editor.focusStart() : title.blur();
          }
        });
        title.addEventListener("blur", () => saveTitle(title.textContent));
        title.addEventListener("paste", (e) => {
          e.preventDefault();
          document.execCommand("insertText", false, (e.clipboardData.getData("text/plain") || "").replace(/\s+/g, " "));
        });
        if (doc.fresh && canEdit) {
          title.textContent = "";
          title.focus();
        }
      }
      presence();
      clearInterval(presenceTimer);
      presenceTimer = setInterval(() => presence(), 15e3);
    }
    async function saveTitle(text) {
      const doc = current;
      if (!doc) return;
      const t = text.trim() || (doc.kind === "sheet" ? "未命名表格" : "未命名文档");
      if (t === doc.title) {
        const el = $2(".doc-title");
        if (el && !el.textContent.trim()) el.textContent = t;
        return;
      }
      try {
        await api2("/api/docs/" + doc.id, { method: "PATCH", body: { title: t } });
        doc.title = t;
        const bar = $2(".doc-bar-title");
        if (bar) bar.textContent = t;
      } catch (e) {
        toast2(e.message);
      }
    }
    function closeDoc() {
      if (!current) return;
      const doc = current;
      current = null;
      clearInterval(presenceTimer);
      doc.sync?.close();
      doc.editor?.destroy();
      api2(`/api/docs/${doc.id}/presence`, { method: "POST", body: { clientId, where: "", leave: true } }).catch(() => {
      });
    }
    async function refreshAccess() {
      const doc = current;
      if (!doc) return;
      try {
        const fresh = await api2("/api/docs/" + doc.id);
        if (current !== doc) return;
        if (fresh.role !== doc.role) {
          const before = doc.role;
          doc.role = fresh.role;
          doc.canExport = fresh.canExport;
          doc.editor.setEditable(RANK[fresh.role] >= 2);
          const tag = $2(".doc-role-tag");
          if (tag) {
            tag.textContent = ROLE_LABEL[fresh.role];
            tag.className = "doc-role-tag role-" + fresh.role;
          }
          toast2(`你的权限已变为“${ROLE_LABEL[fresh.role]}”`);
          if (RANK[before] >= 3 !== RANK[fresh.role] >= 3) {
            const b = $2("[data-docs=share]");
            if (b) b.textContent = RANK[fresh.role] >= 3 ? "分享" : "协作者";
          }
        }
        doc.canExport = fresh.canExport;
      } catch (e) {
        if (current !== doc) return;
        toast2(e.status === 404 ? "文档已被删除" : "你已没有该文档的访问权限");
        closeDoc();
        drawHome();
        loadList();
      }
    }
    async function share() {
      const doc = current;
      if (!doc) return;
      let info;
      try {
        info = await api2(`/api/docs/${doc.id}/members`);
      } catch (e) {
        toast2(e.message);
        return;
      }
      const manage = RANK[info.role] >= 3;
      const roleSelect = (value, attrs, allowManage = true) => `<select ${attrs} ${manage ? "" : "disabled"}>${["view", "edit", ...allowManage ? ["manage"] : []].map((r) => `<option value="${r}" ${r === value ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>`;
      const chats = S2.conversations.filter((c) => !c.peer?.ai);
      modal2("分享“" + esc4(doc.title) + "”", `<div class="share">
   ${manage ? `<div class="share-add"><input id="share-search" placeholder="搜索好友或群聊，添加协作者" autocomplete="off"><select id="share-role"><option value="view">可阅读</option><option value="edit" selected>可编辑</option><option value="manage">可管理</option></select></div><div id="share-results" class="share-results"></div>` : '<p class="hint">只有所有者和“可管理”的协作者可以调整权限。</p>'}
   <h5>协作者</h5><div class="share-list">
    ${info.people.map((p) => `<div class="share-person">${av2(p)}<span><b>${esc4(p.name)}${p.id === S2.user.id ? "（我）" : ""}</b><small>${p.number ? "LinkMe 号 " + esc4(p.number) : ""}</small></span>${p.role === "owner" ? "<em>所有者</em>" : roleSelect(p.role, `data-share-user="${p.id}"`) + (manage || p.id === S2.user.id ? `<button class="icon-btn" data-share-remove="${p.id}" title="${p.id === S2.user.id ? "退出协作" : "移除"}" aria-label="移除">×</button>` : "")}</div>`).join("")}
    ${info.chats.map((c) => `<div class="share-person"><span class="avatar">${docIcon("doc").replace("docs-icon is-doc", "docs-icon is-chat")}</span><span><b>${esc4(c.name)}</b><small>群聊 · ${c.count} 人</small></span>${roleSelect(c.role, `data-share-chat="${c.id}"`, false)}${manage ? `<button class="icon-btn" data-share-unchat="${c.id}" aria-label="移除">×</button>` : ""}</div>`).join("")}
   </div>
   <h5>链接分享</h5>
   <div class="share-row"><select id="share-link" ${manage ? "" : "disabled"}><option value="none" ${!info.linkRole ? "selected" : ""}>关闭：仅协作者可访问</option><option value="view" ${info.linkRole === "view" ? "selected" : ""}>获得链接的 LinkMe 用户可阅读</option><option value="edit" ${info.linkRole === "edit" ? "selected" : ""}>获得链接的 LinkMe 用户可编辑</option></select><button class="secondary" id="share-copy">复制链接</button></div>
   <label class="share-check"><input type="checkbox" id="share-export" ${info.viewerExport ? "checked" : ""} ${manage ? "" : "disabled"}> 允许“可阅读”的人导出和下载</label>
   <h5>发送到聊天</h5>
   <div class="share-row"><select id="share-chat">${chats.map((c) => `<option value="${c.id}">${esc4(c.name)}${c.kind === "group" ? "（群）" : ""}</option>`).join("")}</select>${manage ? `<select id="share-grant"><option value="none">仅发送</option><option value="view" selected>并授予可阅读</option><option value="edit">并授予可编辑</option></select>` : ""}<button class="primary" id="share-send" ${chats.length ? "" : "disabled"}>发送</button></div>
  </div>`, '<button class="secondary" data-action="close-modal">完成</button>');
      const root = document.querySelector(".modal .share");
      if (!root) return;
      const refresh2 = () => {
        closeModal2();
        share();
      };
      const run = async (work, msg) => {
        try {
          await work();
          if (msg) toast2(msg);
          refresh2();
        } catch (e) {
          toast2(e.message);
        }
      };
      root.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset.shareUser) run(() => api2(`/api/docs/${doc.id}/members/${t.dataset.shareUser}`, { method: "PUT", body: { role: t.value } }), "权限已更新");
        else if (t.dataset.shareChat) run(() => api2(`/api/docs/${doc.id}/chats/${t.dataset.shareChat}`, { method: "PUT", body: { role: t.value } }), "权限已更新");
        else if (t.id === "share-link") run(() => api2("/api/docs/" + doc.id, { method: "PATCH", body: { linkRole: t.value } }), t.value === "none" ? "已关闭链接分享" : "已开启链接分享");
        else if (t.id === "share-export") run(() => api2("/api/docs/" + doc.id, { method: "PATCH", body: { viewerExport: t.checked } }));
      });
      root.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-share-remove]");
        if (rm) {
          const me = rm.dataset.shareRemove === S2.user.id;
          (async () => {
            if (me && !await confirmDialog("退出后你将无法再打开这篇文档。", { title: "退出协作", ok: "退出", danger: true })) return;
            run(async () => {
              await api2(`/api/docs/${doc.id}/members/${rm.dataset.shareRemove}`, { method: "DELETE" });
              if (me) {
                closeModal2();
                closeDoc();
                drawHome();
                loadList();
                throw Object.assign(Error("已退出协作"), { quiet: true });
              }
            }, "已移除");
          })();
          return;
        }
        const un = e.target.closest("[data-share-unchat]");
        if (un) {
          run(() => api2(`/api/docs/${doc.id}/chats/${un.dataset.shareUnchat}`, { method: "DELETE" }), "已移除");
          return;
        }
        const add = e.target.closest("[data-share-add]");
        if (add) {
          const role = $2("#share-role").value;
          const [kind, id] = add.dataset.shareAdd.split(":");
          run(() => kind === "user" ? api2(`/api/docs/${doc.id}/members/${id}`, { method: "PUT", body: { role } }) : api2(`/api/docs/${doc.id}/chats/${id}`, { method: "PUT", body: { role: role === "manage" ? "edit" : role } }), "已添加协作者");
          return;
        }
        if (e.target.id === "share-copy") {
          const text = `[${doc.kind === "sheet" ? "表格" : "文档"}] ${doc.title}
linkme-doc:${doc.id}`;
          navigator.clipboard?.writeText(text).then(() => toast2(info.linkRole ? "已复制，粘贴到聊天里即可打开" : "已复制。链接分享已关闭，只有协作者能打开"), () => toast2("复制失败"));
          return;
        }
        if (e.target.id === "share-send") {
          const cid = $2("#share-chat").value, grant = $2("#share-grant")?.value || "none";
          run(() => api2(`/api/docs/${doc.id}/send`, { method: "POST", body: { conversationId: cid, grant, clientId: "doc-" + newId() + newId() } }), "已发送到聊天");
        }
      });
      const search = $2("#share-search");
      if (search) search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase(), out = $2("#share-results");
        if (!q) {
          out.innerHTML = "";
          return;
        }
        const have = new Set(info.people.map((p) => p.id)), haveChats = new Set(info.chats.map((c) => c.id));
        const people = (S2.friends || []).filter((f) => !have.has(f.id) && ((f.name || "").toLowerCase().includes(q) || String(f.number || "").includes(q))).slice(0, 8);
        const groups = S2.conversations.filter((c) => c.kind === "group" && !haveChats.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 5);
        out.innerHTML = [...people.map((p) => `<button data-share-add="user:${p.id}">${av2(p)}<span>${esc4(p.name)}</span><small>${p.number ? "LinkMe 号 " + esc4(p.number) : "好友"}</small></button>`), ...groups.map((g) => `<button data-share-add="chat:${g.id}"><span class="avatar">#</span><span>${esc4(g.name)}</span><small>群聊 · 成员都能访问</small></button>`)].join("") || '<p class="hint">没有匹配的好友或群聊</p>';
      });
    }
    async function history() {
      const doc = current;
      if (!doc) return;
      let versions;
      try {
        versions = await api2(`/api/docs/${doc.id}/versions`);
      } catch (e) {
        toast2(e.message);
        return;
      }
      modal2("历史版本", `<div class="doc-history"><div class="doc-history-list">${versions.length ? versions.map((v) => `<button data-version="${v.id}"><b>${new Date(v.created).toLocaleString("zh-CN", { hour12: false })}</b><small>${esc4(v.authorName || "")} 编辑前的内容 · ${esc4(v.title)}</small></button>`).join("") : '<p class="hint">编辑一段时间后会自动保存历史版本（每 5 分钟最多一个）。</p>'}</div><div class="doc-history-view"><p class="hint">选择左侧的版本查看内容</p></div></div>`, '<button class="secondary" data-action="close-modal">关闭</button>', true);
      const box = document.querySelector(".doc-history");
      if (!box) return;
      box.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-version]");
        if (b) {
          box.querySelectorAll("[data-version]").forEach((x) => x.classList.toggle("active", x === b));
          const view = box.querySelector(".doc-history-view");
          view.innerHTML = '<p class="hint">正在加载…</p>';
          try {
            const v = await api2(`/api/docs/${doc.id}/versions/${b.dataset.version}`);
            view.innerHTML = `<div class="doc-history-head"><b>${esc4(v.title)}</b>${RANK[doc.role] >= 2 ? `<button class="primary" data-restore="${b.dataset.version}">恢复此版本</button>` : ""}</div><div class="doc-history-body">${previewHTML(doc.kind, v.content)}</div>`;
          } catch (err) {
            view.innerHTML = `<p class="hint">${esc4(err.message)}</p>`;
          }
          return;
        }
        const r = e.target.closest("[data-restore]");
        if (r && await confirmDialog("当前内容会先存为一个历史版本，可以再恢复回来。", { title: "恢复到这个版本", ok: "恢复" })) {
          try {
            await api2(`/api/docs/${doc.id}/versions/${r.dataset.restore}/restore`, { method: "POST", body: {} });
            closeModal2();
            toast2("已恢复到所选版本");
            await reopen();
          } catch (err) {
            toast2(err.message);
          }
        }
      });
    }
    function previewHTML(kind, content) {
      if (kind === "sheet") {
        const p = content.sheets?.[0];
        if (!p) return "";
        const refs = Object.keys(p.cells || {});
        let mr = 0, mc = 0;
        for (const r of refs) {
          const m = /^([A-Z]+)(\d+)$/.exec(r);
          if (m) {
            let c = 0;
            for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
            mr = Math.max(mr, +m[2]);
            mc = Math.max(mc, c);
          }
        }
        mr = Math.min(mr, 60);
        mc = Math.min(mc, 15);
        const col = (n2) => {
          let s = "";
          while (n2 > 0) {
            n2--;
            s = String.fromCharCode(65 + n2 % 26) + s;
            n2 = Math.floor(n2 / 26);
          }
          return s;
        };
        return `<p class="hint">${esc4(p.name)}${content.sheets.length > 1 ? ` 等 ${content.sheets.length} 个工作表` : ""}</p><table class="doc-preview-table">${Array.from({ length: mr }, (_, r) => "<tr>" + Array.from({ length: mc }, (_2, c) => `<td>${esc4(p.cells[col(c + 1) + (r + 1)]?.v || "")}</td>`).join("") + "</tr>").join("")}</table>`;
      }
      let n = 0;
      return (content.blocks || []).map((b) => {
        n = b.type === "ordered" ? n + 1 : 0;
        const t = toHTML(b.text || "");
        switch (b.type) {
          case "h1":
            return `<h2>${t}</h2>`;
          case "h2":
            return `<h3>${t}</h3>`;
          case "h3":
            return `<h4>${t}</h4>`;
          case "bullet":
            return `<p>• ${t}</p>`;
          case "ordered":
            return `<p>${n}. ${t}</p>`;
          case "todo":
            return `<p>${b.checked ? "☑" : "☐"} ${t}</p>`;
          case "quote":
            return `<blockquote>${t}</blockquote>`;
          case "code":
            return `<pre>${esc4(b.text || "")}</pre>`;
          case "divider":
            return "<hr>";
          case "table":
            return `<table class="doc-preview-table">${(b.rows || []).map((r) => "<tr>" + r.map((c) => `<td>${esc4(c)}</td>`).join("") + "</tr>").join("")}</table>`;
          default:
            return `<p>${t || "&nbsp;"}</p>`;
        }
      }).join("");
    }
    async function reopen() {
      const id = current?.id;
      if (id) {
        closeDoc();
        await open2(id);
      }
    }
    function more(anchor) {
      const doc = current;
      if (!doc) return;
      document.querySelector(".doc-block-menu")?.remove();
      const box = document.createElement("div");
      box.className = "doc-block-menu";
      const exports = doc.kind === "sheet" ? [["xlsx", "导出为 Excel (.xlsx)"], ["csv", "导出当前工作表为 CSV"]] : [["docx", "导出为 Word (.docx)"], ["md", "导出为 Markdown (.md)"]];
      box.innerHTML = (doc.canExport ? exports.map(([f, l]) => `<button data-doc-more="export:${f}">${l}</button>`).join("") : '<p class="hint">所有者已禁止导出</p>') + `<button data-doc-more="history">历史版本</button><button data-doc-more="copy">复制文档链接</button>${doc.role === "owner" ? '<button data-doc-more="delete" class="danger">删除文档</button>' : ""}`;
      document.body.append(box);
      const r = anchor.getBoundingClientRect();
      box.style.left = Math.max(8, Math.min(r.right - 200, innerWidth - 210)) + "px";
      box.style.top = r.bottom + 4 + "px";
      box.addEventListener("mousedown", async (e) => {
        const b = e.target.closest("[data-doc-more]");
        if (!b) return;
        e.preventDefault();
        box.remove();
        const [op, arg] = b.dataset.docMore.split(":");
        if (op === "export") {
          if (doc.editor.hasPending()) doc.sync.schedule(0);
          const sheet = doc.kind === "sheet" && arg === "csv" ? "&sheet=" + encodeURIComponent(doc.editor.activeSheet()) : "";
          setTimeout(() => downloadURL2(`/api/docs/${doc.id}/export?format=${arg}${sheet}`, doc.title + "." + arg), doc.editor.hasPending() ? 800 : 0);
        } else if (op === "history") history();
        else if (op === "copy") {
          navigator.clipboard?.writeText(`[${doc.kind === "sheet" ? "表格" : "文档"}] ${doc.title}
linkme-doc:${doc.id}`).then(() => toast2("已复制，粘贴到聊天发送即可"), () => toast2("复制失败"));
        } else if (op === "delete") {
          if (await confirmDialog("所有协作者都将无法再打开，且无法恢复。", { title: `删除“${doc.title}”`, ok: "删除", danger: true })) {
            try {
              await api2("/api/docs/" + doc.id, { method: "DELETE" });
              closeDoc();
              toast2("已删除");
              drawHome();
              loadList();
            } catch (err) {
              toast2(err.message);
            }
          }
        }
      });
      setTimeout(() => document.addEventListener("mousedown", function off(ev) {
        if (!box.contains(ev.target)) {
          box.remove();
          document.removeEventListener("mousedown", off);
        }
      }), 0);
    }
    let aiScope = [], aiBusy = false;
    function openAI(ids) {
      const doc = current;
      if (!doc) return;
      const panel = $2(".doc-ai");
      if (!panel) return;
      if (Array.isArray(ids)) aiScope = ids.filter(Boolean);
      panel.classList.remove("hidden");
      $2(".doc-page")?.classList.add("ai-open");
      if (!panel.dataset.ready) {
        panel.dataset.ready = "1";
        panel.innerHTML = `<header><b>✦ AI 助手</b><button class="icon-btn" data-ai-close aria-label="关闭 AI 助手">×</button></header>
    <div class="ai-quick"><button data-ai-mode="check">检查错误</button><button data-ai-mode="tidy">整理排版</button><button data-ai-mode="summary">总结分析</button></div>
    <div class="ai-scope"></div><div class="ai-results"><p class="hint">AI 会阅读${doc.kind === "sheet" ? "表格（含公式计算结果）" : "文档"}，找出问题并给出修改建议。建议不会自动写入，你确认后点“应用”才会修改，所有协作者实时看到，也可以在历史版本里恢复。</p></div>
    <form class="ai-ask"><textarea rows="3" maxlength="2000" placeholder="${doc.kind === "sheet" ? "例如：给每一行加一列合计；找出销售额异常的月份" : "例如：把这段改得更正式；补一段项目背景；翻译成英文"}"></textarea><button class="primary" type="submit">发送</button></form>`;
        panel.addEventListener("click", aiClick);
        panel.querySelector(".ai-ask").addEventListener("submit", (e) => {
          e.preventDefault();
          const t = panel.querySelector(".ai-ask textarea");
          if (t.value.trim()) runAI("ask", t.value.trim());
        });
        panel.querySelector(".ai-ask textarea").addEventListener("keydown", (e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            panel.querySelector(".ai-ask").requestSubmit();
          }
        });
      }
      drawScope();
    }
    function drawScope() {
      const doc = current, box = $2(".doc-ai .ai-scope");
      if (!box || !doc) return;
      if (doc.kind === "sheet") {
        box.innerHTML = `范围：整个表格，当前选中 <b>${esc4(doc.editor.selection())}</b>`;
        return;
      }
      box.innerHTML = aiScope.length ? `范围：选中的 <b>${aiScope.length}</b> 段 <button data-ai-scope-clear>改为全文</button>` : "范围：全文（选中文字后点工具条上的 ✦ AI 可只处理选中部分）";
    }
    async function runAI(mode, instruction = "") {
      const doc = current;
      if (!doc || aiBusy) return;
      aiBusy = true;
      const panel = $2(".doc-ai"), out = panel.querySelector(".ai-results");
      panel.querySelectorAll(".ai-quick button,.ai-ask button").forEach((b) => b.disabled = true);
      out.innerHTML = `<div class="ai-loading"><span></span>${{ check: "正在检查错误", tidy: "正在整理排版", summary: "正在总结分析", ask: "正在处理你的要求" }[mode]}…</div>`;
      try {
        if (doc.editor.hasPending()) doc.sync.schedule(0);
        const body = { mode, instruction };
        if (doc.kind === "sheet") {
          body.range = doc.editor.selection();
          body.values = doc.editor.values();
        } else body.selection = aiScope;
        await new Promise((r2) => setTimeout(r2, doc.editor.hasPending() ? 600 : 0));
        const r = await api2(`/api/docs/${doc.id}/ai`, { method: "POST", body });
        if (current !== doc) return;
        doc.aiEdits = r.edits.map((e, i) => ({ ...e, _i: i }));
        doc.aiCanApply = r.canApply;
        doc.aiReply = r.reply;
        drawAI();
        if (mode === "ask") panel.querySelector(".ai-ask textarea").value = "";
      } catch (e) {
        out.innerHTML = `<p class="ai-error">${esc4(e.message)}</p>`;
      } finally {
        aiBusy = false;
        panel.querySelectorAll(".ai-quick button,.ai-ask button").forEach((b) => b.disabled = false);
      }
    }
    function editHTML(e) {
      const doc = current;
      let body = "";
      if (e.op === "cell") body = `<div class="ai-cell"><code>${esc4(e.sheet || "")}!${esc4(e.ref || "")}</code>${e.original ? `<del>${esc4(e.original)}</del>` : ""}<ins>${esc4(e.v ?? "")}</ins></div>`;
      else if (e.op === "replace") {
        const cur = doc.editor.blocks().find((b) => b.id === e.id);
        body = `${e.original ? `<del>${esc4(e.original)}</del>` : cur ? `<del>${esc4(plain(cur.text))}</del>` : ""}<ins>${toHTML(e.text || "")}</ins>`;
      } else if (e.op === "insert") body = `<div class="ai-new">${(e.blocks || []).map((b) => `<ins>${toHTML(b.text || "")}</ins>`).join("")}</div>`;
      else if (e.op === "delete") {
        const cur = doc.editor.blocks().find((b) => b.id === e.id);
        body = `<del>${esc4(cur ? plain(cur.text) : "该段")}</del>`;
      }
      const label = { replace: "修改", insert: "新增", delete: "删除", cell: "单元格" }[e.op] || e.op;
      return `<div class="ai-edit${e.done ? " done" : ""}" data-edit="${e._i}"><div class="ai-edit-head"><span class="tag">${label}</span>${e.reason ? `<span>${esc4(e.reason)}</span>` : ""}</div>${body}${doc.aiCanApply ? `<div class="ai-edit-actions">${e.done ? `<span class="ok">${e.done === "applied" ? "已应用" : "已忽略"}</span>` : `<button class="primary" data-ai-apply="${e._i}">应用</button><button class="secondary" data-ai-skip="${e._i}">忽略</button>`}${e.op !== "cell" && e.id ? `<button class="link" data-ai-goto="${esc4(e.id)}">定位</button>` : ""}</div>` : ""}</div>`;
    }
    function drawAI() {
      const doc = current, out = $2(".doc-ai .ai-results");
      if (!out || !doc) return;
      const edits = doc.aiEdits || [];
      const open3 = edits.filter((e) => !e.done);
      out.innerHTML = `${doc.aiReply ? `<div class="ai-reply">${replyHTML(doc.aiReply)}<div class="ai-reply-actions"><button class="link" data-ai-copy>复制</button>${doc.kind === "doc" && RANK[doc.role] >= 2 ? '<button class="link" data-ai-insert>插入到文档</button>' : ""}</div></div>` : ""}
   ${edits.length ? `<div class="ai-edits-head"><b>${edits.length} 条修改建议</b>${doc.aiCanApply && open3.length > 1 ? '<button class="primary" data-ai-all>全部应用</button>' : ""}</div>${edits.map(editHTML).join("")}` : doc.aiReply ? "" : '<p class="hint">没有需要修改的地方。</p>'}
   ${!doc.aiCanApply && edits.length ? '<p class="hint">你只有阅读权限，可以把建议告诉文档的编辑者。</p>' : ""}`;
    }
    function applyOne(e) {
      if (e.done) return true;
      const ok = current.editor.applyEdit(e);
      if (ok) e.done = "applied";
      return ok;
    }
    function aiClick(ev) {
      const doc = current;
      if (!doc) return;
      const t = ev.target;
      if (t.closest("[data-ai-close]")) {
        $2(".doc-ai").classList.add("hidden");
        $2(".doc-page")?.classList.remove("ai-open");
        return;
      }
      const mode = t.closest("[data-ai-mode]");
      if (mode) {
        runAI(mode.dataset.aiMode);
        return;
      }
      if (t.closest("[data-ai-scope-clear]")) {
        aiScope = [];
        drawScope();
        return;
      }
      const a = t.closest("[data-ai-apply]");
      if (a) {
        const e = doc.aiEdits[+a.dataset.aiApply];
        if (!applyOne(e)) toast2("这处内容已被修改或删除，无法应用");
        drawAI();
        return;
      }
      const s = t.closest("[data-ai-skip]");
      if (s) {
        doc.aiEdits[+s.dataset.aiSkip].done = "skipped";
        drawAI();
        return;
      }
      if (t.closest("[data-ai-all]")) {
        let failed = 0;
        for (const e of doc.aiEdits) if (!e.done && !applyOne(e)) failed++;
        if (failed) toast2(`${failed} 条建议对应的内容已变化，未应用`);
        drawAI();
        return;
      }
      const g = t.closest("[data-ai-goto]");
      if (g) {
        doc.editor.scrollTo?.(g.dataset.aiGoto);
        return;
      }
      if (t.closest("[data-ai-copy]")) {
        navigator.clipboard?.writeText(doc.aiReply || "").then(() => toast2("已复制"), () => toast2("复制失败"));
        return;
      }
      if (t.closest("[data-ai-insert]")) {
        doc.editor.insertMarkdown(doc.aiReply || "");
        toast2("已插入到文档");
      }
    }
    document.addEventListener("click", (e) => {
      const more_ = e.target.closest("[data-docs-more]");
      if (more_) {
        e.preventDefault();
        e.stopPropagation();
        moreMenu(more_.dataset.docsMore, more_);
        return;
      }
      const opener = e.target.closest("[data-open-doc]");
      if (opener) {
        e.preventDefault();
        open2(opener.dataset.openDoc);
        return;
      }
      const scopeBtn = e.target.closest("[data-docs-scope]");
      if (scopeBtn) {
        scope = scopeBtn.dataset.docsScope;
        list = null;
        drawHome();
        loadList();
        return;
      }
      const b = e.target.closest("[data-docs]");
      if (!b) return;
      switch (b.dataset.docs) {
        case "new-doc":
          create("doc");
          break;
        case "new-sheet":
          create("sheet");
          break;
        case "import":
          $2("#docs-import")?.click();
          break;
        case "back":
          closeDoc();
          drawHome();
          loadList();
          break;
        case "share":
          share();
          break;
        case "more":
          more(b);
          break;
        case "ai": {
          const panel = $2(".doc-ai");
          if (panel && !panel.classList.contains("hidden")) {
            panel.classList.add("hidden");
            $2(".doc-page")?.classList.remove("ai-open");
          } else openAI(current?.kind === "doc" ? current.editor.selectedIds() : void 0);
          break;
        }
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches?.(".docs-row[data-open-doc]")) open2(e.target.dataset.openDoc);
    });
    window.addEventListener("beforeunload", () => {
      if (current) closeDoc();
    });
    return {
      render() {
        if (current && $2(".doc-page")) {
          return;
        }
        if (current) {
          drawDoc();
          return;
        }
        drawHome();
        loadList();
      },
      open: open2,
      leave() {
        closeDoc();
      },
      isOpen: () => !!current,
      event(type, d) {
        if (type === "doc-ops") {
          if (current && d.docId === current.id) current.sync.receive(d);
          else if (S2.tab === "docs" && !current) {
            clearTimeout(listTimer);
            listTimer = setTimeout(loadList, 800);
          }
          return;
        }
        if (type === "doc-presence") {
          if (current && d.docId === current.id) viewers(d.viewers || []);
          return;
        }
        if (type === "doc-meta") {
          if (current && d.docId === current.id) {
            current.title = d.title;
            const bar = $2(".doc-bar-title");
            if (bar) bar.textContent = d.title;
            const t = $2(".doc-title");
            if (t && document.activeElement !== t) t.textContent = d.title;
          } else if (S2.tab === "docs") loadList();
          return;
        }
        if (type === "doc-access") {
          if (current && d.docId === current.id) {
            if (d.deleted) {
              toast2("文档已被所有者删除");
              closeDoc();
              drawHome();
              loadList();
            } else refreshAccess();
          } else if (S2.tab === "docs" && !current) loadList();
          return;
        }
        if (type === "doc-reload") {
          if (current && d.docId === current.id) {
            toast2("文档已恢复到历史版本");
            reopen();
          }
        }
      },
      // A document shared in a chat shows as a card.
      card(m) {
        if (m.kind !== "text") return "";
        const x = DOC_MARK.exec(m.text || "");
        if (!x) return "";
        return `<button class="file-card doc-card" data-open-doc="${x[3]}">${docIcon(x[1] === "表格" ? "sheet" : "doc")}<span><b>${esc4(x[2])}</b><small>LinkMe 云${x[1]} · 点击打开</small></span></button>`;
      },
      preview(text) {
        const x = DOC_MARK.exec(text || "");
        return x ? `[${x[1]}] ${x[2]}` : null;
      },
      reset() {
        closeDoc();
        list = null;
        scope = "recent";
        query = "";
      }
    };
  }

  // internal/ui/src/chat-features.js
  var REACTIONS = ["👍", "👌", "❤️", "😂", "🎉", "🙏", "👏", "💪", "😮", "😢", "收到", "赞", "OK", "辛苦了"];
  var DAY = 864e5;
  var PREVIEW_TEXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|ya?ml|ini|conf|js|ts|go|py|java|kt|c|h|cpp|cs|rb|php|sh|sql|css|html?)$/i;
  var PREVIEW_MEDIA = /\.(png|jpe?g|gif|webp|bmp|mp4|webm|m4v|mov|mp3|wav|m4a|ogg)$/i;
  var AS_DOC = /\.(docx|xlsx|csv|md|markdown)$/i;
  function createChatFeatures({ S: S2, api: api2, esc: esc4, av: av2, icon: icon2, modal: modal2, closeModal: closeModal2, toast: toast2, renderMessages: renderMessages2, jumpMessage: jumpMessage2, messageMenu: messageMenu2, Received: Received2, fileURL: fileURL2, download: download2, Docs: Docs2, shortTime: shortTime2, Mentions: Mentions2, queueRefresh: queueRefresh2, showPresence: showPresence2 }) {
    const $2 = (s) => document.querySelector(s);
    const translations = /* @__PURE__ */ new Map(), pins = /* @__PURE__ */ new Map(), statuses = /* @__PURE__ */ new Map();
    let aiEnabled = false, summary = null, thread = null, urgentQueue = [], urgentShowing = null, beep = null, autoStatus = "", statusTimer = 0;
    const me = () => S2.user?.id;
    const find = (id) => S2.messages.find((m) => m.id === id) || thread?.replies.find((m) => m.id === id) || (thread?.root?.id === id ? thread.root : null);
    function nameOf(id) {
      if (id === me()) return "我";
      for (const m of S2.messages) if (m.sender === id && m.name) return m.name;
      const f = (S2.friends || []).find((u) => u.id === id);
      if (f) return f.remark || f.name;
      const c = (S2.conversations || []).find((c2) => c2.peer?.id === id);
      return c?.peer?.name || "成员";
    }
    const parse2 = (t) => {
      try {
        return JSON.parse(t || "{}");
      } catch {
        return {};
      }
    };
    function replace(m) {
      let hit = false;
      const i = S2.messages.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        S2.messages[i] = { ...S2.messages[i], ...m };
        hit = true;
      }
      if (thread) {
        if (thread.root.id === m.id) {
          thread.root = { ...thread.root, ...m };
          hit = true;
        }
        const j = thread.replies.findIndex((x) => x.id === m.id);
        if (j >= 0) {
          thread.replies[j] = { ...thread.replies[j], ...m };
          hit = true;
        }
      }
      Received2.event("message", m).catch(() => {
      });
      return hit;
    }
    const rerender = () => {
      renderMessages2(true);
      drawThread();
    };
    function pollCard(m) {
      const spec = parse2(m.text), poll = m.poll || { counts: [], votes: {} }, mine = poll.votes?.[me()] || [], voters = Object.keys(poll.votes || {}).length, total = Math.max(1, poll.counts.reduce((a, b) => a + b, 0));
      const closed = !!spec.closed, voted = mine.length > 0;
      return `<div class="poll-card" data-poll="${m.id}"><div class="card-kind">📊 投票 · ${spec.multi ? "多选" : "单选"}${closed ? " · 已结束" : ""}</div><h4>${esc4(spec.title || "")}</h4>
   ${(spec.options || []).map((o, i) => {
        const n = poll.counts[i] || 0, pct = Math.round(n * 100 / total);
        return `<label class="poll-option${mine.includes(i) ? " mine" : ""}"><input type="${spec.multi ? "checkbox" : "radio"}" name="poll-${m.id}" value="${i}" ${mine.includes(i) ? "checked" : ""} ${closed ? "disabled" : ""}><span class="poll-text">${esc4(o)}</span>${voted || closed ? `<span class="poll-count">${n} 票 · ${pct}%</span><i style="width:${pct}%"></i>` : ""}</label>`;
      }).join("")}
   <div class="card-foot"><span>${voters} 人已参与</span>${closed ? "" : `<button class="primary" data-cx="vote" data-mid="${m.id}">${voted ? "修改投票" : "投票"}</button>`}${voters ? `<button data-cx="poll-detail" data-mid="${m.id}">详情</button>` : ""}${m.sender === me() && !closed ? `<button data-cx="poll-close" data-mid="${m.id}">结束</button>` : ""}</div></div>`;
    }
    function chainCard(m) {
      const spec = parse2(m.text), list = m.chain || [], mine = list.find((e) => e.userId === me());
      return `<div class="chain-card"><div class="card-kind">🐉 接龙</div><h4>${esc4(spec.title || "")}</h4>${spec.note ? `<p class="chain-note">${esc4(spec.note)}</p>` : ""}
   ${list.length ? `<ol>${list.map((e) => e.userId === me() && chainEditing === m.id ? `<li><b>${esc4(e.name)}</b> <input class="chain-input" data-chain-input="${m.id}" maxlength="100" value="${esc4(e.text)}" placeholder="补充说明，可留空"></li>` : `<li><b>${esc4(e.name)}</b>${e.text ? " " + esc4(e.text) : ""}</li>`).join("")}</ol>` : '<p class="chain-note">还没有人参与，来做第一个</p>'}
   <div class="card-foot"><span>${list.length} 人已接龙</span>${chainEditing === m.id && mine ? `<button class="primary" data-cx="chain-save" data-mid="${m.id}">保存</button><button data-cx="chain-cancel" data-mid="${m.id}">取消</button>` : `<button class="primary" data-cx="chain-join" data-mid="${m.id}">${mine ? "修改" : "+ 参与接龙"}</button>${mine ? `<button data-cx="chain-leave" data-mid="${m.id}">退出</button>` : ""}`}</div></div>`;
    }
    function card(m) {
      if (m.recalled) return "";
      if (m.kind === "poll") return pollCard(m);
      if (m.kind === "chain") return chainCard(m);
      return "";
    }
    function preview2(m) {
      if (m?.recalled) return null;
      if (m?.kind === "poll") return "[投票] " + (parse2(m.text).title || "");
      if (m?.kind === "chain") return "[接龙] " + (parse2(m.text).title || "");
      return null;
    }
    function extras(m) {
      if (m.recalled) return "";
      let html = "";
      const t = translations.get(m.id);
      if (t?.open) html += `<div class="translation">${t.loading ? '<span class="hint">正在翻译…</span>' : `<div>${esc4(t.text).replace(/\n/g, "<br>")}</div><small>译文 · Me <button data-cx="translate-hide" data-mid="${m.id}">收起</button></small>`}</div>`;
      if (m.urgent) {
        const pending = m.urgent.targets.includes(me()) && !m.urgent.acked.includes(me());
        const n = m.urgent.targets.length, done = m.urgent.acked.length;
        html += `<div class="urgent-line"><span class="urgent-tag">❗ 加急</span>${m.sender === me() ? `<span>${done}/${n} 人已确认</span>` : pending ? `<button data-cx="urgent-ack" data-mid="${m.id}">知道了</button>` : "<span>已确认</span>"}</div>`;
      }
      if (m.reactions?.length) html += `<div class="reactions">${m.reactions.map((r) => `<button class="reaction${r.users.includes(me()) ? " mine" : ""}" data-cx="react" data-mid="${m.id}" data-reaction="${esc4(r.emoji)}" title="${esc4(r.users.map(nameOf).join("、"))}">${esc4(r.emoji)}<span>${r.users.length}</span></button>`).join("")}<button class="reaction add" data-cx="react-pick" data-mid="${m.id}" title="添加表情回复">${icon2("emoji")}</button></div>`;
      if (m.thread?.count && !m.threadId) html += `<button class="thread-link" data-cx="thread" data-mid="${m.id}">${icon2("chat")}${m.thread.count} 条回复 · 最后回复 ${shortTime2(m.thread.last)}</button>`;
      return html;
    }
    const timeTag = (m) => m.edited && !m.recalled ? '<span class="edited-tag" title="' + new Date(m.edited).toLocaleString("zh-CN", { hour12: false }) + ' 编辑">已编辑</span>' : "";
    function hoverTools(m) {
      if (m.recalled) return "";
      return `<button class="icon-btn" title="表情回复" aria-label="表情回复" data-cx="react-pick" data-mid="${m.id}">${icon2("emoji")}</button>${m.threadId ? "" : `<button class="icon-btn" title="回复话题" aria-label="回复话题" data-cx="thread" data-mid="${m.id}">${icon2("chat")}</button>`}`;
    }
    const moreTool = (m) => `<button class="icon-btn" title="更多" aria-label="更多操作" data-cx="more" data-mid="${m.id}">${icon2("more")}</button>`;
    function menuItems(m) {
      if (m.recalled) return "";
      const mine = m.sender === me(), recent = Date.now() - m.created < DAY, pinned = (pins.get(m.conversationId) || []).some((p) => p.id === m.id);
      return (m.kind === "image" ? `<button data-cx="copy-image" data-mid="${m.id}">${icon2("copy")}复制图片</button>` : "") + `<button data-cx="react-pick" data-mid="${m.id}">${icon2("emoji")}表情回复</button>${m.threadId ? "" : `<button data-cx="thread" data-mid="${m.id}">${icon2("chat")}回复话题</button>`}` + (mine && recent && m.kind === "text" && !/\nlinkme-doc:/.test(m.text) ? `<button data-cx="edit" data-mid="${m.id}">${icon2("notebook")}编辑</button>` : "") + (m.threadId ? "" : `<button data-cx="${pinned ? "unpin" : "pin"}" data-mid="${m.id}">${icon2("pin")}${pinned ? "取消置顶" : "置顶"}</button>`) + (mine && recent ? `<button data-cx="urgent" data-mid="${m.id}">${icon2("bell")}加急</button>` : "") + (m.kind === "text" && aiEnabled ? `<button data-cx="translate" data-mid="${m.id}">${icon2("refresh")}翻译</button>` : "");
    }
    function picker(mid, anchor) {
      document.querySelector(".reaction-picker")?.remove();
      const box = document.createElement("div");
      box.className = "reaction-picker";
      box.innerHTML = REACTIONS.map((e) => `<button data-cx="react" data-mid="${mid}" data-reaction="${esc4(e)}">${esc4(e)}</button>`).join("");
      document.body.append(box);
      const r = anchor.getBoundingClientRect();
      box.style.left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8)) + "px";
      box.style.top = Math.max(8, r.top - box.offsetHeight - 6) + "px";
      setTimeout(() => document.addEventListener("mousedown", function off(e) {
        if (!box.contains(e.target)) {
          box.remove();
          document.removeEventListener("mousedown", off);
        }
      }), 0);
    }
    async function react(mid, emoji) {
      document.querySelector(".reaction-picker")?.remove();
      try {
        const r = await api2(`/api/messages/${mid}/reactions`, { method: "POST", body: { emoji } });
        const m = find(mid);
        if (m) {
          m.reactions = r.reactions;
          rerender();
        }
      } catch (e) {
        toast2(e.message);
      }
    }
    function startEdit(m) {
      S2.editing = { id: m.id, cid: m.conversationId };
      const input = $2("#composer");
      if (!input) return;
      S2.editing.draft = input.value;
      input.value = m.text;
      input.dispatchEvent(new Event("input"));
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      drawEditBar();
    }
    function drawEditBar() {
      const bar = $2("#edit-draft");
      if (!bar) return;
      const on = !!S2.editing && S2.editing.cid === S2.active;
      bar.classList.toggle("hidden", !on);
      bar.closest(".composer")?.classList.toggle("has-reply", on || !!S2.reply);
      bar.innerHTML = on ? `<span>${icon2("notebook")} 编辑消息 · 按 Enter 保存，Esc 取消</span><button class="icon-btn" data-cx="edit-cancel" aria-label="取消编辑">${icon2("close")}</button>` : "";
    }
    function cancelEdit() {
      if (!S2.editing) return;
      const input = $2("#composer");
      const draft = S2.editing.draft || "";
      S2.editing = null;
      if (input) {
        input.value = draft;
        input.dispatchEvent(new Event("input"));
      }
      drawEditBar();
    }
    async function submitEdit() {
      const input = $2("#composer"), edit = S2.editing;
      if (!input || !edit) return;
      const text = input.value;
      if (!text.trim()) {
        toast2("消息不能为空");
        return;
      }
      input.disabled = true;
      try {
        const m = await api2("/api/messages/" + edit.id, { method: "PATCH", body: { text, mentions: Mentions2.payload() } });
        replace(m);
        S2.editing = null;
        input.value = edit.draft || "";
        input.dispatchEvent(new Event("input"));
        drawEditBar();
        rerender();
      } catch (e) {
        toast2(e.message);
      } finally {
        input.disabled = false;
        input.focus();
      }
    }
    async function loadPins(cid) {
      try {
        const list = await api2(`/api/conversations/${cid}/pins`);
        pins.set(cid, list);
        if (cid === S2.active) drawPins();
      } catch {
      }
    }
    function drawPins() {
      const box = $2("#pinned-bar");
      if (!box) return;
      const list = pins.get(S2.active) || [];
      if (!list.length) {
        box.innerHTML = "";
        box.className = "";
        return;
      }
      const p = list[0];
      box.className = "pinned-bar";
      box.innerHTML = `<span class="pin-icon">${icon2("pin")}</span><button class="pinned-text" data-cx="pin-jump" data-mid="${p.id}"><b>${esc4(p.name)}：</b>${esc4(previewText(p))}</button>${list.length > 1 ? `<button class="pinned-more" data-cx="pins-open">${list.length} 条置顶</button>` : `<button class="pinned-more" data-cx="pins-open">管理</button>`}`;
    }
    function previewText(m) {
      const p = preview2(m) || Docs2.preview(m.text);
      if (p) return p;
      return { image: "[图片]", file: "[文件] " + (m.fileName || ""), voice: "[语音]", video: "[视频]", forward: "[聊天记录]", meeting: "[会议]", call: "[通话]" }[m.kind] || m.text;
    }
    function pinList() {
      const list = pins.get(S2.active) || [];
      modal2("置顶消息", list.length ? `<div class="pin-list">${list.map((p) => `<div class="pin-item"><button data-cx="pin-jump" data-mid="${p.id}"><b>${esc4(p.name)}</b><span>${esc4(previewText(p))}</span><small>${esc4(p.pinnedByName || "")} 置顶于 ${shortTime2(p.pinnedAt)}</small></button><button class="secondary" data-cx="unpin" data-mid="${p.id}">取消置顶</button></div>`).join("")}</div>` : '<p class="hint">没有置顶消息</p>', '<button class="secondary" data-action="close-modal">关闭</button>');
    }
    async function pin(mid, on) {
      try {
        await api2(`/api/messages/${mid}/pin`, { method: on ? "POST" : "DELETE" });
        toast2(on ? "已置顶" : "已取消置顶");
      } catch (e) {
        toast2(e.message);
      }
    }
    async function urgent(m) {
      const c = S2.conversations.find((c2) => c2.id === m.conversationId);
      if (!c) return;
      if (c.kind === "direct") {
        if (!await confirmDialog(`对方会收到弹窗和铃声提醒，直到点“知道了”。`, { title: `加急提醒 ${c.name}`, ok: "加急" })) return;
        send([]);
        return;
      }
      let members = [];
      try {
        members = (await api2("/api/conversations/" + c.id)).members || [];
      } catch (e) {
        toast2(e.message);
        return;
      }
      const others = members.filter((u) => u.id !== me() && !u.ai);
      modal2("加急提醒", `<p class="hint">被加急的成员会收到弹窗和铃声提醒，直到点“知道了”。</p><label class="urgent-all"><input type="checkbox" id="urgent-all" checked> 全部成员（${others.length} 人）</label><div class="urgent-people">${others.map((u) => `<label>${av2(u)}<span>${esc4(u.nickname || u.name)}</span><input type="checkbox" class="urgent-user" value="${u.id}" checked></label>`).join("")}</div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="urgent-send">加急</button>');
      $2("#urgent-all").onchange = (e) => document.querySelectorAll(".urgent-user").forEach((b) => b.checked = e.target.checked);
      $2("#urgent-send").onclick = () => {
        const ids = [...document.querySelectorAll(".urgent-user:checked")].map((b) => b.value);
        if (!ids.length) {
          toast2("请选择成员");
          return;
        }
        closeModal2();
        send(ids);
      };
      async function send(users) {
        try {
          const updated = await api2(`/api/messages/${m.id}/urgent`, { method: "POST", body: { users } });
          replace(updated);
          rerender();
          toast2("已加急提醒");
        } catch (e) {
          toast2(e.message);
        }
      }
    }
    function ring() {
      try {
        const ctx = beep || (beep = new (window.AudioContext || window.webkitAudioContext)());
        const t = ctx.currentTime;
        for (const [f, at] of [[880, 0], [660, 0.18], [880, 0.36]]) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = f;
          g.gain.setValueAtTime(1e-4, t + at);
          g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
          g.gain.exponentialRampToValueAtTime(1e-4, t + at + 0.16);
          o.connect(g).connect(ctx.destination);
          o.start(t + at);
          o.stop(t + at + 0.17);
        }
      } catch {
      }
    }
    function showUrgent() {
      if (urgentShowing || !urgentQueue.length) return;
      const { message: m, from } = urgentShowing = urgentQueue.shift();
      const layer = document.createElement("div");
      layer.className = "urgent-layer";
      layer.innerHTML = `<div class="urgent-box" role="alertdialog" aria-label="加急消息"><div class="urgent-title">❗ 加急消息</div><div class="urgent-from">${av2({ id: m.sender, name: m.name, avatar: m.avatar })}<b>${esc4(from || m.name)}</b><small>${esc4((S2.conversations.find((c) => c.id === m.conversationId) || {}).name || "")}</small></div><div class="urgent-text">${esc4(previewText(m)).replace(/\n/g, "<br>")}</div><div class="urgent-actions"><button class="secondary" data-cx="urgent-open" data-mid="${m.id}" data-cid="${m.conversationId}">查看</button><button class="primary" data-cx="urgent-ack" data-mid="${m.id}">知道了</button></div></div>`;
      document.body.append(layer);
      ring();
      const timer = setInterval(ring, 4e3);
      setTimeout(() => clearInterval(timer), 6e4);
      layer.dataset.timer = timer;
      if (document.hidden && "Notification" in window && Notification.permission === "granted") try {
        new Notification("加急：" + (from || m.name), { body: previewText(m).slice(0, 120) });
      } catch {
      }
    }
    async function ack(mid) {
      const layer = document.querySelector(".urgent-layer");
      if (layer && urgentShowing?.message.id === mid) {
        clearInterval(+layer.dataset.timer);
        layer.remove();
        urgentShowing = null;
      }
      urgentQueue = urgentQueue.filter((x) => x.message.id !== mid);
      try {
        await api2(`/api/messages/${mid}/urgent/ack`, { method: "POST", body: {} });
      } catch (e) {
        toast2(e.message);
      }
      setTimeout(showUrgent, 300);
    }
    async function openThread(mid) {
      const root = find(mid);
      if (!root) return;
      thread = { root, replies: [], cid: root.conversationId, loading: true };
      drawThread();
      try {
        const r = await api2(`/api/messages/${mid}/thread`);
        if (thread?.root.id !== mid) return;
        thread.root = r.root;
        thread.replies = r.replies;
        thread.loading = false;
        drawThread(true);
      } catch (e) {
        toast2(e.message);
        closeThread();
      }
    }
    function closeThread() {
      thread = null;
      document.querySelector(".thread-panel")?.remove();
    }
    function bubbleText(m) {
      if (m.recalled) return '<i class="hint">消息已撤回</i>';
      if (m.kind === "image") return `<img src="${fileURL2(m.attachmentId)}" alt="" data-preview-image="${m.attachmentId}">`;
      const p = preview2(m) || Docs2.preview(m.text);
      if (p || m.kind !== "text") return esc4(previewText(m));
      return Mentions2.text(m);
    }
    function drawThread(scroll = false) {
      if (!thread) return;
      if (thread.cid !== S2.active) {
        closeThread();
        return;
      }
      let panel = document.querySelector(".thread-panel");
      const main = document.querySelector(".main");
      if (!main) return;
      if (!panel) {
        panel = document.createElement("aside");
        panel.className = "thread-panel";
        panel.setAttribute("aria-label", "话题");
        main.append(panel);
        panel.innerHTML = `<header><b>话题</b><button class="icon-btn" data-cx="thread-close" aria-label="关闭话题">${icon2("close")}</button></header><div class="thread-body"></div><form class="thread-compose"><textarea rows="2" maxlength="6000" placeholder="回复话题，Enter 发送"></textarea><button class="primary" type="submit">发送</button></form>`;
        const form = panel.querySelector("form"), ta = form.querySelector("textarea");
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          replyThread(ta);
        });
        ta.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            replyThread(ta);
          }
        });
      }
      const body = panel.querySelector(".thread-body"), line = (m) => `<div class="thread-msg" data-message="${m.id}">${av2({ id: m.sender, name: m.name, avatar: m.avatar })}<div><div class="thread-meta"><b>${esc4(m.name)}</b><small>${shortTime2(m.created)}</small>${timeTag(m)}</div><div class="thread-text">${bubbleText(m)}</div>${extras({ ...m, thread: null })}</div></div>`;
      body.innerHTML = line(thread.root) + `<div class="thread-sep">${thread.loading ? "正在加载…" : thread.replies.length + " 条回复"}</div>` + thread.replies.map(line).join("");
      if (scroll) body.scrollTop = body.scrollHeight;
    }
    async function replyThread(ta) {
      const text = ta.value.trim();
      if (!text || !thread) return;
      const root = thread.root;
      ta.disabled = true;
      try {
        const m = await api2(`/api/conversations/${thread.cid}/messages`, { method: "POST", body: { kind: "text", text, threadId: root.id, clientId: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) } });
        ta.value = "";
        if (thread?.root.id === root.id && !thread.replies.some((x) => x.id === m.id)) {
          thread.replies.push(m);
          drawThread(true);
        }
      } catch (e) {
        toast2(e.message);
      } finally {
        ta.disabled = false;
        ta.focus();
      }
    }
    function newPoll() {
      modal2("发起投票", `<div class="poll-form"><input id="poll-title" maxlength="100" placeholder="投票主题"><div id="poll-options">${[1, 2, 3].map((i) => `<input class="poll-opt" maxlength="60" placeholder="选项 ${i}">`).join("")}</div><button class="link" id="poll-add">+ 添加选项</button><label><input type="checkbox" id="poll-multi"> 允许多选</label></div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="poll-create">发起</button>');
      $2("#poll-add").onclick = () => {
        const n = document.querySelectorAll(".poll-opt").length;
        if (n >= 20) {
          toast2("最多 20 个选项");
          return;
        }
        $2("#poll-options").insertAdjacentHTML("beforeend", `<input class="poll-opt" maxlength="60" placeholder="选项 ${n + 1}">`);
      };
      $2("#poll-create").onclick = async () => {
        const options = [...document.querySelectorAll(".poll-opt")].map((i) => i.value.trim()).filter(Boolean);
        try {
          await api2(`/api/conversations/${S2.active}/polls`, { method: "POST", body: { title: $2("#poll-title").value, options, multi: $2("#poll-multi").checked } });
          closeModal2();
        } catch (e) {
          toast2(e.message);
        }
      };
      $2("#poll-title").focus();
    }
    function newChain() {
      modal2("发起接龙", `<div class="poll-form"><input id="chain-title" maxlength="100" placeholder="接龙主题，例如：周五聚餐报名"><textarea id="chain-note" maxlength="500" rows="3" placeholder="说明（可选），例如：请写上人数和忌口"></textarea></div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="chain-create">发起</button>');
      $2("#chain-create").onclick = async () => {
        try {
          await api2(`/api/conversations/${S2.active}/chains`, { method: "POST", body: { title: $2("#chain-title").value, note: $2("#chain-note").value } });
          closeModal2();
        } catch (e) {
          toast2(e.message);
        }
      };
      $2("#chain-title").focus();
    }
    async function vote(mid) {
      const box = document.querySelector(`[data-poll="${mid}"]`);
      const options = [...box.querySelectorAll("input:checked")].map((i) => +i.value);
      if (!options.length) {
        toast2("请先选择选项");
        return;
      }
      try {
        replace(await api2(`/api/messages/${mid}/votes`, { method: "POST", body: { options } }));
        rerender();
      } catch (e) {
        toast2(e.message);
      }
    }
    function pollDetail(m) {
      const spec = parse2(m.text), votes = m.poll?.votes || {};
      modal2("投票详情：" + esc4(spec.title || ""), `<div class="poll-detail">${(spec.options || []).map((o, i) => {
        const who = Object.entries(votes).filter(([, v]) => v.includes(i)).map(([u]) => nameOf(u));
        return `<div><b>${esc4(o)}</b> · ${who.length} 票<p>${who.length ? esc4(who.join("、")) : '<span class="hint">暂无</span>'}</p></div>`;
      }).join("")}</div>`, '<button class="secondary" data-action="close-modal">关闭</button>');
    }
    let chainEditing = "";
    async function saveChain(mid, text) {
      try {
        replace(await api2(`/api/messages/${mid}/chain`, { method: "POST", body: { text } }));
        chainEditing = "";
        rerender();
      } catch (e) {
        toast2(e.message);
      }
    }
    async function joinChain(m) {
      const mine = (m.chain || []).find((e) => e.userId === me());
      if (!mine) {
        await saveChain(m.id, "");
        return;
      }
      chainEditing = m.id;
      rerender();
      setTimeout(() => {
        const i = document.querySelector(`[data-chain-input="${m.id}"]`);
        i?.focus();
        i?.select();
      }, 0);
    }
    async function translate(m) {
      const cjk = (m.text.match(/[一-鿿]/g) || []).length, lang = cjk > m.text.length * 0.3 ? "en" : "zh";
      translations.set(m.id, { open: true, loading: true });
      rerender();
      try {
        const r = await api2(`/api/messages/${m.id}/translate`, { method: "POST", body: { lang } });
        translations.set(m.id, { open: true, text: r.text });
      } catch (e) {
        translations.delete(m.id);
        toast2(e.message);
      }
      rerender();
    }
    function loaded(cid) {
      summary = null;
      const c = S2.conversations.find((x) => x.id === cid);
      const box = $2("#unread-summary");
      if (box) box.innerHTML = "";
      loadPins(cid);
      if (!aiEnabled || !c || c.peer?.ai) return;
      const unread = c.unread || 0;
      if (unread < 8) return;
      const list = S2.messages.filter((m) => !m.threadId), i = list.length - unread;
      const afterSeq = i > 0 ? list[i - 1].seq : 0;
      summary = { cid, afterSeq, count: unread };
      if (box) box.innerHTML = `<button class="unread-summary" data-cx="summary">✦ ${unread} 条未读，让 Me 总结</button>`;
    }
    async function summarize(afterSeq, count) {
      const cid = S2.active;
      modal2("✦ Me 总结", `<div class="summary-body"><div class="ai-loading"><span></span>正在阅读${count ? count + " 条" : "最近的"}消息…</div></div>`, '<button class="secondary" data-action="close-modal">关闭</button>', true);
      try {
        const r = await api2(`/api/conversations/${cid}/summary`, { method: "POST", body: { afterSeq } });
        const body = document.querySelector(".summary-body");
        if (body) body.innerHTML = `<div class="ai-reply">${replyHTML(r.summary)}</div><p class="hint">根据 ${r.count} 条消息生成，仅你可见</p><button class="link" data-cx="summary-copy">复制</button>`;
        summary = { ...summary, text: r.summary };
        $2("#unread-summary") && ($2("#unread-summary").innerHTML = "");
      } catch (e) {
        const body = document.querySelector(".summary-body");
        if (body) body.innerHTML = `<p class="ai-error">${esc4(e.message)}</p>`;
      }
    }
    function schedule() {
      const input = $2("#composer");
      const text = input?.value || "";
      if (!text.trim()) {
        toast2("先输入要定时发送的内容");
        return;
      }
      const d = new Date(Date.now() + 36e5);
      d.setMinutes(0, 0, 0);
      const pad3 = (n) => String(n).padStart(2, "0");
      const local = `${d.getFullYear()}-${pad3(d.getMonth() + 1)}-${pad3(d.getDate())}T${pad3(d.getHours())}:${pad3(d.getMinutes())}`;
      modal2("定时发送", `<div class="poll-form"><p class="schedule-preview">${esc4(text).replace(/\n/g, "<br>")}</p><label>发送时间<input type="datetime-local" id="schedule-at" value="${local}"></label><label>重复<select id="schedule-repeat"><option value="once">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option></select></label></div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="schedule-ok">定时发送</button>');
      $2("#schedule-ok").onclick = async () => {
        const at = new Date($2("#schedule-at").value).getTime();
        if (!at || at < Date.now() - 6e4) {
          toast2("请选择未来的时间");
          return;
        }
        try {
          await api2("/api/schedules", { method: "POST", body: { conversationId: S2.active, kind: "text", text, at, repeat: $2("#schedule-repeat").value, tzOffset: -(/* @__PURE__ */ new Date()).getTimezoneOffset() } });
          closeModal2();
          if (input) {
            input.value = "";
            input.dispatchEvent(new Event("input"));
          }
          toast2("将在 " + new Date(at).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " 发送，可在设置 → 定时消息中管理");
        } catch (e) {
          toast2(e.message);
        }
      };
    }
    function previewFile(id, name) {
      const pdf = /\.pdf$/i.test(name), text = PREVIEW_TEXT.test(name), media = PREVIEW_MEDIA.test(name), asDoc = AS_DOC.test(name);
      if (!pdf && !text && !media && !asDoc) return false;
      if (pdf && window.WeLinkAndroid) return false;
      const url = fileURL2(id);
      let body;
      if (pdf) body = `<iframe class="file-frame" src="${url}?inline=1" title="${esc4(name)}"></iframe>`;
      else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) body = `<img class="file-image" src="${url}" alt="${esc4(name)}">`;
      else if (/\.(mp3|wav|m4a|ogg)$/i.test(name)) body = `<audio controls src="${url}"></audio>`;
      else if (media) body = `<video class="file-video" controls src="${url}"></video>`;
      else if (text) body = '<pre class="file-text">正在加载…</pre>';
      else body = `<div class="file-doc"><p>${esc4(name)}</p><p class="hint">可以在 LinkMe 云文档中打开，多人一起在线编辑。</p></div>`;
      modal2(esc4(name), `<div class="file-preview">${body}</div>`, `${asDoc ? '<button class="secondary" data-cx="file-doc" data-file="' + id + '">在云文档中打开</button>' : ""}<button class="primary" data-cx="file-download" data-file="${id}" data-name="${esc4(name)}">下载</button>`, true);
      if (text) fetch(url).then((r) => {
        if (!r.ok) throw Error("无法读取文件");
        return r.text();
      }).then((t) => {
        const pre = document.querySelector(".file-text");
        if (pre) pre.textContent = t.length > 4e5 ? t.slice(0, 4e5) + "\n…（文件较大，仅显示前一部分）" : t;
      }).catch((e) => {
        const pre = document.querySelector(".file-text");
        if (pre) pre.textContent = e.message;
      });
      return true;
    }
    async function copyImage(m) {
      try {
        const blob = await (await fetch(fileURL2(m.attachmentId))).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
        if (typeof window.welinkScreenshotCopy === "function") {
          const url = await new Promise((r) => {
            const f = new FileReader();
            f.onload = () => r(f.result);
            f.readAsDataURL(png);
          });
          await window.welinkScreenshotCopy(url);
        } else if (navigator.clipboard?.write && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        else throw Error("此设备暂不支持复制图片，可以长按保存");
        toast2("图片已复制");
      } catch (e) {
        toast2(e.message && !/NotAllowed|denied/i.test(e.message) ? e.message : "复制图片失败");
      }
    }
    const STATUS_OPTIONS = [["", "无状态"], ["busy", "忙碌"], ["dnd", "请勿打扰"], ["away", "暂时离开"], ["leave", "休假中"]];
    async function loadStatuses() {
      const ids = [...new Set([me(), ...(S2.friends || []).map((f) => f.id), ...S2.conversations.filter((c) => c.kind === "direct").map((c) => c.peer?.id)].filter(Boolean))];
      if (!ids.length) return;
      try {
        const r = await api2("/api/statuses?ids=" + ids.join(","));
        for (const [id, st] of Object.entries(r)) statuses.set(id, st);
        S2.myStatus = statuses.get(me()) || null;
        refreshStatus();
      } catch {
      }
    }
    function statusLabel(userId) {
      const st = statuses.get(userId);
      return st?.label || "";
    }
    function refreshStatus() {
      try {
        showPresence2();
      } catch {
      }
      const me_ = $2(".rail .self");
      if (me_) me_.dataset.status = S2.myStatus?.status || "";
    }
    function statusMenu() {
      const st = S2.myStatus || {};
      modal2("设置状态", `<div class="status-options">${STATUS_OPTIONS.map(([k, l]) => `<label><input type="radio" name="my-status" value="${k}" ${(st.manual || "") === k ? "checked" : ""}> ${l}</label>`).join("")}<label><input type="radio" name="my-status" value="custom" ${st.manual === "custom" ? "checked" : ""}> 自定义 <input id="status-text" maxlength="30" placeholder="例如：出差中" value="${esc4(st.manual === "custom" ? st.text || "" : "")}"></label></div><label class="status-until">持续<select id="status-until"><option value="0">直到我清除</option><option value="3600000">1 小时</option><option value="14400000">4 小时</option><option value="today">今天</option></select></label><p class="hint">会议、通话和远程协助时会自动显示“会议中”等状态。“请勿打扰”时不再弹出普通消息提醒，加急消息除外。</p>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="status-save">保存</button>');
      $2("#status-text").onfocus = () => {
        document.querySelector("input[name=my-status][value=custom]").checked = true;
      };
      $2("#status-save").onclick = async () => {
        const manual = document.querySelector("input[name=my-status]:checked")?.value || "";
        const u = $2("#status-until").value;
        let until = 0;
        if (u === "today") {
          const d = /* @__PURE__ */ new Date();
          d.setHours(23, 59, 59, 0);
          until = d.getTime();
        } else if (+u) until = Date.now() + +u;
        try {
          const r = await api2("/api/me/status", { method: "PUT", body: { manual, text: $2("#status-text").value, until } });
          statuses.set(me(), r);
          S2.myStatus = r;
          refreshStatus();
          closeModal2();
          toast2(r.label ? "状态：" + r.label : "已清除状态");
        } catch (e) {
          toast2(e.message);
        }
      };
    }
    function watchAuto() {
      const now = document.querySelector("#call-layer") ? "call" : document.querySelector("#meeting-layer .meeting-room") ? "meeting" : S2.remote && !["pending", "ended", "closed"].includes(S2.remote.state) ? "remote" : "";
      if (now === autoStatus || !S2.user) return;
      autoStatus = now;
      api2("/api/me/status", { method: "PUT", body: { auto: now } }).then((r) => {
        statuses.set(me(), r);
        S2.myStatus = r;
        refreshStatus();
      }).catch(() => {
        autoStatus = "";
      });
    }
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cx]");
      if (!b) return;
      const mid = b.dataset.mid, m = mid && find(mid);
      switch (b.dataset.cx) {
        case "react-pick":
          e.preventDefault();
          e.stopPropagation();
          document.querySelector(".context-menu")?.remove();
          if (mid) picker(mid, b.closest(".message")?.querySelector(".bubble") || b);
          break;
        case "react":
          e.preventDefault();
          react(mid, b.dataset.reaction);
          break;
        case "more": {
          e.preventDefault();
          e.stopPropagation();
          if (m) {
            const r = b.getBoundingClientRect();
            messageMenu2(m, r.left, r.bottom);
          }
          break;
        }
        case "edit":
          if (m) startEdit(m);
          break;
        case "edit-cancel":
          cancelEdit();
          break;
        case "pin":
          pin(mid, true);
          break;
        case "unpin":
          pin(mid, false);
          break;
        case "pins-open":
          pinList();
          break;
        case "pin-jump":
          closeModal2();
          jumpMessage2(S2.active, mid);
          break;
        case "urgent":
          if (m) urgent(m);
          break;
        case "urgent-ack":
          ack(mid);
          break;
        case "urgent-open": {
          const cid = b.dataset.cid;
          ack(mid);
          if (cid && S2.active !== cid) document.querySelector(`[data-conversation="${cid}"]`)?.click();
          setTimeout(() => jumpMessage2(cid, mid), 600);
          break;
        }
        case "thread":
          if (mid) openThread(mid);
          break;
        case "thread-close":
          closeThread();
          break;
        case "vote":
          vote(mid);
          break;
        case "poll-detail":
          if (m) pollDetail(m);
          break;
        case "poll-close":
          if (await confirmDialog("结束后不能再投票。", { title: "结束投票", ok: "结束" })) try {
            replace(await api2(`/api/messages/${mid}/close`, { method: "POST", body: {} }));
            rerender();
          } catch (err) {
            toast2(err.message);
          }
          break;
        case "chain-join":
          if (m) joinChain(m);
          break;
        case "chain-leave":
          try {
            replace(await api2(`/api/messages/${mid}/chain`, { method: "POST", body: { leave: true } }));
            rerender();
          } catch (err) {
            toast2(err.message);
          }
          break;
        case "chain-save": {
          const i = document.querySelector(`[data-chain-input="${mid}"]`);
          if (i) saveChain(mid, i.value.trim());
          break;
        }
        case "chain-cancel":
          chainEditing = "";
          rerender();
          break;
        case "translate":
          if (m) translate(m);
          break;
        case "translate-hide":
          translations.delete(mid);
          rerender();
          break;
        case "summary":
          if (summary) summarize(summary.afterSeq, summary.count);
          break;
        case "summary-copy":
          navigator.clipboard?.writeText(summary?.text || "").then(() => toast2("已复制"), () => toast2("复制失败"));
          break;
        case "new-poll":
          newPoll();
          break;
        case "new-chain":
          newChain();
          break;
        case "ai-summary":
          summarize(0, 0);
          break;
        case "file-download":
          closeModal2();
          download2(b.dataset.file, b.dataset.name);
          break;
        case "file-doc":
          try {
            const r = await api2("/api/docs/import-attachment", { method: "POST", body: { attachmentId: b.dataset.file } });
            closeModal2();
            Docs2.open(r.id);
          } catch (err) {
            toast2(err.message);
          }
          break;
        case "status":
          statusMenu();
          break;
        case "copy-image":
          if (m) copyImage(m);
          break;
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && S2.editing && e.target.id === "composer") {
        e.preventDefault();
        cancelEdit();
      }
      const ci = e.target.closest?.("[data-chain-input]");
      if (ci && !e.isComposing) {
        if (e.key === "Enter") {
          e.preventDefault();
          saveChain(ci.dataset.chainInput, ci.value.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          chainEditing = "";
          rerender();
        }
      }
    });
    return {
      card,
      extras,
      timeTag,
      hoverTools,
      moreTool,
      menuItems,
      preview: preview2,
      previewFile,
      statusLabel,
      editing: () => !!S2.editing && S2.editing.cid === S2.active,
      submitEdit,
      drawEditBar,
      tools(c) {
        return c && !c.peer?.ai ? `<button class="icon-btn" title="发起投票" aria-label="发起投票" data-cx="new-poll">${icon2("check")}</button><button class="icon-btn chain-tool" title="发起接龙" aria-label="发起接龙" data-cx="new-chain">龙</button>` : "";
      },
      headerButtons(c) {
        return aiEnabled && c && !c.peer?.ai ? `<button class="icon-btn" title="让 Me 总结最近消息" aria-label="AI 总结" data-cx="ai-summary">✦</button>` : "";
      },
      mount(c) {
        drawPins();
        drawEditBar();
        if (thread && thread.cid !== c?.id) closeThread();
        else drawThread();
        refreshStatus();
        const send = $2("#send-message");
        if (send) send.oncontextmenu = (e) => {
          e.preventDefault();
          schedule();
        };
        const btn2 = $2("#send-message");
        if (btn2 && !btn2.title) btn2.title = "右键可定时发送";
      },
      loaded,
      schedule,
      statusMenu,
      async start() {
        try {
          const c = await api2("/api/ai/config");
          aiEnabled = !!c.enabled;
        } catch {
          aiEnabled = false;
        }
        loadStatuses();
        try {
          const list = await api2("/api/urgent");
          for (const m of list) if (!urgentQueue.some((x) => x.message.id === m.id)) urgentQueue.push({ message: m, from: m.name });
          showUrgent();
        } catch {
        }
        clearInterval(statusTimer);
        statusTimer = setInterval(watchAuto, 3e3);
      },
      dnd: () => !!S2.myStatus?.dnd,
      event(type, d) {
        if (type === "message-updated") {
          if (replace(d)) rerender();
          if ((pins.get(d.conversationId) || []).some((p) => p.id === d.id)) loadPins(d.conversationId);
          return true;
        }
        if (type === "reaction") {
          const m = find(d.messageId);
          if (m) {
            m.reactions = d.reactions;
            rerender();
          }
          return true;
        }
        if (type === "pins") {
          loadPins(d.conversationId);
          return true;
        }
        if (type === "urgent") {
          if (!urgentQueue.some((x) => x.message.id === d.message.id)) urgentQueue.push(d);
          showUrgent();
          return true;
        }
        if (type === "status") {
          statuses.set(d.userId, d.status);
          if (d.userId === me()) S2.myStatus = d.status;
          refreshStatus();
          return true;
        }
        if (type === "meeting-minutes") {
          toast2("会议纪要已生成，可在云文档中查看：" + d.title);
          return true;
        }
        if (type === "message" && d.threadId) {
          if (thread?.root.id === d.threadId && !thread.replies.some((x) => x.id === d.id)) {
            thread.replies.push(d);
            drawThread(true);
          }
          return false;
        }
        return false;
      },
      reset() {
        translations.clear();
        pins.clear();
        statuses.clear();
        thread = null;
        urgentQueue = [];
        urgentShowing = null;
        summary = null;
        S2.editing = null;
        clearInterval(statusTimer);
        autoStatus = "";
        document.querySelector(".urgent-layer")?.remove();
      }
    };
  }

  // internal/ui/src/sidebar-resize.js
  var KEY = "welink_sidebar_width";
  var MIN = 220;
  var MAX = 400;
  var DEFAULT = 278;
  function sidebarResize() {
    const apply = (w) => document.documentElement.style.setProperty("--sidebar-w", w + "px");
    let saved = DEFAULT;
    try {
      saved = +localStorage.getItem(KEY) || DEFAULT;
    } catch {
    }
    apply(Math.min(MAX, Math.max(MIN, saved)));
    document.addEventListener("mousedown", (e) => {
      const handle = e.target.closest?.(".sidebar-resizer");
      if (!handle || e.button !== 0) return;
      e.preventDefault();
      const sidebar = handle.closest(".sidebar"), left = sidebar.getBoundingClientRect().left;
      document.body.classList.add("resizing-sidebar");
      let width = sidebar.offsetWidth;
      const move = (ev) => {
        width = Math.round(Math.min(MAX, Math.max(MIN, ev.clientX - left)));
        apply(width);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.classList.remove("resizing-sidebar");
        try {
          localStorage.setItem(KEY, String(width));
        } catch {
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    document.addEventListener("dblclick", (e) => {
      if (!e.target.closest?.(".sidebar-resizer")) return;
      apply(DEFAULT);
      try {
        localStorage.removeItem(KEY);
      } catch {
      }
    });
  }

  // internal/ui/src/work.js
  var DAY2 = 864e5;
  var pad2 = (n) => String(n).padStart(2, "0");
  var localInput = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  var dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  var startOfDay = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  var hm = (t) => {
    const d = new Date(t);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  };
  function whenText(t) {
    if (!t) return "";
    const d = new Date(t), today = startOfDay(Date.now()), day = startOfDay(t);
    const label = day === today ? "今天" : day === today + DAY2 ? "明天" : day === today - DAY2 ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日`;
    return label + " " + hm(t);
  }
  function createWork({ S: S2, api: api2, esc: esc4, av: av2, icon: icon2, modal: modal2, closeModal: closeModal2, toast: toast2, renderSidebar: renderSidebar2, openMessage: openMessage2, preview: preview2, meetingButton: meetingButton2 }) {
    const $2 = (s) => document.querySelector(s);
    let view = "tasks", taskScope = "mine", tasks = null, events = null, flags = null, month = startOfDay(Date.now()), selected = startOfDay(Date.now());
    const flagged = /* @__PURE__ */ new Set();
    const me = () => S2.user?.id;
    const peopleHTML = (list) => list.slice(0, 4).map((p) => `<span class="mini-av" title="${esc4(p.name)}">${av2(p)}</span>`).join("") + (list.length > 4 ? `<span class="mini-more">+${list.length - 4}</span>` : "");
    async function loadTasks() {
      try {
        tasks = await api2("/api/tasks?scope=" + taskScope);
      } catch (e) {
        tasks = [];
        toast2(e.message);
      }
      if (S2.tab === "work" && view === "tasks") draw();
    }
    async function loadEvents() {
      const from = startOfDay(month) - 7 * DAY2, to = from + 50 * DAY2;
      try {
        events = await api2(`/api/events?from=${Math.min(from, Date.now() - DAY2)}&to=${Math.max(to, Date.now() + 14 * DAY2)}`);
      } catch (e) {
        events = [];
        toast2(e.message);
      }
      if (S2.tab === "work" && view === "calendar") draw();
    }
    async function loadFlags() {
      try {
        flags = await api2("/api/flags");
        flagged.clear();
        for (const m of flags) flagged.add(m.id);
      } catch (e) {
        flags = [];
      }
      if (S2.tab === "work" && view === "flags") draw();
    }
    function render() {
      draw();
      if (view === "tasks") loadTasks();
      else if (view === "calendar") loadEvents();
      else loadFlags();
    }
    function draw() {
      const main = $2("#main-content");
      if (!main || S2.tab !== "work") return;
      const tabs = [["tasks", "待办"], ["calendar", "日历"], ["flags", "标记"]];
      main.innerHTML = `<section class="work-page"><header class="work-head"><h2>工作台</h2><nav class="docs-tabs">${tabs.map(([k, l]) => `<button class="${view === k ? "active" : ""}" data-work-view="${k}">${l}</button>`).join("")}</nav><span class="spacer"></span>${view === "tasks" ? '<button class="primary" data-work="new-task">新建待办</button>' : view === "calendar" ? '<button class="primary" data-work="new-event">新建日程</button>' : ""}</header><div class="work-body">${view === "tasks" ? tasksHTML() : view === "calendar" ? calendarHTML() : flagsHTML()}</div></section>`;
      const quick = $2("#task-quick");
      if (quick) quick.onkeydown = (e) => {
        if (e.key === "Enter" && quick.value.trim() && !e.isComposing) {
          e.preventDefault();
          quickTask(quick.value.trim());
        }
      };
    }
    function tasksHTML() {
      const list = tasks || [];
      return `<div class="task-quick"><input id="task-quick" maxlength="200" placeholder="添加待办，按 Enter 保存（可写“明天下午三点”之类的时间，打开详情再调整）"></div>
   <nav class="work-subtabs">${[["mine", "我负责的"], ["created", "我分配的"], ["done", "已完成"]].map(([k, l]) => `<button class="${taskScope === k ? "active" : ""}" data-task-scope="${k}">${l}</button>`).join("")}</nav>
   <div class="task-list">${tasks === null ? '<p class="hint">正在加载…</p>' : list.length ? list.map(taskRow).join("") : `<div class="docs-empty"><b>${taskScope === "done" ? "还没有完成的待办" : "没有待办"}</b><p>在聊天里右键消息“转为待办”，或者对 Me 说“提醒我周五交报告”。</p></div>`}</div>`;
    }
    function taskRow(t) {
      const overdue = t.due && !t.done && t.due < Date.now(), soon = t.due && !t.done && !overdue && t.due - Date.now() < DAY2;
      const from = t.creator.id !== me() ? `${esc4(t.creator.name)} 分配` : t.assignees.length && !(t.assignees.length === 1 && t.assignees[0].id === me()) ? "我分配给 " + esc4(t.assignees.map((a) => a.name).join("、")) : "";
      return `<div class="task-row${t.done ? " done" : ""}" data-task="${t.id}"><input type="checkbox" class="task-check" data-task-done="${t.id}" ${t.done ? "checked" : ""} aria-label="完成"><div class="task-main"><b>${esc4(t.title)}</b><small>${t.due ? `<span class="${overdue ? "overdue" : soon ? "soon" : ""}">${overdue ? "已逾期 · " : ""}截止 ${whenText(t.due)}</span>` : "无截止时间"}${from ? " · " + from : ""}${t.messageId ? " · 来自聊天" : ""}</small></div><span class="task-people">${peopleHTML(t.assignees)}</span></div>`;
    }
    function quickTask(text) {
      const due = parseWhen(text);
      api2("/api/tasks", { method: "POST", body: { title: text, due: due || 0, assignees: [] } }).then(() => {
        toast2(due ? "已添加，截止 " + whenText(due) : "已添加待办");
        loadTasks();
      }).catch((e) => toast2(e.message));
    }
    function calendarHTML() {
      const m = new Date(month);
      m.setDate(1);
      const first = new Date(m), startDay = new Date(m);
      startDay.setDate(1 - (first.getDay() + 6) % 7);
      const byDay = /* @__PURE__ */ new Map();
      for (const e of events || []) {
        for (let d = startOfDay(e.start); d <= e.end; d += DAY2) {
          const k = dayKey(d);
          if (!byDay.has(k)) byDay.set(k, []);
          byDay.get(k).push(e);
          if (byDay.get(k).length > 50) break;
        }
      }
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(startDay);
        d.setDate(startDay.getDate() + i);
        const t = d.getTime(), k = dayKey(t), n = (byDay.get(k) || []).length;
        cells.push(`<button class="cal-day${d.getMonth() !== first.getMonth() ? " other" : ""}${k === dayKey(Date.now()) ? " today" : ""}${k === dayKey(selected) ? " selected" : ""}" data-cal-day="${t}">${d.getDate()}${n ? `<i>${n > 3 ? "•••" : "•".repeat(n)}</i>` : ""}</button>`);
      }
      const day = (byDay.get(dayKey(selected)) || []).slice().sort((a, b) => a.start - b.start);
      const upcoming = (events || []).filter((e) => e.end >= Date.now()).sort((a, b) => a.start - b.start).slice(0, 8);
      return `<div class="cal-wrap"><div class="cal-month"><div class="cal-nav"><button class="icon-btn" data-cal-move="-1" aria-label="上个月">‹</button><b>${first.getFullYear()} 年 ${first.getMonth() + 1} 月</b><button class="icon-btn" data-cal-move="1" aria-label="下个月">›</button><button class="link" data-cal-today>今天</button></div><div class="cal-grid">${["一", "二", "三", "四", "五", "六", "日"].map((w) => `<span class="cal-week">${w}</span>`).join("")}${cells.join("")}</div></div>
   <div class="cal-agenda"><h4>${whenText(selected).split(" ")[0]} 的日程</h4>${events === null ? '<p class="hint">正在加载…</p>' : day.length ? day.map(eventRow).join("") : `<p class="hint">这天没有日程 · <button class="link" data-work="new-event">新建</button></p>`}<h4>接下来</h4>${upcoming.length ? upcoming.map(eventRow).join("") : '<p class="hint">没有即将开始的日程</p>'}</div></div>`;
    }
    function eventRow(e) {
      const mine = e.creator.id === me(), att = e.attendees.find((a) => a.id === me()), resp = { accept: "已接受", decline: "已拒绝", tentative: "待定", "": "待回复" }[att?.response ?? ""];
      return `<button class="event-row${att?.response === "decline" ? " declined" : ""}" data-event="${e.id}"><span class="event-time">${e.allDay ? "全天" : hm(e.start) + "–" + hm(e.end)}</span><span class="event-main"><b>${esc4(e.title)}</b><small>${startOfDay(e.start) !== startOfDay(Date.now()) ? whenText(e.start).split(" ")[0] + " · " : ""}${e.location ? esc4(e.location) + " · " : ""}${e.meeting ? "线上会议 · " : ""}${mine ? "我组织" : esc4(e.creator.name) + " 邀请 · " + resp}</small></span></button>`;
    }
    function flagsHTML() {
      if (flags === null) return '<p class="hint">正在加载…</p>';
      if (!flags.length) return '<div class="docs-empty"><b>没有标记的消息</b><p>在聊天里右键消息选“标记”，稍后在这里集中处理。</p></div>';
      return `<div class="flag-list">${flags.map((m) => `<div class="flag-row">${av2({ id: m.sender, name: m.name, avatar: m.avatar })}<div class="flag-main"><small>${esc4(m.conversationName)} · ${esc4(m.name)} · ${whenText(m.created)}</small><p>${esc4(preview2(m))}</p></div><div class="flag-actions"><button class="secondary" data-flag-open="${m.id}" data-cid="${m.conversationId}">查看</button><button class="secondary" data-flag-task="${m.id}">转为待办</button><button class="secondary" data-flag-done="${m.id}">完成</button></div></div>`).join("")}</div>`;
    }
    function peoplePicker(selectedIds, id = "people") {
      const friends = (S2.friends || []).filter((f) => !f.ai);
      return `<div class="people-picker" id="${id}"><input class="people-filter" placeholder="搜索好友"><div class="people-list">${friends.map((f) => `<label data-name="${esc4((f.remark || "") + f.name + (f.number || ""))}">${av2(f)}<span>${esc4(f.remark || f.name)}</span><input type="checkbox" value="${f.id}" ${selectedIds.includes(f.id) ? "checked" : ""}></label>`).join("") || '<p class="hint">还没有好友</p>'}</div></div>`;
    }
    function bindPicker(id = "people") {
      const box = document.getElementById(id);
      if (!box) return;
      box.querySelector(".people-filter").oninput = (e) => {
        const q = e.target.value.trim().toLowerCase();
        box.querySelectorAll("label").forEach((l) => l.classList.toggle("hidden", !!q && !l.dataset.name.toLowerCase().includes(q)));
      };
    }
    const picked = (id = "people") => [...document.querySelectorAll(`#${id} input[type=checkbox]:checked`)].map((i) => i.value);
    function newTask(prefill = {}) {
      modal2("新建待办", `<div class="poll-form"><input id="task-title" maxlength="200" placeholder="要做什么" value="${esc4(prefill.title || "")}"><label>截止时间<input type="datetime-local" id="task-due" value="${prefill.due ? localInput(prefill.due) : ""}"></label><label>负责人（不选就是自己）</label>${peoplePicker(prefill.assignees || [])}<textarea id="task-note" rows="3" maxlength="2000" placeholder="说明（可选）">${esc4(prefill.note || "")}</textarea></div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="task-save">创建</button>');
      bindPicker();
      $2("#task-title").focus();
      $2("#task-save").onclick = async () => {
        const due = $2("#task-due").value ? new Date($2("#task-due").value).getTime() : 0;
        try {
          await api2("/api/tasks", { method: "POST", body: { title: $2("#task-title").value, note: $2("#task-note").value, due, assignees: picked(), messageId: prefill.messageId || "" } });
          closeModal2();
          toast2("已创建待办");
          if (S2.tab === "work") loadTasks();
        } catch (e) {
          toast2(e.message);
        }
      };
    }
    async function openTask(id) {
      let list = tasks || [];
      let t = list.find((x) => x.id === id);
      if (!t) {
        try {
          t = (await api2("/api/tasks?scope=all")).find((x) => x.id === id);
        } catch {
        }
      }
      if (!t) {
        toast2("待办不存在");
        return;
      }
      const mine = t.creator.id === me();
      modal2(
        mine ? "编辑待办" : "待办详情",
        `<div class="poll-form">${mine ? `<input id="task-title" maxlength="200" value="${esc4(t.title)}"><label>截止时间<input type="datetime-local" id="task-due" value="${t.due ? localInput(t.due) : ""}"></label><label>负责人</label>${peoplePicker(t.assignees.map((a) => a.id))}<textarea id="task-note" rows="3" maxlength="2000" placeholder="说明">${esc4(t.note)}</textarea>` : `<h3>${esc4(t.title)}</h3><p class="hint">${esc4(t.creator.name)} 分配 · ${t.due ? "截止 " + whenText(t.due) : "无截止时间"}</p>${t.note ? `<p>${esc4(t.note).replace(/\n/g, "<br>")}</p>` : ""}<p>负责人：${esc4(t.assignees.map((a) => a.name).join("、") || "—")}</p>`}${t.messageId ? `<button class="link" data-task-message="${t.messageId}" data-cid="${t.conversationId}">查看原消息</button>` : ""}</div>`,
        `${mine ? '<button class="secondary danger" id="task-delete">删除</button>' : ""}<button class="secondary" id="task-toggle">${t.done ? "标为未完成" : "完成"}</button>${mine ? '<button class="primary" id="task-update">保存</button>' : ""}`
      );
      if (mine) {
        bindPicker();
        $2("#task-update").onclick = async () => {
          try {
            await api2("/api/tasks/" + id, { method: "PATCH", body: { title: $2("#task-title").value, note: $2("#task-note").value, due: $2("#task-due").value ? new Date($2("#task-due").value).getTime() : 0, assignees: picked() } });
            closeModal2();
            loadTasks();
          } catch (e) {
            toast2(e.message);
          }
        };
        $2("#task-delete").onclick = async () => {
          if (!await confirmDialog("删除后无法恢复。", { title: "删除待办", ok: "删除", danger: true })) return;
          try {
            await api2("/api/tasks/" + id, { method: "DELETE" });
            closeModal2();
            loadTasks();
          } catch (e) {
            toast2(e.message);
          }
        };
      }
      $2("#task-toggle").onclick = async () => {
        try {
          await api2("/api/tasks/" + id, { method: "PATCH", body: { done: !t.done } });
          closeModal2();
          loadTasks();
        } catch (e) {
          toast2(e.message);
        }
      };
    }
    function newEvent(prefill = {}) {
      const start = prefill.start || (() => {
        const d = new Date(Math.max(selected, startOfDay(Date.now())));
        const n = /* @__PURE__ */ new Date();
        d.setHours(Math.max(9, n.getHours() + 1), 0, 0, 0);
        return d.getTime();
      })();
      const end = prefill.end || start + 36e5;
      modal2("新建日程", eventForm({ title: prefill.title || "", start, end, location: "", note: "", meeting: !!prefill.meeting, remind: 15, attendees: (prefill.attendees || []).map((id) => ({ id })) }), '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="event-save">创建</button>');
      bindPicker("event-people");
      $2("#event-title").focus();
      $2("#event-save").onclick = async () => {
        try {
          await api2("/api/events", { method: "POST", body: eventValues() });
          closeModal2();
          toast2("已创建日程，已通知参与人");
          loadEvents();
        } catch (e) {
          toast2(e.message);
        }
      };
    }
    function eventForm(e) {
      return `<div class="poll-form"><input id="event-title" maxlength="200" placeholder="日程主题" value="${esc4(e.title)}"><div class="form-row"><label>开始<input type="datetime-local" id="event-start" value="${localInput(e.start)}"></label><label>结束<input type="datetime-local" id="event-end" value="${localInput(e.end)}"></label></div><div class="form-row"><label>地点<input id="event-location" maxlength="200" value="${esc4(e.location)}" placeholder="会议室或地址"></label><label>提醒<select id="event-remind">${[[0, "不提醒"], [5, "提前 5 分钟"], [15, "提前 15 分钟"], [30, "提前 30 分钟"], [60, "提前 1 小时"], [1440, "提前 1 天"]].map(([v, l]) => `<option value="${v}" ${e.remind === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div><label class="check-row"><input type="checkbox" id="event-meeting" ${e.meeting ? "checked" : ""}> 线上会议（到时一键发起）</label><label>参与人</label>${peoplePicker(e.attendees.map((a) => a.id), "event-people")}<textarea id="event-note" rows="2" maxlength="2000" placeholder="说明（可选）">${esc4(e.note)}</textarea></div>`;
    }
    const eventValues = () => ({ title: $2("#event-title").value, start: new Date($2("#event-start").value).getTime(), end: new Date($2("#event-end").value).getTime(), location: $2("#event-location").value, note: $2("#event-note").value, meeting: $2("#event-meeting").checked, remind: +$2("#event-remind").value, attendees: picked("event-people") });
    async function openEvent(id) {
      let e = (events || []).find((x) => x.id === id);
      if (!e) {
        try {
          e = (await api2(`/api/events?from=${Date.now() - 60 * DAY2}&to=${Date.now() + 300 * DAY2}`)).find((x) => x.id === id);
        } catch {
        }
      }
      if (!e) {
        toast2("日程不存在或已取消");
        return;
      }
      const mine = e.creator.id === me(), att = e.attendees.find((a) => a.id === me());
      const live = e.meeting && Date.now() > e.start - 15 * 6e4 && Date.now() < e.end;
      modal2(
        mine ? "编辑日程" : "日程详情",
        mine ? eventForm(e) : `<div class="event-detail"><h3>${esc4(e.title)}</h3><p>${e.allDay ? "全天" : whenText(e.start) + " – " + hm(e.end)}</p>${e.location ? `<p>地点：${esc4(e.location)}</p>` : ""}${e.meeting ? "<p>线上会议</p>" : ""}<p>组织者：${esc4(e.creator.name)}</p>${e.note ? `<p>${esc4(e.note).replace(/\n/g, "<br>")}</p>` : ""}</div><div class="event-people"><b>参与人</b>${e.attendees.map((a) => `<span>${av2(a)}${esc4(a.name)}<small>${{ accept: "接受", decline: "拒绝", tentative: "待定", "": "未回复" }[a.response]}</small></span>`).join("") || '<span class="hint">只有组织者</span>'}</div>`,
        (mine ? '<button class="secondary danger" id="event-delete">取消日程</button>' : att ? ["accept", "tentative", "decline"].map((r) => `<button class="${att.response === r ? "primary" : "secondary"}" data-event-response="${r}">${{ accept: "接受", tentative: "待定", decline: "拒绝" }[r]}</button>`).join("") : "") + (e.meeting ? `<button class="${live ? "primary" : "secondary"}" id="event-meet">${live ? "发起 / 加入会议" : "发起会议"}</button>` : "") + (mine ? '<button class="primary" id="event-update">保存</button>' : "")
      );
      if (mine) {
        bindPicker("event-people");
        $2("#event-update").onclick = async () => {
          try {
            await api2("/api/events/" + id, { method: "PATCH", body: eventValues() });
            closeModal2();
            loadEvents();
          } catch (err) {
            toast2(err.message);
          }
        };
        $2("#event-delete").onclick = async () => {
          if (!await confirmDialog("参与人会收到通知。", { title: "取消日程", ok: "取消日程", cancel: "不取消", danger: true })) return;
          try {
            await api2("/api/events/" + id, { method: "DELETE" });
            closeModal2();
            loadEvents();
          } catch (err) {
            toast2(err.message);
          }
        };
      }
      document.querySelectorAll("[data-event-response]").forEach((b) => b.onclick = async () => {
        try {
          await api2("/api/events/" + id, { method: "PATCH", body: { response: b.dataset.eventResponse } });
          closeModal2();
          loadEvents();
        } catch (err) {
          toast2(err.message);
        }
      });
      const meet = $2("#event-meet");
      if (meet) meet.onclick = async () => {
        closeModal2();
        try {
          const room = await api2("/api/meetings", { method: "POST", body: { title: e.title.slice(0, 60), members: [e.creator.id, ...e.attendees.map((a) => a.id)].filter((x) => x !== me()) } });
          meetingButton2(room.code);
        } catch (err) {
          toast2(err.message);
        }
      };
    }
    function parseWhen(text) {
      const now = /* @__PURE__ */ new Date();
      let d = null;
      const day = /(今天|明天|后天|大后天)/.exec(text), week = /(下)?(周|星期)([一二三四五六日天])/.exec(text), date = /(\d{1,2})月(\d{1,2})[日号]/.exec(text);
      if (day) {
        d = new Date(now);
        d.setDate(now.getDate() + { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[day[1]]);
      } else if (week) {
        d = new Date(now);
        const target = "一二三四五六日天".indexOf(week[3]) % 7 + 1;
        let diff = target % 7 - now.getDay();
        if (diff <= 0 || week[1]) diff += 7;
        if (week[1] && diff <= 7 && target % 7 > now.getDay()) diff += 0;
        d.setDate(now.getDate() + diff);
      } else if (date) {
        d = new Date(now.getFullYear(), +date[1] - 1, +date[2]);
        if (d < startOfDay(Date.now())) d.setFullYear(d.getFullYear() + 1);
      }
      const time = /(上午|早上|中午|下午|晚上)?\s*(\d{1,2})(?:[:：点](\d{1,2})?|点半)/.exec(text);
      if (!d && !time) return 0;
      if (!d) d = new Date(now);
      let h = 18, m = 0;
      if (time) {
        h = +time[2];
        m = time[0].includes("半") ? 30 : +(time[3] || 0);
        if (/下午|晚上/.test(time[1] || "") && h < 12) h += 12;
        if (time[1] === "中午" && h < 6) h += 12;
      }
      d.setHours(h, m, 0, 0);
      if (d.getTime() < Date.now() && !day && !week && !date) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    const FILTERS = [["all", "全部"], ["unread", "未读"], ["mention", "@我"], ["direct", "单聊"], ["group", "群聊"]];
    function chips() {
      if (S2.tab !== "messages") return "";
      const f = S2.chatFilter || "all";
      return `<div class="chat-filters" role="tablist">${FILTERS.map(([k, l]) => {
        const n = k === "unread" ? S2.conversations.filter((c) => c.unread > 0).length : k === "mention" ? S2.conversations.filter((c) => c.mentionCount > 0).length : 0;
        return `<button role="tab" class="${f === k ? "active" : ""}" data-chat-filter="${k}">${l}${n ? `<i>${n}</i>` : ""}</button>`;
      }).join("")}</div>`;
    }
    function filter(list) {
      switch (S2.chatFilter) {
        case "unread":
          return list.filter((c) => c.unread > 0 || c.mentionCount > 0);
        case "mention":
          return list.filter((c) => c.mentionCount > 0);
        case "direct":
          return list.filter((c) => c.kind === "direct");
        case "group":
          return list.filter((c) => c.kind === "group");
        default:
          return list;
      }
    }
    document.addEventListener("click", (e) => {
      const t = e.target;
      let b;
      if (b = t.closest("[data-work-view]")) {
        view = b.dataset.workView;
        render();
        return;
      }
      if (b = t.closest("[data-task-scope]")) {
        taskScope = b.dataset.taskScope;
        tasks = null;
        draw();
        loadTasks();
        return;
      }
      if (b = t.closest("[data-task-done]")) {
        e.stopPropagation();
        const id = b.dataset.taskDone;
        api2("/api/tasks/" + id, { method: "PATCH", body: { done: b.checked } }).then(() => {
          toast2(b.checked ? "已完成" : "已恢复");
          setTimeout(loadTasks, 300);
        }).catch((err) => {
          b.checked = !b.checked;
          toast2(err.message);
        });
        return;
      }
      if ((b = t.closest("[data-task]")) && !t.closest("input")) {
        openTask(b.dataset.task);
        return;
      }
      if (b = t.closest("[data-task-message]")) {
        closeModal2();
        openMessage2(b.dataset.cid, b.dataset.taskMessage);
        return;
      }
      if (b = t.closest("[data-work]")) {
        if (b.dataset.work === "new-task") newTask();
        else newEvent();
        return;
      }
      if (b = t.closest("[data-cal-day]")) {
        selected = +b.dataset.calDay;
        const d = new Date(selected);
        if (d.getMonth() !== new Date(month).getMonth()) {
          month = selected;
          loadEvents();
        }
        draw();
        return;
      }
      if (b = t.closest("[data-cal-move]")) {
        const d = new Date(month);
        d.setDate(1);
        d.setMonth(d.getMonth() + +b.dataset.calMove);
        month = d.getTime();
        events = null;
        draw();
        loadEvents();
        return;
      }
      if (t.closest("[data-cal-today]")) {
        month = selected = startOfDay(Date.now());
        draw();
        loadEvents();
        return;
      }
      if (b = t.closest("[data-event]")) {
        openEvent(b.dataset.event);
        return;
      }
      if (b = t.closest("[data-flag-open]")) {
        openMessage2(b.dataset.cid, b.dataset.flagOpen);
        return;
      }
      if (b = t.closest("[data-flag-done]")) {
        setFlag(b.dataset.flagDone, false).then(loadFlags);
        return;
      }
      if (b = t.closest("[data-flag-task]")) {
        const m = (flags || []).find((x) => x.id === b.dataset.flagTask);
        if (m) newTask({ title: preview2(m).slice(0, 200), messageId: m.id });
        return;
      }
      if (b = t.closest("[data-chat-filter]")) {
        S2.chatFilter = b.dataset.chatFilter;
        renderSidebar2();
        return;
      }
      if (b = t.closest("[data-work-msg]")) {
        const m = S2.messages.find((x) => x.id === b.dataset.mid);
        if (m) messageAction(b.dataset.workMsg, m);
        return;
      }
    });
    function messageAction(kind, m) {
      if (kind === "task") newTask({ title: preview2(m).slice(0, 200), messageId: m.id });
      else setFlag(m.id, kind === "flag");
    }
    async function setFlag(id, on) {
      try {
        await api2(`/api/messages/${id}/flag`, { method: on ? "POST" : "DELETE" });
        if (on) flagged.add(id);
        else flagged.delete(id);
        toast2(on ? "已标记，可在工作台 → 标记中处理" : "已取消标记");
      } catch (e) {
        toast2(e.message);
      }
    }
    return {
      render,
      newTask,
      newEvent,
      openTask,
      openEvent,
      chips,
      filter,
      parseWhen,
      menuItems(m) {
        if (m.recalled) return "";
        return `<button data-work-msg="task" data-mid="${m.id}">${icon2("check")}转为待办</button><button data-work-msg="${flagged.has(m.id) ? "unflag" : "flag"}" data-mid="${m.id}">${icon2("star")}${flagged.has(m.id) ? "取消标记" : "标记"}</button>`;
      },
      messageAction,
      setView(v) {
        view = v;
      },
      start() {
        loadFlags();
      },
      tasks: () => tasks,
      events: () => events,
      async fetchSoon() {
        const [t, e] = await Promise.all([api2("/api/tasks").catch(() => []), api2(`/api/events?from=${Date.now() - DAY2}&to=${Date.now() + 2 * DAY2}`).catch(() => [])]);
        return { tasks: t, events: e };
      },
      event(type, d) {
        if (type === "task") {
          if (S2.tab === "work" && view === "tasks") loadTasks();
        }
        if (type === "event") {
          if (S2.tab === "work" && view === "calendar") loadEvents();
        }
        if (type === "flags") {
          if (d.flagged) flagged.add(d.messageId);
          else flagged.delete(d.messageId);
          if (S2.tab === "work" && view === "flags") loadFlags();
        }
      },
      reset() {
        tasks = events = flags = null;
        flagged.clear();
        view = "tasks";
        taskScope = "mine";
      }
    };
  }

  // internal/ui/src/global-search.js
  function createGlobalSearch({ S: S2, api: api2, esc: esc4, av: av2, icon: icon2, modal: modal2, closeModal: closeModal2, toast: toast2, openMessage: openMessage2, openChat: openChat2, startChat: startChat2, Docs: Docs2, preview: preview2, whenText: whenText2 }) {
    const $2 = (s) => document.querySelector(s);
    let ticket = 0, timer = 0;
    const mark = (text, q) => {
      const t = esc4(text);
      if (!q) return t;
      const i = t.toLowerCase().indexOf(esc4(q).toLowerCase());
      return i < 0 ? t : t.slice(0, i) + "<mark>" + t.slice(i, i + esc4(q).length) + "</mark>" + t.slice(i + esc4(q).length);
    };
    function open2(query = "") {
      modal2("搜索", `<div class="global-search"><label class="docs-search">${icon2("search")}<input id="global-q" placeholder="搜索联系人、群聊、聊天记录、文档" maxlength="100" value="${esc4(query)}" autocomplete="off"></label><div id="global-results" class="global-results"><p class="hint">输入关键词开始搜索 · Ctrl + K 随时打开</p></div></div>`, '<button class="secondary" data-action="close-modal">关闭</button>', true);
      const input = $2("#global-q");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => run(input.value.trim()), 250);
      };
      if (query) run(query);
    }
    async function run(q) {
      const box = $2("#global-results");
      if (!box) return;
      if (!q) {
        box.innerHTML = '<p class="hint">输入关键词开始搜索</p>';
        return;
      }
      const t = ++ticket;
      box.innerHTML = '<p class="hint">正在搜索…</p>';
      let r;
      try {
        r = await api2("/api/search?q=" + encodeURIComponent(q));
      } catch (e) {
        if (t === ticket) box.innerHTML = `<p class="hint">${esc4(e.message)}</p>`;
        return;
      }
      if (t !== ticket || !$2("#global-results")) return;
      const section = (title, items) => items.length ? `<h5>${title}</h5>${items.join("")}` : "";
      const html = section("联系人", r.contacts.map((c) => `<button class="search-hit" data-hit-user="${c.id}" data-cid="${c.conversationId || ""}">${av2(c)}<span><b>${mark(c.name, q)}</b><small>LinkMe 号 ${esc4(c.number)}</small></span></button>`)) + section("群聊", r.chats.map((c) => `<button class="search-hit" data-hit-chat="${c.id}"><span class="avatar">${icon2("contacts")}</span><span><b>${mark(c.name, q)}</b><small>${c.count} 人</small></span></button>`)) + section("聊天记录", r.messages.map((m) => `<button class="search-hit" data-hit-message="${m.id}" data-cid="${m.conversationId}">${av2({ id: m.sender, name: m.name, avatar: m.avatar })}<span><b>${esc4(m.conversationName)} · ${esc4(m.name)}</b><small>${mark(preview2(m), q)} · ${whenText2(m.created)}</small></span></button>`)) + section("云文档", r.docs.map((d) => `<button class="search-hit" data-hit-doc="${d.id}"><span class="docs-icon ${d.kind === "sheet" ? "is-sheet" : "is-doc"}">${icon2("doc")}</span><span><b>${mark(d.title, q)}</b><small>${esc4(d.ownerName)} · ${whenText2(d.updated)}</small></span></button>`));
      box.innerHTML = html || '<p class="hint">没有找到相关内容</p>';
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest(".search-hit");
      if (!b) return;
      closeModal2();
      if (b.dataset.hitUser) {
        if (b.dataset.cid) openChat2(b.dataset.cid);
        else startChat2(b.dataset.hitUser);
      } else if (b.dataset.hitChat) openChat2(b.dataset.hitChat);
      else if (b.dataset.hitMessage) openMessage2(b.dataset.cid, b.dataset.hitMessage);
      else if (b.dataset.hitDoc) Docs2.open(b.dataset.hitDoc);
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k" && S2.user) {
        e.preventDefault();
        open2(window.getSelection()?.toString().trim().slice(0, 100) || "");
      }
    });
    return { open: open2 };
  }

  // internal/ui/src/assistant.js
  var SUGGESTIONS = ["总结一下我的未读消息", "明天上午十点和同事开个会", "提醒我周五下午交周报", "把状态设为请勿打扰两小时", "今天有什么需要我处理的？"];
  function createAssistant({ S: S2, api: api2, esc: esc4, av: av2, icon: icon2, toast: toast2, openChat: openChat2, openMessage: openMessage2, startChat: startChat2, showWork: showWork2, showTab: showTab2, Docs: Docs2, Work: Work2, closeModal: closeModal2 }) {
    const $2 = (s) => document.querySelector(s);
    let prefs = { enabled: false, brief: true, nudges: true, ai: false }, notices = [], brief = null, briefing = false, asking = false, answer = null, timer = 0, bubbleTimer = 0, started = false;
    const bubbles = [], shown = /* @__PURE__ */ new Set();
    const me = () => S2.user?.id;
    const today = () => (/* @__PURE__ */ new Date()).toDateString();
    const store = (k, v) => {
      try {
        if (v === void 0) return JSON.parse(localStorage.getItem("welink_me_" + k) || "null");
        localStorage.setItem("welink_me_" + k, JSON.stringify(v));
      } catch {
        return null;
      }
    };
    const dismissed = () => {
      const d = store("dismissed");
      return d?.date === today() ? new Set(d.keys) : /* @__PURE__ */ new Set();
    };
    const tz = () => -(/* @__PURE__ */ new Date()).getTimezoneOffset();
    const quiet = () => !!S2.myStatus?.dnd;
    function orb() {
      let el = $2("#me-orb");
      if (!prefs.enabled || !S2.user) {
        el?.remove();
        $2("#me-bubble")?.remove();
        $2("#me-assist")?.remove();
        return null;
      }
      if (!el) {
        el = document.createElement("button");
        el.id = "me-orb";
        el.className = "me-orb";
        el.setAttribute("aria-label", "Me 管家");
        el.title = "Me 管家";
        el.innerHTML = '<span class="orb-core">M</span><span class="orb-badge hidden"></span>';
        document.body.append(el);
        el.onclick = () => {
          if (el.dataset.dragged) {
            delete el.dataset.dragged;
            return;
          }
          togglePanel();
        };
        dragOrb(el);
      }
      const n = notices.length;
      const badge = el.querySelector(".orb-badge");
      badge.textContent = n > 99 ? "99+" : n;
      badge.classList.toggle("hidden", !n);
      el.classList.toggle("alert", notices.some((x) => x.level === "high"));
      return el;
    }
    function dragOrb(el) {
      let start = null;
      el.addEventListener("touchstart", (e) => {
        start = { y: e.touches[0].clientY, top: el.getBoundingClientRect().top };
      }, { passive: true });
      el.addEventListener("touchmove", (e) => {
        if (!start) return;
        const dy = e.touches[0].clientY - start.y;
        if (Math.abs(dy) < 6) return;
        el.dataset.dragged = "1";
        const top = Math.max(70, Math.min(innerHeight - 140, start.top + dy));
        el.style.top = top + "px";
        el.style.bottom = "auto";
        e.preventDefault();
      }, { passive: false });
      el.addEventListener("touchend", () => {
        if (el.dataset.dragged) store("orb", el.style.top);
        start = null;
      });
      const saved = store("orb");
      if (saved && innerWidth <= 700) {
        el.style.top = saved;
        el.style.bottom = "auto";
      }
    }
    function bubble(text, open2, urgent = true) {
      if (!prefs.enabled || !prefs.nudges) return;
      const b = { text, open: open2, urgent };
      const cur = $2("#me-bubble");
      if (urgent && cur && cur.dataset.urgent !== "1") {
        bubbles.unshift(b, current);
        cur.remove();
        clearTimeout(bubbleTimer);
        nextBubble();
        return;
      }
      if (urgent) {
        const i = bubbles.findIndex((x) => !x.urgent);
        bubbles.splice(i < 0 ? bubbles.length : i, 0, b);
      } else bubbles.push(b);
      if (!cur) nextBubble();
    }
    let current = null;
    function nextBubble() {
      if ($2("#me-assist")) {
        bubbles.length = 0;
        return;
      }
      const b = bubbles.shift();
      if (!b) return;
      const o = orb();
      if (!o) return;
      current = b;
      const el = document.createElement("div");
      el.id = "me-bubble";
      el.className = "me-bubble";
      el.setAttribute("role", "status");
      el.dataset.urgent = b.urgent ? "1" : "";
      el.innerHTML = `<span>${esc4(b.text)}</span><button class="icon-btn" aria-label="关闭">${icon2("close")}</button>`;
      document.body.append(el);
      const r = o.getBoundingClientRect();
      if (innerWidth > 700) {
        el.style.left = r.right + 10 + "px";
        el.style.bottom = innerHeight - r.bottom + "px";
      } else {
        el.style.right = "76px";
        el.style.top = Math.max(8, r.top) + "px";
      }
      el.onclick = (e) => {
        const close = e.target.closest("button");
        el.remove();
        clearTimeout(bubbleTimer);
        if (!close) {
          if (b.open) b.open();
          else openPanel();
        }
        setTimeout(nextBubble, 300);
      };
      o.classList.add("speaking");
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => {
        el.remove();
        o.classList.remove("speaking");
        setTimeout(nextBubble, 400);
      }, 8e3);
    }
    function togglePanel() {
      if ($2("#me-assist")) closePanel();
      else openPanel();
    }
    function closePanel() {
      $2("#me-assist")?.remove();
    }
    function openPanel() {
      if (!prefs.enabled) return;
      let p = $2("#me-assist");
      if (!p) {
        p = document.createElement("aside");
        p.id = "me-assist";
        p.className = "me-assist";
        p.setAttribute("aria-label", "Me 管家");
        document.body.append(p);
        p.addEventListener("click", panelClick);
        p.innerHTML = `<header><b>✦ Me 管家</b><label class="assist-switch" title="关闭后不再提醒，可在设置里重新打开"><input type="checkbox" id="assist-enabled" checked> 管理应用</label><button class="icon-btn" data-me="close" aria-label="关闭">${icon2("close")}</button></header><div class="assist-body"></div><form class="assist-ask"><div class="assist-chips">${SUGGESTIONS.map((s) => `<button type="button" data-me-suggest="${esc4(s)}">${esc4(s)}</button>`).join("")}</div><textarea rows="2" maxlength="2000" placeholder="让 Me 帮你：发消息、建待办、约日程、改状态、打开文档…"></textarea><button class="primary" type="submit">发送</button></form>`;
        p.querySelector("#assist-enabled").onchange = (e) => {
          if (!e.target.checked) setEnabled(false);
        };
        const form = p.querySelector("form"), ta = form.querySelector("textarea");
        form.onsubmit = (e) => {
          e.preventDefault();
          ask(ta.value);
        };
        ta.onkeydown = (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            ask(ta.value);
          }
        };
        if (!prefs.ai) form.classList.add("hidden");
      }
      draw();
      if (prefs.ai && prefs.brief && !brief && !briefing) loadBrief();
    }
    function draw() {
      const body = $2("#me-assist .assist-body");
      if (!body) return;
      const hour = (/* @__PURE__ */ new Date()).getHours(), hello = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
      const facts = brief?.facts;
      body.innerHTML = `<section class="assist-hello"><h3>${hello}，${esc4(S2.user?.name || "")}</h3>${facts ? `<div class="assist-facts"><span><b>${facts.unread || 0}</b>未读</span><span><b>${facts.mentions || 0}</b>@我</span><span><b>${facts.tasks || 0}</b>待办</span><span><b>${facts.events || 0}</b>日程</span></div>` : ""}</section>
   ${prefs.ai && prefs.brief ? `<section class="assist-brief"><h4>今日简报${brief?.text ? '<button class="link" data-me="rebrief">刷新</button>' : ""}</h4>${briefing ? '<div class="ai-loading"><span></span>Me 正在整理今天的情况…</div>' : brief?.text ? `<div class="ai-reply">${replyHTML(brief.text)}</div>` : `${brief?.error ? `<p class="hint">简报暂时无法生成：${esc4(brief.error)}</p>` : ""}<button class="secondary" data-me="rebrief">${brief?.error ? "重试" : "生成今日简报"}</button>`}</section>` : ""}
   <section class="assist-notices"><h4>需要关注${notices.length ? ` · ${notices.length}` : ""}</h4>${notices.length ? notices.map(noticeHTML).join("") : '<p class="hint">暂时没有需要你处理的事 🎉</p>'}</section>
   ${answer ? `<section class="assist-answer"><h4>Me 的回复</h4>${answer.loading ? '<div class="ai-loading"><span></span>Me 正在想…</div>' : `${answer.reply ? `<div class="ai-reply">${replyHTML(answer.reply)}</div>` : ""}${answer.actions.length ? `<div class="assist-actions">${answer.actions.map(actionHTML).join("")}${answer.actions.filter((a) => !a.done).length > 1 ? '<button class="primary" data-me="run-all">全部执行</button>' : ""}</div>` : ""}`}</section>` : ""}
   ${!prefs.ai ? '<p class="hint">服务器未开启 AI，Me 管家只做提醒。</p>' : ""}`;
    }
    function noticeHTML(n, i) {
      return `<div class="notice ${n.level || ""}"><span class="notice-icon">${n.icon || "•"}</span><div class="notice-text">${esc4(n.text)}${n.sub ? `<small>${esc4(n.sub)}</small>` : ""}</div><div class="notice-actions">${(n.actions || []).map((a, j) => `<button class="${j === 0 ? "primary" : "secondary"}" data-notice="${i}" data-notice-action="${j}">${esc4(a.label)}</button>`).join("")}<button class="icon-btn" data-notice-dismiss="${i}" title="忽略" aria-label="忽略">${icon2("close")}</button></div></div>`;
    }
    async function refresh2() {
      if (!prefs.enabled || !S2.user) return;
      const skip = dismissed(), list = [];
      const conv = S2.conversations || [];
      for (const c of conv.filter((c2) => c2.mentionCount > 0).slice(0, 3)) list.push({ key: "mention:" + c.id + ":" + c.mentionCount, icon: "@", level: "high", text: `${c.name} 里有 ${c.mentionCount} 条消息 @你`, actions: [{ label: "查看", run: () => openChat2(c.id) }] });
      const unread = conv.filter((c) => c.unread > 0 && !c.muted && !c.peer?.ai), total = unread.reduce((n, c) => n + c.unread, 0);
      if (total) list.push({ key: "unread:" + total, icon: "💬", text: `${unread.length} 个聊天共 ${total} 条未读`, sub: unread.slice(0, 3).map((c) => c.name).join("、"), actions: [{ label: "去看看", run: () => {
        S2.chatFilter = "unread";
        showTab2("messages");
      } }] });
      try {
        const { tasks, events } = await Work2.fetchSoon();
        const now = Date.now();
        const overdue = tasks.filter((t) => t.due && t.due < now), soon = tasks.filter((t) => t.due && t.due >= now && t.due - now < 6 * 36e5);
        if (overdue.length) list.push({ key: "overdue:" + overdue.map((t) => t.id).join(), icon: "⏰", level: "high", text: `${overdue.length} 个待办已逾期`, sub: overdue.slice(0, 3).map((t) => t.title).join("、"), actions: [{ label: "处理", run: () => showWork2("tasks") }] });
        for (const t of soon.slice(0, 3)) list.push({ key: "due:" + t.id + ":" + t.due, icon: "📌", text: `待办“${t.title}”将在 ${whenText(t.due)} 截止`, actions: [{ label: "完成", run: () => api2("/api/tasks/" + t.id, { method: "PATCH", body: { done: true } }).then(() => {
          toast2("已完成");
          refresh2();
        }) }, { label: "查看", run: () => {
          showWork2("tasks");
          setTimeout(() => Work2.openTask(t.id), 200);
        } }] });
        for (const e of events.filter((e2) => e2.start > now - 10 * 6e4 && e2.start - now < 3 * 36e5 && e2.attendees.find((a) => a.id === me())?.response !== "decline").slice(0, 3)) {
          const mins = Math.round((e.start - now) / 6e4);
          list.push({ key: "event:" + e.id + ":" + e.start, icon: "📅", level: mins <= 15 ? "high" : "", text: mins > 0 ? `“${e.title}”${mins < 60 ? mins + " 分钟后" : "将在 " + whenText(e.start)}开始` : `“${e.title}”正在进行`, sub: e.location || (e.meeting ? "线上会议" : ""), actions: [{ label: "查看", run: () => {
            showWork2("calendar");
            setTimeout(() => Work2.openEvent(e.id), 200);
          } }] });
          const remind = e.remind || 15;
          if (mins <= remind && mins >= -1 && !shown.has("remind:" + e.id + e.start)) {
            shown.add("remind:" + e.id + e.start);
            if (!quiet()) bubble(`“${e.title}”${mins > 0 ? mins + " 分钟后开始" : "开始了"}${e.meeting ? "，点我查看会议" : ""}`, () => {
              showWork2("calendar");
              setTimeout(() => Work2.openEvent(e.id), 200);
            });
          }
        }
        for (const t of soon.filter((t2) => t2.due - now < 30 * 6e4)) if (!shown.has("due:" + t.id)) {
          shown.add("due:" + t.id);
          if (!quiet()) bubble(`待办“${t.title}”快到截止时间了`, () => showWork2("tasks"));
        }
      } catch {
      }
      notices = list.filter((n) => !skip.has(n.key)).concat(extra.filter((n) => !skip.has(n.key)));
      orb();
      draw();
    }
    const extra = [];
    document.addEventListener("change", (e) => {
      if (e.target.matches?.("[data-assistant-toggle]")) setEnabled(e.target.checked);
    });
    function remember(n) {
      if (extra.some((x) => x.key === n.key)) return;
      extra.unshift(n);
      if (extra.length > 20) extra.pop();
    }
    function dismiss(i) {
      const n = notices[i];
      if (!n) return;
      const d = dismissed();
      d.add(n.key);
      store("dismissed", { date: today(), keys: [...d] });
      const j = extra.indexOf(n);
      if (j >= 0) extra.splice(j, 1);
      notices.splice(i, 1);
      orb();
      draw();
    }
    async function loadBrief(force = false) {
      const cached = store("brief");
      if (!force && cached?.date === today()) {
        brief = cached;
        draw();
        return;
      }
      briefing = true;
      draw();
      try {
        const r = await api2("/api/assistant/brief?tz=" + tz(), { method: "POST", body: {} });
        brief = { date: today(), text: r.brief, facts: r.facts };
        store("brief", brief);
      } catch (e) {
        brief = { date: "", text: "", facts: null, error: e.message };
      } finally {
        briefing = false;
        draw();
      }
    }
    async function ask(text) {
      text = (text || "").trim();
      if (!text || asking) return;
      asking = true;
      const ta = $2("#me-assist textarea");
      if (ta) ta.value = "";
      answer = { loading: true, actions: [] };
      draw();
      try {
        const r = await api2("/api/assistant/ask?tz=" + tz(), { method: "POST", body: { text } });
        answer = { reply: r.reply, actions: r.actions.map((a) => ({ ...a, done: false })) };
      } catch (e) {
        answer = { reply: "⚠️ " + e.message, actions: [] };
      } finally {
        asking = false;
        draw();
        $2("#me-assist .assist-answer")?.scrollIntoView({ block: "nearest" });
      }
    }
    const convName = (id) => S2.conversations.find((c) => c.id === id)?.name || "某个聊天";
    const userName = (id) => id === me() ? "我" : (S2.friends || []).find((f) => f.id === id)?.name || "成员";
    const parseTime = (s) => {
      if (!s) return 0;
      const t = new Date(String(s).replace(" ", "T")).getTime();
      return isNaN(t) ? 0 : t;
    };
    function describe(a) {
      switch (a.type) {
        case "send_message":
          return [`发消息给 ${convName(a.conversationId)}`, a.text];
        case "schedule_message":
          return [`定时发消息给 ${convName(a.conversationId)}`, `${whenText(parseTime(a.at))}：${a.text}`];
        case "create_task":
          return ["新建待办", `${a.title}${a.due ? " · 截止 " + whenText(parseTime(a.due)) : ""}${a.assignees?.length ? " · 负责人 " + a.assignees.map(userName).join("、") : ""}`];
        case "complete_task":
          return ["完成待办", (Work2.tasks() || []).find((t) => t.id === a.taskId)?.title || a.taskId];
        case "create_event":
          return ["新建日程", `${a.title} · ${whenText(parseTime(a.start))}${a.end ? " – " + whenText(parseTime(a.end)).split(" ")[1] : ""}${a.attendees?.length ? " · 邀请 " + a.attendees.map(userName).join("、") : ""}${a.meeting ? " · 线上会议" : ""}`];
        case "set_status":
          return ["设置状态", a.status === "clear" ? "清除状态" : ({ busy: "忙碌", dnd: "请勿打扰", away: "暂时离开", leave: "休假中", custom: a.text }[a.status] || a.status) + (a.hours ? ` · ${a.hours} 小时` : "")];
        case "open":
          return ["打开", { chat: convName(a.id), doc: "云文档", tasks: "待办", calendar: "日历", flags: "标记的消息", docs: "云文档列表" }[a.target] || a.target];
        case "create_doc":
          return ["新建文档", a.title];
        case "summarize_chat":
          return ["总结聊天", convName(a.conversationId)];
      }
      return [a.type, ""];
    }
    function actionHTML(a, i) {
      const [title, detail] = describe(a);
      return `<div class="assist-action${a.done ? " done" : ""}"><div><b>${esc4(title)}</b>${detail ? `<small>${esc4(detail)}</small>` : ""}</div>${a.done ? `<span class="ok">${a.done === true ? "已完成" : esc4(a.done)}</span>` : `<button class="primary" data-me-run="${i}">执行</button><button class="secondary" data-me-skip="${i}">取消</button>`}</div>`;
    }
    async function run(a) {
      const clientId = "me-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      switch (a.type) {
        case "send_message":
          await api2(`/api/conversations/${a.conversationId}/messages`, { method: "POST", body: { kind: "text", text: String(a.text || ""), clientId } });
          return "已发送";
        case "schedule_message":
          await api2("/api/schedules", { method: "POST", body: { conversationId: a.conversationId, kind: "text", text: String(a.text || ""), at: parseTime(a.at), repeat: "once", tzOffset: tz() } });
          return "已设置";
        case "create_task":
          await api2("/api/tasks", { method: "POST", body: { title: a.title, due: parseTime(a.due), assignees: a.assignees || [] } });
          return "已创建";
        case "complete_task":
          await api2("/api/tasks/" + a.taskId, { method: "PATCH", body: { done: true } });
          return "已完成";
        case "create_event": {
          const start = parseTime(a.start);
          await api2("/api/events", { method: "POST", body: { title: a.title, start, end: parseTime(a.end) || start + 36e5, attendees: a.attendees || [], meeting: !!a.meeting, location: a.location || "" } });
          return "已创建";
        }
        case "set_status": {
          const r = await api2("/api/me/status", { method: "PUT", body: { manual: a.status === "clear" ? "" : a.status, text: a.text || "", until: a.hours ? Date.now() + a.hours * 36e5 : 0 } });
          S2.myStatus = r;
          return "已设置";
        }
        case "open":
          closePanel();
          if (a.target === "chat" && a.id) openChat2(a.id);
          else if (a.target === "doc" && a.id) Docs2.open(a.id);
          else if (a.target === "docs") showTab2("docs");
          else showWork2(a.target === "calendar" ? "calendar" : a.target === "flags" ? "flags" : "tasks");
          return "已打开";
        case "create_doc": {
          const form = new FormData();
          form.append("file", new File([String(a.markdown || "")], (a.title || "新文档").replace(/[\\/:*?"<>|]/g, "_") + ".md", { type: "text/markdown" }));
          const r = await api2("/api/docs/import", { method: "POST", body: form });
          closePanel();
          Docs2.open(r.id);
          return "已创建";
        }
        case "summarize_chat":
          closePanel();
          await openChat2(a.conversationId);
          setTimeout(() => document.querySelector("[data-cx=ai-summary]")?.click(), 500);
          return "已打开";
      }
      throw Error("Me 不支持这个操作");
    }
    async function runAt(i) {
      const a = answer?.actions[i];
      if (!a || a.done) return;
      try {
        a.done = await run(a);
      } catch (e) {
        toast2(e.message);
        return;
      }
      draw();
      setTimeout(refresh2, 500);
    }
    function panelClick(e) {
      const t = e.target;
      let b;
      if (t.closest("[data-me=close]")) {
        closePanel();
        return;
      }
      if (t.closest("[data-me=rebrief]")) {
        loadBrief(true);
        return;
      }
      if (t.closest("[data-me=run-all]")) {
        (async () => {
          for (let i = 0; i < answer.actions.length; i++) await runAt(i);
        })();
        return;
      }
      if (b = t.closest("[data-me-run]")) {
        runAt(+b.dataset.meRun);
        return;
      }
      if (b = t.closest("[data-me-skip]")) {
        answer.actions[+b.dataset.meSkip].done = "已取消";
        draw();
        return;
      }
      if (b = t.closest("[data-me-suggest]")) {
        const ta = $2("#me-assist textarea");
        ta.value = b.dataset.meSuggest;
        ta.focus();
        return;
      }
      if (b = t.closest("[data-notice-action]")) {
        const n = notices[+b.dataset.notice];
        const a = n?.actions?.[+b.dataset.noticeAction];
        if (a) {
          Promise.resolve(a.run()).catch((err) => toast2(err.message));
          if (!/查看|去看看|处理/.test(a.label)) dismiss(+b.dataset.notice);
        }
        return;
      }
      if (b = t.closest("[data-notice-dismiss]")) {
        dismiss(+b.dataset.noticeDismiss);
        return;
      }
    }
    async function setEnabled(on) {
      try {
        prefs = await api2("/api/assistant/prefs", { method: "PUT", body: { enabled: on } });
      } catch (e) {
        toast2(e.message);
        return;
      }
      if (!on) {
        closePanel();
        orb();
        toast2("已关闭 AI 管家，可在设置里重新打开");
      } else {
        toast2("Me 管家已开启");
        boot();
      }
    }
    async function boot() {
      orb();
      refresh2();
      clearInterval(timer);
      timer = setInterval(refresh2, 6e4);
      if (prefs.ai && prefs.brief) {
        const cached = store("brief");
        if (cached?.date === today()) brief = cached;
        else {
          await loadBrief();
          if (brief?.text && !quiet()) bubble("今日简报已准备好，点我看看今天要处理的事", openPanel, false);
        }
      }
    }
    return {
      async start() {
        started = true;
        try {
          prefs = await api2("/api/assistant/prefs");
        } catch {
          prefs = { enabled: false };
        }
        if (prefs.enabled) boot();
        else orb();
      },
      settingsRow() {
        return `<div class="prefs-row"><span>AI 管家 Me<small class="hint" style="display:block">悬浮助手、主动提醒和今日简报</small></span><label class="switch"><input type="checkbox" data-assistant-toggle ${prefs.enabled ? "checked" : ""}><span></span></label></div>`;
      },
      toggle(on) {
        setEnabled(on);
      },
      open: openPanel,
      event(type, d) {
        if (!prefs.enabled) return;
        if (type === "task" && d.created && d.by !== me()) {
          const t = d.task;
          remember({ key: "assigned:" + t.id, icon: "📌", level: "high", text: `${t.creator.name} 给你分配了待办“${t.title}”`, sub: t.due ? "截止 " + whenText(t.due) : "", actions: [{ label: "查看", run: () => {
            showWork2("tasks");
            setTimeout(() => Work2.openTask(t.id), 200);
          } }] });
          if (!quiet()) bubble(`${t.creator.name} 给你分配了待办：${t.title}`, () => {
            showWork2("tasks");
            setTimeout(() => Work2.openTask(t.id), 200);
          });
        }
        if (type === "event" && d.created && d.by !== me()) {
          const e = d.event;
          remember({ key: "invite:" + e.id, icon: "📅", level: "high", text: `${e.creator.name} 邀请你参加“${e.title}”`, sub: whenText(e.start), actions: [{ label: "接受", run: () => api2("/api/events/" + e.id, { method: "PATCH", body: { response: "accept" } }).then(() => toast2("已接受")) }, { label: "拒绝", run: () => api2("/api/events/" + e.id, { method: "PATCH", body: { response: "decline" } }).then(() => toast2("已拒绝")) }] });
          if (!quiet()) bubble(`${e.creator.name} 邀请你参加“${e.title}”（${whenText(e.start)}）`, openPanel);
        }
        if (type === "event" && d.deleted && d.by !== me()) remember({ key: "cancel:" + d.event.id, icon: "📅", text: `日程“${d.event.title || ""}”已取消` });
        if (type === "doc-access" && !d.deleted) remember({ key: "doc:" + d.docId, icon: "📄", text: "有文档的协作权限有变化，可能有人与你分享了文档", actions: [{ label: "打开", run: () => Docs2.open(d.docId) }] });
        if (type === "message" && d.sender !== me() && d.mentionRecipients?.includes(me()) && S2.active !== d.conversationId && !quiet()) bubble(`${d.name} 在“${convName(d.conversationId)}”里 @了你`, () => openMessage2(d.conversationId, d.id));
        if (type === "assistant-prefs") {
          const was = prefs.enabled;
          prefs = { ...prefs, ...d };
          if (was !== prefs.enabled) {
            if (prefs.enabled) boot();
            else {
              closePanel();
              orb();
            }
          }
          return;
        }
        clearTimeout(this._t);
        this._t = setTimeout(refresh2, 800);
      },
      changed() {
        if (started && prefs.enabled) {
          orb();
          clearTimeout(this._c);
          this._c = setTimeout(refresh2, 1500);
        }
      },
      reset() {
        clearInterval(timer);
        prefs = { enabled: false };
        notices = [];
        brief = null;
        answer = null;
        extra.length = 0;
        bubbles.length = 0;
        $2("#me-orb")?.remove();
        $2("#me-bubble")?.remove();
        $2("#me-assist")?.remove();
      }
    };
  }

  // internal/ui/src/contacts.js
  function createContacts({ S: S2, api: api2, action: action2, modal: showModal, closeModal: closeModal2, toast: toast2, esc: esc4, icon: icon2, av: av2, refresh: refresh2, renderSidebar: renderSidebar2, renderMain: renderMain2, stopMedia, requestFriend: requestFriend2, contextMenu: contextMenu2 }) {
    const $2 = (s) => document.querySelector(s), title = (u) => u.remark || u.name;
    const modal2 = (...args) => {
      showModal(...args);
      $2(".modal")?.classList.add("contacts-modal");
    };
    function bind(id, fn) {
      const b = $2("#" + id);
      if (b) b.onclick = async () => {
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          error(e);
        } finally {
          b.disabled = false;
        }
      };
    }
    const error = (e) => {
      const n = $2("#modal-error");
      if (n) n.textContent = e.message;
      else toast2(e.message);
    };
    function collapsed() {
      try {
        return new Set(JSON.parse(localStorage.getItem("welink_contact_groups_" + S2.user.id) || "[]"));
      } catch {
        return /* @__PURE__ */ new Set();
      }
    }
    function badge(u) {
      return u?.specialCare ? '<span class="contact-attention-badge" role="img" aria-label="特别关心" title="特别关心">' + icon2("star") + "</span>" : "";
    }
    function sidebar() {
      const closed = collapsed(), q = S2.search.toLowerCase(), recent = new Set(S2.conversations.filter((c) => c.kind === "direct").map((c) => c.peer?.id)), peopleSource = q ? S2.friends : S2.friends.filter((u) => recent.has(u.id)), care = S2.friends.filter((u) => u.specialCare);
      const matches = (u) => (u.name + (u.remark || "") + u.account + u.number + u.id + (u.note || "")).toLowerCase().includes(q);
      const groups2 = [{ id: "special-care", name: "特别关心", people: care }, ...[{ id: "", name: "最近联系人" }, ...S2.contactGroups].map((g) => ({ ...g, people: peopleSource.filter((u) => (u.contactGroupId || "") === g.id) }))];
      let found = 0;
      const folders = groups2.map((g) => {
        const people = g.people.filter(matches), hidden = !q && closed.has(g.id);
        found += people.length;
        if (q && !people.length) return "";
        return `<section class="contact-folder-section" data-contact-folder="${g.id}"><button class="contact-folder ${hidden ? "collapsed" : ""}" data-contact="toggle" data-group-id="${g.id}" aria-expanded="${!hidden}">${icon2("down")}<b>${esc4(g.name)}</b><small>${people.filter((u) => u.online).length}/${g.people.length}</small></button>${hidden ? "" : people.map((u) => `<button class="conversation-row contact-row" data-profile="${u.id}">${av2(u, "", true)}<div class="row-text"><div class="row-title"><b>${esc4(title(u))}</b>${badge(u)}</div><div class="row-preview"><span>${esc4(u.bio || (u.online ? "[在线]" : "[离线]"))}</span></div></div></button>`).join("")}${!hidden && !q && g.id === "special-care" && !people.length ? '<p class="contact-attention-empty">在联系人设置中添加特别关心</p>' : ""}</section>`;
      }).join("");
      const self = matches(S2.user) ? '<section class="contact-folder-section self-contact"><button class="conversation-row contact-self-row" data-profile="' + S2.user.id + '">' + av2({ ...S2.user, online: !S2.offline }, "", true) + '<div class="row-text"><div class="row-title"><b>' + esc4(S2.user.name) + '（我）</b></div><div class="row-preview">' + (S2.offline ? "离线" : "在线") + " · " + esc4(S2.user.number) + "</div></div></button></section>" : "";
      return self + '<button class="contact-manage-link" data-contact="groups">' + icon2("settings") + "分组管理</button>" + folders + (!q && !peopleSource.length && !care.length ? '<div class="empty-list">还没有最近联系人<br>搜索用户，直接开始聊天</div>' : q && !found && !self ? '<div class="empty-list">没有找到用户</div>' : "");
    }
    function profile2(u) {
      return `${av2(u, "large", true)}<h2>${esc4(title(u))}${badge(u)}</h2>${u.remark ? '<span class="profile-line">姓名：' + esc4(u.name) + "</span>" : ""}<span class="profile-line">${APP_NAME} 账号：${esc4(u.number || u.account)}</span><dl class="profile-details"><dt>手机号</dt><dd>${esc4(u.phone || "未设置")}</dd><dt>性别</dt><dd>${esc4({ male: "男", female: "女", other: "其他" }[u.gender] || "未设置")}</dd><dt>职位</dt><dd>${esc4(u.jobTitle || "未设置")}</dd></dl><p class="profile-bio">${esc4(u.bio || "这个人很酷，还没有写签名。")}</p>${u.note ? '<p class="contact-private-note">' + esc4(u.note) + "</p>" : ""}<div class="contact-profile-actions">${u.id === S2.user.id ? '<button class="primary" data-action="profile">编辑资料</button>' : `<button class="primary" data-start-chat="${u.id}">发消息</button><button class="secondary" data-user-call="${u.id}" data-user-call-mode="audio">语音通话</button><button class="secondary" data-user-call="${u.id}" data-user-call-mode="video">视频通话</button><button class="secondary" data-contact="attention" data-user="${u.id}">${u.specialCare ? "取消特别关心" : "设为特别关心"}</button><button class="secondary" data-contact="messages" data-user="${u.id}">${u.messageBlocked ? "取消屏蔽" : "屏蔽私聊消息"}</button><button class="secondary" data-contact="edit" data-user="${u.id}">联系人设置</button>`}</div>`;
    }
    async function edit(id) {
      const detail = await api2("/api/contacts/" + id), u = detail.user;
      if (!detail.friend) {
        modal2("联系人资料", `<div class="contact-person">${av2(u, "large")}<h3>${esc4(u.name)}</h3><p>${APP_NAME} 号 ${esc4(u.number)}</p></div><p class="hint">${detail.blocked ? "你已将该用户加入黑名单。" : "你们还不是好友。"}</p>`, detail.blocked ? '<button class="primary" id="contact-unblock">解除拉黑</button>' : detail.canAdd ? '<button class="primary" id="contact-add">添加好友</button>' : "");
        bind("contact-unblock", async () => {
          await api2("/api/contact-blocks/" + id, { method: "DELETE" });
          await refresh2();
          await edit(id);
        });
        bind("contact-add", () => requestFriend2(id, u.name));
        return;
      }
      modal2("联系人设置", `<div class="contact-person compact">${av2(u)}<div><h3>${esc4(title(u))}</h3><p>${APP_NAME} 号 ${esc4(u.number)}</p></div></div><label for="contact-remark">备注名称</label><input id="contact-remark" maxlength="32" value="${esc4(u.remark || "")}" placeholder="${esc4(u.name)}"><label for="contact-folder">联系人分组</label><select id="contact-folder"><option value="">最近联系人</option>${S2.contactGroups.map((g) => `<option value="${g.id}" ${g.id === u.contactGroupId ? "selected" : ""}>${esc4(g.name)}</option>`).join("")}</select><label for="contact-note">描述</label><textarea id="contact-note" maxlength="200" placeholder="仅自己可见的备注信息">${esc4(u.note || "")}</textarea><p class="hint">备注、分组和描述仅自己可见，会同步到你的其他设备。</p><label class="check-row"><span>特别关心</span><input type="checkbox" id="contact-special-care" ${u.specialCare ? "checked" : ""}></label><p class="hint">在联系人中单独分组，仅自己可见，并同步到其他设备。</p><label class="check-row"><span>屏蔽 TA 的私聊消息</span><input type="checkbox" id="contact-message-blocked" ${detail.messageBlocked ? "checked" : ""}></label><p class="hint">屏蔽期间，对方无法向你发送私聊消息。历史记录保留，取消屏蔽后恢复接收。</p><div class="contact-danger-actions"><button data-contact="delete" data-user="${id}">从列表移除</button><button data-contact="block" data-user="${id}">加入黑名单</button></div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="contact-save">保存</button>');
      bind("contact-save", async () => {
        await api2("/api/contacts/" + id, { method: "PATCH", body: { remark: $2("#contact-remark").value, groupId: $2("#contact-folder").value, note: $2("#contact-note").value, specialCare: $2("#contact-special-care").checked, messageBlocked: $2("#contact-message-blocked").checked } });
        closeModal2();
        await refresh2();
        toast2("联系人设置已保存");
      });
    }
    function confirmRemove(id, block) {
      const u = S2.friends.find((u2) => u2.id === id) || S2.conversations.find((c) => c.peer?.id === id)?.peer || { name: "该用户" };
      modal2(block ? "加入黑名单" : "从列表移除", `<p class="contact-confirm">确定${block ? "拉黑" : "移除"} ${esc4(title(u))}？</p><p class="hint">${block ? "不再接收对方的私聊，双方的远程协助和单聊会议会结束。" : "从列表移除并取消特别关心，聊天记录和备注保留。下次收发消息时会重新显示。"}</p>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="contact-remove-confirm">确定</button>');
      bind("contact-remove-confirm", async () => {
        await api2((block ? "/api/contact-blocks/" : "/api/contacts/") + id, { method: block ? "POST" : "DELETE", body: block ? {} : void 0 });
        closeModal2();
        await refresh2();
        toast2(block ? "已加入黑名单" : "已从列表移除");
      });
    }
    async function groups() {
      await refresh2();
      modal2("联系人分组", `<div class="contact-group-item"><span>最近联系人</span><small>默认分组</small></div>${S2.contactGroups.map((g, i) => `<div class="contact-group-item"><span>${esc4(g.name)}<small>${g.count} 位联系人</small></span><button data-contact="group-up" data-group-id="${g.id}" ${i === 0 ? "disabled" : ""} title="上移">↑</button><button data-contact="group-down" data-group-id="${g.id}" ${i === S2.contactGroups.length - 1 ? "disabled" : ""} title="下移">↓</button><button data-contact="group-edit" data-group-id="${g.id}">重命名</button><button data-contact="group-delete" data-group-id="${g.id}" class="danger">删除</button></div>`).join("")}<p class="hint">删除分组会将其中好友移到“最近联系人”，保留备注和描述。</p>`, '<button class="secondary" data-action="close-modal">完成</button><button class="primary" data-contact="group-create">新建分组</button>', true);
    }
    function groupForm(id) {
      const g = S2.contactGroups.find((x) => x.id === id);
      modal2(g ? "重命名分组" : "新建分组", '<label for="contact-group-name">分组名称</label><input id="contact-group-name" maxlength="24" placeholder="例如：同事、家人" value="' + esc4(g?.name || "") + '">', '<button class="secondary" data-contact="groups">取消</button><button class="primary" id="contact-group-save">保存</button>');
      bind("contact-group-save", async () => {
        await api2("/api/contact-groups" + (g ? "/" + g.id : ""), { method: g ? "PATCH" : "POST", body: { name: $2("#contact-group-name").value } });
        await groups();
      });
      $2("#contact-group-name").focus();
    }
    async function moveGroup(id, delta) {
      const order = S2.contactGroups.map((g) => g.id), i = order.indexOf(id), to = i + delta;
      if (i < 0 || to < 0 || to >= order.length) return;
      [order[i], order[to]] = [order[to], order[i]];
      await action2("/api/contact-groups/order", { ids: order });
      await groups();
    }
    async function blocks() {
      const list = await api2("/api/contact-blocks");
      modal2("黑名单", `<p class="hint">解除拉黑后可以再次直接聊天。</p>${list.map((u) => `<div class="contact-block-row">${av2(u)}<span><b>${esc4(u.name)}</b><small>${esc4(u.number)}</small></span><button class="secondary" data-contact="unblock" data-user="${u.id}">解除</button></div>`).join("") || '<p class="empty-list">黑名单为空</p>'}`, '<button class="secondary" data-contact="privacy">返回</button>');
    }
    async function privacy() {
      modal2("联系人设置", '<p class="hint">不需要添加或批准好友。通过姓名、号码或用户 ID 搜索即可聊天；从列表移除后仍保留聊天记录。</p><button class="contact-settings-row" data-contact="blocks">黑名单' + icon2("chevron") + '</button><button class="contact-settings-row" data-contact="groups">联系人分组' + icon2("chevron") + "</button>", '<button class="primary" data-action="close-modal">完成</button>');
    }
    function syncComposer() {
      const c = S2.conversations.find((c2) => c2.id === S2.active), composer = $2(".composer");
      if (!composer) return;
      const blocked = c?.kind === "direct" && c.canSend === false, was = composer.classList.contains("contact-unavailable");
      if (blocked && !was) stopMedia();
      composer.classList.toggle("contact-unavailable", blocked);
      let banner = $2("#contact-unavailable-banner");
      if (!banner) {
        composer.insertAdjacentHTML("beforeend", '<div id="contact-unavailable-banner" class="contact-unavailable-banner"></div>');
        banner = $2("#contact-unavailable-banner");
      }
      ;
      banner.innerHTML = blocked ? `<span>当前无法私聊，请检查黑名单或账号状态。</span><button data-contact="edit" data-user="${c.peer.id}">查看联系人</button>` : "";
      if (blocked || was) $2("#composer").disabled = blocked;
      if (c?.kind === "direct" && $2(".chat-head h2")) $2(".chat-head h2").innerHTML = esc4(c.name) + badge(c.peer) + `<small id="typing-status" data-presence="${c.peer?.ai ? "" : c.peer?.online ? "on" : "off"}">${c.peer?.online ? "在线" : "离线"}</small>`;
    }
    function menu(id, x, y) {
      const u = S2.friends.find((u2) => u2.id === id);
      contextMenu2(x, y, `<button data-create-group-user="${id}">创建群聊</button><button data-contact="attention" data-user="${id}">${u?.specialCare ? "取消特别关心" : "设为特别关心"}</button><button data-contact="edit" data-user="${id}">备注与分组</button><button data-contact="delete" data-user="${id}">从列表移除</button><button data-contact="block" data-user="${id}">加入黑名单</button>`);
    }
    document.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".contact-row[data-profile]");
      if (row) {
        e.preventDefault();
        menu(row.dataset.profile, e.clientX, e.clientY);
      }
    });
    bindLongPress(".contact-row[data-profile]", (row, x, y) => menu(row.dataset.profile, x, y));
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-contact]");
      if (!b || !S2.user) return;
      try {
        switch (b.dataset.contact) {
          case "attention": {
            b.disabled = true;
            const owner2 = S2.user.id;
            try {
              const detail = await api2("/api/contacts/" + b.dataset.user);
              if (S2.user?.id !== owner2) break;
              await api2("/api/contacts/" + b.dataset.user, { method: "PATCH", body: { specialCare: !detail.user.specialCare } });
              if (S2.user?.id !== owner2) break;
              await refresh2();
              toast2(detail.user.specialCare ? "已取消特别关心" : "已设为特别关心");
            } finally {
              b.disabled = false;
            }
            break;
          }
          case "messages": {
            const id = b.dataset.user, detail = await api2("/api/contacts/" + id), blocked = !detail.messageBlocked;
            await api2("/api/contacts/" + id, { method: "PATCH", body: { messageBlocked: blocked } });
            await refresh2();
            if (S2.profile?.id === id) {
              S2.profile.messageBlocked = blocked;
              renderMain2();
            }
            toast2(blocked ? "已屏蔽此人的私聊消息" : "已取消屏蔽");
            break;
          }
          case "edit":
            await edit(b.dataset.user);
            break;
          case "delete":
            confirmRemove(b.dataset.user, false);
            break;
          case "block":
            confirmRemove(b.dataset.user, true);
            break;
          case "groups":
            await groups();
            break;
          case "group-create":
            groupForm();
            break;
          case "group-edit":
            groupForm(b.dataset.groupId);
            break;
          case "group-up":
            await moveGroup(b.dataset.groupId, -1);
            break;
          case "group-down":
            await moveGroup(b.dataset.groupId, 1);
            break;
          case "group-delete": {
            const g = S2.contactGroups.find((g2) => g2.id === b.dataset.groupId);
            modal2("删除分组", '<p class="contact-confirm">确定删除 ' + esc4(g.name) + "？好友会移入默认分组。</p>", '<button class="secondary" data-contact="groups">取消</button><button class="primary" id="contact-group-delete">确定</button>');
            bind("contact-group-delete", async () => {
              await api2("/api/contact-groups/" + g.id, { method: "DELETE" });
              await groups();
            });
            break;
          }
          case "toggle": {
            const list = collapsed(), id = b.dataset.groupId;
            if (list.has(id)) list.delete(id);
            else list.add(id);
            localStorage.setItem("welink_contact_groups_" + S2.user.id, JSON.stringify([...list]));
            renderSidebar2();
            break;
          }
          case "privacy":
            await privacy();
            break;
          case "blocks":
            await blocks();
            break;
          case "unblock":
            b.disabled = true;
            await api2("/api/contact-blocks/" + b.dataset.user, { method: "DELETE" });
            await refresh2();
            await blocks();
            break;
        }
      } catch (e2) {
        error(e2);
      }
    });
    return { sidebar, profile: profile2, edit, privacy, syncComposer, badge };
  }

  // internal/ui/src/groups.js
  function createGroups({ S: S2, api: api2, action: action2, modal: showModal, closeModal: closeModal2, toast: toast2, esc: esc4, icon: icon2, av: av2, refresh: refresh2, selectConversation: selectConversation2, renderMain: renderMain2, copy, stopMedia }) {
    const $2 = (s) => document.querySelector(s), roles = { owner: "群主", admin: "管理员", member: "成员" }, modes = { open: "允许任何人加入", approval: "需要管理员审核", closed: "不允许申请加入" };
    let detailState = null, searchVersion = 0, muteTimer;
    const modal2 = (...args) => {
      showModal(...args);
      $2(".modal")?.classList.add("group-modal");
    };
    const manager = (g) => g?.role === "owner" || g?.role === "admin";
    const error = (e) => {
      const n = $2("#modal-error");
      if (n) {
        n.textContent = e.message;
        n.scrollIntoView?.({ block: "nearest" });
      } else toast2(e.message);
    };
    function bind(id, fn) {
      const b = $2("#" + id);
      if (!b) return;
      b.onclick = async () => {
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          error(e);
        } finally {
          b.disabled = false;
        }
      };
    }
    const back = () => detailState && detail(detailState.id);
    function row(label, text, act) {
      return `<button class="group-setting-row" data-group="${act}"><span>${label}</span><small>${text || ""}</small>${icon2("chevron")}</button>`;
    }
    async function detail(cid = S2.active) {
      const c = await api2("/api/conversations/" + cid);
      if (c.kind !== "group") return;
      detailState = c;
      const g = c.group, local = S2.conversations.find((x) => x.id === cid) || {}, me = c.members.find((x) => x.id === S2.user.id);
      modal2("群聊设置", `<div class="group-summary">${manager(g) ? '<button class="group-avatar-link" data-avatar="group" data-group-id="' + c.id + '" aria-label="更换群头像">' : ""}${av2({ kind: "group", avatar: g.avatar || "group", name: c.name }, "large")}${manager(g) ? "</button>" : ""}<div><h3>${esc4(c.name)}</h3><p>群号 ${esc4(g.number)} <button class="group-link" data-group="copy-number">复制</button></p><small>${g.count} 人 · ${roles[g.role]}</small></div></div><div class="group-member-grid">${c.members.slice(0, 9).map((u) => `<button data-group-user="${u.id}">${av2(u)}<span>${esc4(u.nickname || u.name)}</span>${u.role !== "member" ? `<small class="group-role ${u.role}">${roles[u.role]}</small>` : ""}</button>`).join("")}${manager(g) || g.membersInvite ? '<button data-group="invite" class="group-add-member">' + icon2("plus") + "<span>邀请</span></button>" : ""}</div>${row("群聊成员", g.count + " 人", "members")}${row("群公告", esc4(c.announcement?.slice(0, 24) || "暂无公告"), "announcement")}${row("我的群名片", esc4(me?.nickname || me?.name || ""), "my-card")}${manager(g) ? row("群管理", "入群方式、管理员、禁言", "manage") + row("加群申请", (S2.groupRequests || []).filter((x) => x.conversationId === cid && x.canReview && x.status === "pending").length + " 条待处理", "requests") : ""}${row("查找聊天记录", "", "history")}<label class="prefs-row">置顶聊天<input type="checkbox" id="group-pin" ${local.pinned ? "checked" : ""}></label><label class="prefs-row">消息免打扰<input type="checkbox" id="group-notifications" ${local.muted ? "checked" : ""}></label><p class="hint">${esc4(g.description || "暂无群介绍")}</p><button class="chat-remove-entry" data-conversation-action="remove" data-cid="${c.id}">${icon2("trash")}从消息列表移除</button><button class="group-danger" data-group="${g.role === "owner" ? "dissolve" : "leave"}">${g.role === "owner" ? "解散该群" : "退出该群"}</button>`, '<button class="primary" id="group-save-prefs">完成</button>', true);
      bind("group-save-prefs", async () => {
        await api2("/api/conversations/" + cid, { method: "PATCH", body: { pinned: $2("#group-pin").checked, muted: $2("#group-notifications").checked } });
        closeModal2();
        await refresh2();
      });
    }
    async function members() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      modal2("群聊成员 · " + c.members.length, '<input id="group-member-search" placeholder="搜索群成员或号码" aria-label="搜索群成员"><div id="group-members-list"></div>', '<button class="secondary" data-group="back">返回</button>', true);
      const render = () => {
        const q = $2("#group-member-search").value.toLowerCase();
        $2("#group-members-list").innerHTML = c.members.filter((u) => (u.name + u.nickname + u.number).toLowerCase().includes(q)).map((u) => `<button class="group-person-row" data-group-user="${u.id}">${av2(u)}<span><b>${esc4(u.nickname || u.name)}</b><small>${esc4(u.number)}${u.muteUntil > Date.now() ? " · 禁言中" : ""}</small></span><i class="group-role ${u.role}">${roles[u.role]}</i>${icon2("chevron")}</button>`).join("") || '<p class="hint">没有找到成员</p>';
      };
      $2("#group-member-search").oninput = render;
      render();
    }
    async function member(id) {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      const u = c.members.find((x) => x.id === id);
      if (!u) {
        toast2("该成员已退出群聊");
        return;
      }
      ;
      const g = c.group, self = id === S2.user.id, canManage = manager(g) && !self && u.role !== "owner" && (g.role === "owner" || u.role !== "admin"), canCard = self || canManage;
      modal2("群成员资料", `<div class="group-summary">${av2(u, "large")}<div><h3>${esc4(u.name)}</h3><p>${APP_NAME} 号 ${esc4(u.number)}</p><span class="group-role ${u.role}">${roles[u.role]}</span></div></div><label for="group-member-card">群名片</label><input id="group-member-card" maxlength="32" value="${esc4(u.nickname || "")}" placeholder="${esc4(u.name)}" ${canCard ? "" : "disabled"}>${canManage ? `<label for="group-member-mute">禁言</label><select id="group-member-mute"><option value="">保持当前状态</option><option value="0">解除禁言</option><option value="10">10 分钟</option><option value="60">1 小时</option><option value="1440">1 天</option><option value="43200">30 天</option></select><p class="hint">${u.muteUntil > Date.now() ? "禁言至 " + esc4(new Date(u.muteUntil).toLocaleString()) : "当前未禁言"}</p>` : ""}${g.role === "owner" && !self ? `<label class="prefs-row">设为管理员<input type="checkbox" id="group-member-admin" ${u.role === "admin" ? "checked" : ""}></label>` : ""}${canManage ? '<button class="group-danger" id="group-remove-member">移出群聊</button>' : ""}`, '<button class="secondary" data-group="members">返回成员列表</button>' + (canCard ? '<button class="primary" id="group-member-save">保存</button>' : ""));
      bind("group-member-save", async () => {
        const p = { nickname: $2("#group-member-card").value };
        if ($2("#group-member-admin") && $2("#group-member-admin").checked !== (u.role === "admin")) p.admin = $2("#group-member-admin").checked;
        if ($2("#group-member-mute")?.value) p.muteMinutes = Number($2("#group-member-mute").value);
        await api2(`/api/groups/${c.id}/members/${id}`, { method: "PATCH", body: p });
        toast2("已更新群成员");
        await refresh2();
        await members();
      });
      bind("group-remove-member", () => confirm("移出群聊", "确定将 " + esc4(u.nickname || u.name) + " 移出群聊？", async () => {
        await api2(`/api/conversations/${c.id}/members/${id}`, { method: "DELETE" });
        await refresh2();
        await members();
      }));
    }
    async function manage() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      const g = c.group;
      if (!manager(g)) throw Error("你已没有群管理权限");
      modal2("群管理", `<label for="group-edit-name">群名称</label><input id="group-edit-name" value="${esc4(c.name)}" maxlength="60">${g.role === "owner" ? `<label for="group-edit-number">群号</label><input id="group-edit-number" value="${esc4(g.number)}" inputmode="numeric" maxlength="9" autocomplete="off"><p class="hint">群主可改为 5–8 位数字（不能以 0 开头），不能与其他群或账号重复。</p>` : ""}<label for="group-description">群介绍</label><textarea id="group-description" maxlength="200" placeholder="向搜索到群的人介绍一下">${esc4(g.description)}</textarea><label class="prefs-row">允许通过群号或名称搜索<input type="checkbox" id="group-discoverable" ${g.discoverable ? "checked" : ""}></label><label for="group-join-mode">搜索入群方式</label><select id="group-join-mode">${Object.entries(modes).map(([v, t]) => `<option value="${v}" ${g.joinMode === v ? "selected" : ""}>${t}</option>`).join("")}</select><label class="prefs-row">允许成员邀请好友<input type="checkbox" id="group-members-invite" ${g.membersInvite ? "checked" : ""}></label><label class="prefs-row">全员禁言<input type="checkbox" id="group-all-muted" ${g.allMuted ? "checked" : ""}></label><p class="hint">全员禁言时，群主和管理员仍可发言。成员邀请会直接拉人入群，不需要再次申请。</p>${row("设置管理员", "在成员资料中设置，最多 10 人", "members")}${g.role === "owner" ? row("转让群主", "", "transfer") : ""}`, '<button class="secondary" data-group="back">返回</button><button class="primary" id="group-manage-save">保存</button>', true);
      bind("group-manage-save", async () => {
        const number = $2("#group-edit-number")?.value.trim();
        await api2("/api/groups/" + c.id, { method: "PATCH", body: { name: $2("#group-edit-name").value, description: $2("#group-description").value, discoverable: $2("#group-discoverable").checked, joinMode: $2("#group-join-mode").value, membersInvite: $2("#group-members-invite").checked, allMuted: $2("#group-all-muted").checked, ...number && number !== g.number ? { number } : {} } });
        await refresh2();
        toast2("群管理设置已保存");
        await detail(c.id);
      });
    }
    function confirm(title, text, fn) {
      modal2(title, `<p class="group-confirm">${text}</p>`, '<button class="secondary" data-group="back">取消</button><button class="primary" id="group-confirm">确定</button>');
      bind("group-confirm", fn);
    }
    async function transfer() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      modal2("转让群主", '<p class="hint">转让后，你将成为普通成员。请选择新群主。</p><div class="member-select">' + c.members.filter((u) => u.id !== S2.user.id).map((u) => `<button class="group-person-row" data-group-transfer="${u.id}">${av2(u)}<span><b>${esc4(u.nickname || u.name)}</b><small>${roles[u.role]}</small></span>${icon2("chevron")}</button>`).join("") + "</div>", '<button class="secondary" data-group="manage">取消</button>');
    }
    async function invite() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      const list = S2.friends.filter((u) => !c.members.some((m) => m.id === u.id));
      modal2("邀请好友入群", `<p class="hint">选择一位或多位用户，直接加入群聊</p><div class="member-select">${list.map((u) => `<label class="check-row">${av2(u)}${esc4(u.name)}<input type="checkbox" name="group-invite" value="${u.id}"></label>`).join("") || '<p class="hint">好友都已在群里</p>'}</div>`, '<button class="secondary" data-group="back">取消</button><button class="primary" id="group-invite-send">邀请</button>');
      bind("group-invite-send", async () => {
        const result = await action2("/api/conversations/" + c.id + "/members", { members: [...document.querySelectorAll("[name=group-invite]:checked")].map((x) => x.value) });
        await refresh2();
        await detail(c.id);
      });
    }
    async function announcement() {
      const c = await api2("/api/conversations/" + detailState.id);
      detailState = c;
      modal2("群公告", `<textarea id="group-announcement" maxlength="2000" placeholder="暂无群公告" ${manager(c.group) ? "" : "readonly"}>${esc4(c.announcement)}</textarea>`, '<button class="secondary" data-group="back">返回</button>' + (manager(c.group) ? '<button class="primary" id="group-announcement-save">发布</button>' : ""));
      bind("group-announcement-save", async () => {
        await api2("/api/groups/" + c.id, { method: "PATCH", body: { announcement: $2("#group-announcement").value } });
        await refresh2();
        toast2("群公告已发布");
        await detail(c.id);
      });
    }
    async function requests() {
      const list = await api2("/api/group-requests");
      S2.groupRequests = list;
      const status = { pending: "等待审核", accepted: "已同意", rejected: "已拒绝", cancelled: "群已解散" };
      modal2("群通知", `<div class="group-requests">${list.map((q) => `<article class="group-request">${av2(q)}<div><b>${esc4(q.name)}</b><p>${q.inviter ? esc4(q.inviterName) + " 邀请加入" : "申请加入"} ${esc4(q.groupName)}</p><small>群号 ${esc4(q.number)}</small><p class="hint">${esc4(q.message)}</p>${q.status === "pending" && q.canReview ? `<button class="secondary" data-group-review="${q.id}" data-accept="false">拒绝</button><button class="primary" data-group-review="${q.id}" data-accept="true">同意</button>` : `<span class="group-request-state">${status[q.status] || q.status}</span>`}</div></article>`).join("") || '<p class="hint">暂无群通知</p>'}</div>`, "", true);
    }
    function search() {
      const revision = ++searchVersion;
      let requestVersion = 0;
      modal2("查找群聊", '<form id="group-search-form" class="group-search-form"><input id="group-search-query" placeholder="输入群号或群名称" aria-label="搜索群聊" maxlength="60"><button class="primary">查找</button></form><div id="group-search-results"><p class="hint">群主开启搜索后，可通过群号或群名称找到群。</p></div>', "", true);
      $2("#group-search-form").onsubmit = async (e) => {
        e.preventDefault();
        const request = ++requestVersion;
        const query = $2("#group-search-query").value.trim(), list = $2("#group-search-results");
        list.innerHTML = '<p class="hint">正在查找…</p>';
        try {
          const results = await api2("/api/groups?q=" + encodeURIComponent(query));
          if (searchVersion !== revision || request !== requestVersion || !document.contains(list)) return;
          list.innerHTML = results.map((g) => `<article class="group-search-result">${av2({ kind: "group", avatar: g.avatar || "group" })}<div><b>${esc4(g.name)}</b><p>群号 ${esc4(g.number)} · ${g.count} 人</p><p class="hint">${esc4(g.description)}</p><small>${modes[g.joinMode]}</small></div><button class="${g.joined ? "secondary" : "primary"}" data-group-join="${g.id}" data-joined="${g.joined}" data-mode="${g.joinMode}" data-name="${esc4(g.name)}" ${!g.joined && g.joinMode === "closed" ? "disabled" : ""}>${g.joined ? "发消息" : "加入"}</button></article>`).join("") || '<p class="hint">没有找到群聊</p>';
        } catch (e2) {
          if (request === requestVersion && document.contains(list)) list.textContent = e2.message;
        }
      };
      $2("#group-search-query").focus();
    }
    async function join(button) {
      const cid = button.dataset.groupJoin;
      if (button.dataset.joined === "true") {
        closeModal2();
        await selectConversation2(cid);
        return;
      }
      ;
      if (button.dataset.mode === "open") {
        button.disabled = true;
        try {
          await action2("/api/groups/" + cid + "/join");
          closeModal2();
          await refresh2();
          await selectConversation2(cid);
        } finally {
          button.disabled = false;
        }
        return;
      }
      ;
      modal2("申请加入 " + button.dataset.name, '<label for="group-join-message">验证信息</label><textarea id="group-join-message" maxlength="200" placeholder="向群主和管理员介绍一下自己"></textarea>', '<button class="secondary" data-group="search">取消</button><button class="primary" id="group-join-submit">发送申请</button>');
      bind("group-join-submit", async () => {
        const result = await action2("/api/groups/" + cid + "/join", { message: $2("#group-join-message").value });
        await refresh2();
        if (result.status === "joined") {
          closeModal2();
          await selectConversation2(cid);
        } else {
          modal2("申请已发送", '<p class="hint">等待群主或管理员审核，处理结果会显示在群通知中。</p>', '<button class="primary" data-group="requests">查看群通知</button>');
        }
      });
    }
    function syncComposer() {
      clearTimeout(muteTimer);
      const c = S2.conversations.find((x) => x.id === S2.active), g = c?.group, blocked = g && !manager(g) && (g.allMuted || g.muteUntil > Date.now()), composer = $2(".composer");
      if (!composer) return;
      const wasBlocked = composer.classList.contains("group-muted");
      if (blocked && !wasBlocked) stopMedia();
      composer.classList.toggle("group-muted", !!blocked);
      let banner = $2("#group-muted-banner");
      if (!banner) {
        composer.insertAdjacentHTML("beforeend", '<div id="group-muted-banner" class="group-muted-banner"></div>');
        banner = $2("#group-muted-banner");
      }
      ;
      banner.textContent = blocked ? g.allMuted ? "全员禁言中，仅群主和管理员可发言" : "你已被禁言至 " + new Date(g.muteUntil).toLocaleString("zh-CN", { hour12: false }) : "";
      if (blocked && !g.allMuted) muteTimer = setTimeout(syncComposer, Math.min(6e4, Math.max(50, g.muteUntil - Date.now() + 50)));
      if (blocked || wasBlocked) $2("#composer").disabled = !!blocked;
      const header = $2(".chat-head h2");
      if (c && header && c.kind === "group") header.innerHTML = esc4(c.name) + `<small id="typing-status">${g?.count || ""} 人 · 群号 ${esc4(g?.number || "")}</small>`;
    }
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-group],[data-group-user],[data-group-review],[data-group-join],[data-group-transfer]");
      if (!b || !S2.user) return;
      try {
        if (b.dataset.groupUser) {
          await member(b.dataset.groupUser);
          return;
        }
        ;
        if (b.dataset.groupReview) {
          b.disabled = true;
          try {
            await action2("/api/group-requests/" + b.dataset.groupReview, { accept: b.dataset.accept === "true" });
            await refresh2();
            await requests();
          } finally {
            b.disabled = false;
          }
          ;
          return;
        }
        ;
        if (b.dataset.groupJoin) {
          await join(b);
          return;
        }
        ;
        if (b.dataset.groupTransfer) {
          const c = detailState, u = c.members.find((u2) => u2.id === b.dataset.groupTransfer);
          confirm("转让群主", "确定将群主转让给 " + esc4(u.nickname || u.name) + "？", async () => {
            await action2("/api/groups/" + c.id + "/transfer", { userId: u.id });
            await refresh2();
            toast2("群主已转让");
            await detail(c.id);
          });
          return;
        }
        switch (b.dataset.group) {
          case "back":
            await back();
            break;
          case "members":
            await members();
            break;
          case "my-card":
            await member(S2.user.id);
            break;
          case "manage":
            await manage();
            break;
          case "announcement":
            await announcement();
            break;
          case "invite":
            await invite();
            break;
          case "transfer":
            await transfer();
            break;
          case "requests":
            await requests();
            break;
          case "search":
            search();
            break;
          case "copy-number":
            await copy(detailState.group.number);
            break;
          case "history":
            closeModal2();
            document.querySelector(".chat-head [data-action=search-history]")?.click();
            break;
          case "leave":
          case "dissolve": {
            const c = detailState, dissolve = b.dataset.group === "dissolve";
            confirm(dissolve ? "解散群聊" : "退出群聊", dissolve ? "解散后所有成员都将失去该群的访问权限，群号不再使用。确定解散 " + esc4(c.name) + "？" : "确定退出 " + esc4(c.name) + "？退出后将无法继续访问群聊记录。", async () => {
              await api2(dissolve ? "/api/groups/" + c.id : `/api/conversations/${c.id}/members/${S2.user.id}`, { method: "DELETE" });
              closeModal2();
              await refresh2();
              renderMain2();
              toast2(dissolve ? "群已解散" : "已退出群聊");
            });
            break;
          }
        }
      } catch (e2) {
        error(e2);
      }
    });
    return { detail, search, requests, syncComposer };
  }

  // internal/ui/src/media.js
  function createMedia({ S: S2, api: api2, action: action2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc4, icon: icon2, fileURL: fileURL2, randomID: randomID2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, upload: upload2, enqueue }) {
    const $2 = (s, r = document) => r.querySelector(s);
    const mic = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
    const sound = '<svg class="voice-sound" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 10 4-4v12l-4-4H3v-4Z"/><path d="M13 8a6 6 0 0 1 0 8"/><path d="M17 4a11 11 0 0 1 0 16"/></svg>';
    const seconds = (ms) => Math.max(1, Math.ceil(Number(ms || 0) / 1e3));
    const clock = (ms) => {
      const n = Math.max(0, Math.floor(Number(ms || 0) / 1e3));
      return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
    };
    let mode = false, recording = null, hold = null, videoPlayer = null, playing = null;
    const audio = document.createElement("audio");
    audio.id = "welink-audio-player";
    audio.preload = "none";
    audio.style.display = "none";
    document.body.append(audio);
    function played() {
      try {
        return new Set(JSON.parse(localStorage.getItem("welink_voice_played_" + S2.user?.id) || "[]"));
      } catch {
        return /* @__PURE__ */ new Set();
      }
    }
    function markPlayed(id) {
      const ids = played();
      ids.add(id);
      localStorage.setItem("welink_voice_played_" + S2.user.id, JSON.stringify([...ids].slice(-500)));
    }
    function bubble(m, rootID = "") {
      if (m.kind === "voice") return `<button class="voice-message" data-play-voice="${m.attachmentId}" data-media-message="${m.id || rootID}" data-duration="${Number(m.durationMs) || 0}" aria-label="播放语音 ${seconds(m.durationMs)} 秒" style="width:${Math.min(220, 95 + Math.sqrt(seconds(m.durationMs)) * 15)}px">${sound}<span>${seconds(m.durationMs)}″</span>${m.sender && m.sender !== S2.user?.id && !played().has(m.attachmentId) ? '<i class="voice-unplayed"></i>' : ""}</button>`;
      return `<button class="video-message" data-play-video="${m.attachmentId}" data-media-message="${m.id || rootID}" data-media-root="${rootID}" data-media-name="${esc4(m.fileName || "视频")}" aria-label="播放视频"><video muted playsinline preload="metadata" src="${fileURL2(m.attachmentId)}" tabindex="-1"></video><span class="video-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" style="fill:currentColor;stroke:none"/></svg></span><span class="video-duration">${clock(m.durationMs)}</span></button>`;
    }
    function tools() {
      return `<button class="icon-btn" title="语音消息" aria-label="语音消息" data-media="voice-mode">${mic}</button>`;
    }
    function input() {
      return '<div id="voice-input" class="voice-input hidden"><button class="voice-hold" data-media="voice-hold">按住说话</button><div class="desktop-voice-controls"><span id="voice-status">语音最长 60 秒</span><button class="primary" data-media="voice-start">开始录音</button><button class="secondary hidden" data-media="voice-cancel">取消</button><button class="primary hidden" data-media="voice-finish">发送语音</button></div></div><input id="video-input" class="file-input" type="file" accept="video/mp4,video/webm"><input id="video-capture-input" class="file-input" type="file" accept="video/*" capture="environment">';
    }
    function mount() {
      $2(".composer")?.classList.toggle("voice-mode", mode);
      $2("#voice-input")?.classList.toggle("hidden", !mode);
      $2("[data-media=voice-mode]")?.classList.toggle("active", mode);
      for (const id of ["video-input", "video-capture-input"]) if ($2("#" + id)) $2("#" + id).onchange = (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (file) sendVideo(file);
      };
      renderRecording();
    }
    function renderRecording() {
      const state = recording, ready = state?.context, elapsed = ready ? state.frames / state.rate : 0, cancelled = hold?.cancel;
      if ($2("#voice-status")) $2("#voice-status").textContent = state ? ready ? `正在录音 ${Math.floor(elapsed)} / 60 秒` : "正在请求麦克风权限…" : "语音最长 60 秒";
      const holdButton = $2("[data-media=voice-hold]");
      if (holdButton) {
        holdButton.textContent = state ? cancelled ? "松开取消" : "松开发送，上滑取消" : "按住说话";
        holdButton.classList.toggle("recording", !!state);
      }
      $2("[data-media=voice-start]")?.classList.toggle("hidden", !!state);
      $2("[data-media=voice-cancel]")?.classList.toggle("hidden", !state);
      $2("[data-media=voice-finish]")?.classList.toggle("hidden", !state);
      if ($2("[data-media=voice-finish]")) $2("[data-media=voice-finish]").disabled = !ready;
      if (!state) {
        $2("#voice-record-overlay")?.remove();
        return;
      }
      if (!$2("#voice-record-overlay")) document.body.insertAdjacentHTML("beforeend", `<aside id="voice-record-overlay" class="voice-record-overlay" aria-live="polite"><div class="record-wave">${Array.from({ length: 7 }, () => "<i></i>").join("")}</div><b></b><p></p></aside>`);
      const overlay = $2("#voice-record-overlay");
      overlay.classList.toggle("cancelling", !!cancelled);
      $2("b", overlay).textContent = ready ? `${Math.floor(elapsed)}″` : "正在请求麦克风权限";
      $2("p", overlay).textContent = cancelled ? "松开手指，取消发送" : state.held ? "松开发送，上滑取消" : "录音完成后点击发送";
      overlay.style.setProperty("--voice-level", String(0.35 + Math.min(1, (state.level || 0) * 8)));
    }
    async function begin(held) {
      if (recording || !S2.active || !S2.user) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext && !window.webkitAudioContext) {
        toast2("当前设备不支持录音，请更新 WebView 或检查麦克风");
        return;
      }
      audio.pause();
      const state = recording = { cid: S2.active, userId: S2.user.id, held, chunks: [], frames: 0, rate: 0 };
      renderRecording();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (recording !== state || document.hidden) {
          stream.getTracks().forEach((t) => t.stop());
          if (!document.hidden && S2.active === state.cid && S2.user?.id === state.userId) {
            mode = true;
            mount();
            toast2("麦克风已允许，请重新开始录音");
          }
          return;
        }
        state.stream = stream;
        const Context = window.AudioContext || window.webkitAudioContext;
        const context = new Context();
        state.context = context;
        state.rate = context.sampleRate;
        await context.resume();
        if (recording !== state) {
          release(state);
          return;
        }
        state.source = context.createMediaStreamSource(stream);
        state.processor = context.createScriptProcessor(4096, 1, 1);
        state.silence = context.createGain();
        state.silence.gain.value = 0;
        state.processor.onaudioprocess = (e) => {
          if (recording !== state) return;
          const input2 = e.inputBuffer.getChannelData(0), remaining = Math.max(0, Math.floor(state.rate * 60) - state.frames), data = input2.slice(0, Math.min(input2.length, remaining));
          state.chunks.push(data);
          state.frames += data.length;
          let level = 0;
          for (let i = 0; i < data.length; i += 16) level += data[i] * data[i];
          state.level = Math.sqrt(level / Math.max(1, data.length / 16));
          if (state.frames >= state.rate * 60 && !state.limit) {
            state.limit = true;
            setTimeout(() => finish(false), 0);
          }
        };
        state.source.connect(state.processor);
        state.processor.connect(state.silence);
        state.silence.connect(context.destination);
        state.timer = setInterval(renderRecording, 150);
        renderRecording();
        for (const track of stream.getTracks()) track.onended = () => {
          if (recording === state) finish(true);
        };
      } catch (error) {
        if (recording === state) {
          recording = null;
          release(state);
          renderRecording();
          toast2(error.name === "NotAllowedError" ? "未获得麦克风权限，请允许后重新录制" : "无法录音：" + error.message);
        }
      }
    }
    function release(state) {
      clearInterval(state.timer);
      if (state.processor) state.processor.onaudioprocess = null;
      for (const node of [state.source, state.processor, state.silence]) try {
        node?.disconnect();
      } catch {
      }
      ;
      state.stream?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      state.context?.close().catch(() => {
      });
    }
    function wav(state) {
      const all = new Float32Array(state.frames);
      let offset = 0;
      for (const chunk of state.chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      const rate = 24e3, length = Math.min(rate * 60, Math.floor(all.length * rate / state.rate)), buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer), str = (at, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
      };
      str(0, "RIFF");
      view.setUint32(4, 36 + length * 2, true);
      str(8, "WAVE");
      str(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      str(36, "data");
      view.setUint32(40, length * 2, true);
      const ratio = state.rate / rate;
      for (let i = 0; i < length; i++) {
        const at = i * ratio, start = Math.floor(at), end = Math.min(all.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sample = 0;
        for (let j = start; j < end; j++) sample += all[j];
        sample = Math.max(-1, Math.min(1, sample / (end - start)));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
      }
      return new File([buffer], "语音-" + Date.now() + ".wav", { type: "audio/wav" });
    }
    function finish(cancel) {
      const state = recording;
      if (!state) return;
      recording = null;
      hold = null;
      release(state);
      renderRecording();
      if (cancel) return;
      if (!state.rate || state.frames / state.rate < 0.7) {
        toast2("说话时间太短，请重新录制");
        return;
      }
      if (!S2.user || S2.user.id !== state.userId) return;
      sendMedia(wav(state), "voice", {}, state.cid).catch(showRetry);
    }
    const accountScope = () => JSON.stringify([S2.config.server, S2.config.fingerprint, S2.user?.id, S2.token]);
    async function sendMedia(file, kind, metadata2 = {}, cid = S2.active) {
      const owner2 = accountScope(), retry = () => {
        if (accountScope() !== owner2) throw Error("登录账号已变化");
        return enqueue(cid, { kind, text: "" }, file, metadata2);
      };
      try {
        return await retry();
      } catch (error) {
        error.retry = retry;
        throw error;
      }
    }
    function showRetry(error) {
      if (!error.retry) {
        toast2(error.message);
        return;
      }
      modal2("未能保存待发送内容", `<p class="hint">${esc4(error.message)}。录音或视频暂时保留在当前窗口，关闭窗口前请重试保存。</p>`, '<button class="secondary" data-action="close-modal">关闭</button><button class="primary" id="media-retry">重试保存</button>');
      $2("#media-retry").onclick = async (e) => {
        e.target.disabled = true;
        try {
          await error.retry();
          closeModal2();
        } catch (next) {
          next.retry = error.retry;
          showRetry(next);
        }
      };
    }
    function videoMetadata(file) {
      return new Promise((resolve, reject) => {
        const v = document.createElement("video"), url = URL.createObjectURL(file);
        v.preload = "metadata";
        v.muted = true;
        let timer, done = false;
        const finish2 = (error, result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          v.onloadedmetadata = v.ondurationchange = v.ontimeupdate = v.onerror = null;
          v.removeAttribute("src");
          v.load();
          URL.revokeObjectURL(url);
          error ? reject(error) : resolve(result);
        };
        const check = () => {
          const duration = v.duration;
          if (Number.isFinite(duration) && duration > 0 && v.videoWidth && v.videoHeight) finish2(null, { durationMs: Math.round(duration * 1e3), width: v.videoWidth, height: v.videoHeight });
        };
        v.onloadedmetadata = () => {
          check();
          if (!done && !Number.isFinite(v.duration)) try {
            v.currentTime = 1e10;
          } catch {
          }
        };
        v.ondurationchange = v.ontimeupdate = check;
        v.onerror = () => finish2(Error("当前设备无法播放这段视频"));
        timer = setTimeout(() => finish2(Error("无法读取视频信息")), 15e3);
        v.src = url;
      });
    }
    async function sendVideo(file) {
      const cid = S2.active, owner2 = accountScope();
      if (!cid) return;
      if (S2.policy?.chatMaxAttachmentBytes > 0 && file.size > S2.policy.chatMaxAttachmentBytes) {
        toast2("文件超过服务器配置的大小限制");
        return;
      }
      const fallback = (error) => {
        if (accountScope() !== owner2) return;
        modal2("无法直接发送视频", `<p class="hint">${esc4(error.message)}，可以作为普通文件发送给对方。</p>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="video-send-file">作为文件发送</button>');
        $2("#video-send-file").onclick = () => {
          closeModal2();
          if (S2.active === cid && accountScope() === owner2) upload2(file, true);
          else toast2("聊天已切换，请重新选择文件");
        };
      };
      let metadata2;
      try {
        metadata2 = await videoMetadata(file);
      } catch (error) {
        fallback(error);
        return;
      }
      if (accountScope() !== owner2) return;
      try {
        await sendMedia(file, "video", metadata2, cid);
      } catch (error) {
        if (error.status === 400) fallback(error);
        else showRetry(error);
      }
    }
    function sync() {
      document.querySelectorAll("[data-play-voice]").forEach((button) => {
        const active = playing?.id === button.dataset.playVoice && !audio.paused;
        button.classList.toggle("is-playing", active);
        button.setAttribute("aria-label", (active ? "暂停语音" : "播放语音") + " " + seconds(button.dataset.duration) + " 秒");
        if (played().has(button.dataset.playVoice)) $2(".voice-unplayed", button)?.remove();
      });
      if (recording && $2(".composer")?.classList.contains("selection-hidden")) finish(true);
    }
    function stopVideo() {
      if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute("src");
        videoPlayer.load();
        videoPlayer = null;
      }
    }
    function reset() {
      finish(true);
      audio.pause();
      playing = null;
      stopVideo();
      mode = false;
      mount();
    }
    function invalidate(id) {
      if (playing?.messageID === id) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        playing = null;
      }
      if (videoPlayer?.dataset.messageId === id) {
        stopVideo();
        if ($2(".video-viewer")) closeModal2();
      }
    }
    async function playVoice(button) {
      finish(true);
      stopVideo();
      const id = button.dataset.playVoice;
      if (playing?.id === id && !audio.paused) {
        audio.pause();
        return;
      }
      if (playing?.id !== id) {
        audio.pause();
        audio.src = fileURL2(id);
        playing = { id, messageID: button.dataset.mediaMessage };
      }
      if (audio.ended) audio.currentTime = 0;
      try {
        await audio.play();
        if (S2.user && playing?.id === id) markPlayed(id);
        sync();
      } catch (error) {
        if (S2.user) toast2("无法播放语音，请检查网络或下载后播放");
        sync();
      }
    }
    function playVideo(button) {
      finish(true);
      audio.pause();
      stopVideo();
      modal2(button.dataset.mediaName || "视频", `<div class="video-viewer"><video id="message-video-player" controls playsinline preload="metadata" src="${fileURL2(button.dataset.playVideo)}"></video><p class="hint">${esc4(button.dataset.mediaName || "视频")}</p></div>`, (button.dataset.mediaRoot ? '<button class="secondary" data-fw="record-return">返回聊天记录</button>' : "") + '<button class="secondary" data-download="' + button.dataset.playVideo + '" data-filename="' + esc4(button.dataset.mediaName || "视频") + '">保存视频</button>', true);
      videoPlayer = $2("#message-video-player");
      videoPlayer.dataset.messageId = button.dataset.mediaMessage;
      videoPlayer.onerror = () => toast2("当前设备无法播放此视频，可保存文件后播放");
      videoPlayer.play().catch(() => {
      });
    }
    for (const type of ["play", "pause", "ended"]) audio.addEventListener(type, sync);
    new MutationObserver(() => {
      if (videoPlayer && !document.contains(videoPlayer)) stopVideo();
    }).observe($2("#overlays"), { childList: true, subtree: true });
    document.addEventListener("click", (e) => {
      const button = e.target.closest("[data-media],[data-play-voice],[data-play-video]");
      if (!button) return;
      if (button.dataset.playVoice) {
        playVoice(button);
        return;
      }
      if (button.dataset.playVideo) {
        playVideo(button);
        return;
      }
      switch (button.dataset.media) {
        case "voice-mode":
          finish(true);
          mode = !mode;
          if (mode) $2("#composer")?.blur();
          mount();
          break;
        case "voice-start":
          begin(false);
          break;
        case "voice-cancel":
          finish(true);
          break;
        case "voice-finish":
          finish(false);
          break;
        case "video":
          if (window.WeLinkAndroid) {
            modal2("发送视频", '<button class="remote-choice" id="video-from-gallery">' + icon2("folder") + '从相册选择</button><button class="remote-choice" id="video-from-camera">' + icon2("video") + '拍摄视频</button><p class="hint">支持 MP4、WebM。文件大小遵循服务器配置。</p>');
            $2("#video-from-gallery").onclick = () => {
              closeModal2();
              $2("#video-input").click();
            };
            $2("#video-from-camera").onclick = () => {
              closeModal2();
              $2("#video-capture-input").click();
            };
          } else $2("#video-input").click();
          break;
      }
    });
    document.addEventListener("pointerdown", (e) => {
      const button = e.target.closest("[data-media=voice-hold]");
      if (!button || e.button !== 0) return;
      e.preventDefault();
      hold = { pointer: e.pointerId, y: e.clientY, cancel: false };
      button.setPointerCapture(e.pointerId);
      begin(true);
    });
    document.addEventListener("pointermove", (e) => {
      if (hold && hold.pointer === e.pointerId) {
        hold.cancel = e.clientY < hold.y - 60;
        renderRecording();
      }
    });
    document.addEventListener("pointerup", (e) => {
      if (hold && hold.pointer === e.pointerId) {
        const cancel = hold.cancel;
        hold = null;
        finish(cancel);
      }
    });
    document.addEventListener("pointercancel", () => {
      if (hold) {
        hold = null;
        finish(true);
      }
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-nav],[data-conversation],[data-action=back],[data-action=logout]")) reset();
    }, true);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) reset();
    });
    window.addEventListener("blur", () => finish(true));
    window.WeLinkMediaBackground = reset;
    window.WeLinkMediaBeforeModal = () => finish(true);
    return { bubble, tools, input, mount, reset, invalidate, sync, sendVideo };
  }

  // internal/ui/src/forwarding.js
  function createForwarding({ S: S2, api: api2, action: action2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc4, icon: icon2, av: av2, preview: preview2, fullTime: fullTime2, bytes: bytes2, fileURL: fileURL2, randomID: randomID2, renderMessages: renderMessages2, queueRefresh: queueRefresh2, mediaBubble }) {
    const $2 = (s, r = document) => r.querySelector(s);
    let selection = null, chooser = null, viewer = null;
    function selected(message) {
      return selection?.cid === S2.active && selection.ids.has(message.id);
    }
    function checkbox(message) {
      return selection?.cid === S2.active ? `<button class="message-check" role="checkbox" aria-checked="${selected(message)}" aria-label="选择消息">${selected(message) ? icon2("check") : ""}</button>` : "";
    }
    function reset(render = true) {
      selection = null;
      if (render) renderMessages2(true);
    }
    function sync() {
      if (selection && (selection.cid !== S2.active || S2.tab !== "messages" || !S2.user)) selection = null;
      const area = $2("#messages"), composer = $2(".composer");
      if (!area) return;
      area.classList.toggle("selecting-messages", !!selection);
      if (composer) composer.classList.toggle("selection-hidden", !!selection);
      $2("#message-selection-toolbar")?.remove();
      if (!selection) return;
      const selectedMessages = S2.messages.filter((m) => selection.ids.has(m.id));
      selection.ids = new Set(selectedMessages.map((m) => m.id));
      const count = selection.ids.size, unavailable = selectedMessages.some((m) => m.recalled), voice = selectedMessages.some((m) => m.kind === "voice");
      area.insertAdjacentHTML("afterend", `<section class="message-selection-toolbar" id="message-selection-toolbar"><div><b>已选择 ${count} 条消息</b><button data-fw="cancel-select">取消</button></div><nav><button data-fw="selected-forward" ${!count || unavailable || voice ? "disabled" : ""} title="${unavailable ? "已撤回消息不能转发" : voice ? "语音消息不能转发" : "转发所选消息"}">${icon2("send")}<span>转发</span></button><button data-fw="selected-delete" ${count ? "" : "disabled"}>${icon2("trash")}<span>删除</span></button></nav></section>`);
    }
    function start(id) {
      selection = { cid: S2.active, ids: /* @__PURE__ */ new Set([id]) };
      renderMessages2(true);
    }
    function toggle(id) {
      if (selection.ids.has(id)) selection.ids.delete(id);
      else if (selection.ids.size < 100) selection.ids.add(id);
      else {
        toast2("一次最多选择 100 条消息");
        return;
      }
      renderMessages2(true);
    }
    function removed(id) {
      if (selection) {
        selection.ids.delete(id);
        sync();
      }
      invalidate(id);
    }
    function invalidate(id) {
      if (viewer?.id === id && ($2(".forward-record-dialog") || $2(".forward-record-image"))) {
        viewer = null;
        closeModal2();
        toast2("这条聊天记录已删除或撤回");
      }
    }
    function deleteSelected() {
      const state = selection;
      if (!state?.ids.size) return;
      const ids = [...state.ids];
      modal2("删除所选消息", `<p class="hint">删除这 ${ids.length} 条消息？它们将从你所有设备的聊天记录中移除，对方的记录和已保存的收藏会保留。</p>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="selection-delete-confirm">删除</button>');
      $2("#selection-delete-confirm").onclick = async (e) => {
        e.target.disabled = true;
        try {
          await action2(`/api/conversations/${state.cid}/messages/delete`, { messageIds: ids });
          if (S2.active === state.cid) S2.messages = S2.messages.filter((m) => !ids.includes(m.id));
          reset();
          closeModal2();
          queueRefresh2();
          toast2("已删除所选消息");
        } catch (error) {
          $2("#modal-error").textContent = error.message;
          e.target.disabled = false;
        }
      };
    }
    function targets(tab) {
      const recent = S2.conversations.filter((c) => c.canSend !== false).map((c) => ({ key: c.id, cid: c.id, name: c.name, kind: c.kind, avatar: c.peer?.avatar || "group" }));
      if (tab === "groups") return recent.filter((c) => c.kind === "group");
      if (tab === "friends") return S2.friends.map((u) => {
        const existing = S2.conversations.find((c) => c.kind === "direct" && c.peer?.id === u.id);
        return { key: existing?.id || "user:" + u.id, cid: existing?.id, userId: u.id, name: u.remark || u.name, number: u.number, avatar: u.avatar };
      });
      return recent;
    }
    function renderTargets() {
      const state = chooser;
      if (!state || !$2("#forward-recipients")) return;
      const query = $2("#forward-search").value.toLowerCase();
      const items = targets(state.tab).filter((c) => (c.name + (c.number || "")).toLowerCase().includes(query));
      $2("#forward-recipients").innerHTML = items.map((c) => `<label class="forward-recipient">${av2(c)}<span>${esc4(c.name)}${c.number ? `<small>${esc4(c.number)}</small>` : ""}</span><input type="checkbox" value="${esc4(c.key)}" ${state.targets.has(c.key) ? "checked" : ""} aria-label="选择 ${esc4(c.name)}"></label>`).join("") || '<p class="empty-list">没有匹配的会话</p>';
      $2("#forward-recipients").onchange = (e) => {
        const target = items.find((c) => c.key === e.target.value);
        if (!target) return;
        if (e.target.checked) {
          if (state.targets.size >= 9) {
            e.target.checked = false;
            toast2("最多选择 9 个会话");
            return;
          }
          state.targets.set(target.key, target);
        } else state.targets.delete(target.key);
        renderChosen();
      };
      document.querySelectorAll("[data-forward-tab]").forEach((b) => b.classList.toggle("active", b.dataset.forwardTab === state.tab));
    }
    function renderChosen() {
      const state = chooser;
      $2("#forward-selected-count").textContent = `已选择 ${state.targets.size} 个会话`;
      $2("#forward-selected").innerHTML = [...state.targets.values()].map((c) => `<button class="forward-chip" data-forward-remove="${esc4(c.key)}">${esc4(c.name)}<span>×</span></button>`).join("") || '<p class="hint">选择好友或群聊</p>';
      $2("#forward-submit").disabled = !state.targets.size;
    }
    function open2(ids) {
      const messages = S2.messages.filter((m) => ids.includes(m.id));
      if (!messages.length || messages.some((m) => m.recalled) || messages.length !== ids.length) {
        toast2("所选消息已删除或撤回");
        return;
      }
      if (messages.some((m) => m.kind === "voice")) {
        toast2("语音消息不能转发");
        return;
      }
      const state = chooser = { cid: S2.active, ids, tab: "recent", targets: /* @__PURE__ */ new Map(), mode: ids.length > 1 ? "merge" : "each", messages, signature: "", clientId: "" };
      modal2("发送给", `<div class="forward-chooser"><section class="forward-people"><input id="forward-search" aria-label="搜索接收人" placeholder="搜索好友或群聊"><nav class="forward-tabs"><button data-forward-tab="recent" class="active">最近</button><button data-forward-tab="friends">好友</button><button data-forward-tab="groups">群聊</button></nav><div id="forward-recipients"></div></section><section class="forward-confirm"><b id="forward-selected-count"></b><div id="forward-selected"></div>${ids.length > 1 ? '<div class="forward-mode"><label><input type="radio" name="forward-mode" value="merge" checked>合并转发</label><label><input type="radio" name="forward-mode" value="each">逐条转发</label></div>' : ""}<div class="forward-send-preview"><b>${ids.length > 1 ? "聊天记录" : esc4(preview2(messages[0]).slice(0, 60))}</b>${ids.length > 1 ? messages.slice(0, 3).map((m) => `<p>${esc4(m.name + "：" + preview2(m))}</p>`).join("") : ""}<small>${ids.length} 条消息</small></div><textarea id="forward-note" placeholder="给对方留言（可选）" aria-label="转发留言" maxlength="600"></textarea></section></div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="forward-submit" disabled>发送</button>', true);
      $2(".modal").classList.add("forward-dialog");
      renderTargets();
      renderChosen();
      $2("#forward-search").oninput = renderTargets;
      $2("#forward-selected").onclick = (e) => {
        const button = e.target.closest("[data-forward-remove]");
        if (button) {
          state.targets.delete(button.dataset.forwardRemove);
          renderTargets();
          renderChosen();
        }
      };
      $2(".forward-tabs").onclick = (e) => {
        const b = e.target.closest("[data-forward-tab]");
        if (b) {
          state.tab = b.dataset.forwardTab;
          renderTargets();
        }
      };
      document.querySelectorAll("[name=forward-mode]").forEach((input) => input.onchange = () => {
        state.mode = input.value;
      });
      $2("#forward-submit").onclick = async () => {
        const button = $2("#forward-submit");
        button.disabled = true;
        const chosen = [...state.targets.values()].map((target) => ({ ...target })), mode = state.mode, note = $2("#forward-note").value;
        try {
          const destinations = [];
          for (const target of chosen) {
            if (!target.cid) {
              const created = await action2("/api/conversations", { kind: "direct", members: [target.userId] });
              target.cid = created.id;
            }
            destinations.push(target.cid);
          }
          const body = { conversationId: state.cid, messageIds: state.ids, targets: destinations, mode, note };
          const signature = JSON.stringify(body);
          if (signature !== state.signature) {
            state.signature = signature;
            state.clientId = randomID2();
          }
          await action2("/api/messages/forward", { ...body, clientId: state.clientId });
          closeModal2();
          reset();
          queueRefresh2();
          toast2(`已转发到 ${destinations.length} 个会话`);
        } catch (error) {
          if ($2("#modal-error")) $2("#modal-error").textContent = error.message;
          button.disabled = false;
        }
      };
    }
    function card(m) {
      let card2;
      try {
        card2 = JSON.parse(m.text);
      } catch {
        return esc4("[聊天记录]");
      }
      ;
      return `<button class="forward-card" data-forward-view="${m.id}"><b>${esc4(card2.title)}</b>${(card2.preview || []).slice(0, 3).map((line) => `<p>${esc4(line)}</p>`).join("")}<small>聊天记录 · ${Number(card2.count) || 0} 条</small></button>`;
    }
    function previewRecord(record) {
      return `<b>${esc4(record.title)}</b>${record.items.slice(0, 3).map((item) => `<p>${esc4(item.name + "：" + preview2(item))}</p>`).join("")}<small>聊天记录 · ${record.items.length} 条</small>`;
    }
    function showDocument() {
      const record = viewer.stack[viewer.stack.length - 1];
      modal2(record.title, `<div class="forward-record">${record.items.map((item, index) => {
        let content = esc4(item.text);
        if (item.kind === "image") content = `<img loading="lazy" src="${fileURL2(item.attachmentId)}" alt="${esc4(item.fileName || "图片")}" data-forward-image="${item.attachmentId}">`;
        else if (item.kind === "file") content = `<button class="file-card" data-download="${item.attachmentId}" data-filename="${esc4(item.fileName)}">${icon2("file")}<span><b>${esc4(item.fileName)}</b><small>${bytes2(item.fileSize)} · 点击下载</small></span></button>`;
        else if (item.kind === "voice" || item.kind === "video") content = mediaBubble(item, viewer.id);
        else if (item.record) content = `<button class="forward-card" data-forward-nested="${index}">${previewRecord(item.record)}</button>`;
        else if (item.kind === "call") content = esc4(preview2(item));
        else if (item.kind === "meeting") content = esc4("[会议]");
        return `<article class="forward-record-item">${av2(item)}<div><header><b>${esc4(item.name)}</b><time>${fullTime2(item.created)}</time></header><div class="forward-record-content">${content}</div>${item.quote ? `<p class="forward-record-quote">${esc4(item.quote.name + "：" + item.quote.text)}</p>` : ""}</div></article>`;
      }).join("")}</div>`, viewer.stack.length > 1 ? '<button class="secondary" data-fw="record-back">返回上一层</button>' : "", true);
      $2(".modal").classList.add("forward-record-dialog");
    }
    async function view(id) {
      try {
        const document2 = await api2(`/api/messages/${id}/forward`);
        viewer = { id, stack: [document2] };
        showDocument();
      } catch (e) {
        toast2(e.message);
      }
    }
    document.addEventListener("click", (e) => {
      if (!selection) return;
      const message = e.target.closest("[data-message]");
      if (message && $2("#messages")?.contains(message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle(message.dataset.message);
      }
    }, true);
    document.addEventListener("contextmenu", (e) => {
      if (selection && e.target.closest("[data-message]")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && selection && !$2(".modal")) reset();
    });
    document.addEventListener("click", (e) => {
      const button = e.target.closest("[data-fw],[data-forward-view],[data-forward-nested],[data-forward-image]");
      if (!button) return;
      $2(".context-menu")?.remove();
      if (button.dataset.forwardView) {
        view(button.dataset.forwardView);
        return;
      }
      if (button.dataset.forwardNested !== void 0) {
        const record = viewer?.stack[viewer.stack.length - 1].items[Number(button.dataset.forwardNested)]?.record;
        if (record) {
          viewer.stack.push(record);
          showDocument();
        }
        ;
        return;
      }
      if (button.dataset.forwardImage) {
        modal2("图片", `<img class="forward-record-image" src="${fileURL2(button.dataset.forwardImage)}" alt="图片预览">`, '<button class="secondary" data-fw="image-back">返回聊天记录</button>', true);
        return;
      }
      switch (button.dataset.fw) {
        case "single":
          open2([button.dataset.mid]);
          break;
        case "select":
          start(button.dataset.mid);
          break;
        case "cancel-select":
          reset();
          break;
        case "selected-forward":
          if (selection) open2([...selection.ids]);
          break;
        case "selected-delete":
          deleteSelected();
          break;
        case "record-back":
          viewer?.stack.pop();
          showDocument();
          break;
        case "image-back":
        case "record-return":
          showDocument();
          break;
      }
    });
    return { checkbox, selected, sync, reset, removed, invalidate, open: open2, card };
  }

  // internal/ui/src/history.js
  function createHistory({ S: S2, api: api2, modal: modal2, toast: toast2, esc: esc4, preview: preview2, fullTime: fullTime2, jump }) {
    let current = null;
    const $2 = (s) => document.querySelector(s);
    function render() {
      const state = current, list = $2("#history-results");
      if (!list || !state) return;
      list.innerHTML = state.items.map((m) => `<button class="history-item" data-history-id="${m.id}"><small>${esc4(m.name)} · ${fullTime2(m.created)}</small><p>${esc4(preview2(m))}</p><span>查看上下文</span></button>`).join("") || '<div class="empty-list">未找到相关消息</div>';
      if (S2.cacheView) list.insertAdjacentHTML("afterbegin", '<p class="hint">当前仅搜索此设备已缓存的消息，联网后可搜索完整记录。</p>');
      if (state.more) list.insertAdjacentHTML("beforeend", '<button class="history-more secondary">加载更早记录</button>');
      list.querySelectorAll("[data-history-id]").forEach((button) => button.onclick = () => jump(state.cid, button.dataset.historyId).catch((e) => toast2(e.message)));
      const more = list.querySelector(".history-more");
      if (more) more.onclick = () => load(true);
    }
    async function load(older = false) {
      const state = current;
      if (!state || !$2("#history-search")) return;
      const revision = ++state.revision;
      const params = new URLSearchParams({ q: $2("#history-search").value, kind: $2("#history-kind").value, sender: $2("#history-sender").value });
      for (const field of ["from", "to"]) {
        const value = $2("#history-" + field).value;
        if (value) {
          const day = /* @__PURE__ */ new Date(value + "T00:00:00");
          if (field === "to") day.setDate(day.getDate() + 1);
          params.set(field, String(day.getTime()));
        }
      }
      if ($2("#history-mentions")?.checked) params.set("mentions", "me");
      if (older && state.items.length) params.set("before", String(state.items[state.items.length - 1].seq));
      if (!older) $2("#history-results").innerHTML = '<p class="hint">正在查找…</p>';
      else $2(".history-more").disabled = true;
      try {
        const items = await api2(`/api/conversations/${state.cid}/messages?${params}`);
        if (current !== state || state.revision !== revision || !$2("#history-results")) return;
        state.items = older ? [...state.items, ...items.reverse()] : items.reverse();
        state.more = items.length === 60;
        render();
      } catch (e) {
        if (current === state && state.revision === revision) {
          toast2(e.message);
          render();
        }
      }
    }
    async function open2() {
      const state = current = { cid: S2.active, items: [], more: false, revision: 0 };
      modal2("聊天记录", `<div class="history-search-box"><input id="history-search" maxlength="200" placeholder="搜索消息内容或文件名" aria-label="搜索聊天记录"></div><div class="history-filters"><label>消息类型<select id="history-kind"><option value="">全部消息</option value="text">文字</option><option value="image">图片</option><option value="voice">语音</option><option value="video">视频</option><option value="file">文件</option><option value="meeting">会议</option><option value="call">通话</option><option value="forward">聊天记录</option></select></label><label>发送人<select id="history-sender"><option value="">所有人</option></select></label><label>开始日期<input type="date" id="history-from"></label><label>结束日期<input type="date" id="history-to"></label></div>${S2.conversations.find((c) => c.id === state.cid)?.kind === "group" ? '<label class="history-mention-filter"><input type="checkbox" id="history-mentions">只看 @我的消息</label>' : ""}<div id="history-results" class="history-results" aria-live="polite"></div>`, "", true);
      let timer;
      $2("#history-search").oninput = () => {
        clearTimeout(timer);
        ++state.revision;
        state.items = [];
        state.more = false;
        $2("#history-results").innerHTML = '<p class="hint">正在查找…</p>';
        timer = setTimeout(() => load(), 250);
      };
      for (const id of ["kind", "sender", "from", "to"]) $2("#history-" + id).onchange = () => {
        clearTimeout(timer);
        load();
      };
      if ($2("#history-mentions")) $2("#history-mentions").onchange = () => load();
      load();
      try {
        const detail = await api2("/api/conversations/" + state.cid);
        if (current === state && $2("#history-sender")) $2("#history-sender").innerHTML = '<option value="">所有人</option>' + detail.members.map((u) => `<option value="${u.id}">${esc4(u.name)}</option>`).join("");
      } catch (e) {
        toast2(e.message);
      }
    }
    function changed(id, recalled = false) {
      if (!current || !$2("#history-results")) return;
      current.revision++;
      current.items = current.items.filter((m) => m.id !== id);
      if (recalled) {
        for (const item of current.items) if (item.reply?.id === id) item.reply = { ...item.reply, text: "", fileName: "", recalled: true };
      }
      render();
    }
    return { open: open2, changed };
  }

  // internal/ui/src/security.js
  function createSecurity({ api: api2, action: action2, S: S2, modal: modal2, toast: toast2, esc: esc4, icon: icon2, logout: logout2 }) {
    const el = (id) => document.getElementById(id);
    const when = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "暂无活动记录";
    function open2() {
      modal2("账号与安全", `<div class="security-account">${icon2("shield")}<div><b>${esc4(S2.user.name)}</b>${S2.user.email ? `<p>邮箱：${esc4(S2.user.email)}</p>` : ""}<p>${APP_NAME} 号：${esc4(S2.user.number)}</p></div></div><button class="utility-row security-option" data-security="devices">${icon2("monitor")}<div class="body"><b>登录设备</b><p>查看设备，退出不再使用的登录</p></div>${icon2("chevron")}</button><button class="utility-row security-option" data-security="password">${icon2("shield")}<div class="body"><b>修改密码</b><p>修改后其他设备需要重新登录</p></div>${icon2("chevron")}</button>`);
    }
    async function devices() {
      if (!S2.user) return;
      modal2("登录设备", '<p class="hint">退出设备后，该设备的聊天、会议和远程协助会断开。</p><div id="device-list">正在读取…</div>', '<button class="secondary" data-security="back">返回</button><button class="primary" id="revoke-other-devices">退出其他设备</button>');
      el("revoke-other-devices").disabled = true;
      try {
        const items = await api2("/api/auth/sessions");
        if (!el("device-list")) return;
        el("device-list").innerHTML = items.map((d) => `<article class="device-row">${icon2(d.device.includes("Android") ? "phone" : "monitor")}<div class="device-details"><b>${esc4(d.device)} ${d.current ? '<span class="device-current">本设备</span>' : ""}</b><p>登录：${esc4(when(d.created))}</p><p>最近使用：${esc4(when(d.lastSeen))}</p></div>${d.current ? "" : `<button class="device-remove" data-device-id="${esc4(d.id)}">退出</button>`}</article>`).join("");
        el("revoke-other-devices").disabled = !items.some((d) => !d.current);
        el("device-list").onclick = (e) => {
          const button = e.target.closest("[data-device-id]");
          if (button) confirm(items.find((d) => d.id === button.dataset.deviceId));
        };
        el("revoke-other-devices").onclick = () => confirm();
      } catch (e) {
        if (el("device-list")) el("device-list").textContent = e.message;
      }
    }
    function confirm(device) {
      modal2(device ? "退出登录设备" : "退出其他设备", `<p class="hint">${device ? "确认让 " + esc4(device.device) + " 退出登录？" : "确认退出其他所有登录设备？当前设备会保留登录。"}该操作会断开对应设备的聊天、会议和远程协助。</p>`, '<button class="secondary" data-security="devices">取消</button><button class="primary" id="device-confirm-revoke">确认退出</button>');
      el("device-confirm-revoke").onclick = async () => {
        const button = el("device-confirm-revoke");
        button.disabled = true;
        try {
          const result = device ? await api2("/api/auth/sessions/" + encodeURIComponent(device.id), { method: "DELETE" }) : await action2("/api/auth/sessions/revoke-others");
          if (result.current) {
            await logout2(false);
            return;
          }
          toast2("已退出所选设备");
          await devices();
        } catch (e) {
          if (el("modal-error")) el("modal-error").textContent = e.message;
          button.disabled = false;
        }
      };
    }
    function password() {
      modal2("修改密码", '<form id="password-form"><label for="security-old-password">原密码</label><input id="security-old-password" type="password" autocomplete="current-password" required maxlength="72"><label for="security-new-password">新密码</label><input id="security-new-password" type="password" autocomplete="new-password" required minlength="8" maxlength="72" placeholder="至少 8 位"><label for="security-repeat-password">确认新密码</label><input id="security-repeat-password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"><p class="hint">修改成功后保留本设备，其他设备会退出登录；尚未完成的扫码授权也将失效。</p></form>', '<button class="secondary" data-security="back">取消</button><button type="submit" form="password-form" class="primary" id="password-save">保存密码</button>');
      el("password-form").onsubmit = async (e) => {
        e.preventDefault();
        const button = el("password-save"), oldPassword = el("security-old-password").value, newPassword = el("security-new-password").value;
        if (newPassword !== el("security-repeat-password").value) {
          el("modal-error").textContent = "两次输入的新密码不一致";
          return;
        }
        button.disabled = true;
        el("modal-error").textContent = "";
        try {
          await action2("/api/auth/password", { oldPassword, newPassword });
          toast2("密码已修改，其他设备已退出");
          open2();
        } catch (error) {
          if (el("modal-error")) el("modal-error").textContent = error.message;
          button.disabled = false;
        }
      };
    }
    document.addEventListener("click", (e) => {
      const node = e.target.closest("[data-security],[data-action=security]");
      if (!node || !S2.user) return;
      switch (node.dataset.security || "back") {
        case "devices":
          devices();
          break;
        case "password":
          password();
          break;
        default:
          open2();
      }
    });
    return { open: open2, devices, password };
  }

  // internal/ui/src/qr-login.js
  function createQRLogin({ action: action2, S: S2, modal: modal2, toast: toast2, esc: esc4, enter: enter2, renderAuth: renderAuth2, windows: windows2, logo: logo2, icon: icon2 }) {
    let active = null, phonePending = null;
    const el = (id) => document.getElementById(id);
    function stop() {
      if (!active) return;
      const previous = active;
      active = null;
      clearTimeout(previous.timer);
      if (previous.id) action2("/api/auth/qr/cancel", { id: previous.id, pollSecret: previous.pollSecret }).catch(() => {
      });
    }
    async function open2() {
      stop();
      const current = { timer: null };
      active = current;
      el("app").innerHTML = `<main class="auth-shell">${windows2()}${authShowcase()}<section class="auth-card qr-auth">${logo2()}<h2>扫码登录</h2><p class="subtitle">使用安卓 ${APP_NAME}「扫一扫」</p><div class="qr-image" id="qr-image"><span>正在生成二维码…</span></div><p class="qr-status" id="qr-status">请在手机上登录你的 ${APP_NAME} 账号</p><p class="qr-check" id="qr-check"></p><div class="auth-error" id="auth-error"></div><button class="primary" id="qr-refresh">刷新二维码</button><div class="auth-links"><button data-action="login">密码登录</button>${S2.registrationEnabled ? '<button data-action="register">注册账号</button>' : ""}</div><p class="auth-consent">扫码后请在手机上确认<br>二维码 3 分钟内有效，仅可使用一次</p></section><small class="auth-footer">${APP_NAME} ${CLIENT_VERSION}</small></main>`;
      el("qr-refresh").onclick = open2;
      try {
        const q = await action2("/api/auth/qr", { device: "" + APP_NAME + " Windows 客户端" });
        if (active !== current) {
          action2("/api/auth/qr/cancel", q).catch(() => {
          });
          return;
        }
        Object.assign(current, q);
        el("qr-image").innerHTML = `<img alt="${APP_NAME} 桌面登录二维码" src="${q.image}">`;
        el("qr-check").textContent = "核对码 " + q.checkCode;
        await poll(current);
      } catch (e) {
        if (active === current) el("auth-error").textContent = e.message;
      }
    }
    async function poll(current) {
      if (active !== current) return;
      try {
        const result = await action2("/api/auth/qr/poll", { id: current.id, pollSecret: current.pollSecret });
        if (active !== current) return;
        if (result.token) {
          active = null;
          S2.token = result.token;
          S2.user = result.user;
          localStorage.setItem("welink_token", S2.token);
          await enter2();
          return;
        }
        const ended = result.state === "expired" || result.state === "rejected";
        el("qr-status").textContent = result.state === "scanned" ? "扫码成功，请在手机上确认" : result.state === "expired" ? "二维码已过期，请刷新" : result.state === "rejected" ? "手机已取消登录，请刷新" : "请使用安卓 " + APP_NAME + " 扫描二维码";
        el("qr-image").classList.toggle("qr-inactive", ended);
        if (!ended) current.timer = setTimeout(() => poll(current), 1200);
      } catch (e) {
        if (active === current) {
          el("auth-error").textContent = e.message;
          if (e.status === 404) {
            el("qr-status").textContent = "二维码已失效，请刷新";
            el("qr-image").classList.add("qr-inactive");
          } else current.timer = setTimeout(() => poll(current), 3e3);
        }
      }
    }
    async function scanned(payload) {
      if (!S2.user) {
        toast2("请先在手机上登录 " + APP_NAME);
        return;
      }
      const match = /^welink:\/\/login\/([a-f0-9]{32})\?key=([a-f0-9]{64})$/.exec(String(payload));
      if (!match) {
        toast2("这不是 " + APP_NAME + " 登录二维码");
        return;
      }
      const request = { id: match[1], key: match[2] };
      try {
        const result = await action2("/api/auth/qr/scan", request);
        phonePending = request;
        modal2("登录 Windows 版 " + APP_NAME, `<div class="qr-confirm"><div class="qr-computer">${icon2("monitor")}</div><h3>${esc4(result.device)}</h3><p>将使用 ${esc4(S2.user.name)} 登录</p><p>${APP_NAME} 号：${esc4(S2.user.number)}</p><div class="qr-check">核对码 ${esc4(result.checkCode)}</div><p class="hint">请核对电脑上的数字，只确认你正在操作的电脑。</p></div>`, '<button class="secondary" id="qr-phone-cancel">取消登录</button><button class="primary" id="qr-phone-confirm">确认登录</button>');
        const resolve = async (accept) => {
          const button = el(accept ? "qr-phone-confirm" : "qr-phone-cancel");
          button.disabled = true;
          try {
            await action2("/api/auth/qr/confirm", { ...request, accept });
            phonePending = null;
            document.querySelector(".modal [data-action=close-modal]")?.click();
            toast2(accept ? "已授权电脑登录" : "已取消电脑登录");
          } catch (e) {
            toast2(e.message);
            button.disabled = false;
          }
        };
        el("qr-phone-confirm").onclick = () => resolve(true);
        el("qr-phone-cancel").onclick = () => resolve(false);
      } catch (e) {
        toast2(e.message);
      }
    }
    window.WeLinkQrScanned = scanned;
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-action]")?.dataset.action;
      if (a === "qr-login") open2();
      if (a === "scan-qr") {
        if (!S2.user) {
          toast2("请先登录");
          return;
        }
        if (window.WeLinkAndroid?.scanQRCode) window.WeLinkAndroid.scanQRCode();
        else toast2("请在安卓 " + APP_NAME + " 中使用扫一扫");
      }
      if (a === "close-modal" && phonePending) {
        const request = phonePending;
        phonePending = null;
        action2("/api/auth/qr/confirm", { ...request, accept: false }).catch(() => {
        });
      }
    });
    window.addEventListener("pagehide", () => {
      clearTimeout(active?.timer);
    });
    return { open: open2, stop, scanned };
  }

  // internal/ui/src/meeting-tuning.js
  var SCREEN_BITRATE = 1e8;
  var CAMERA_BITRATE = 2e7;
  function videoBudget(screen) {
    return screen ? SCREEN_BITRATE : CAMERA_BITRATE;
  }
  async function tuneMeetingPeer(peer, screen, peers) {
    if (peer.tuning || peer.pc.signalingState === "closed") return;
    const bitrate = videoBudget(screen, peers), key = String(screen);
    if (peer.tuningKey === key) return;
    peer.tuning = true;
    let complete = true;
    try {
      for (const sender of peer.pc.getSenders()) {
        if (!sender.track || !sender.getParameters) continue;
        try {
          const p = sender.getParameters();
          if (!p.encodings?.length) {
            complete = false;
            continue;
          }
          for (const e of p.encodings) {
            if (sender.track.kind === "audio") {
              e.maxBitrate = 128e3;
              if ("priority" in e) e.priority = "high";
              if ("networkPriority" in e) e.networkPriority = "high";
            } else {
              e.maxBitrate = Math.round(bitrate / p.encodings.length);
              e.maxFramerate = 30;
              e.scaleResolutionDownBy = 1;
              if (screen) {
                if ("priority" in e) e.priority = "high";
                if ("networkPriority" in e) e.networkPriority = "high";
              }
            }
          }
          if (sender.track.kind === "video") p.degradationPreference = screen ? "maintain-resolution" : "maintain-framerate";
          await sender.setParameters(p);
        } catch {
          complete = false;
        }
      }
    } finally {
      if (complete) peer.tuningKey = key;
      peer.tuning = false;
    }
  }
  function lowLatencyReceiver(receiver) {
    if (!receiver || receiver.track?.kind !== "video") return;
    try {
      if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;
    } catch {
    }
    try {
      if ("playoutDelayHint" in receiver) receiver.playoutDelayHint = 0;
    } catch {
    }
  }

  // internal/ui/src/rtc-path.js
  function directFirstICE(pc, policy, { alive, changed, negotiate }) {
    const servers = policy.iceServers || [], hasRelay = servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/.test(u)));
    let relay = false, closed = false, deadline, recovery, statsTimer, restarts = 0, path = "正在直连", rtt = -1, available = 0, gathered = 0, blocked = false;
    const connected = () => ["connected", "completed"].includes(pc.iceConnectionState) || pc.connectionState === "connected";
    const valid = () => !closed && alive() && pc.connectionState !== "closed";
    const setPath = (value) => {
      if (path !== value) {
        path = value;
        changed();
      }
    };
    async function stats() {
      if (!valid() || !connected()) return;
      try {
        const report = await pc.getStats();
        if (!valid()) return;
        let pair;
        for (const value of report.values()) if (value.type === "transport" && value.selectedCandidatePairId) pair = report.get(value.selectedCandidatePairId);
        if (!pair) {
          for (const value of report.values()) if (value.type === "candidate-pair" && value.state === "succeeded" && (value.nominated || value.selected)) {
            pair = value;
            break;
          }
        }
        if (pair) {
          rtt = Number.isFinite(pair.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1e3) : -1;
          available = Number(pair.availableOutgoingBitrate) || 0;
          changed();
          const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
          setPath(local?.candidateType === "relay" || remote?.candidateType === "relay" ? "中转连接" : "P2P 直连");
        }
      } catch {
      }
    }
    function fallback() {
      if (!valid() || connected()) return;
      if (!hasRelay) {
        setPath(blocked ? "直连被本机网络策略阻止" : "直连未成功");
        return;
      }
      clearTimeout(deadline);
      relay = true;
      setPath("正在连接中转");
      try {
        pc.setConfiguration({ ...pc.getConfiguration(), iceServers: servers, iceTransportPolicy: "all" });
        pc.restartIce();
        Promise.resolve(negotiate()).catch(() => setPath("网络连接不稳定"));
      } catch {
        setPath("网络连接不稳定");
      }
    }
    function update() {
      if (!valid()) return;
      if (connected()) {
        clearTimeout(deadline);
        clearTimeout(recovery);
        recovery = null;
        stats();
        return;
      }
      if (pc.iceConnectionState === "failed" || pc.connectionState === "failed") {
        if (!relay) fallback();
        else if (restarts++ < 2) {
          setPath("正在重连");
          pc.restartIce();
          Promise.resolve(negotiate()).catch(() => {
          });
        } else setPath("网络连接不稳定");
      } else if (pc.iceConnectionState === "disconnected" && !recovery) {
        setPath("正在重连");
        recovery = setTimeout(() => {
          recovery = null;
          fallback();
        }, 5e3);
      }
    }
    pc.addEventListener("icecandidate", (event) => {
      if (relay || !valid()) return;
      if (event.candidate?.candidate) {
        gathered++;
        return;
      }
      if (!event.candidate && !gathered) {
        blocked = true;
        clearTimeout(deadline);
        fallback();
      }
    });
    deadline = setTimeout(fallback, policy.directTimeoutMs || 15e3);
    statsTimer = setInterval(stats, 2500);
    return { update, get path() {
      return path;
    }, get blocked() {
      return blocked;
    }, get rtt() {
      return rtt;
    }, get available() {
      return available;
    }, close() {
      closed = true;
      clearTimeout(deadline);
      clearTimeout(recovery);
      clearInterval(statsTimer);
    } };
  }
  function directIceServers(policy) {
    return (policy.iceServers || []).map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => /^stun:/.test(u)) })).filter((s) => s.urls.length);
  }

  // internal/ui/src/microphone-meter.js
  function microphoneMeter(track, node) {
    if (!track || !node) return null;
    let context, source, analyser, frame = 0, last = 0, level = 0, closed = false;
    const bars = [...node.children], history = Array(bars.length).fill(0), values = new Float32Array(512);
    const display2 = (value) => {
      node.dataset.level = String(Math.round(value * 100));
      node.setAttribute("aria-valuenow", String(Math.round(value * 100)));
      if (value <= 0) history.fill(0);
      else {
        history.shift();
        history.push(value);
      }
      bars.forEach((bar, i) => {
        bar.style.height = Math.max(15, history[i] * 100) + "%";
        bar.classList.toggle("active", history[i] > 0.02);
      });
    };
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      source = context.createMediaStreamSource(new MediaStream([track]));
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      context.resume().catch(() => {
      });
      const draw = (time) => {
        if (closed) return;
        frame = requestAnimationFrame(draw);
        if (time - last < 90) return;
        last = time;
        analyser.getFloatTimeDomainData(values);
        let sum = 0;
        for (const value of values) sum += value * value;
        const sample = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(Math.sqrt(sum / values.length), 1e-6)) + 60) / 60));
        level = track.enabled && track.readyState === "live" ? Math.max(sample, level * 0.65) : 0;
        display2(level);
      };
      frame = requestAnimationFrame(draw);
    } catch {
      source?.disconnect();
      context?.close().catch(() => {
      });
      display2(0);
      return null;
    }
    return { track, close() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      context.close().catch(() => {
      });
      display2(0);
    } };
  }

  // internal/ui/src/meeting-captions.js
  function createCaptions({ send, toast: toast2, esc: esc4, api: api2, code, stream, box }) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let on = false, rec = null, recorder = null, interimAt = 0, lastInterim = "", failed = false;
    const lines = /* @__PURE__ */ new Map();
    function draw() {
      const el = box();
      if (!el) return;
      const now = Date.now();
      for (const [id, l] of lines) if (now - l.at > (l.final ? 7e3 : 4e3)) lines.delete(id);
      el.classList.toggle("hidden", !on || !lines.size);
      el.innerHTML = [...lines.values()].slice(-3).map((l) => `<p><b>${esc4(l.name)}：</b>${esc4(l.text)}</p>`).join("");
    }
    const tick = setInterval(draw, 1e3);
    function show(m) {
      lines.set(m.id, { name: m.name, text: m.text, final: !!m.final, at: Date.now() });
      draw();
    }
    function emit(text, final) {
      text = text.trim();
      if (!text) return;
      send({ type: "caption", text: text.slice(0, 400), final });
    }
    function startRecognition() {
      rec = new Recognition();
      rec.lang = "zh-CN";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            emit(r[0].transcript, true);
            lastInterim = "";
          } else interim += r[0].transcript;
        }
        if (interim && interim !== lastInterim && Date.now() - interimAt > 500) {
          interimAt = Date.now();
          lastInterim = interim;
          emit(interim, false);
        }
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed") {
          failed = true;
          toast2("无法使用语音识别，请允许麦克风权限");
          stop();
          return;
        }
        if (["network", "service-not-allowed", "language-not-supported", "audio-capture"].includes(e.error)) {
          failed = true;
          try {
            rec.onend = null;
            rec.stop();
          } catch {
          }
          rec = null;
          if (on) startRecording();
        }
      };
      rec.onend = () => {
        if (on && !failed) setTimeout(() => {
          try {
            rec?.start();
          } catch {
          }
        }, 250);
      };
      try {
        rec.start();
      } catch {
      }
    }
    function startRecording() {
      const track = stream()?.getAudioTracks()[0];
      if (!track || typeof MediaRecorder !== "function") {
        toast2("此设备不支持字幕");
        stop();
        return;
      }
      const audio = new MediaStream([track.clone()]);
      let chunks = [];
      const cycle = () => {
        if (!on) return;
        recorder = new MediaRecorder(audio, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {});
        chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          if (on) cycle();
          if (blob.size < 3e3 || !track.enabled) return;
          const form = new FormData();
          form.append("audio", blob, "speech.webm");
          try {
            const r = await api2(`/api/meetings/${code()}/transcribe`, { method: "POST", body: form });
            if (r.text) emit(r.text, true);
          } catch (e) {
            if (e.status === 501 || e.status === 502) {
              toast2(e.message);
              failed = true;
              stop(true);
            }
          }
        };
        recorder.start();
        setTimeout(() => {
          if (recorder?.state === "recording") recorder.stop();
        }, 6e3);
      };
      cycle();
      recorder && (recorder.audioStream = audio);
    }
    function start() {
      if (on) return;
      on = true;
      failed = false;
      if (Recognition) startRecognition();
      else startRecording();
      toast2("字幕已开启：你的发言会转为文字，会议结束后自动生成纪要");
      draw();
    }
    function stop(keepDisplay = false) {
      if (!keepDisplay) on = false;
      try {
        rec && (rec.onend = null, rec.stop());
      } catch {
      }
      rec = null;
      try {
        if (recorder?.state === "recording") recorder.stop();
        recorder?.audioStream?.getTracks().forEach((t) => t.stop());
      } catch {
      }
      recorder = null;
      draw();
    }
    return { show, toggle() {
      if (on) stop();
      else start();
      return on;
    }, stop() {
      stop();
      clearInterval(tick);
    }, get on() {
      return on;
    } };
  }

  // internal/ui/src/meetings.js
  function createMeetings({ api: api2, action: action2, S: S2, modal: modal2, closeModal: closeModal2, toast: toast2, esc: esc4, icon: icon2, av: av2, Desktop: Desktop2, onCallClosed, callCurrent, historyEntry }) {
    let room = null, nativeCall = null, pending = /* @__PURE__ */ new Map(), checkingInvitation = false;
    function personUser(id) {
      if (!room) return null;
      if (id === S2.user?.id) return S2.user;
      if (room.call?.peer?.id === id) return room.call.peer;
      return (S2.friends || []).find((u) => u.id === id) || (S2.conversations || []).find((c) => c.peer?.id === id)?.peer || null;
    }
    function personHTML(id, name) {
      const u = personUser(id);
      return u && av2 ? av2(u, "large") : '<span class="meeting-initial">' + esc4((name || "M").slice(0, 1)) + "</span>";
    }
    const el = (id) => document.getElementById(id);
    const display2 = meetingWindow({ active: () => !!room, toast: toast2, changed: (full) => {
      if (!full && room?.focus) unfocusScreen();
      const b = el("meeting-fullscreen");
      if (b) {
        b.classList.toggle("on", full);
        b.querySelector("span").textContent = full ? "退出全屏" : "全屏";
        b.setAttribute("aria-pressed", String(full));
      }
    } });
    async function minimize() {
      if (!room) return;
      try {
        await display2.exit();
        if (room) {
          root().classList.add("meeting-minimized");
          toast2(room.call ? "通话继续进行，点击“返回通话”恢复" : "会议继续进行，点击“返回会议”恢复");
        }
      } catch {
        toast2("暂时无法最小化，请先退出全屏");
      }
    }
    const root = () => {
      let n = el("meeting-layer");
      if (!n) {
        n = document.createElement("div");
        n.id = "meeting-layer";
        document.body.append(n);
      }
      return n;
    };
    function invitationText(code) {
      return "邀请你加入 " + APP_NAME + " 会议\n会议号：" + grouped(code) + "\n会议链接：" + S2.config.server.replace(/\/$/, "") + "/join/" + code;
    }
    async function copyInvitation(code) {
      const text = invitationText(code);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.append(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) {
          modal2("会议邀请", '<textarea readonly style="width:100%;height:120px">' + esc4(text) + "</textarea>");
          return;
        }
      }
      toast2("邀请链接和会议号已复制");
    }
    function parseInvitation(raw) {
      const compact = raw.trim().replace(/\s/g, "");
      if (/^[1-9]\d{8}$/.test(compact)) return compact;
      const link = raw.match(/https?:\/\/[^\s]+/);
      if (link) {
        let url;
        try {
          url = new URL(link[0]);
        } catch {
          throw Error("会议链接无效");
        }
        ;
        if (url.origin !== new URL(S2.config.server).origin) throw Error("会议链接的服务器与当前连接不同");
        const match = url.pathname.match(/^\/join\/([1-9]\d{8})$/);
        if (!match || url.search || url.hash) throw Error("会议链接无效");
        return match[1];
      }
      const code = raw.match(/会议号[：:]\s*([1-9]\d{2}\s?\d{3}\s?\d{3})(?!\d)/);
      if (code) return code[1].replace(/\s/g, "");
      throw Error("请粘贴有效的会议邀请链接或 9 位会议号");
    }
    async function checkNativeInvitation(force = false) {
      if (checkingInvitation || !S2.user || S2.signingOut || room || nativeCall || document.querySelector("#call-layer") || !force && document.querySelector(".modal")) return;
      checkingInvitation = true;
      try {
        const code = window.WeLinkAndroid?.takeMeetingInvitation ? window.WeLinkAndroid.takeMeetingInvitation() : window.welinkMeetingInvitation ? await window.welinkMeetingInvitation() : (await api2("/local/meeting-invitation").catch(() => null))?.code || "";
        if (code && S2.user && !S2.signingOut) openJoin(code);
      } catch {
      } finally {
        checkingInvitation = false;
      }
    }
    setInterval(checkNativeInvitation, 1500);
    window.addEventListener("welink-open-meeting", () => checkNativeInvitation(true));
    const grouped = (code) => String(code).replace(/(\d{3})(?=\d)/g, "$1 ");
    function send(message) {
      if (room?.ws.readyState === 1) room.ws.send(JSON.stringify(message));
    }
    function state() {
      if (!room?.id) return;
      startMicrophoneMeter(room);
      const local = room.states.get(room.id);
      if (!local) return;
      local.microphone = room.stream.getAudioTracks().some((t) => t.enabled);
      local.camera = room.stream.getVideoTracks().some((t) => t.enabled);
      local.screen = !!room.screen;
      local.recording = !!room.recording;
      send({ type: "state", ...local });
      renderMembers();
      updateButtons();
    }
    function renderHome() {
      Desktop2?.clearActivities("meeting/");
      const n = document.querySelector("#main-content");
      n.innerHTML = `<section class="utility meeting-home"><h2>会议</h2><p class="hint">和好友一起面对面交流，也可以分享屏幕。</p><div class="meeting-cards"><button data-action="meeting-create">${icon2("video")}<b>发起会议</b><span>邀请好友或群成员</span></button><button data-action="meeting-join">${icon2("plus")}<b>加入会议</b><span>输入 9 位会议号</span></button></div>${historyEntry()}<h3>正在进行</h3><div id="meeting-list">正在读取…</div></section>`;
      api2("/api/meetings").then((items) => {
        if (!el("meeting-list")) return;
        el("meeting-list").innerHTML = items.map((m) => `<button class="utility-row meeting-open-row" data-meeting-code="${m.code}">${icon2("video")}<div class="body"><b>${esc4(m.title)}</b><p>${grouped(m.code)} · ${m.count} 人</p></div><span>进入</span></button>`).join("") || '<div class="empty-list">暂无进行中的会议</div>';
      }).catch((e) => toast2(e.message));
    }
    function openCreate(cid = "", mode = "video") {
      if (room) {
        show();
        return;
      }
      modal2(mode === "audio" ? "发起语音通话" : "发起会议", `<label>会议名称</label><input id="meeting-title" maxlength="60" value="${esc4(mode === "audio" ? S2.user.name + "的语音通话" : S2.user.name + "的会议")}"><p class="hint">${cid ? "将邀请当前会话成员加入。" : "创建后可邀请好友，或分享会议号。"}最多 ${S2.policy.meetingMaxParticipants || 8} 人，最长 ${S2.policy.meetingDurationMinutes || 120} 分钟。</p><label class="check-row"><input type="checkbox" id="meeting-mic" checked>入会时开启麦克风</label><label class="check-row"><input type="checkbox" id="meeting-camera" >入会时开启摄像头</label>`, `<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-create-submit">立即开始</button>`);
      el("meeting-create-submit").onclick = async () => {
        const button = el("meeting-create-submit");
        button.disabled = true;
        const mic = el("meeting-mic").checked, cam = el("meeting-camera").checked;
        try {
          const m = await action2("/api/meetings", { title: el("meeting-title").value, conversationId: cid });
          await join(m.code, mic, cam, true);
        } catch (e) {
          toast2(e.message);
        } finally {
          button.disabled = false;
        }
      };
    }
    function openJoin(code = "") {
      if (room) {
        show();
        return;
      }
      modal2("加入会议", `<label>会议链接或会议号</label><input id="meeting-code" maxlength="1000" placeholder="粘贴会议邀请链接或输入 9 位会议号" value="${esc4(code)}"><label class="check-row"><input type="checkbox" id="meeting-mic" checked>开启麦克风</label><label class="check-row"><input type="checkbox" id="meeting-camera">开启摄像头</label>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-join-submit">加入会议</button>');
      el("meeting-join-submit").onclick = async () => {
        const b = el("meeting-join-submit");
        b.disabled = true;
        try {
          await join(parseInvitation(el("meeting-code").value), el("meeting-mic").checked, el("meeting-camera").checked);
        } catch (e) {
          toast2(e.message);
        } finally {
          b.disabled = false;
        }
      };
    }
    async function initialMedia(mic, cam) {
      if (!mic && !cam) return new MediaStream();
      if (!navigator.mediaDevices?.getUserMedia) throw Error("当前系统缺少音视频组件");
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: mic ? { echoCancellation: true, noiseSuppression: true } : false, video: cam ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } : false });
      } catch (e) {
        toast2("设备未开启，可在会议中重新启用：" + e.message);
        return new MediaStream();
      }
    }
    async function join(code, mic = false, cam = false, host = false, call = null) {
      if (!/^[1-9]\d{8}$/.test(code)) throw Error("请输入 9 位会议号");
      if (room) {
        if (call && room.call?.id !== call.id) throw Error("请先结束当前会议");
        show();
        return;
      }
      if (!call) await api2("/api/meetings/" + code);
      const joiningToken = S2.token, rtc = await api2("/api/rtc-config");
      if (joiningToken !== S2.token || !S2.user || call && !callCurrent(call.id)) return;
      if (call && window.WeLinkAndroid?.openCall) {
        nativeCall = call.id;
        window.WeLinkAndroid.openCall(code, S2.token, S2.user.name, call.id, call.peer.name, call.mode, JSON.stringify(rtc));
        return;
      }
      if (window.WeLinkAndroid?.openMeeting) {
        window.WeLinkAndroid.openMeeting(code, S2.token, S2.user.name, host, mic, cam, S2.config.server, JSON.stringify(rtc));
        closeModal2();
        return;
      }
      const owner2 = S2.token, stream = await initialMedia(mic, cam);
      if (owner2 !== S2.token || !S2.user || call && !callCurrent(call.id)) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (call && !stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("未获得麦克风权限，请检查权限后重试");
      }
      const signalProtocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${signalProtocol}//${location.host}/api/meetings/${code}/ws`);
      room = { code, ws, stream, call, rtc, id: "", host: "", states: /* @__PURE__ */ new Map(), peers: /* @__PURE__ */ new Map(), tiles: /* @__PURE__ */ new Map(), screen: null, recording: null, ping: null, started: Date.now(), intentional: false };
      const active = room;
      renderRoom();
      if (call) {
        root().classList.add("call-mode");
        root().classList.toggle("call-audio", call.mode === "audio");
        root().querySelector(".meeting-top b").textContent = (call.mode === "video" ? "视频通话 · " : "语音通话 · ") + call.peer.name;
        el("meeting-leave").querySelector("span").textContent = "挂断";
        el("meeting-leave").title = "挂断";
        el("meeting-restore").textContent = "返回通话";
        el("meeting-mini-leave").textContent = "挂断";
        el("meeting-mini-leave").title = "挂断";
        el("meeting-network").textContent = "正在接通…";
        tile(call.peer.id, call.peer.name, null);
        active.callClock = setInterval(() => {
          if (room === active && call.started) renderConnection(active);
        }, 1e3);
      }
      closeModal2();
      ws.onmessage = (event) => {
        if (room !== active) return;
        let m;
        try {
          m = JSON.parse(event.data);
        } catch {
          return;
        }
        receive(m).catch((e) => toast2("会议信令处理失败：" + e.message));
      };
      ws.onopen = () => {
        active.ping = setInterval(() => send({ type: "ping" }), 2e4);
      };
      ws.onclose = () => {
        if (room === active) {
          const reason = active.id ? "会议连接已断开" : "无法入会，请核对会议号、等待主持人入会或检查是否已满";
          cleanup(active);
          if (!active.intentional) toast2(reason);
        }
      };
    }
    function renderConnection(active) {
      if (room !== active || !el("meeting-network")) return;
      for (const p of active.peers.values()) tuneMeetingPeer(p, !!active.screen, active.peers.size);
      const paths2 = [...active.peers.values()].map((p) => p.route.path);
      let label = paths2.includes("中转连接") ? "中转连接" : paths2.length && paths2.every((p) => p === "P2P 直连") ? "P2P 直连" : paths2.find((p) => p !== "P2P 直连") || "等待其他成员";
      if (active.call?.started) label = formatDuration((Date.now() - active.call.started) / 1e3) + " · " + label;
      const rtt = Math.max(-1, ...[...active.peers.values()].map((p) => p.route.rtt));
      const node = el("meeting-network");
      node.textContent = label + (rtt >= 0 ? " · " + rtt + " ms" : "");
      node.dataset.state = paths2.some((p) => /未成功|阻止|不稳定/.test(p)) ? "bad" : paths2.length && paths2.every((p) => p === "P2P 直连" || p === "中转连接") ? "good" : "wait";
      if (!active.blockedNotice && [...active.peers.values()].some((p) => p.route.blocked)) {
        active.blockedNotice = true;
        toast2(active.rtc?.relayEnabled === false ? "本机网络策略禁止 WebRTC 直连，且服务器未开启中转，无法建立音视频连接。请联系管理员开启中转服务。" : "本机网络策略禁止直连，已自动切换到加密中转。");
      }
    }
    function renderRoom() {
      root().innerHTML = `<section class="meeting-room"><header class="meeting-top"><b>${APP_NAME} 会议</b><button id="meeting-copy" title="复制邀请链接和会议号">${grouped(room.code)} ${icon2("copy")}</button><span id="meeting-network">正在连接…</span><button id="meeting-minimize" title="最小化会议" aria-label="最小化会议">${icon2("minus")}</button></header><button id="meeting-restore">返回会议</button><button id="meeting-mini-leave" title="离开会议">离开</button><div class="meeting-content"><div id="meeting-grid" class="meeting-grid"></div><aside class="meeting-members"><h3>成员 <span id="meeting-count"></span></h3><div id="meeting-members-list"></div><button class="secondary" id="meeting-invite">邀请好友</button><p class="meeting-record-indicator hidden" id="meeting-recording">● 主持人正在录制</p></aside></div><footer class="meeting-tools"><div class="meeting-tool-group"><button id="meeting-audio" title="麦克风">${icon2("mic")}<span>麦克风</span></button><button id="meeting-video" title="摄像头">${icon2("video")}<span>摄像头</span></button><button id="meeting-share" title="共享屏幕">${icon2("monitor")}<span>共享屏幕</span></button><button id="meeting-record" title="录制">${icon2("record")}<span>录制</span></button><button id="meeting-captions-btn" title="字幕：把你的发言转成文字，会议结束后生成纪要">${icon2("notebook")}<span>字幕</span></button><button id="meeting-fullscreen" title="全屏">${icon2("maximize")}<span>全屏</span></button></div><button id="meeting-leave" class="meeting-leave" title="离开会议">${icon2("phone")}<span>离开会议</span></button><button id="meeting-end" class="meeting-end" title="结束会议"><span>结束会议</span></button></footer></section>`;
      el("meeting-copy").onclick = () => {
        if (root().classList.contains("meeting-minimized")) {
          show();
          return;
        }
        copyInvitation(room.code);
      };
      el("meeting-minimize").onclick = minimize;
      el("meeting-restore").onclick = show;
      el("meeting-mini-leave").onclick = () => leave(false);
      for (const [id, fn] of [["meeting-audio", () => toggle("audio")], ["meeting-video", () => toggle("video")], ["meeting-share", share], ["meeting-record", record]]) el(id).onclick = () => fn().catch((e) => toast2(e.message));
      el("meeting-fullscreen").onclick = display2.toggle;
      {
        const active = room;
        if (active && !active.captions) {
          active.captions = createCaptions({ send, toast: toast2, esc: esc4, api: (p, o) => api2(p, o), code: () => active.code, stream: () => active.stream, box: () => {
            let b = document.getElementById("meeting-captions");
            const host = document.querySelector("#meeting-layer .meeting-room");
            if (!b && host) {
              b = document.createElement("div");
              b.id = "meeting-captions";
              b.className = "meeting-captions hidden";
              host.append(b);
            }
            return b;
          } });
        }
        const cb = el("meeting-captions-btn");
        if (cb) cb.onclick = () => {
          if (!room?.captions) return;
          cb.classList.toggle("on", room.captions.toggle());
        };
      }
      const meter = document.createElement("div");
      meter.id = "meeting-mic-level";
      meter.className = "microphone-level";
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", "麦克风输入音量");
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-valuenow", "0");
      meter.innerHTML = "<i></i>".repeat(7);
      el("meeting-audio").append(meter);
      startMicrophoneMeter(room);
      el("meeting-invite").onclick = invite;
      el("meeting-leave").onclick = () => leave(false);
      el("meeting-end").onclick = () => leave(true);
      updateButtons();
    }
    function startMicrophoneMeter(active) {
      if (room !== active) return;
      const track = active.stream.getAudioTracks()[0];
      if (active.microphoneMeter?.track === track) return;
      active.microphoneMeter?.close();
      active.microphoneMeter = microphoneMeter(track, el("meeting-mic-level"));
    }
    function show() {
      if (room) root().classList.remove("meeting-minimized");
      else openJoin();
    }
    function tile(id, name, stream, self = false) {
      let n = room.tiles.get(id);
      if (!n) {
        n = document.createElement("div");
        n.className = "meeting-tile";
        n.innerHTML = `<video autoplay playsinline></video><div class="meeting-person"></div><div class="meeting-sharing-status">正在共享屏幕<br><small>本机不回显共享画面</small></div><div class="meeting-tile-label"></div><button class="meeting-tile-full" title="全屏观看共享屏幕">${icon2("maximize")}<span>全屏</span></button>`;
        n.querySelector(".meeting-tile-full").onclick = (e) => {
          e.stopPropagation();
          toggleScreenFocus(id);
        };
        n.ondblclick = () => {
          if (n.classList.contains("is-screen") && !n.classList.contains("meeting-self")) toggleScreenFocus(id);
        };
        room.tiles.set(id, n);
        el("meeting-grid").append(n);
        n.classList.toggle("meeting-self", self);
      }
      ;
      const v = n.querySelector("video");
      v.muted = self;
      if (stream && v.srcObject !== stream) {
        v.srcObject = stream;
        v.play().catch(() => {
        });
      }
      ;
      const person = n.querySelector(".meeting-person"), key = id + "|" + (name || "");
      if (person.dataset.key !== key) {
        person.dataset.key = key;
        person.innerHTML = personHTML(id, name);
      }
      n.querySelector(".meeting-tile-label").textContent = (self ? "我 · " : "") + name;
      return n;
    }
    function applyScreenFocus() {
      if (!room) return;
      for (const [id, n] of room.tiles) {
        const on = id === room.focus;
        n.classList.toggle("meeting-focus", on);
        const b = n.querySelector(".meeting-tile-full");
        if (b) {
          b.querySelector("span").textContent = on ? "退出全屏" : "全屏";
          b.title = on ? "退出全屏（Esc）" : "全屏观看共享屏幕";
        }
      }
      root().classList.toggle("screen-focus", !!room.focus);
    }
    function unfocusScreen() {
      if (!room) return;
      room.focus = "";
      room.focusFull = false;
      applyScreenFocus();
    }
    async function toggleScreenFocus(id) {
      const active = room;
      if (!active) return;
      if (active.focus === id) {
        const leave2 = active.focusFull;
        unfocusScreen();
        if (leave2 && display2.full()) await display2.exit();
        return;
      }
      active.focus = id;
      applyScreenFocus();
      active.focusFull = !display2.full();
      if (active.focusFull) await display2.toggle();
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && room?.focus && !display2.full()) {
        e.preventDefault();
        unfocusScreen();
      }
    });
    function renderMembers() {
      if (!room) return;
      el("meeting-count").textContent = room.states.size;
      const columns = room.states.size <= 2 ? room.states.size : room.states.size <= 4 ? 2 : 3;
      el("meeting-grid").style.gridTemplateColumns = `repeat(${innerWidth <= 700 ? 1 : columns},minmax(0,1fr))`;
      el("meeting-grid").style.gridTemplateRows = `repeat(${Math.ceil(room.states.size / (innerWidth <= 700 ? 1 : columns))},minmax(0,1fr))`;
      el("meeting-members-list").innerHTML = [...room.states.entries()].map(([id, p]) => `<div class="meeting-member"><b>${esc4(p.name)}${id === room.id ? "（我）" : ""}</b><small>${id === room.host ? "主持人 · " : ""}${p.microphone ? "麦克风开启" : "已静音"}</small>${room.id === room.host && id !== room.id ? `<div><button data-meeting-mute="${id}">静音</button><button data-meeting-transfer="${id}">设为主持人</button><button data-meeting-kick="${id}">移出</button></div>` : ""}</div>`).join("");
      for (const [id, p] of room.states) {
        const n = room.tiles.get(id);
        if (n) {
          n.classList.toggle("has-video", !(id === room.id && p.screen) && (!!p.camera || !!p.screen));
          n.classList.toggle("is-screen", !!p.screen);
          n.classList.toggle("sharing-local", id === room.id && !!p.screen);
        }
      }
      if (room.focus && !room.states.get(room.focus)?.screen) {
        unfocusScreen();
        display2.exit().catch(() => {
        });
      }
      el("meeting-recording").classList.toggle("hidden", ![...room.states.values()].some((p) => p.recording));
      el("meeting-members-list").onclick = (e) => {
        for (const type of ["mute", "transfer", "kick"]) {
          const b = e.target.closest(`[data-meeting-${type}]`);
          if (b) send({ type, to: b.getAttribute(`data-meeting-${type}`) });
        }
      };
    }
    function setToolIcon(button, name) {
      const svg = button.querySelector("svg");
      if (svg && button.dataset.icon !== name) {
        button.dataset.icon = name;
        svg.outerHTML = icon2(name);
      }
    }
    function updateButtons() {
      if (!room) return;
      const local = room.states.get(room.id), host = room.id && room.id === room.host;
      el("meeting-audio").classList.toggle("on", !!local?.microphone);
      el("meeting-video").classList.toggle("on", !!local?.camera);
      el("meeting-audio").classList.toggle("off", !local?.microphone);
      el("meeting-video").classList.toggle("off", !local?.camera);
      setToolIcon(el("meeting-audio"), local?.microphone ? "mic" : "mic-off");
      setToolIcon(el("meeting-video"), local?.camera ? "video" : "video-off");
      el("meeting-audio").querySelector("span").textContent = local?.microphone ? "静音" : "解除静音";
      el("meeting-video").querySelector("span").textContent = local?.camera ? "关闭视频" : "开启视频";
      el("meeting-share").title = host ? "共享屏幕" : "仅主持人可共享屏幕";
      el("meeting-record").title = host ? "录制" : "仅主持人可录制";
      el("meeting-share").disabled = !host;
      el("meeting-record").disabled = !host;
      el("meeting-share").classList.toggle("on", !!room.screen);
      el("meeting-record").classList.toggle("on", !!room.recording);
      el("meeting-end").classList.toggle("hidden", !host);
    }
    function peer(id) {
      if (room.peers.has(id)) return room.peers.get(id);
      const active = room, pc = new RTCPeerConnection({ iceServers: directIceServers(active.rtc), iceTransportPolicy: "all", bundlePolicy: "max-bundle" }), entry = { id, pc, makingOffer: false, queue: [], ignore: false, signals: Promise.resolve(), pendingSignals: 0, needsOffer: false, localOffer: null };
      room.peers.set(id, entry);
      entry.route = directFirstICE(pc, active.rtc, { alive: () => room === active && active.peers.get(id) === entry, changed: () => renderConnection(active), negotiate: () => offer(entry) });
      for (const track of room.stream.getAudioTracks()) pc.addTrack(track, room.stream);
      const video = room.screen?.getVideoTracks()[0] || room.stream.getVideoTracks()[0];
      if (video) pc.addTrack(video, room.screen || room.stream);
      if (!room.stream.getAudioTracks().length) pc.addTransceiver("audio", { direction: "recvonly" });
      if (!video) pc.addTransceiver("video", { direction: "recvonly" });
      pc.onicecandidate = (e) => {
        if (e.candidate && room === active) send({ type: "signal", to: id, signal: "candidate", candidate: JSON.stringify(e.candidate.toJSON()) });
      };
      pc.ontrack = (e) => {
        lowLatencyReceiver(e.receiver);
        if (room !== active) return;
        const p = room.states.get(id);
        let stream = e.streams[0];
        if (!stream) {
          stream = new MediaStream();
          stream.addTrack(e.track);
        }
        tile(id, p?.name || "参会者", stream);
        renderMembers();
      };
      pc.onnegotiationneeded = () => offer(entry).catch((e) => toast2(e.message));
      const connectionChanged = () => {
        if (room !== active) return;
        if (active.call && (pc.connectionState === "connected" || ["connected", "completed"].includes(pc.iceConnectionState))) send({ type: "call-connected" });
        entry.route.update();
        renderConnection(active);
      };
      pc.onconnectionstatechange = connectionChanged;
      pc.oniceconnectionstatechange = connectionChanged;
      return entry;
    }
    async function offer(p) {
      const active = room;
      if (!active || active.peers.get(p.id) !== p) return;
      if (p.pendingSignals) {
        p.needsOffer = true;
        return;
      }
      if (p.makingOffer || p.pc.signalingState !== "stable") return;
      p.needsOffer = false;
      const epoch = p.offerEpoch = (p.offerEpoch || 0) + 1, live = () => room === active && active.peers.get(p.id) === p && p.offerEpoch === epoch;
      let setting = null;
      try {
        p.makingOffer = true;
        const description = await p.pc.createOffer();
        if (!live()) return;
        setting = p.localOffer = p.pc.setLocalDescription(description);
        await setting;
        if (live()) send({ type: "signal", to: p.id, signal: "offer", sdp: p.pc.localDescription.sdp });
      } catch (error) {
        if (live()) throw error;
      } finally {
        if (p.localOffer === setting) p.localOffer = null;
        if (p.offerEpoch === epoch) p.makingOffer = false;
      }
    }
    function signal(active, p, m) {
      const live = () => room === active && active.peers.get(p.id) === p;
      p.pendingSignals++;
      const task = p.signals.then(async () => {
        try {
          if (live()) await receiveSignal(active, p, m, live);
        } catch (error) {
          if (live()) throw error;
        } finally {
          p.pendingSignals--;
          if (!p.pendingSignals && p.needsOffer && live()) offer(p).catch((e) => toast2(e.message));
        }
      });
      p.signals = task.catch(() => {
      });
      return task;
    }
    async function receiveSignal(active, p, m, live) {
      const pc = p.pc;
      if (m.signal === "candidate") {
        if (p.ignore) return;
        const c = JSON.parse(m.candidate);
        if (pc.remoteDescription) await pc.addIceCandidate(c);
        else if (p.queue.length < 64) p.queue.push(c);
        return;
      }
      const collision = m.signal === "offer" && (p.makingOffer || pc.signalingState !== "stable"), polite = active.id > m.from;
      p.ignore = !polite && collision;
      if (p.ignore) {
        p.queue.length = 0;
        return;
      }
      if (collision) {
        p.offerEpoch = (p.offerEpoch || 0) + 1;
        p.makingOffer = false;
        if (p.localOffer) await p.localOffer.catch(() => {
        });
        if (!live()) return;
        if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
        if (!live()) return;
      }
      await pc.setRemoteDescription({ type: m.signal, sdp: m.sdp });
      if (!live()) return;
      for (const c of p.queue.splice(0)) {
        await pc.addIceCandidate(c);
        if (!live()) return;
      }
      if (m.signal === "offer") {
        const answer = await pc.createAnswer();
        if (!live()) return;
        await pc.setLocalDescription(answer);
        if (live()) send({ type: "signal", to: p.id, signal: "answer", sdp: pc.localDescription.sdp });
      }
    }
    async function receive(m) {
      if (!room) return;
      if (m.type === "call-state" && room.call) {
        room.call.started = m.started || 0;
        return;
      }
      if (m.type === "welcome") {
        const active = room;
        room.id = m.id;
        room.host = m.host;
        room.states.set(m.id, { name: S2.user.name });
        tile(m.id, S2.user.name, room.stream, true);
        for (const p of m.peers || []) {
          room.states.set(p.id, p);
          tile(p.id, p.name);
          await offer(peer(p.id));
          if (room !== active) return;
        }
        if (!room.peers.size) el("meeting-network").textContent = room.call ? "正在接通…" : "等待其他成员加入";
        else renderConnection(active);
        state();
        return;
      }
      if (m.type === "peer-joined") {
        room.states.set(m.id, { name: m.name });
        tile(m.id, m.name);
        renderMembers();
        state();
        return;
      }
      if (m.type === "peer-left") {
        room.peers.get(m.id)?.route.close();
        room.peers.get(m.id)?.pc.close();
        room.peers.delete(m.id);
        room.tiles.get(m.id)?.remove();
        room.tiles.delete(m.id);
        room.states.delete(m.id);
        renderMembers();
        if (!room.peers.size && !room.call) el("meeting-network").textContent = "等待其他成员加入";
        else renderConnection(room);
        return;
      }
      if (m.type === "state") {
        const p = room.states.get(m.id);
        if (p) Object.assign(p, { microphone: !!m.microphone, camera: !!m.camera, screen: !!m.screen, recording: !!m.recording });
        renderMembers();
        return;
      }
      if (m.type === "host") {
        room.host = m.host;
        if (room.id !== room.host) {
          await stopSharing();
          stopRecording();
        }
        updateButtons();
        renderMembers();
        return;
      }
      if (m.type === "mute") {
        room.stream.getAudioTracks().forEach((t) => t.enabled = false);
        state();
        toast2("主持人已将你的麦克风静音");
        return;
      }
      if (m.type === "ended") {
        const active = room;
        active.intentional = true;
        cleanup(active);
        toast2(m.message || "会议已结束");
        return;
      }
      if (m.type === "caption") {
        room.captions?.show(m);
        return;
      }
      if (m.type === "signal") return signal(room, peer(m.from), m);
    }
    async function toggle(kind) {
      const active = room;
      if (!active) return;
      active.pendingMedia ??= /* @__PURE__ */ new Set();
      if (active.pendingMedia.has(kind)) return;
      active.pendingMedia.add(kind);
      try {
        const tracks = kind === "audio" ? active.stream.getAudioTracks() : active.stream.getVideoTracks();
        if (tracks.length) tracks.forEach((t) => t.enabled = !t.enabled);
        else {
          const stream = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio: { echoCancellation: true } } : { video: true });
          if (room !== active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          for (const t of stream.getTracks()) {
            active.stream.addTrack(t);
            for (const p of active.peers.values()) {
              if (room !== active) return;
              if (kind === "video" && active.screen) continue;
              const sender = p.pc.getSenders().find((s) => s.track?.kind === kind);
              if (sender) await sender.replaceTrack(t);
              else p.pc.addTrack(t, active.stream);
            }
          }
        }
        if (room !== active) return;
        if (!active.screen) tile(active.id, S2.user.name, active.stream, true);
        state();
      } finally {
        active.pendingMedia.delete(kind);
      }
    }
    async function replaceVideo(track, stream) {
      for (const p of room.peers.values()) {
        const transceiver = p.pc.getTransceivers().find((t) => t.sender.track?.kind === "video" || t.receiver.track?.kind === "video");
        if (transceiver) {
          if (track && transceiver.direction === "recvonly") transceiver.direction = "sendrecv";
          await transceiver.sender.replaceTrack(track);
        } else if (track) p.pc.addTrack(track, stream);
        p.tuningKey = "";
        await tuneMeetingPeer(p, !!room.screen, room.peers.size);
      }
    }
    async function nativeScreen() {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 0;
      let alive = true, painted = 0;
      const first = new Promise((resolve, reject) => {
        runRemoteFrames(canvas, () => alive, () => {
          painted = Date.now();
          resolve();
        }, (error) => {
          if (alive) reject(error);
        }, "/local/screen/tiles").catch(reject);
      });
      try {
        await Promise.race([first, new Promise((_, reject) => setTimeout(() => reject(Error("无法共享屏幕，请稍后重试")), 8e3))]);
      } catch (e) {
        alive = false;
        throw e;
      }
      const stream = canvas.captureStream(30), track = stream.getVideoTracks()[0], stop = track.stop.bind(track), ctx = canvas.getContext("2d", { alpha: false });
      const keep = setInterval(() => {
        if (Date.now() - painted < 1e3 || !canvas.width) return;
        try {
          ctx.putImageData(ctx.getImageData(0, 0, 1, 1), 0, 0);
          painted = Date.now();
        } catch {
        }
      }, 500);
      track.stop = () => {
        alive = false;
        clearInterval(keep);
        stop();
      };
      return stream;
    }
    async function share() {
      const active = room;
      if (!active || active.id !== active.host || active.sharePending) return;
      if (active.screen) {
        await stopSharing();
        return;
      }
      const native = S2.config?.platform === "windows" && !window.WeLinkAndroid;
      if (!native && !navigator.mediaDevices?.getDisplayMedia) throw Error("当前系统不支持屏幕共享");
      active.sharePending = true;
      el("meeting-share").disabled = true;
      try {
        const screen = native ? await nativeScreen() : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, resizeMode: "none" }, audio: false, selfBrowserSurface: "exclude" });
        const shared = screen.getVideoTracks()[0];
        if (shared && "contentHint" in shared) shared.contentHint = "text";
        if (room !== active || active.id !== active.host) {
          screen.getTracks().forEach((t) => t.stop());
          return;
        }
        active.screen = screen;
        screen.getVideoTracks()[0].onended = () => {
          if (room === active) stopSharing().catch((e) => toast2(e.message));
        };
        try {
          await replaceVideo(screen.getVideoTracks()[0], screen);
        } catch (e) {
          await stopSharing();
          throw e;
        }
        if (room !== active) return;
        tile(active.id, S2.user.name, active.stream, true);
        state();
        toast2("正在共享屏幕，本机已关闭共享画面回显");
      } catch (e) {
        if (e.name !== "NotAllowedError" && e.name !== "AbortError") throw e;
      } finally {
        active.sharePending = false;
        if (room === active) updateButtons();
      }
    }
    async function stopSharing() {
      if (!room?.screen) return;
      const active = room, screen = active.screen;
      active.screen = null;
      screen.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      await replaceVideo(active.stream.getVideoTracks()[0] || null, active.stream);
      if (room !== active) return;
      tile(active.id, S2.user.name, active.stream, true);
      state();
    }
    async function record() {
      if (!room || room.id !== room.host) return;
      if (room.recording) {
        stopRecording();
        return;
      }
      if (typeof MediaRecorder === "undefined") throw Error("当前系统不支持录制");
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d"), stream = canvas.captureStream(15), audio = new AudioContext(), destination = audio.createMediaStreamDestination(), sources = [];
      for (const n of room.tiles.values()) {
        const media = n.querySelector("video").srcObject;
        if (media?.getAudioTracks().length) {
          const source = audio.createMediaStreamSource(media);
          source.connect(destination);
          sources.push(source);
        }
      }
      stream.addTrack(destination.stream.getAudioTracks()[0]);
      const mime = ["video/webm;codecs=vp8,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x)), recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : void 0), capture = { recorder, stream, audio, sources, chunks: [], timer: null, code: room.code };
      room.recording = capture;
      capture.timer = setInterval(() => {
        if (!room) return;
        const tiles = [...room.tiles.values()], cols = Math.ceil(Math.sqrt(tiles.length)), rows = Math.ceil(tiles.length / cols), w = 1280 / cols, h = 720 / rows;
        ctx.fillStyle = "#f5f6f7";
        ctx.fillRect(0, 0, 1280, 720);
        tiles.forEach((n, i) => {
          try {
            ctx.drawImage(n.querySelector("video"), i % cols * w, Math.floor(i / cols) * h, w, h);
          } catch {
          }
          ctx.fillStyle = "#22262b";
          ctx.font = "20px sans-serif";
          ctx.fillText(n.querySelector(".meeting-tile-label").textContent, i % cols * w + 12, (Math.floor(i / cols) + 1) * h - 18);
        });
      }, 67);
      recorder.ondataavailable = (e) => {
        if (e.data.size) capture.chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(capture.chunks, { type: mime || "video/webm" }), a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `LinkMe-会议-${capture.code}-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3e4);
        stream.getTracks().forEach((t) => t.stop());
        sources.forEach((s) => s.disconnect());
        audio.close();
      };
      recorder.start(1e3);
      state();
    }
    function stopRecording() {
      if (!room?.recording) return;
      const r = room.recording;
      room.recording = null;
      clearInterval(r.timer);
      if (r.recorder.state !== "inactive") r.recorder.stop();
      state();
    }
    function invite() {
      const active = room;
      if (!active) return;
      modal2("邀请好友入会", '<p class="hint">会议号：' + grouped(active.code) + '</p><button class="secondary" id="meeting-copy-invitation">复制邀请链接和会议号</button><label for="meeting-invite-search">搜索姓名或 6 位账号</label><input id="meeting-invite-search" placeholder="搜索用户"><div id="meeting-invite-results" class="member-select"></div>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-send-invites">发送邀请</button>');
      const panel = el("meeting-invite-results"), selected = /* @__PURE__ */ new Map();
      let version = 0, timer;
      const valid = () => room === active && panel.isConnected;
      function render(users) {
        if (!valid()) return;
        const found = new Map([...selected, ...users.filter((u) => u.id !== S2.user.id && !active.states.has(u.id)).map((u) => [u.id, u])]);
        panel.innerHTML = [...found.values()].map((u) => '<label class="check-row">' + esc4(u.remark || u.name) + " · " + esc4(u.number) + '<input type="checkbox" value="' + u.id + '" name="meeting-invite-user" ' + (selected.has(u.id) ? "checked" : "") + "></label>").join("") || '<p class="hint">暂无可邀请的联系人，可搜索用户或复制邀请链接。</p>';
        panel.onchange = (e) => {
          const u = found.get(e.target.value);
          if (u) {
            if (e.target.checked) selected.set(u.id, u);
            else selected.delete(u.id);
          }
        };
      }
      render(S2.friends);
      el("meeting-invite-search").oninput = (e) => {
        clearTimeout(timer);
        const q = e.target.value.trim(), v = ++version;
        if (!q) {
          render(S2.friends);
          return;
        }
        timer = setTimeout(async () => {
          try {
            const users = await api2("/api/users?q=" + encodeURIComponent(q));
            if (v === version) render(users);
          } catch (e2) {
            if (valid() && v === version) toast2(e2.message);
          }
        }, 220);
      };
      el("meeting-copy-invitation").onclick = () => copyInvitation(active.code);
      const button = el("meeting-send-invites");
      button.onclick = async () => {
        if (!valid()) return;
        if (!selected.size) {
          el("modal-error").textContent = "请选择要邀请的好友";
          return;
        }
        button.disabled = true;
        try {
          await action2("/api/meetings/" + active.code + "/invite", { members: [...selected.keys()] });
          if (valid()) {
            closeModal2();
            toast2("会议邀请已发送");
          }
        } catch (e) {
          if (valid()) {
            el("modal-error").textContent = e.message;
            button.disabled = false;
          }
        }
      };
    }
    function invitationSound() {
      if (window.WeLinkAndroid) return;
      try {
        const audio = new (window.AudioContext || window.webkitAudioContext)();
        audio.resume().catch(() => {
        });
        for (let i = 0; i < 3; i++) {
          const tone = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * 0.18;
          tone.frequency.value = [523, 659, 784][i];
          gain.gain.setValueAtTime(0.025, at);
          gain.gain.exponentialRampToValueAtTime(1e-3, at + 0.26);
          tone.connect(gain);
          gain.connect(audio.destination);
          tone.start(at);
          tone.stop(at + 0.27);
        }
        setTimeout(() => audio.close(), 1100);
      } catch {
      }
    }
    function dismissInvitation(code, clearNative = true) {
      pending.delete(code);
      document.querySelector('[data-meeting-notice="' + code + '"]')?.remove();
      if (clearNative) window.WeLinkAndroid?.dismissNativeInvite?.("meeting:" + code);
    }
    async function invited(m) {
      if (!S2.user || !/^[1-9]\d{8}$/.test(m.code) || pending.has(m.code)) return;
      const owner2 = S2.token;
      pending.set(m.code, m);
      if (window.welinkMeetingNotify) {
        try {
          const handled = await window.welinkMeetingNotify(m.code, m.title, m.expires || Date.now() + 72e5);
          if (owner2 !== S2.token) {
            window.welinkMeetingClear?.();
            return;
          }
          if (handled) {
            pending.delete(m.code);
            return;
          }
        } catch {
        }
      }
      if (S2.config.platform === "windows" || innerWidth > 700 && !window.WeLinkAndroid) {
        pending.delete(m.code);
        return;
      }
      invitationSound();
      let area = el("meeting-invitations");
      if (!area) {
        area = document.createElement("div");
        area.id = "meeting-invitations";
        document.body.append(area);
      }
      const box = document.createElement("section");
      box.className = "meeting-invitation-notice";
      box.dataset.meetingNotice = m.code;
      box.setAttribute("role", "alert");
      box.innerHTML = `<header><b>${APP_NAME} · 会议邀请</b><button data-meeting-notice-close title="关闭">${icon2("close")}</button></header><h3>${esc4(m.title)}</h3><p>会议号 ${grouped(m.code)}</p><footer><button data-meeting-notice-close>忽略</button><button class="primary" data-meeting-notice-enter>进入会议</button></footer>`;
      area.append(box);
      box.querySelectorAll("[data-meeting-notice-close]").forEach((b) => b.onclick = () => dismissInvitation(m.code));
      box.querySelector("[data-meeting-notice-enter]").onclick = () => nativeAction(m.code, true);
    }
    function ended(m) {
      if (!m?.code) return;
      dismissInvitation(m.code);
      Desktop2?.activity("meeting/" + m.code, false);
    }
    function nativeAction(code, accept) {
      dismissInvitation(code);
      if (accept) openJoin(code);
    }
    function clearInvitations() {
      pending.clear();
      el("meeting-invitations")?.remove();
      window.welinkMeetingClear?.();
    }
    function leave(end) {
      const active = room;
      if (!active) return;
      if (active.call) {
        send({ type: "call-end" });
        active.intentional = true;
        cleanup(active);
        action2("/api/calls/" + active.call.id + "/end").catch(() => {
        });
        return;
      }
      modal2(end ? "结束会议" : "离开会议", '<p class="hint">' + (end ? "结束后所有成员将离开，会议号立即失效。" : "其他成员可继续交流；主持人离开后会自动转交权限。") + "</p>", '<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="meeting-confirm-leave">确认</button>');
      const button = el("meeting-confirm-leave");
      button.onclick = async () => {
        if (room !== active) {
          closeModal2();
          return;
        }
        button.disabled = true;
        try {
          if (end) await action2("/api/meetings/" + active.code + "/end");
          if (room === active) {
            active.intentional = true;
            cleanup(active);
          }
          closeModal2();
        } catch (e) {
          if (button.isConnected) {
            el("modal-error").textContent = e.message;
            button.disabled = false;
          }
        }
      };
    }
    function cleanup(active) {
      active.captions?.stop();
      display2.exit().catch(() => {
      });
      closeModal2();
      if (room === active) {
        stopRecording();
        room = null;
      }
      active.microphoneMeter?.close();
      clearInterval(active.ping);
      clearInterval(active.callClock);
      active.ws.close();
      for (const p of active.peers.values()) {
        p.route.close();
        p.pc.close();
      }
      ;
      active.stream.getTracks().forEach((t) => t.stop());
      active.screen?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      root().innerHTML = "";
      root().classList.remove("meeting-minimized", "call-mode", "call-audio");
      if (active.call) onCallClosed(active.call.id);
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-action]"), a = b?.dataset.action;
      switch (a) {
        case "meeting-create":
          openCreate();
          break;
        case "meeting-start":
          openCreate(S2.active);
          break;
        case "meeting-audio-call":
          openCreate(S2.active, "audio");
          break;
        case "meeting-join":
          openJoin();
          break;
        case "meeting-open":
          show();
          break;
      }
      const m = e.target.closest("[data-meeting-code]");
      if (m) openJoin(m.dataset.meetingCode);
    });
    function formatDuration(value) {
      const n = Math.max(0, Math.floor(value));
      return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
    }
    return { renderHome, openCreate, openJoin, invited, ended, nativeAction, show, busy: () => !!room || !!nativeCall, joinCall: (c) => join(c.code, true, c.mode === "video", c.caller === S2.user.id, c), closedNativeCall: (id) => {
      if (nativeCall === id) nativeCall = null;
    }, closeCall: (id) => {
      if (nativeCall === id) {
        window.WeLinkAndroid?.closeCall?.(id);
        nativeCall = null;
      }
      if (room?.call?.id === id) {
        room.intentional = true;
        cleanup(room);
      }
    }, close: () => {
      clearInvitations();
      if (room) {
        room.intentional = true;
        cleanup(room);
      }
    } };
  }

  // internal/ui/src/updates.js
  function createUpdates({ S: S2, api: api2, action: action2, esc: esc4, toast: toast2 }) {
    let timer, shown = "";
    const supported = () => ["windows", "darwin", "android"].includes(S2.config?.platform);
    async function poll() {
      clearTimeout(timer);
      if (!S2.user || !supported()) return;
      try {
        render(await api2("/local/update"));
      } catch {
      }
      timer = setTimeout(poll, 10 * 60 * 1e3);
    }
    function render(st) {
      let bar = document.getElementById("update-banner");
      if (st.state !== "ready" || !st.latest) {
        bar?.remove();
        shown = "";
        return;
      }
      if (shown === st.latest && bar) return;
      shown = st.latest;
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "update-banner";
        bar.setAttribute("role", "status");
        document.body.append(bar);
      }
      bar.innerHTML = "<span>新版本 " + esc4(st.latest) + " 已下载" + (S2.config.platform === "android" ? "" : "，重启后完成更新") + '</span><button data-update-apply>立即更新</button><button class="dismiss" data-update-later aria-label="稍后">稍后</button>';
    }
    async function apply() {
      const result = await action2("/local/update/apply", {});
      if (result.apk) {
        if (!window.WeLinkAndroid?.installUpdate) throw Error("当前版本不支持应用内安装，请从下载页安装");
        window.WeLinkAndroid.installUpdate(result.apk);
        return;
      }
      if (result.exit) {
        toast2("正在更新，LinkMe 将自动重新打开");
        setTimeout(() => {
          if (window.welinkDesktopExit) window.welinkDesktopExit();
        }, 600);
      }
    }
    async function check(button) {
      if (!supported()) {
        toast2("当前设备不支持自动更新");
        return;
      }
      button && (button.disabled = true);
      try {
        let st = await api2("/local/update?check=1");
        for (let i = 0; i < 20 && st.state === "checking"; i++) {
          await new Promise((r) => setTimeout(r, 500));
          st = await api2("/local/update");
        }
        if (st.state === "downloading") toast2("正在下载新版本 " + st.latest + "，完成后会提示你更新");
        else if (st.state === "ready") render(st);
        else if (st.state === "failed") toast2(st.error || "检查更新失败");
        else toast2("已是最新版本");
        if (st.state === "downloading") setTimeout(poll, 15e3);
      } catch (e) {
        toast2(e.message);
      } finally {
        button && (button.disabled = false);
      }
    }
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-update-apply],[data-update-later],[data-update-check]");
      if (!b) return;
      try {
        if (b.hasAttribute("data-update-later")) document.getElementById("update-banner")?.remove();
        else if (b.hasAttribute("data-update-check")) await check(b);
        else {
          b.disabled = true;
          await apply();
        }
      } catch (err) {
        toast2(err.message);
        b.disabled = false;
      }
    });
    return { start() {
      timer = setTimeout(poll, 30 * 1e3);
    }, stop() {
      clearTimeout(timer);
      document.getElementById("update-banner")?.remove();
      shown = "";
    }, check };
  }

  // internal/ui/src/app.js
  var randomID = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  var $ = (s, r = document) => r.querySelector(s);
  var $$ = (s, r = document) => [...r.querySelectorAll(s)];
  var esc3 = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var paths = { grid: "M4 4h7v7H4ZM13 4h7v7h-7ZM4 13h7v7H4ZM13 13h7v7h-7Z", doc: "M6 2h9l5 5v15H6ZM14 2v6h6M9 13h8M9 17h6", cloud: "M7 18a5 5 0 1 1 .5-9.98A7 7 0 0 1 21 10a4 4 0 0 1-1 8ZM9 14l3-3 3 3M12 11v9", notebook: "M5 3h14v18H5ZM8 3v18M3 7h4M3 12h4M3 17h4M11 8h5M11 12h5", chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 2v-6.5A8.5 8.5 0 1 1 21 11.5ZM8 11h.01M12 11h.01M16 11h.01", contacts: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87", folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18", star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z", monitor: "M3 4h18v13H3ZM8 21h8M12 17v4", settings: "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0", search: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.5-2 5 5", plus: "M12 5v14M5 12h14", more: "M5 12h.01M12 12h.01M19 12h.01", close: "m6 6 12 12M18 6 6 18", minus: "M5 12h14", maximize: "M5 5h14v14H5Z", chevron: "m9 5 7 7-7 7", back: "m15 5-7 7 7 7", down: "m5 9 7 7 7-7", emoji: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 9h.01M16 9h.01M7 14c2 4 8 4 10 0", image: "M3 3h18v18H3ZM3 16l5-5 5 5 3-3 5 5M15 7h.01", file: "M14 2H5v20h14V7ZM14 2v6h5M8 13h8M8 17h6", scissors: "M6 14a4 4 0 1 1-4 4 4 4 0 0 1 4-4ZM6 2a4 4 0 1 1-4 4 4 4 0 0 1 4-4Zm3 7 12 12M9 15 21 3", history: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2", phone: "M4 3h4l2 5-3 2c1 3 4 6 7 7l2-3 5 2v4c-9 3-20-8-17-17Z", video: "M3 5h12v14H3ZM15 9l6-3v12l-6-3", mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM19 11a7 7 0 0 1-14 0M12 18v3M8 21h8", "mic-off": "M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.5V6a3 3 0 0 0-5.9-.8M17 16.9A7 7 0 0 1 5 11M19 11a7 7 0 0 1-.4 2.3M12 18v3M8 21h8", "video-off": "M3 3l18 18M10 5h5v5M15 15v4H3V5h2M15 9l6-3v12l-4-2", record: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", reply: "m9 5-6 6 6 6M3 11h10c5 0 8 3 8 8", trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7", check: "m4 12 5 5L20 6", bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4", mute: "M9 5a6 6 0 0 1 9 5c0 3 1 5 3 7H8M3 3l18 18M6 8c0 6-3 7-3 9h3", pin: "m8 3 8 0-1 7 4 4H5l4-4ZM12 14v8", download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5", logout: "M9 4H4v16h5M9 12h12m-4-4 4 4-4 4", user: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 22v-2a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7v2", shield: "m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6ZM8 12l3 3 5-6", send: "m3 3 19 9-19 9 4-9ZM7 12h15", copy: "M8 8h13v13H8ZM16 8V3H3v13h5", refresh: "M3 11a9 9 0 0 1 15-7l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 7l-3-3M3 21v-5h5", info: "M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" };
  var icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.chat}"/></svg>`;
  var btn = (name, title, action2, extra = "") => `<button class="icon-btn" title="${title}" aria-label="${title}" data-action="${action2}" ${extra}>${icon(name)}</button>`;
  var av = (u = {}, size = "", online = false) => {
    if (u.ai || u.avatar === "bot:me") return '<span class="avatar me-avatar ' + size + '" data-avatar-user="' + esc3(u.id) + '">M</span>';
    const cartoon = cartoonURL(u.avatar), photo = /^image:[a-f0-9]{32}$/.test(u.avatar || "");
    return `<span class="avatar ${photo || cartoon ? "has-photo" : esc3(u.avatar || "blue")} ${size}" ${u.kind !== "group" && (u.sender || u.id) ? 'data-avatar-user="' + esc3(u.sender || u.id) + '"' : ""}>${u.kind === "group" ? icon("contacts") : esc3((u.name || "M").slice(0, 1))}${photo || cartoon ? '<img class="avatar-photo" src="' + (cartoon || "/api/avatars/" + u.avatar.slice(6)) + '" alt="">' : ""}${online && u.online ? '<i class="dot"></i>' : ""}</span>`;
  };
  var logo = () => '<div class="logo"><img src="' + brandIcon() + '" alt=""><b>' + APP_NAME + "</b></div>";
  async function applyBrand(name, iconVersion) {
    const old = APP_NAME;
    setBrand(name, iconVersion);
    document.title = document.title.replace(/^(\(\d+\+?\)\s*)?.*$/, (m, count) => (count || "") + APP_NAME);
    const icon2 = document.querySelector("link[rel~=icon]");
    if (icon2 && customBrandIcon()) icon2.href = customBrandIcon();
    document.querySelectorAll(".logo img").forEach((img) => {
      img.src = brandIcon();
    });
    document.querySelectorAll(".logo b").forEach((b) => {
      b.textContent = APP_NAME;
    });
    if (old !== APP_NAME && !S.user) {
      const root = $("#app");
      if (root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue.includes(old)) node.nodeValue = node.nodeValue.split(old).join(APP_NAME);
        root.querySelectorAll("[placeholder],[aria-label],[alt]").forEach((el) => {
          for (const a of ["placeholder", "aria-label", "alt"]) {
            const v = el.getAttribute(a);
            if (v && v.includes(old)) el.setAttribute(a, v.split(old).join(APP_NAME));
          }
        });
      }
    }
    if (window.welinkBrand) {
      let data = "";
      try {
        if (customBrandIcon()) {
          const bytes2 = new Uint8Array(await (await fetch(customBrandIcon())).arrayBuffer());
          let text = "";
          for (let i = 0; i < bytes2.length; i += 8192) text += String.fromCharCode.apply(null, bytes2.subarray(i, i + 8192));
          data = btoa(text);
        }
      } catch {
      }
      window.welinkBrand(APP_NAME, data);
    }
  }
  var S = { token: localStorage.getItem("welink_token") || "", user: null, config: {}, policy: {}, registrationEnabled: false, tab: "messages", contactTab: "friends", conversations: [], friends: [], requests: [], groupRequests: [], contactGroups: [], myGroups: [], messages: [], active: null, profile: null, search: "", historyMode: false, reply: null, drafts: {}, ws: null, offline: false, cacheView: false, cacheSyncing: false, remote: null, remoteTimer: null, remoteLocal: null };
  var modalHandler = null;
  var refreshTimer = null;
  var toastTimer;
  var searchTimer;
  var typingAt = 0;
  function toast(msg) {
    const n = document.createElement("div");
    n.className = "toast";
    n.textContent = msg;
    $("#toasts").innerHTML = "";
    $("#toasts").appendChild(n);
    setTimeout(() => n.remove(), 3800);
  }
  var phoneLayout = window.matchMedia ? matchMedia("(max-width:700px)") : { matches: false };
  function fitComposer(t) {
    if (!t) return;
    if (!phoneLayout.matches) {
      if (t.style.height) t.style.height = "";
      return;
    }
    t.style.height = "0";
    const border = t.offsetHeight - t.clientHeight;
    t.style.height = Math.min(t.scrollHeight + border, 132) + "px";
  }
  phoneLayout.addEventListener?.("change", () => fitComposer(document.querySelector("#composer")));
  async function api(path, options = {}) {
    const token = S.token, server = S.config.server;
    const value = await Received.run(path, options, () => {
      if (!path.startsWith("/local") && (token !== S.token || server !== S.config.server)) throw Object.assign(Error("登录账号已变化"), { name: "AbortError" });
      return apiNetwork(path, options, token);
    });
    if (!path.startsWith("/local") && (token !== S.token || server !== S.config.server)) throw Object.assign(Error("登录账号已变化"), { name: "AbortError" });
    return value;
  }
  async function apiNetwork(path, options = {}, requestToken = S.token) {
    const headers = { ...options.headers };
    if (requestToken) headers.Authorization = "Bearer " + requestToken;
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    ;
    const r = await fetch(path, { ...options, headers });
    if (requestToken !== S.token && !path.startsWith("/local")) throw Object.assign(Error("登录账号已变化"), { name: "AbortError" });
    if (r.status === 401 && S.user && requestToken === S.token && !path.startsWith("/local")) {
      logout(false);
      throw Object.assign(Error("登录已过期，请重新登录"), { status: 401 });
    }
    ;
    if (!r.ok) {
      let p;
      try {
        p = await r.json();
      } catch {
      }
      throw Object.assign(Error(p?.error || `请求失败 (${r.status})`), { status: r.status });
    }
    ;
    return r.status === 204 ? null : r.json();
  }
  var action = (p, body = {}) => api(p, { method: "POST", body });
  function shortTime(value) {
    const d = new Date(value), today = /* @__PURE__ */ new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const yesterday = new Date(Date.now() - 864e5);
    if (d.toDateString() === yesterday.toDateString()) return "昨天";
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function fullTime(t) {
    return new Date(t).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function preview(m) {
    if (!m) return "开始聊天";
    if (ChatX.preview(m)) return ChatX.preview(m);
    if (m.kind === "text" && !m.recalled && Docs.preview(m.text)) return Docs.preview(m.text);
    if (m.kind === "call" && !m.recalled) return Calls.summary(m);
    if (m.kind === "forward" && !m.recalled) {
      try {
        return "[聊天记录] " + JSON.parse(m.text).title;
      } catch {
        return "[聊天记录]";
      }
    }
    if (m.kind === "meeting" && !m.recalled) {
      try {
        return "[会议] " + JSON.parse(m.text).title;
      } catch {
        return "[会议]";
      }
    }
    return m.recalled ? "消息已撤回" : m.kind === "voice" ? "[语音]" : m.kind === "video" ? "[视频]" : m.kind === "image" ? "[图片]" : m.kind === "file" ? `[文件] ${m.fileName}` : m.text;
  }
  function modal(...args) {
    Navigation.open(...args);
  }
  var modalError = (e) => {
    $("#modal-error") ? $("#modal-error").textContent = e.message : toast(e.message);
  };
  function closeModal() {
    Navigation.clear();
  }
  function finishModal() {
    Navigation.complete();
  }
  var pageHistory = [];
  var NativeNotifications = createNativeNotifications({ S, action, selectConversation, refresh, toast });
  function pageBack() {
    if ($(".remote-screen")) {
      $(".remote-screen [data-action=stop-remote]")?.click();
      return true;
    }
    if (S.tab === "drive" && Cloud.back()) return true;
    if (S.profile && S.tab === "contacts") {
      S.profile = null;
      renderShell();
      return true;
    }
    if (S.active && S.tab === "messages") {
      Media.reset();
      Forwarding.reset(false);
      S.active = null;
      S.messages = [];
      S.reply = null;
      renderShell();
      return true;
    }
    const previous = pageHistory.pop();
    if (previous) {
      Object.assign(S, previous.state);
      renderShell();
      if (previous.settings) settings();
      return true;
    }
    if (S.user && S.tab !== "messages") {
      S.tab = "messages";
      S.search = "";
      S.profile = null;
      renderShell();
      return true;
    }
    return false;
  }
  function navigatePage(button) {
    const tab = button.dataset.nav;
    if (!["messages", "contacts", "work", "meetings", "docs", "drive", "files", "favorites", "profile"].includes(tab)) return;
    if (!button.closest(".rail") && tab !== S.tab) pageHistory.push({ state: { tab: S.tab, active: S.active, profile: S.profile, search: S.search }, settings: $(".modal")?.getAttribute("aria-label") === "设置" });
    else pageHistory.length = 0;
    closeModal();
    S.tab = tab;
    S.search = "";
    S.profile = null;
    renderShell();
  }
  function pageNavigation() {
    return '<header class="utility-navigation' + (!pageHistory.length && ["meetings", "profile", "docs", "work"].includes(S.tab) ? " is-root" : "") + '"><button class="page-back" data-action="page-back">' + icon("back") + "返回" + (pageHistory[pageHistory.length - 1]?.settings ? "设置" : "") + "</button></header>";
  }
  var Navigation = createNavigation({ getHandler: () => modalHandler, setHandler: (value) => {
    modalHandler = value;
  }, beforeOpen: () => window.WeLinkMediaBeforeModal?.(), esc: esc3, icon, onPageBack: () => RemoteDisplay.back() || pageBack(), beforeBack: () => {
    if (S.remote?.state !== "pending" || !$(".remote-invite")) return false;
    (S.remote.requester === S.user?.id ? stopRemote() : acceptRemote(false)).catch(modalError);
    return true;
  } });
  function windows() {
    return S.config.platform === "windows" ? `<div class="window-controls">${btn("minus", "最小化", "window-min")}${btn("maximize", "最大化", "window-max")}${btn("close", "关闭", "window-close")}</div>` : "";
  }
  function renderAuth(register = false) {
    return EmailAuth.render(register ? "register" : "login");
  }
  function nav() {
    const unread = S.conversations.reduce((n, c) => n + (c.muted ? c.mentionCount || 0 : c.unread), 0), requests = S.requests.filter((q) => q.recipient === S.user.id && q.status === "pending").length + S.groupRequests.filter((q) => q.canReview && q.status === "pending").length;
    markUnread(unread);
    return `<aside class="rail"><button class="self" title="个人资料" data-action="profile">${av(S.user, "", true)}</button><nav>${[["messages", "chat", "消息", unread], ["contacts", "contacts", "联系人", requests], ["work", "grid", "工作台", 0], ["meetings", "video", "会议", 0], ["docs", "doc", "文档", 0], ["drive", "cloud", "网盘", 0], ["files", "folder", "文件", 0], ["favorites", "star", "收藏", 0], ["profile", "user", "我的", 0]].map(([tab, i, t, n]) => `<button data-nav="${tab}" class="${S.tab === tab ? "active" : ""}${n ? " has-unread" : ""}" title="${t}${n ? ` · ${n} 条未读` : ""}" aria-label="${t}">${icon(i)}<span class="rail-label">${t}</span>${n ? `<span class="badge">${n > 99 ? "99+" : n}</span>` : ""}</button>`).join("")}</nav><div class="rail-bottom">${btn("settings", "设置", "settings")}${btn("more", "更多", "more-menu")}</div></aside>`;
  }
  function renderShell() {
    const utility = !["messages", "contacts"].includes(S.tab);
    $("#app").innerHTML = `<div class="shell ${S.active && S.tab === "messages" ? "in-chat" : ""} ${utility ? "in-utility" : ""}">${nav()}<aside class="sidebar"><div class="sidebar-resizer" title="拖动调整宽度，双击恢复" aria-hidden="true"></div><div class="mobile-title"><button data-action="profile">${av(S.user)}</button><h2>${S.tab === "contacts" ? "联系人" : "消息"}</h2>${btn("plus", "创建群聊或扫一扫", "add-menu")}</div><div class="searchbar"><label class="searchbox">${icon("search")}<input id="sidebar-search" value="${esc3(S.search)}" placeholder="搜索用户或群聊" aria-label="搜索用户或群聊" maxlength="60"></label>${btn("plus", "创建群聊或扫一扫", "add-menu")}</div><div class="sidebar-connection-status"></div><div id="sidebar-content" class="list-scroll"></div></aside><main class="main">${windows()}<div id="connection-status"></div>${utility ? pageNavigation() : ""}<div id="main-content" style="display:contents"></div></main></div>`;
    renderSidebar();
    renderMain();
    $("#sidebar-search").oninput = (e) => {
      S.search = e.target.value;
      renderSidebar();
    };
    $("#sidebar-search").onkeydown = (e) => {
      if (e.key === "Enter" && !e.isComposing && S.search.trim()) {
        e.preventDefault();
        GlobalSearch.open(S.search.trim());
      }
    };
    connectionState();
  }
  function renderSidebar() {
    const list = $("#sidebar-content");
    if (!list) return;
    try {
      Assistant.changed();
    } catch {
    }
    const q = S.search.toLowerCase();
    if (q.trim()) {
      list.innerHTML = Directory.render(S.search);
      return;
    }
    if (S.tab === "contacts") {
      list.innerHTML = '<button class="notify-row group-notice-row" data-group="requests">' + icon("contacts") + '群通知</button><div class="contact-tab"><button data-contact-tab="friends" class="' + (S.contactTab === "friends" ? "active" : "") + '">联系人</button><button data-contact-tab="groups" class="' + (S.contactTab === "groups" ? "active" : "") + '">群聊</button></div>' + (S.contactTab === "friends" ? Contacts.sidebar() : S.myGroups.map((g) => S.conversations.find((c) => c.id === g.id) || { id: g.id, kind: "group", name: g.name, avatar: g.avatar, group: g, unread: 0 }).map(conversationRow).join("") || '<div class="empty-list">还没有群聊</div>');
      return;
    }
    const result = S.conversations.filter((c) => (c.name + (c.peer?.number || "") + (c.group?.number || "") + (c.last?.text || "")).toLowerCase().includes(q));
    const users = q ? S.friends.filter((u) => (u.name + (u.remark || "") + u.number + u.id + u.account).toLowerCase().includes(q)) : [];
    list.innerHTML = Work.chips() + Me.sidebar() + Work.filter(result).map(conversationRow).join("") + (users.length ? '<div class="search-section-label">搜索用户 · 直接聊天</div>' + users.map((u) => '<div class="user-search-result"><button class="conversation-row" data-start-chat="' + u.id + '">' + av(u, "", true) + '<div class="row-text"><div class="row-title"><b>' + esc3(u.remark || u.name) + '</b></div><div class="row-preview">' + esc3(u.number) + '</div></div></button><div class="user-search-actions"><button data-start-chat="' + u.id + '">发消息</button><button data-user-call="' + u.id + '" data-user-call-mode="audio" title="语音通话" aria-label="语音通话">' + icon("phone") + '</button><button data-user-call="' + u.id + '" data-user-call-mode="video" title="视频通话" aria-label="视频通话">' + icon("video") + "</button></div></div>").join("") : "") + (!result.length && !users.length ? '<div class="empty-list">' + (q ? "没有找到相关用户或会话" : "暂无消息<br>搜索用户，直接开始聊天") + "</div>" : "");
  }
  function conversationRow(c) {
    return `<div class="conversation-item"><button class="conversation-row ${S.active === c.id ? "selected" : ""} ${c.pinned ? "pinned" : ""}" data-conversation="${c.id}">${av(c.kind === "group" ? { name: c.name, kind: "group", avatar: c.avatar || "group" } : c.peer || c, "", c.kind === "direct" && !c.peer?.ai)}<div class="row-text"><div class="row-title"><b>${esc3(c.name)}</b>${c.peer?.ai ? '<em class="ai-label">AI</em>' : ""}${c.kind === "direct" ? Contacts.badge(c.peer) : ""}<time>${c.last ? shortTime(c.last.created) : ""}</time></div><div class="row-preview"><span>${c.mentionCount ? '<i class="mention-unread">[有人@我]</i>' : ""}${esc3(c.kind === "group" && c.last && !c.last.recalled ? `${c.last.name}：` : "")}${esc3(preview(c.last))}</span>${c.muted ? icon("mute") : ""}${c.unread ? `<i class="badge">${c.unread > 99 ? "99+" : c.unread}</i>` : ""}</div></div></button><button type="button" class="conversation-more" data-conversation-menu="${c.id}" aria-label="${esc3(c.name)}的会话操作" title="会话操作">${icon("more")}</button></div>`;
  }
  var typingTimer = 0;
  function presenceState(c) {
    return c?.kind === "direct" && !c.peer?.ai ? c.peer?.online ? "on" : "off" : "";
  }
  function presenceLabel(c) {
    if (c?.kind !== "direct") return "群聊";
    const base = c.peer?.online ? "在线" : "离线", st = c.peer?.ai ? "" : ChatX.statusLabel(c.peer?.id);
    return st ? base + " · " + st : base;
  }
  function showPresence() {
    const c = activeConversation(), el = $("#typing-status");
    if (!c || !el) return;
    if (c.kind !== "direct") {
      Groups.syncComposer();
      return;
    }
    el.textContent = presenceLabel(c);
    el.dataset.presence = presenceState(c);
  }
  function applyPresence(d) {
    if (!d?.userId) return;
    const online = !!d.online;
    for (const u of S.friends || []) if (u.id === d.userId) u.online = online;
    for (const c of S.conversations || []) if (c.kind === "direct" && c.peer?.id === d.userId) c.peer.online = online;
    if (S.profile?.id === d.userId) S.profile.online = online;
    renderSidebar();
    showPresence();
    if (S.tab === "contacts" && S.profile?.id === d.userId) renderMain();
  }
  function activeConversation() {
    return S.conversations.find((c) => c.id === S.active);
  }
  function renderMain() {
    const main = $("#main-content");
    if (!main) return;
    if (S.tab !== "docs" && Docs.isOpen()) Docs.leave();
    if (S.tab === "docs") {
      Docs.render();
      return;
    }
    if (S.tab === "work") {
      Work.render();
      return;
    }
    if (S.tab === "drive") {
      Cloud.renderDrive().catch((e) => toast(e.message));
      return;
    }
    if (S.tab === "contacts") {
      if (S.profile) {
        renderContactProfile();
        return;
      }
      ;
      main.innerHTML = empty("联系人", "找到好友，让联系更简单");
      return;
    }
    ;
    if (S.tab === "files") {
      renderFiles();
      return;
    }
    ;
    if (S.tab === "favorites") {
      renderFavorites();
      return;
    }
    ;
    if (S.tab === "meetings") {
      Meetings.renderHome();
      return;
    }
    ;
    if (S.tab === "profile") {
      renderMyPage();
      return;
    }
    ;
    const c = activeConversation();
    if (!c) {
      main.innerHTML = empty("" + APP_NAME, "每一句，都有回应。", true);
      return;
    }
    ;
    main.innerHTML = `<header class="chat-head">${btn("back", "返回", "back", "").replace('class="icon-btn"', 'class="icon-btn mobile-back"')}<h2>${esc3(c.name)}<small id="typing-status" data-presence="${presenceState(c)}">${presenceLabel(c)}</small></h2><div class="chat-actions">${c.peer?.ai ? "" : c.kind === "direct" ? '<button class="icon-btn" title="语音通话" aria-label="语音通话" data-call-mode="audio">' + icon("phone") + '</button><button class="icon-btn" title="视频通话" aria-label="视频通话" data-call-mode="video">' + icon("video") + "</button>" : btn("phone", "语音通话", "meeting-audio-call") + btn("video", "发起会议", "meeting-start")}${c.kind === "direct" && !c.peer?.ai ? btn("monitor", "远程协助", "remote") : ""}${ChatX.headerButtons(c)}${btn("search", "搜索聊天记录", "search-history")}${btn("more", "聊天设置", "chat-detail")}</div></header><div id="sharing-banner"></div><div id="pinned-bar"></div><div id="unread-summary"></div><div id="me-panel" class="hidden"></div><div id="mention-jump"></div><section class="message-area" id="messages" aria-label="聊天记录"></section><section class="composer" aria-label="消息输入"><div class="reply-draft edit-draft hidden" id="edit-draft"></div><div class="reply-draft hidden" id="reply-draft"></div><div class="attach-draft hidden" id="attach-draft" aria-label="待发送的文件"></div><div class="compose-tools">${Media.tools()}${Mentions.tool()}${btn("emoji", "表情", "emoji")}${btn("image", "发送图片", "image")}<button class="icon-btn" title="发送视频" aria-label="发送视频" data-media="video">${icon("video")}</button>${btn("folder", "发送文件", "file")}${btn("scissors", "截图", "screenshot")}${c.kind === "group" ? ChatX.tools(c) : ""}<span class="spacer"></span></div><textarea id="composer" rows="1" placeholder="" aria-label="输入消息" maxlength="6000">${esc3(S.drafts[c.id] || "")}</textarea>${Media.input()}<div class="compose-bottom"><small>Enter 发送，Shift + Enter 换行</small><button class="send-btn" id="send-message" data-action="send" ${S.drafts[c.id]?.trim() || Attachments.count(c.id) ? "" : "disabled"}>发送</button></div><input type="file" id="image-input" class="file-input" multiple accept="image/png,image/jpeg,image/gif,image/webp"><input type="file" id="file-input" class="file-input" multiple></section>`;
    renderMessages();
    const input = $("#composer");
    fitComposer(input);
    input.oninput = () => {
      fitComposer(input);
      Mentions.changed();
      S.drafts[S.active] = input.value;
      Outbox.saveDraft().catch(() => {
      });
      Attachments.sync();
      if (Date.now() - typingAt > 2500 && S.ws?.readyState === 1) {
        typingAt = Date.now();
        S.ws.send(JSON.stringify({ type: "typing", conversationId: S.active }));
      }
    };
    input.onkeydown = (e) => {
      if (Mentions.key(e)) return;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    };
    input.onpaste = (e) => {
      const files = [...e.clipboardData?.files || []];
      if (!files.length || e.clipboardData.getData("text/plain").trim()) return;
      e.preventDefault();
      Attachments.add(files);
    };
    $("#image-input").onchange = (e) => {
      Attachments.add(e.target.files);
      e.target.value = "";
    };
    $("#file-input").onchange = (e) => {
      Attachments.add(e.target.files);
      e.target.value = "";
    };
    const area = $("#messages");
    renderReply();
    Attachments.render();
    renderSharing();
    Media.mount();
    Groups.syncComposer();
    Contacts.syncComposer();
    Mentions.mount();
    Me.mount();
    ChatX.mount(c);
  }
  function empty(title, sub, add = false) {
    return `<div class="empty-chat"><img src="/assets/icon.svg" alt=""><h2>${title}</h2><p>${sub}</p></div>`;
  }
  function fileURL(id) {
    return "/api/files/" + encodeURIComponent(id);
  }
  function messageHTML(m) {
    if (m.recalled) return `<div class="recalled" data-message="${m.id}">${Forwarding.checkbox(m)}${m.sender === S.user.id ? "你" : esc3(m.name)}撤回了一条消息</div>`;
    const mine = m.sender === S.user.id;
    const quote = S.messages.find((x) => x.id === m.replyId) || m.reply;
    let content = Mentions.text(m);
    const docCard = Docs.card(m);
    if (docCard) content = docCard;
    const xcard = ChatX.card(m);
    if (xcard) content = xcard;
    if (m.kind === "call") content = Calls.card(m);
    if (m.kind === "voice" || m.kind === "video") content = Media.bubble(m);
    if (m.kind === "forward") content = Forwarding.card(m);
    if (m.kind === "meeting") {
      try {
        const meeting = JSON.parse(m.text);
        content = `<button class="file-card" data-meeting-code="${esc3(meeting.code)}">${icon("video")}<span><b>${esc3(meeting.title)}</b><small>会议号 ${esc3(meeting.code)} · 点击加入</small></span></button>`;
      } catch {
      }
    }
    if (m.kind === "image") content = S.offline ? '<div class="file-card">' + icon("image") + "<span><b>" + esc3(m.fileName || "图片") + "</b><small>联网后查看图片</small></span></div>" : `<img src="${fileURL(m.attachmentId)}" alt="${esc3(m.fileName || "图片")}" loading="lazy" data-preview-image="${m.attachmentId}">`;
    if (m.kind === "file") content = `<button class="file-card" data-download="${m.attachmentId}" data-filename="${esc3(m.fileName)}">${icon("file")}<span><b>${esc3(m.fileName)}</b><small>${bytes(m.fileSize)} · 点击下载</small></span></button>`;
    return `<article class="message ${mine ? "mine" : ""}" data-message="${m.id}">${Forwarding.checkbox(m)}${av(m)}<div class="message-body"><span class="message-name">${esc3(m.name || (mine ? S.user.name : activeConversation()?.name) || "" + APP_NAME + " 用户")}</span><div class="bubble ${m.kind === "poll" || m.kind === "chain" ? "card-bubble " : ""}${m.kind === "image" ? "image-bubble" : m.kind === "forward" ? "forward-bubble" : m.kind === "voice" ? "voice-bubble" : m.kind === "video" ? "video-bubble" : ""}">${content}</div>${ChatX.extras(m)}${m.replyId ? `<button class="quote" data-action="jump-message" data-mid="${m.replyId}" title="查看原消息">${quote ? esc3(quote.name + "：" + preview(quote)) : "原消息不可用"}</button>` : ""}<span class="message-time">${shortTime(m.created)}${ChatX.timeTag(m)}${mine ? Receipts.label(m) : ""}</span></div><div class="message-menu">${ChatX.hoverTools(m)}<button class="icon-btn" title="转发" aria-label="转发" data-fw="single" data-mid="${m.id}">${icon("send")}</button>${btn("reply", "引用", "quote", `data-mid="${m.id}"`)}${btn("star", "收藏", "favorite", `data-mid="${m.id}"`)}${mine && Date.now() - m.created < 864e5 ? btn("history", "撤回", "recall", `data-mid="${m.id}"`) : ""}${btn("trash", "删除", "delete-message", `data-mid="${m.id}"`)}${ChatX.moreTool(m)}</div></article>`;
  }
  function renderMessages(keep = false) {
    const area = $("#messages");
    if (!area) return;
    const old = area.scrollTop, near = area.scrollHeight - area.clientHeight - old < 100;
    let last = 0;
    area.innerHTML = (S.messages.length >= 60 ? '<button class="load-more" data-action="load-older">查看更多消息</button>' : "") + S.messages.filter((m) => !m.threadId).map((m) => {
      let date = "";
      if (m.created - last > 3e5) {
        last = m.created;
        date = `<div class="timestamp">${fullTime(m.created)}</div>`;
      }
      return date + messageHTML(m);
    }).join("");
    if (S.historyMode) area.insertAdjacentHTML("beforeend", '<div class="history-live-bar"><button data-action="load-newer">查看后续消息</button><button data-action="latest-messages">返回最新消息</button></div>');
    const pending = Outbox.html(S.active) + Transfers.html(S.active);
    if (!S.messages.length && !pending) area.innerHTML = '<div class="timestamp">' + (S.offline ? "此会话尚无本机缓存，联网后加载消息" : "和好友打个招呼吧") + "</div>";
    area.insertAdjacentHTML("beforeend", pending);
    Forwarding.sync();
    Media.sync();
    if (!keep || near) area.scrollTop = area.scrollHeight;
    else area.scrollTop = old;
    $$("img", area).forEach((img) => img.onload = () => {
      if (!keep || near) area.scrollTop = area.scrollHeight;
    });
  }
  async function selectConversation(id) {
    if (!S.conversations.some((c) => c.id === id)) {
      await action("/api/conversations/" + id + "/open");
      await refresh();
      if (!S.conversations.some((c) => c.id === id)) return;
    }
    Mentions.select(id);
    Media.reset();
    Forwarding.reset(false);
    S.active = id;
    S.historyMode = false;
    S.tab = "messages";
    S.reply = Outbox.replyPlaceholder(id);
    S.messages = [];
    S.profile = null;
    S.search = "";
    renderShell();
    try {
      const m = await api(`/api/conversations/${id}/messages`);
      if (S.active !== id) return;
      S.messages = m;
      renderMessages();
      Receipts.load(id);
      await Outbox.restoreReply(id);
      ChatX.loaded(id);
      await markRead();
      if (innerWidth > 700) $("#composer")?.focus();
    } catch (e) {
      toast(e.message);
    }
  }
  async function markRead() {
    if (S.offline || S.cacheSyncing) return;
    const last = S.messages[S.messages.length - 1];
    if (!last || Desktop.hidden() || S.historyMode || S.tab !== "messages" || !$("#messages")) return;
    await action(`/api/conversations/${S.active}/read`, { seq: last.seq });
    const c = activeConversation();
    if (c) {
      c.unread = 0;
      c.mentionCount = 0;
      c.firstMentionId = "";
    }
    renderSidebar();
    updateRail();
  }
  function updateRail() {
    const old = $(".rail");
    if (old) old.outerHTML = nav();
    Desktop.unread();
  }
  async function sendMessage() {
    if (ChatX.editing()) {
      await ChatX.submitEdit();
      return;
    }
    if (Me.busy()) {
      toast("Me 正在处理，请等待完成或停止任务");
      return;
    }
    const input = $("#composer"), cid = S.active;
    if (!input || input.disabled || !input.value.trim() && !Attachments.count(cid)) return;
    if (Attachments.count(cid)) {
      const items = Attachments.take(cid), owner3 = Outbox.scope();
      try {
        for (const item of items) {
          if (Outbox.scope() !== owner3) return;
          await upload(item.file, false, cid);
        }
      } finally {
        Attachments.release(items);
      }
      if (Outbox.scope() !== owner3 || S.active !== cid || input !== $("#composer")) return;
      if (!input.value.trim()) {
        input.focus();
        return;
      }
    }
    const text = input.value, owner2 = Outbox.scope();
    input.disabled = true;
    try {
      await Outbox.enqueue(cid, { kind: "text", text, mentions: Mentions.payload(), replyId: S.reply?.id || "" }, null, {}, true);
      if (Outbox.scope() !== owner2) return;
      if (S.active === cid && input === $("#composer")) {
        input.value = "";
        fitComposer(input);
        Attachments.sync();
        S.reply = null;
        renderReply();
        renderMessages();
      }
    } catch (e) {
      Mentions.failed();
      toast(e.message);
    } finally {
      if (input.isConnected) {
        input.disabled = false;
        input.focus();
        Groups.syncComposer();
        Contacts.syncComposer();
      }
    }
  }
  function renderReply() {
    const d = $("#reply-draft");
    if (!d) return;
    d.classList.toggle("hidden", !S.reply);
    d.closest(".composer").classList.toggle("has-reply", !!S.reply);
    d.innerHTML = S.reply ? `<span>回复 ${esc3(S.reply.name)}：${esc3(preview(S.reply))}</span>${btn("close", "取消引用", "cancel-reply")}` : "";
  }
  async function upload(file, forceFile = false, cid = S.active) {
    if (cid === S.active && !forceFile && (/^video\//.test(file.type) || /\.(mp4|webm|m4v)$/i.test(file.name))) {
      await Media.sendVideo(file);
      return;
    }
    if (!cid) return;
    try {
      await Outbox.enqueue(cid, { kind: forceFile ? "file" : "auto", text: "" }, file);
    } catch (e) {
      toast(e.message);
    }
  }
  function bytes(n) {
    return n >= 1099511627776 ? (n / 1099511627776).toFixed(1) + " TB" : n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.ceil(n / 1024) + " KB" : n + " B";
  }
  async function refresh(conversationsOnly = false) {
    if (!S.user) return;
    const userId = S.user.id;
    const [conversations, friends, requests, groupRequests, contactGroups, myGroups] = await Promise.all([api("/api/conversations"), conversationsOnly ? S.friends : api("/api/friends"), conversationsOnly ? S.requests : api("/api/requests"), conversationsOnly ? S.groupRequests : api("/api/group-requests"), conversationsOnly ? S.contactGroups : api("/api/contact-groups"), conversationsOnly ? S.myGroups : api("/api/groups?mine=1").catch(() => null)]);
    if (S.user?.id !== userId) return;
    S.conversations = conversations;
    if (!conversationsOnly) {
      S.friends = friends;
      S.requests = requests;
      S.groupRequests = groupRequests;
      S.contactGroups = contactGroups;
      S.myGroups = myGroups || conversations.filter((c) => c.kind === "group").map((c) => ({ id: c.id, name: c.name, ...c.group, joined: true }));
      Directory.changed();
    }
    if (!conversationsOnly && S.profile) {
      const updated = friends.find((u) => u.id === S.profile.id);
      S.profile = updated ? { ...S.profile, ...updated } : null;
      if (S.tab === "contacts") renderMain();
    }
    if (S.active && !conversations.some((c) => c.id === S.active)) {
      Media.reset();
      Forwarding.reset(false);
      S.active = null;
      S.messages = [];
      S.reply = null;
      closeModal();
      renderShell();
    }
    renderSidebar();
    updateRail();
    showPresence();
    Groups.syncComposer();
    Contacts.syncComposer();
  }
  var refreshDirectory = false;
  function queueRefresh(conversationsOnly = false) {
    refreshDirectory = refreshDirectory || !conversationsOnly;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const only = !refreshDirectory;
      refreshDirectory = false;
      refresh(only).catch((e) => {
        if (S.user) toast(e.message);
      });
    }, 200);
  }
  async function enter() {
    await Sounds.ready;
    if (!S.cacheView) await Received.identified(S.user);
    await Promise.all([api("/api/config").then((policy) => {
      S.policy = policy;
    }), refresh()]);
    await Outbox.start();
    renderShell();
    Me.start().catch(() => {
    });
    ChatX.start();
    Work.start();
    Assistant.start();
    Updates.start();
    await NativeNotifications.start().catch(() => toast("消息通知连接暂不可用，正在重试"));
    connectEvents(true);
    Calls.start();
    NativeNotifications.drainInvites();
  }
  function connectEvents(initial = false) {
    if (!S.user) return;
    S.ws?.close();
    const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/ws");
    S.ws = ws;
    ws.onopen = async () => {
      if (S.ws !== ws || !S.user) return;
      const directoryFresh = initial && !S.cacheView && !S.offline;
      S.cacheView = false;
      S.cacheSyncing = true;
      connectionState();
      try {
        await Received.reconcile(api);
        if (S.ws !== ws || !S.user) return;
        await refresh(directoryFresh);
        if (S.active && !S.historyMode) {
          const cid = S.active, ms = await api("/api/conversations/" + cid + "/messages");
          if (S.ws !== ws || !S.user) return;
          if (S.active === cid && !S.historyMode) {
            S.messages = ms;
            renderMessages(true);
            Receipts.load(cid);
          }
        }
        if (S.ws === ws && !S.cacheView) {
          S.offline = false;
          Outbox.kick();
        }
      } catch {
      } finally {
        if (S.ws === ws) {
          S.cacheSyncing = false;
          connectionState();
          markRead().catch(() => {
          });
        }
      }
    };
    ws.onmessage = (e) => {
      if (S.ws !== ws || !S.user || S.signingOut) return;
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      const d = event.data;
      if (event.type === "ai-delta" || event.type === "ai-state") {
        Me.changed(event.type, d);
      } else if (event.type === "call") {
        Calls.changed(d);
      } else if (event.type === "branding") {
        applyBrand(d.name, d.iconVersion).catch(() => {
        });
      } else if (event.type === "drive") {
        Cloud.changed(event.type);
      } else if (event.type === "call-history") {
        Calls.historyChanged();
      } else if (event.type === "message") {
        ChatX.event("message", d);
        Assistant.event("message", d);
        Received.event("message", d).catch(() => {
        });
        Outbox.ack(d).catch(() => {
        });
        if (S.active === d.conversationId && !S.historyMode) {
          if (!S.messages.some((m) => m.id === d.id)) S.messages.push(d);
          renderMessages(true);
          markRead().catch(() => {
          });
        }
        if ((S.active !== d.conversationId || S.tab !== "messages" || Desktop.hidden()) && d.sender !== S.user.id && !ChatX.dnd() && (!S.conversations.find((c) => c.id === d.conversationId)?.muted || Mentions.applies(d))) {
          if (!NativeNotifications.active()) Sounds.notify();
          if (!NativeNotifications.active() && !Desktop.native && document.hidden && window.Notification?.permission === "granted") new Notification(S.friends.find((u) => u.id === d.sender)?.remark || d.name, { body: (Mentions.applies(d) ? "有人 @你：" : "") + preview(d), icon: "/assets/icon.svg", silent: true });
          document.title = Mentions.applies(d) ? "有人 @你 · " + APP_NAME : "新消息 · " + APP_NAME;
        }
        queueRefresh(true);
      } else if (event.type === "read") {
        Receipts.event(d);
        if (d.userId === S.user.id) queueRefresh(true);
      } else if (["message-updated", "reaction", "pins", "urgent", "status", "meeting-minutes"].includes(event.type)) {
        ChatX.event(event.type, d);
      } else if (["task", "event", "flags", "assistant-prefs"].includes(event.type)) {
        Work.event(event.type, d);
        Assistant.event(event.type, d);
      } else if (event.type.startsWith("doc-")) {
        Docs.event(event.type, d);
        if (event.type === "doc-access") Assistant.event(event.type, d);
      } else if (event.type === "profile") {
        Avatars.changed(d);
        queueRefresh();
      } else if (event.type === "recall") {
        applyRecall(d);
      } else if (event.type === "message-deleted") {
        applyDeletion(d);
      } else if (event.type === "typing") {
        if (d.conversationId === S.active && d.userId !== S.user.id && $("#typing-status")) {
          $("#typing-status").textContent = "对方正在输入…";
          $("#typing-status").dataset.presence = "";
          clearTimeout(typingTimer);
          typingTimer = setTimeout(showPresence, 3200);
        }
      } else if (event.type === "meeting-invite") {
        Meetings.invited(d);
      } else if (event.type === "meeting-ended") {
        Meetings.ended(d);
      } else if (event.type === "remote") {
        remoteEvent(d);
      } else if (event.type === "presence") {
        applyPresence(d);
      } else {
        queueRefresh();
      }
    };
    ws.onclose = (e) => {
      if (S.ws !== ws || !S.user || S.signingOut) return;
      if (e.code === 4001) {
        logout(false);
        toast("此设备已退出登录，请重新登录");
        return;
      }
      S.offline = true;
      connectionState();
      setTimeout(async () => {
        if (S.user && S.ws === ws) {
          try {
            await api("/api/me");
          } catch {
          }
          if (S.user && S.ws === ws) connectEvents();
        }
      }, 2500);
    };
  }
  function connectionState() {
    if (S.user && S.tab === "contacts") renderSidebar();
    const text = S.cacheSyncing ? "正在核对本机聊天记录…" : S.cacheView ? "离线查看 · 仅显示本机已缓存的记录" : S.offline ? "网络连接已断开，正在重新连接…" : "";
    for (const n of [$("#connection-status"), $(".sidebar-connection-status")]) if (n) n.innerHTML = text ? '<div class="connection-state" role="status">' + text + "</div>" : "";
  }
  async function logout(notify = true) {
    if (S.signingOut) return;
    const signingOutToken = S.token;
    pageHistory.length = 0;
    Sounds.reset();
    Screenshots.reset();
    Media.reset();
    Forwarding.reset(false);
    S.signingOut = true;
    Calls.stop();
    Me.stop();
    Updates.stop();
    Outbox.stop();
    Transfers.stop();
    Cloud.reset();
    Avatars.reset();
    Mentions.reset();
    Attachments.reset();
    Receipts.reset();
    Docs.reset();
    ChatX.reset();
    Work.reset();
    Assistant.reset();
    S.drafts = {};
    try {
      await NativeNotifications.stop().catch(() => {
      });
      Meetings.close();
      await Received.forget();
      if (notify) try {
        await action("/api/auth/logout");
      } catch {
      }
      S.user = null;
      const ws = S.ws;
      S.ws = null;
      ws?.close();
      S.token = "";
      if (localStorage.getItem("welink_token") === signingOutToken) localStorage.removeItem("welink_token");
      S.active = null;
      S.messages = [];
      S.conversations = [];
      S.myGroups = [];
      Directory.reset();
      S.friends = [];
      S.offline = false;
      S.cacheView = false;
      S.cacheSyncing = false;
      closeModal();
      stopRemote(false).catch(() => {
      });
      renderAuth();
    } finally {
      S.signingOut = false;
    }
  }
  function addFriend() {
    modal("查找用户", `<label for="find-user">${APP_NAME} 号码 / 姓名</label><input id="find-user" placeholder="输入 ${APP_NAME} 号码或姓名" autocomplete="off"><div id="user-results" class="member-select"><p class="hint">输入至少两个字符，找到想联系的人。</p></div>`);
    $("#find-user").oninput = (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value;
      searchTimer = setTimeout(async () => {
        try {
          const users = await api("/api/users?q=" + encodeURIComponent(q));
          const list = $("#user-results");
          if (!list) return;
          list.innerHTML = users.map((u) => `<div class="utility-row">${av(u)}<div class="body"><b>${esc3(u.name)}</b><p>${esc3(u.number || u.account)}</p></div><button class="secondary" data-start-chat="${u.id}">发消息</button><button class="icon-btn" data-user-call="${u.id}" data-user-call-mode="audio" title="语音通话">${icon("phone")}</button><button class="icon-btn" data-user-call="${u.id}" data-user-call-mode="video" title="视频通话">${icon("video")}</button></div>`).join("") || '<div class="empty-list">未找到用户</div>';
        } catch (e2) {
          modalError(e2);
        }
      }, 250);
    };
  }
  function requestFriend(id, name) {
    modal("添加 " + name, '<label for="request-message">验证消息</label><input id="request-message" maxlength="150" value="你好，我是 ' + esc3(S.user.name) + '">', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">发送申请</button>');
    modalHandler = async () => {
      await action("/api/requests", { userId: id, message: $("#request-message").value });
      closeModal();
      toast("好友申请已发送");
      await refresh();
    };
  }
  function createGroup() {
    modal("创建群聊", `<label for="group-name">群名称（选填）</label><input id="group-name" maxlength="60" placeholder="默认用你和第一位成员的名字命名"><label>选择好友</label><div class="member-select">${S.friends.map((u) => `<label class="check-row">${av(u)}${esc3(u.name)}<input type="checkbox" value="${u.id}" name="group-member"></label>`).join("") || '<p class="hint">请先查找用户。</p>'}</div>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">创建群聊</button>');
    modalHandler = async () => {
      const members = $$("input[name=group-member]:checked").map((x) => x.value);
      const c = await action("/api/conversations", { kind: "group", name: $("#group-name").value, members });
      closeModal();
      await refresh();
      selectConversation(c.id);
    };
  }
  function renderContactProfile() {
    const u = S.profile;
    $("#main-content").innerHTML = `<header class="chat-head">${btn("back", "返回", "back", "").replace('class="icon-btn"', 'class="icon-btn mobile-back"')}<h2>个人资料</h2></header><div class="contact-profile">${Contacts.profile(u)}</div>`;
  }
  async function showRequests() {
    modal("联系人通知", '<div class="inline-loading">正在读取…</div>', "", true);
    await refresh();
    $(".modal-body").innerHTML = S.requests.map((q) => `<div class="utility-row">${av(q)}<div class="body"><b>${esc3(q.name)}</b><p>${q.sender === S.user.id ? "我：" : ""}${esc3(q.message)}</p><p>${shortTime(q.created)}</p></div>${q.status === "pending" && q.recipient === S.user.id ? `<div class="request-actions"><button class="secondary" data-resolve="${q.id}" data-accept="false">拒绝</button><button class="primary" data-resolve="${q.id}" data-accept="true">同意</button></div>` : `<span class="muted">${{ pending: "等待验证", accepted: "已添加", rejected: "已拒绝", cancelled: "已取消" }[q.status]}</span>`}</div>`).join("") || '<div class="empty-list">暂无联系人通知</div>';
  }
  async function chatDetail() {
    if (activeConversation()?.kind === "group") {
      await Groups.detail();
      return;
    }
    const c = await api(`/api/conversations/${S.active}`), mine = c.owner === S.user.id, local = activeConversation();
    modal("聊天设置", `<div class="detail-members">${c.members.map((u) => `<div class="detail-member">${av(u)}<span>${esc3(u.name)}${u.id === c.owner && c.kind === "group" ? " · 群主" : ""}</span></div>`).join("")}</div>${c.kind === "group" ? `<label>群名称</label><input id="detail-name" value="${esc3(c.name)}" maxlength="60" ${mine ? "" : "disabled"}><label>群公告</label><textarea id="detail-notice" maxlength="2000" placeholder="暂无群公告" ${mine ? "" : "disabled"}>${esc3(c.announcement)}</textarea>` : ""}<button class="chat-history-entry" data-contact="edit" data-user="${local.peer?.id || ""}">联系人设置</button><button class="chat-history-entry" data-action="search-history">查找聊天记录</button><label class="prefs-row">置顶聊天<input type="checkbox" id="detail-pin" ${local.pinned ? "checked" : ""}></label><label class="prefs-row">消息免打扰<input type="checkbox" id="detail-mute" ${local.muted ? "checked" : ""}></label><button class="chat-remove-entry" data-conversation-action="remove" data-cid="${c.id}">${icon("trash")}从消息列表移除</button>`, `<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">保存</button>`);
    modalHandler = async () => {
      const p = { pinned: $("#detail-pin").checked, muted: $("#detail-mute").checked };
      if (c.kind === "group" && mine) {
        p.name = $("#detail-name").value;
        p.announcement = $("#detail-notice").value;
      }
      await api(`/api/conversations/${c.id}`, { method: "PATCH", body: p });
      closeModal();
      await refresh();
      renderMain();
      toast("已保存");
    };
  }
  async function inviteMembers() {
    const cid = S.active, c = await api(`/api/conversations/${cid}`);
    const list = S.friends.filter((u) => !c.members.some((m) => m.id === u.id));
    modal("邀请好友入群", `<div class="member-select">${list.map((u) => `<label class="check-row">${av(u)}${esc3(u.name)}<input type="checkbox" name="invite-member" value="${u.id}"></label>`).join("") || '<p class="hint">好友都已在群里。</p>'}</div>`, '<button class="primary" data-action="modal-submit">邀请</button>');
    modalHandler = async () => {
      await action(`/api/conversations/${cid}/members`, { members: $$("input[name=invite-member]:checked").map((x) => x.value) });
      closeModal();
      toast("已邀请好友入群");
    };
  }
  function searchHistory() {
    History.open();
  }
  async function renderFiles() {
    const n = $("#main-content");
    n.innerHTML = '<section class="utility"><h2>聊天文件</h2><div id="file-list" class="inline-loading">正在读取…</div></section>';
    const target = $("#file-list");
    try {
      const files = await api("/api/files"), list = $("#file-list");
      if (list !== target || S.tab !== "files") return;
      list.className = "";
      list.innerHTML = files.map((f) => `<div class="utility-row">${icon(f.mime.startsWith("image/") ? "image" : "file")}<div class="body"><b>${esc3(f.name)}</b><p>${bytes(f.size)} · ${fullTime(f.created)}</p></div>${btn("download", "下载", "download", `data-download="${f.id}" data-filename="${esc3(f.name)}"`)}${f.messageId ? btn("trash", "删除文件", "delete-chat-file", `data-mid="${f.messageId}" data-cid="${f.conversationId}" data-filename="${esc3(f.name)}"`) : ""}</div>`).join("") || '<div class="empty-list">发送和接收的文件会保存在这里</div>';
    } catch (e) {
      toast(e.message);
    }
  }
  async function renderFavorites() {
    $("#main-content").innerHTML = '<section class="utility"><h2>我的收藏</h2><div id="favorites-list" class="inline-loading">正在读取…</div></section>';
    try {
      const items = await api("/api/favorites"), list = $("#favorites-list");
      if (!list) return;
      list.className = "";
      list.innerHTML = items.map((m) => `<div class="utility-row">${av(m)}<div class="body"><b>${esc3(m.name)}</b><p>${esc3(preview(m))}</p><p>${fullTime(m.created)}</p>${m.kind === "voice" || m.kind === "video" ? `<div class="favorite-media">${Media.bubble(m)}</div>` : ""}${m.kind === "forward" ? `<button class="secondary" data-forward-view="${m.id}">查看聊天记录</button>` : ""}${m.attachmentId ? `<button class="secondary" data-download="${m.attachmentId}" data-filename="${esc3(m.fileName)}">下载附件</button>` : ""}</div>${btn("trash", "取消收藏", "unfavorite", `data-mid="${m.id}"`)}</div>`).join("") || '<div class="empty-list">在聊天中长按或右键消息，即可收藏</div>';
    } catch (e) {
      toast(e.message);
    }
  }
  async function openUserProfile(id) {
    modal("个人资料", '<div id="profile-loading" class="inline-loading">正在读取资料…</div>');
    const node = $("#profile-loading");
    try {
      const u = await api("/api/users/" + encodeURIComponent(id));
      if (!node.isConnected) return;
      modal("个人资料", '<div class="contact-profile">' + Contacts.profile({ ...S.friends.find((p) => p.id === id), ...u }) + "</div>");
    } catch (e) {
      if (node.isConnected) modalError(e);
    }
  }
  function profile(initial = {}) {
    const user = { ...S.user, ...initial };
    modal("编辑资料", `<div style="text-align:center;margin:5px 0 25px"><button class="avatar-edit-button" data-avatar="user" aria-label="更换头像">${av(S.user, "large")}<span class="avatar-edit-hint">更换头像</span></button></div><p class="hint">${APP_NAME} 账号：${esc3(user.number)}</p><button type="button" class="secondary status-entry" data-cx="status">个人状态：${esc3(S.myStatus?.label || "未设置")}</button><label>姓名</label><input id="profile-name" value="${esc3(user.name)}" maxlength="32"><label>手机号</label><input id="profile-phone" type="tel" autocomplete="tel" value="${esc3(user.phone || "")}" maxlength="32" placeholder="未设置"><label>性别</label><select id="profile-gender"><option value="">未设置</option>${[["male", "男"], ["female", "女"], ["other", "其他"]].map(([v, t]) => `<option value="${v}" ${user.gender === v ? "selected" : ""}>${t}</option>`).join("")}</select><label>职位</label><input id="profile-job" value="${esc3(user.jobTitle || "")}" maxlength="64" placeholder="未设置"><label>个性签名</label><input id="profile-bio" value="${esc3(user.bio)}" maxlength="150" placeholder="分享此刻的心情"><p class="hint">点击头像，从 100 个卡通头像中挑选，或上传自己的照片。</p>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">保存</button>');
    modalHandler = async () => {
      S.user = await api("/api/me", { method: "PATCH", body: { name: $("#profile-name").value, bio: $("#profile-bio").value, phone: $("#profile-phone").value, gender: $("#profile-gender").value, jobTitle: $("#profile-job").value, avatar: user.avatar } });
      closeModal();
      updateRail();
      if (S.tab === "profile") renderMyPage();
      toast("个人资料已更新");
    };
  }
  function renderMyPage() {
    $("#main-content").innerHTML = `<section class="utility"><div class="settings-body"><div class="contact-profile" style="padding:25px 0">${av(S.user, "large")}<h2>${esc3(S.user.name)}</h2><span class="profile-line">${APP_NAME} 号：${esc3(S.user.number || S.user.account)}</span></div><button class="utility-row" style="width:100%" data-action="profile">${icon("user")}<div class="body" style="text-align:left">个人资料</div>${icon("chevron")}</button><button class="utility-row" style="width:100%" data-cx="status">${icon("bell")}<div class="body" style="text-align:left">个人状态${S.myStatus?.label ? " · " + esc3(S.myStatus.label) : ""}</div>${icon("chevron")}</button><button class="utility-row" style="width:100%" data-nav="drive">${icon("cloud")}<div class="body" style="text-align:left">我的网盘</div>${icon("chevron")}</button><button class="utility-row" style="width:100%" data-nav="files">${icon("folder")}<div class="body" style="text-align:left">我的文件</div>${icon("chevron")}</button><button class="utility-row" style="width:100%" data-nav="favorites">${icon("star")}<div class="body" style="text-align:left">我的收藏</div>${icon("chevron")}</button>${S.config.platform === "android" ? '<button class="utility-row" style="width:100%" data-action="scan-qr"><div class="body" style="text-align:left">扫一扫 · 电脑登录</div></button>' : ""}<button class="utility-row" style="width:100%" data-action="settings">${icon("settings")}<div class="body" style="text-align:left">设置</div>${icon("chevron")}</button></div></section>`;
  }
  async function settings() {
    await Sounds.ready;
    modal("设置", `<label class="prefs-row">深色外观<input type="checkbox" id="pref-dark" ${document.body.classList.contains("dark") ? "checked" : ""}></label>${Desktop.native ? "" : '<label class="prefs-row">' + (window.WeLinkAndroid ? "手机消息通知" : "桌面消息通知") + '<button class="secondary" data-action="notifications">开启通知</button></label>'}${Sounds.row()}${window.WeLinkAndroid ? '<div class="prefs-row"><span>后台在线</span><button class="secondary" data-action="background">设置</button></div><p class="hint">离开 ' + APP_NAME + " 后，只要系统没有强制停止应用，仍会保持在线并接收消息。</p>" : ""}${Assistant.settingsRow()}${Desktop.settingsRow()}${Outbox.settingsRow()}${Received.settingsRow()}<div class="prefs-row"><span>账号与安全</span><button class="secondary" data-action="security">管理</button></div><div class="prefs-row"><span>联系人与隐私</span><button class="secondary" data-contact="privacy">管理</button></div><div class="prefs-row"><span>定时消息</span><button class="secondary" data-action="schedules">管理</button></div><div class="prefs-row"><span>当前版本</span><span>${CLIENT_VERSION} 正式版 <button class="text-btn" data-update-check>检查更新</button></span></div><div class="prefs-row"><span>服务器</span><span>${esc3(S.config.server || "本地")}</span></div><p class="hint">聊天记录保存在服务器，登录同一账号即可同步。<br>远程协助每次都需要对方明确同意。</p><button class="secondary" data-action="connection">连接设置</button> <button class="secondary" data-action="licenses">开源许可</button>`, `<button class="secondary danger" data-action="logout">退出登录</button><button class="primary" data-action="modal-submit">完成</button>`);
    modalHandler = async () => {
      applyTheme($("#pref-dark").checked);
      localStorage.setItem("welink_dark", String($("#pref-dark").checked));
      closeModal();
    };
  }
  function normalizeServer(value) {
    let v = value.trim().replace(/\/+$/, "");
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "http://" + v;
    const explicitPort = /^https?:\/\/(\[[^\]]+\]|[^/:]+):\d+$/i.test(v);
    try {
      const u = new URL(v);
      if (!explicitPort && u.protocol === "http:") u.port = "8250";
      return u.origin;
    } catch {
      return v;
    }
  }
  function connection() {
    let confirmed = false;
    modal("连接设置", `<label>服务器地址</label><input id="server-url" value="${esc3(S.config.server || "")}" placeholder="例如 192.168.1.10 或 chat.example.com" autocomplete="off" spellcheck="false"><p class="hint">填写管理员提供的服务器 IP 或域名即可，http:// 和默认端口 8250 会自动补全；留空则使用默认服务器。</p><label>HTTPS 证书指纹（可选）</label><input id="server-pin" value="${esc3(S.config.fingerprint || "")}" placeholder="64 位十六进制指纹"><p class="hint">证书指纹仅在使用 HTTPS 时需要。</p><p class="hint connection-check" id="server-check" role="status"></p>`, '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">连接</button>');
    $("#server-url").oninput = () => {
      confirmed = false;
      const note = $("#server-check");
      note.textContent = "";
      note.classList.remove("error");
      $(".modal [data-action=modal-submit]").textContent = "连接";
    };
    modalHandler = async () => {
      const server = normalizeServer($("#server-url").value), fingerprint = $("#server-pin").value.trim(), note = $("#server-check"), submit = $(".modal [data-action=modal-submit]");
      if (!confirmed) {
        note.classList.remove("error");
        note.textContent = "正在连接 " + (server || "默认服务器") + " …";
        try {
          await action("/local/config/check", { server, fingerprint });
        } catch (e) {
          note.classList.add("error");
          note.textContent = e.message + "。确认地址无误可点击“仍然保存”。";
          confirmed = true;
          submit.textContent = "仍然保存";
          return;
        }
      }
      const cfg = await action("/local/config", { server, fingerprint });
      S.config = cfg;
      closeModal();
      await logout(false);
      toast("已切换到 " + cfg.server + "，请登录");
    };
  }
  function contextMenu(x, y, items) {
    $(".context-menu")?.remove();
    const n = document.createElement("div");
    n.className = "context-menu";
    n.innerHTML = items;
    document.body.append(n);
    const r = n.getBoundingClientRect();
    n.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    n.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  }
  var menuSelection = "";
  function messageMenu(m, x, y, selection = "") {
    menuSelection = selection;
    contextMenu(x, y, (m.recalled ? "" : `${Mentions.menu(m)}${ChatX.menuItems(m)}${Work.menuItems(m)}<button data-action="quote" data-mid="${m.id}">${icon("reply")}引用</button>${m.kind === "voice" ? "" : `<button data-fw="single" data-mid="${m.id}">${icon("send")}转发</button>`}${selection ? `<button data-action="copy-selection">${icon("copy")}复制</button>` : m.kind === "text" ? `<button data-action="copy-message" data-mid="${m.id}">${icon("copy")}复制文字</button>` : ""}<button data-action="favorite" data-mid="${m.id}">${icon("star")}收藏</button>${m.sender === S.user.id && Date.now() - m.created < 864e5 ? `<button data-action="recall" data-mid="${m.id}">${icon("history")}撤回</button>` : ""}`) + `<button data-fw="select" data-mid="${m.id}">${icon("check")}多选</button><button class="destructive" data-action="delete-message" data-mid="${m.id}">${icon("trash")}删除</button>`);
  }
  function emojis() {
    const old = $(".popup");
    if (old) {
      old.remove();
      return;
    }
    ;
    const d = document.createElement("div");
    d.className = "popup";
    d.innerHTML = '<div class="emoji-heading"><span>表情</span><button class="emoji-close" data-action="close-emoji" aria-label="关闭表情">' + icon("close") + "</button></div>" + "😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 🥰 😍 🤩 😘 😋 😎 🥳 🤔 🤗 🤭 🤫 😴 😪 😮 😯 😳 😱 😢 😭 😤 😡 🤯 🥺 😇 💙 ❤️ 💛 💚 💜 ✨ 🌟 🎉 🎈 🎁 🌷 🌸 🍀 ☀️ 🌈 ☕ 🍰 🍉 🍎 🎵 💡 🔥 👍 👋 👏 🤝 🙏 💪 👌 ✅".split(" ").map((v) => `<button data-emoji="${v}">${v}</button>`).join("");
    $(".composer").append(d);
  }
  async function copyMessage(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw Error("复制失败，请重试");
    }
    toast("已复制");
  }
  function applyRecall(message) {
    Received.event("recall", message).catch(() => {
    });
    Mentions.invalidated(message.id);
    Media.invalidate(message.id);
    Forwarding.invalidate(message.id);
    const i = S.messages.findIndex((m) => m.id === message.id);
    if (i >= 0) S.messages[i] = message;
    for (const m of S.messages) if (m.reply?.id === message.id) m.reply = { ...m.reply, text: "", fileName: "", recalled: true };
    if (S.reply?.id === message.id) {
      S.reply = null;
      renderReply();
    }
    History.changed(message.id, true);
    renderMessages(true);
    if (S.tab === "files") renderFiles();
    queueRefresh();
  }
  function deleteChatFile(button) {
    const { mid, cid, filename } = button.dataset;
    modal("删除聊天文件", "<p>删除「" + esc3(filename) + '」及对应的文件消息？</p><p class="hint">会从你所有设备的聊天记录和文件列表中移除。对方的记录、你的收藏及已下载到设备的副本会保留。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary danger" data-action="modal-submit">删除</button>');
    modalHandler = async () => {
      await api("/api/messages/" + mid, { method: "DELETE" });
      applyDeletion({ id: mid, conversationId: cid });
      closeModal();
      toast("已删除聊天文件");
    };
  }
  function applyDeletion(message) {
    Received.event("message-deleted", message).catch(() => {
    });
    Mentions.invalidated(message.id);
    Media.invalidate(message.id);
    Forwarding.removed(message.id);
    if (S.active === message.conversationId) {
      S.messages = S.messages.filter((m) => m.id !== message.id);
      if (S.reply?.id === message.id) {
        S.reply = null;
        renderReply();
      }
      renderMessages(true);
    }
    History.changed(message.id);
    if (S.tab === "files") renderFiles();
    queueRefresh();
  }
  function deleteMessage(id) {
    const cid = S.active;
    modal("删除消息", '<p class="hint">删除后，这条消息将从你所有设备的聊天记录中移除。对方的记录和你已保存的收藏会保留。</p>', '<button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="modal-submit">删除</button>');
    modalHandler = async () => {
      await api("/api/messages/" + id, { method: "DELETE" });
      applyDeletion({ id, conversationId: cid });
      closeModal();
      toast("已删除消息");
    };
  }
  async function jumpMessage(cid, id) {
    const current = S.messages.find((m) => m.id === id);
    if (S.active !== cid || !current) {
      const messages = await api("/api/conversations/" + cid + "/messages?around=" + encodeURIComponent(id));
      S.active = cid;
      S.messages = messages;
      S.historyMode = true;
      S.tab = "messages";
      S.profile = null;
      S.reply = Outbox.replyPlaceholder(cid);
      renderShell();
      Outbox.restoreReply(cid).catch(() => {
      });
    }
    closeModal();
    const target = document.querySelector('[data-message="' + id + '"]');
    if (!target) throw Error("消息已删除或不可访问");
    target.scrollIntoView({ block: "center", behavior: "auto" });
    target.classList.remove("highlight-message");
    void target.offsetWidth;
    target.classList.add("highlight-message");
  }
  async function screenshot() {
    return Screenshots.start();
  }
  var RemoteDisplay = createRemoteWindow({ active: () => !!$(".remote-screen"), action, toast });
  function remoteChoices() {
    const c = activeConversation();
    if (c?.kind !== "direct") {
      toast("请在好友单聊中使用远程协助");
      return;
    }
    modal("远程协助", `<button class="remote-choice" data-invite-remote="control" data-direction="request">${icon("monitor")}<span><b>请求控制对方设备</b><p>对方同意后，帮助对方操作</p></span></button><button class="remote-choice" data-invite-remote="view" data-direction="request">${icon("video")}<span><b>请求观看对方屏幕</b><p>只看画面，不操作对方设备</p></span></button><button class="remote-choice" data-invite-remote="control" data-direction="share">${icon("contacts")}<span><b>邀请对方协助我</b><p>共享我的屏幕，允许对方操作</p></span></button><p class="hint">邀请会持续到接听、拒绝或取消。安卓共享需要系统屏幕录制授权，触控需要无障碍权限。</p>`);
  }
  async function ensureSharing() {
    if (S.config.platform === "android") {
      if (!window.WeLinkAndroid) throw Error("当前环境不支持 Android 屏幕共享");
      window.WeLinkAndroid.requestSharing();
      const deadline = Date.now() + 6e4;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        const s = await api("/local/remote/state");
        if (s.sharing) return s;
      }
      throw Error("屏幕共享未获授权");
    }
    return api("/local/remote/state");
  }
  async function schedules() {
    const list = await api("/api/schedules");
    const name = (id) => {
      const c = S.conversations.find((c2) => c2.id === id);
      return c ? c.kind === "direct" ? c.peer?.remark || c.peer?.name || c.name : c.name : "会话";
    };
    const repeat = { once: "一次", daily: "每天", weekdays: "工作日" };
    const fmt = (ms) => {
      const d = new Date(ms);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    };
    modal("定时消息", list.length ? '<div class="schedule-list">' + list.map((s) => '<div class="schedule-row"><div><b>' + esc3(name(s.conversationId)) + "</b><small>" + fmt(s.nextRun) + " · " + (repeat[s.repeat] || s.repeat) + (s.lastError ? " · 上次失败：" + esc3(s.lastError) : "") + "</small><p>" + (s.kind === "text" ? esc3(s.text) : s.kind === "image" ? "[图片]" : "[文件]") + '</p></div><button class="secondary danger" data-action="cancel-schedule" data-id="' + esc3(s.id) + '">取消</button></div>').join("") + "</div>" : '<p class="hint">暂无定时消息。可以让 Me 帮你设置，例如“每天 9 点给项目群发早安”。</p>', '<button class="primary" data-action="close-modal">完成</button>', true);
  }
  async function inviteRemote(mode, direction) {
    const local = direction === "share" ? await ensureSharing() : await api("/local/remote/state");
    const v = await action("/api/remotes", { conversationId: S.active, mode, direction, deviceId: local.deviceId });
    S.remote = v;
    closeModal();
    renderRemoteWait(v);
  }
  function renderRemoteWait(v) {
    modal("远程协助", `<div class="remote-invite">${av(activeConversation()?.peer || {}, "large")}<h3>等待对方接受邀请…</h3><p>邀请正在等待响应<br>你可以随时取消</p></div>`, '<button class="secondary" data-action="stop-remote">取消邀请</button>');
    clearTimeout(toastTimer);
  }
  async function remoteEvent(v) {
    if (!S.user) return;
    const key = "remote/" + v.id;
    if (v.state === "pending") {
      if (v.requester === S.user.id) return;
      Desktop.activity(key, v.recipient === S.user.id);
      if (v.recipient !== S.user.id) return;
      if (S.remote?.id === v.id) return;
      S.remote = v;
      if (S.config.platform === "windows" && typeof window.welinkTakeNativeInviteAction === "function") return;
      const from = S.friends.find((u) => u.id === v.requester) || { name: "好友" };
      modal("远程协助邀请", `<div class="remote-invite">${av(from, "large")}<h3>${esc3(from.name)}</h3><p>${v.host === S.user.id ? v.mode === "control" ? "请求观看并控制你的设备" : "请求观看你的屏幕" : "邀请你远程协助"}<br>同意后开始，随时可以结束</p></div>`, '<button class="secondary" data-action="reject-remote">拒绝</button><button class="primary" data-action="accept-remote">同意</button>');
      return;
    }
    ;
    Desktop.activity(key, false);
    window.WeLinkAndroid?.dismissNativeInvite?.("remote:" + v.id);
    if (S.remote?.id !== v.id) return;
    S.remote = v;
    if (v.state === "accepted") {
      clearTimeout(toastTimer);
      if (v.host !== S.user.id || v.requester === S.user.id) try {
        await startRemote(v);
      } catch (e) {
        toast(e.message);
        await stopRemote();
      }
    } else {
      await stopRemote(false);
      if (v.state === "rejected") toast("对方拒绝了远程邀请");
      else toast("远程协助已结束");
    }
  }
  async function acceptRemote(accept) {
    const v = S.remote;
    if (!v) return;
    let local;
    if (accept && v.host === S.user.id) local = await ensureSharing();
    const result = await action(`/api/remotes/${v.id}/respond`, { accept, deviceId: local?.deviceId || "" });
    S.remote = result;
    closeModal();
    if (accept) await startRemote(result);
    else S.remote = null;
  }
  async function startRemote(v) {
    await action("/local/remote/start", { id: v.id, token: S.token });
    closeModal();
    S.remote = v;
    clearInterval(S.remoteTimer);
    if (v.host !== S.user.id) showRemoteScreen();
    else renderSharing();
    S.remoteTimer = setInterval(remoteTick, 250);
    await remoteTick();
  }
  var remoteFailures = 0;
  var frameVersion = 0;
  var frameURL = "";
  var remoteTickBusy = false;
  var remoteFrameSeen = 0;
  var remoteFrameShown = 0;
  var remoteInput = null;
  var remoteFrameLoopToken = 0;
  function remoteFrameLoop() {
    const token = ++remoteFrameLoopToken, canvas = $("#remote-image");
    if (!canvas) return;
    runRemoteFrames(canvas, () => token === remoteFrameLoopToken && !!S.remote && canvas.isConnected, () => {
      $("#remote-loading")?.classList.add("hidden");
      fitRemoteActual(true);
    }, (error) => toast(error.message));
  }
  function fitRemoteActual(newFrame = false) {
    const c = $("#remote-image"), wrap = c?.parentElement;
    if (!wrap || !c.dataset.width) return;
    fitRemoteView(c, wrap, wrap.classList.contains("actual-size"), newFrame);
  }
  var remoteResize = null;
  async function remoteTick() {
    if (remoteTickBusy || !S.remote) return;
    remoteTickBusy = true;
    try {
      const state = await api("/local/remote/state");
      S.remoteLocal = state;
      const status = $("#remote-status");
      if (status) status.textContent = state.status === "connected" ? `${state.path === "p2p" ? "P2P 直连" : "加密中转"} · ${state.rtt} ms · 原画 ${state.width}×${state.height}` : state.error || "正在建立加密连接…";
      if (state.status === "ended") {
        const error = state.error;
        await stopRemote();
        if (error) toast(error);
        return;
      }
      remoteFailures = 0;
      $(".remote-screen")?.classList.toggle("is-connected", state.status === "connected");
    } catch (e) {
      if (++remoteFailures >= 12) {
        toast(e.message);
        await stopRemote(false);
      }
    } finally {
      remoteTickBusy = false;
    }
  }
  function renderSharing() {
    const sharing = S.remote?.state === "accepted" && S.user && S.remote.host === S.user.id;
    let pill = $("#remote-sharing-pill");
    if (!sharing) {
      pill?.remove();
      return;
    }
    const peer = S.friends.find((u) => u.id === (S.remote.requester === S.user.id ? S.remote.recipient : S.remote.requester));
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "remote-sharing-pill";
      pill.setAttribute("role", "status");
      document.body.append(pill);
    }
    const html = `<i class="live-dot"></i>${icon("monitor")}<span>${esc3(peer?.name || "对方")}${S.remote.mode === "control" ? " 正在远程控制你的设备" : " 正在观看你的屏幕"}</span><button data-action="stop-remote">结束共享</button>`;
    if (pill.dataset.html !== html) {
      pill.dataset.html = html;
      pill.innerHTML = html;
    }
  }
  function showRemoteScreen() {
    if ($(".remote-screen")) return;
    remoteFrameSeen = remoteFrameShown = 0;
    const node = document.createElement("section");
    node.className = "remote-screen";
    const remotePeer = S.friends.find((u) => u.id === S.remote?.host) || activeConversation()?.peer;
    node.innerHTML = `<header class="remote-toolbar">${icon("monitor")}<b>远程协助${remotePeer ? " · " + esc3(remotePeer.remark || remotePeer.name) : ""}</b><span class="remote-mode">${S.remote?.mode === "control" ? "可控制" : "仅观看"}</span><span id="remote-status" class="status">正在连接…</span><button class="secondary" data-action="remote-actual" aria-pressed="false" title="按原始像素 1:1 显示">1:1</button><button class="secondary" data-action="remote-fullscreen" aria-pressed="false">全屏</button>${S.config.platform !== "android" ? '<button class="secondary" data-action="remote-minimize" aria-label="最小化远程窗口">最小化</button>' : ""}<button class="primary" data-action="stop-remote">结束协助</button></header><div class="remote-canvas"><p id="remote-loading"><i class="remote-spinner"></i>正在等待对方画面…</p><canvas id="remote-image" tabindex="0" role="img" aria-label="远程设备屏幕"></canvas></div><div class="remote-touchbar"><button data-remote-key="Escape">返回</button><button data-remote-key="Home">主页</button><button data-action="remote-text">输入文字</button><button data-remote-key="Enter">回车</button></div>`;
    document.body.append(node);
    remoteResize?.disconnect();
    remoteResize = new ResizeObserver(() => fitRemoteActual());
    remoteResize.observe(node.querySelector(".remote-canvas"));
    node.querySelector(".remote-canvas").addEventListener("scroll", () => fitRemoteActual(), { passive: true });
    remoteFrameLoop();
    const img = $("#remote-image");
    let held = false;
    remoteInput = createRemoteInput((events) => action("/local/remote/input", { events }), () => action("/local/remote/release"), (e) => toast(e.message));
    const send = remoteInput.push;
    const point = (e) => remotePoint(e, img);
    let moveAt = 0;
    img.onpointerdown = (e) => {
      if (S.remote?.mode !== "control") return;
      e.preventDefault();
      img.focus();
      img.setPointerCapture(e.pointerId);
      held = true;
      send([point(e), { type: "down", button: e.button === 2 ? 3 : 1 }]);
    };
    img.onpointermove = (e) => {
      if (S.remote?.mode !== "control" || Date.now() - moveAt < 8) return;
      moveAt = Date.now();
      send([point(e)]);
    };
    img.onpointerup = (e) => {
      if (!held) return;
      held = false;
      send([point(e), { type: "up", button: e.button === 2 ? 3 : 1 }]);
    };
    img.onpointercancel = () => {
      held = false;
      remoteInput?.release();
    };
    img.oncontextmenu = (e) => e.preventDefault();
    img.onwheel = (e) => {
      if (S.remote?.mode !== "control") return;
      e.preventDefault();
      send([{ type: "wheel", deltaY: Math.round(e.deltaY), deltaX: Math.round(e.deltaX) }]);
    };
    img.onkeydown = (e) => {
      if (S.remote?.mode !== "control") return;
      e.preventDefault();
      send([{ type: "key_down", key: e.key, code: e.code }]);
    };
    img.onkeyup = (e) => {
      if (S.remote?.mode !== "control") return;
      e.preventDefault();
      send([{ type: "key_up", key: e.key, code: e.code }]);
    };
    img.onblur = () => remoteInput?.release();
  }
  async function stopRemote(notify = true) {
    remoteFrameLoopToken++;
    remoteInput?.close();
    remoteInput = null;
    const v = S.remote;
    S.remote = null;
    S.remoteLocal = null;
    clearInterval(S.remoteTimer);
    clearTimeout(toastTimer);
    S.remoteTimer = null;
    await RemoteDisplay.exit().catch(() => {
    });
    remoteResize?.disconnect();
    remoteResize = null;
    const rc = $("#remote-image");
    if (rc) disposeRemoteView(rc);
    $(".remote-screen")?.remove();
    frameVersion = 0;
    URL.revokeObjectURL(frameURL);
    frameURL = "";
    closeModal();
    renderSharing();
    try {
      await action("/local/remote/stop");
    } catch {
    }
    if (notify && v) try {
      await action(`/api/remotes/${v.id}/end`);
    } catch {
    }
  }
  async function download(id, name) {
    if (window.WeLinkAndroid) {
      window.WeLinkAndroid.downloadFile(fileURL(id), name || "文件");
      return;
    }
    const a = document.createElement("a");
    a.href = fileURL(id);
    a.download = name || "文件";
    document.body.append(a);
    a.click();
    a.remove();
  }
  document.addEventListener("click", async (e) => {
    const avatar = e.target.closest(".message .avatar[data-avatar-user],.detail-member .avatar[data-avatar-user]");
    if (avatar) {
      openUserProfile(avatar.dataset.avatarUser);
      return;
    }
    const b = e.target.closest("button,a,[data-preview-image]");
    $(".context-menu")?.remove();
    if (!b) return;
    try {
      if (b.dataset.nav) {
        navigatePage(b);
        return;
      }
      if (b.dataset.contactTab) {
        S.contactTab = b.dataset.contactTab;
        renderSidebar();
        return;
      }
      if (b.dataset.conversation) {
        await selectConversation(b.dataset.conversation);
        return;
      }
      if (b.dataset.profile) {
        if (b.dataset.profile === S.user.id) {
          await openUserProfile(S.user.id);
          return;
        }
        S.profile = S.friends.find((u) => u.id === b.dataset.profile);
        renderMain();
        $(".shell").classList.add("in-chat");
        const id = b.dataset.profile;
        const detail = await api("/api/users/" + id);
        if (S.tab === "contacts" && S.profile?.id === id) {
          S.profile = { ...S.profile, ...detail };
          renderMain();
        }
        return;
      }
      if (b.dataset.userCall) {
        closeModal();
        const c = await action("/api/conversations", { kind: "direct", members: [b.dataset.userCall] });
        await refresh();
        await selectConversation(c.id);
        await Calls.dial(c.id, b.dataset.userCallMode === "video" ? "video" : "audio");
        return;
      }
      if (b.dataset.startChat) {
        closeModal();
        const c = await action("/api/conversations", { kind: "direct", members: [b.dataset.startChat] });
        await refresh();
        await selectConversation(c.id);
        return;
      }
      if (b.dataset.requestUser) {
        requestFriend(b.dataset.requestUser, b.dataset.name);
        return;
      }
      if (b.dataset.resolve) {
        await action("/api/requests/" + b.dataset.resolve, { accept: b.dataset.accept === "true" });
        await showRequests();
        return;
      }
      if (b.dataset.color) {
        $$(".color-list button").forEach((x) => x.classList.toggle("selected", x === b));
        return;
      }
      if (b.dataset.emoji) {
        const input = $("#composer");
        const start = input.selectionStart;
        input.value = input.value.slice(0, start) + b.dataset.emoji + input.value.slice(input.selectionEnd);
        input.dispatchEvent(new Event("input"));
        input.focus();
        input.setSelectionRange(start + b.dataset.emoji.length, start + b.dataset.emoji.length);
        return;
      }
      if (b.dataset.inviteRemote) {
        await inviteRemote(b.dataset.inviteRemote, b.dataset.direction);
        return;
      }
      if (b.dataset.remoteKey) {
        await action("/local/remote/input", { events: [{ type: "key", key: b.dataset.remoteKey }] });
        return;
      }
      if (b.dataset.download) {
        if (!ChatX.previewFile(b.dataset.download, b.dataset.filename || "")) await download(b.dataset.download, b.dataset.filename);
        return;
      }
      if (b.dataset.previewImage) {
        $("#overlays").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><img class="image-preview" src="${fileURL(b.dataset.previewImage)}" alt="图片预览"></div>`;
        return;
      }
      const a = b.dataset.action;
      if (!a) return;
      $(".context-menu")?.remove();
      switch (a) {
        case "register":
          renderAuth(true);
          break;
        case "login":
          renderAuth(false);
          break;
        case "close-modal":
          if (S.remote?.state === "pending" && $(".remote-invite")) Navigation.back();
          else if (b.closest(".modal-footer") && b.textContent.trim() === "取消") Navigation.back();
          else finishModal();
          break;
        case "modal-back":
          Navigation.back();
          break;
        case "page-back":
          pageBack();
          break;
        case "modal-submit":
          if (modalHandler) {
            b.disabled = true;
            try {
              await modalHandler();
            } finally {
              b.disabled = false;
            }
          }
          break;
        case "window-min":
        case "window-max":
        case "window-close":
          await action("/local/window/" + a.slice(7));
          break;
        case "connection":
          connection();
          break;
        case "licenses": {
          const text = await (await fetch("/assets/licenses.txt")).text();
          modal("开源许可", '<pre class="license-text">' + esc3(text) + "</pre>", "", true);
          break;
        }
        case "profile":
          profile();
          break;
        case "settings":
          settings();
          break;
        case "logout":
          await logout();
          break;
        case "send":
          await sendMessage();
          break;
        case "back":
          pageBack();
          break;
        case "add-friend":
          addFriend();
          break;
        case "create-group":
          createGroup();
          break;
        case "requests":
          await showRequests();
          break;
        case "add-menu": {
          const r = b.getBoundingClientRect();
          contextMenu(r.left - 120, r.bottom + 5, `<button data-action="create-group">${icon("chat")}创建群聊</button>${S.config.platform === "android" ? '<button data-action="scan-qr">扫一扫</button>' : ""}`);
          break;
        }
        case "more-menu": {
          const r = b.getBoundingClientRect();
          contextMenu(r.left + 40, r.top - 80, `<button data-action="settings">${icon("settings")}设置</button><button data-action="logout">${icon("logout")}退出登录</button>${Desktop.exitMenu()}`);
          break;
        }
        case "emoji":
          emojis();
          break;
        case "close-emoji":
          $(".popup")?.remove();
          $("#composer")?.focus();
          break;
        case "image":
          $("#image-input").click();
          break;
        case "file":
          $("#file-input").click();
          break;
        case "screenshot":
          await screenshot();
          break;
        case "search-history":
          searchHistory();
          break;
        case "chat-detail":
          await chatDetail();
          break;
        case "invite-members":
          await inviteMembers();
          break;
        case "quote":
          S.reply = S.messages.find((m) => m.id === b.dataset.mid);
          Outbox.saveDraft().catch(() => {
          });
          renderReply();
          $("#composer")?.focus();
          break;
        case "cancel-reply":
          S.reply = null;
          Outbox.saveDraft().catch(() => {
          });
          renderReply();
          break;
        case "favorite":
          await action("/api/favorites/" + b.dataset.mid);
          toast("已收藏");
          break;
        case "unfavorite":
          await api("/api/favorites/" + b.dataset.mid, { method: "DELETE" });
          await renderFavorites();
          break;
        case "copy-message":
          await copyMessage(S.messages.find((m) => m.id === b.dataset.mid)?.text || "");
          break;
        case "copy-selection":
          await copyMessage(menuSelection);
          break;
        case "delete-chat-file":
          deleteChatFile(b);
          break;
        case "delete-message":
          deleteMessage(b.dataset.mid);
          break;
        case "jump-message":
          await jumpMessage(S.active, b.dataset.mid);
          break;
        case "latest-messages":
          await selectConversation(S.active);
          break;
        case "load-newer": {
          const cid = S.active, area = $("#messages"), top = area.scrollTop;
          const ms = await api(`/api/conversations/${cid}/messages?after=${S.messages[S.messages.length - 1].seq}`);
          if (S.active !== cid) break;
          if (!ms.length) {
            toast(S.cacheView ? "已到本机缓存的最新消息" : "已到最新消息");
            S.historyMode = false;
          } else S.messages.push(...ms.filter((m) => !S.messages.some((x) => x.id === m.id)));
          renderMessages(true);
          area.scrollTop = top;
          break;
        }
        case "recall": {
          const m = await action("/api/messages/" + b.dataset.mid + "/recall");
          applyRecall(m);
          break;
        }
        case "load-older": {
          const cid = S.active, seq = S.messages[0]?.seq;
          if (!cid || !seq) break;
          const older = await api(`/api/conversations/${cid}/messages?before=${seq}`);
          if (S.active !== cid || S.messages[0]?.seq !== seq) break;
          if (!older.length) {
            b.remove();
            toast(S.cacheView ? "没有更早的本机缓存，联网后可继续加载" : "已经是最早的消息");
            break;
          }
          const area = $("#messages"), h = area.scrollHeight;
          S.messages = [...older, ...S.messages];
          renderMessages(true);
          area.scrollTop = area.scrollHeight - h;
          break;
        }
        case "background":
          if (window.WeLinkAndroid?.requestBackgroundReliability) window.WeLinkAndroid.requestBackgroundReliability();
          else toast("当前版本无需设置");
          break;
        case "notifications":
          if (window.WeLinkAndroid) {
            window.WeLinkAndroid.requestNotifications();
            break;
          }
          if ("Notification" in window) {
            const p = await Notification.requestPermission();
            toast(p === "granted" ? "已开启桌面通知" : "通知权限未开启");
          }
          break;
        case "remote":
          remoteChoices();
          break;
        case "schedules":
          await schedules();
          break;
        case "cancel-schedule":
          await api("/api/schedules/" + b.dataset.id, { method: "DELETE" });
          toast("已取消");
          await schedules();
          break;
        case "accept-remote":
          b.disabled = true;
          await acceptRemote(true);
          break;
        case "reject-remote":
          await acceptRemote(false);
          break;
        case "stop-remote":
          await stopRemote();
          break;
        case "remote-fullscreen":
          await RemoteDisplay.toggle();
          break;
        case "remote-actual": {
          const on = $(".remote-canvas")?.classList.toggle("actual-size");
          b.setAttribute("aria-pressed", String(!!on));
          b.classList.toggle("on", !!on);
          fitRemoteActual();
          break;
        }
        case "remote-minimize":
          await RemoteDisplay.minimize();
          break;
        case "remote-text":
          modal("输入文字", '<textarea id="remote-text" placeholder="输入要发送到远程设备的文字"></textarea>', '<button class="primary" data-action="modal-submit">发送</button>');
          modalHandler = async () => {
            await action("/local/remote/input", { events: [{ type: "text", text: $("#remote-text").value }] });
            closeModal();
          };
          break;
      }
    } catch (err) {
      modalError(err);
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop") && (!S.remote || S.remote.state === "pending")) Navigation.back();
  });
  var selectionIn = (el) => {
    const s = getSelection();
    if (!s || s.isCollapsed || !String(s).trim()) return "";
    for (let i = 0; i < s.rangeCount; i++) if (s.getRangeAt(i).intersectsNode(el)) return String(s);
    return "";
  };
  var rightDownSelection = null;
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 2) return;
    const el = e.target.closest?.("[data-message]");
    rightDownSelection = el ? selectionIn(el) : null;
  }, true);
  document.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("[data-message]");
    if (el) {
      e.preventDefault();
      const m = S.messages.find((x) => x.id === el.dataset.message);
      const selection = rightDownSelection ?? selectionIn(el);
      rightDownSelection = null;
      if (m) messageMenu(m, e.clientX, e.clientY, selection);
    }
  });
  addEventListener("contextmenu", (e) => {
    if (window.WeLinkAndroid || e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : e.target?.parentElement;
    const field = t?.closest("textarea,input");
    const editable = field ? !field.disabled && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(field.type || "") : !!t?.isContentEditable;
    const sel = getSelection();
    let selected = false;
    if (sel && !sel.isCollapsed && String(sel).trim()) for (let i = 0; i < sel.rangeCount; i++) selected ||= sel.getRangeAt(i).intersectsNode(e.target);
    if (!editable && !selected) e.preventDefault();
  });
  bindLongPress("[data-message]", (node, x, y) => {
    const message = S.messages.find((m) => m.id === node.dataset.message);
    if (message) messageMenu(message, x, y);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".popup,[data-action=emoji]")) $(".popup")?.remove();
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (!Desktop.hidden()) {
      document.title = "" + APP_NAME;
      if (S.active && S.user) markRead().catch(() => {
      });
    } else action("/local/remote/release").catch(() => {
    });
  });
  document.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && window.welinkDrag && !e.target.closest("#overlays,#meeting-layer,button,input,textarea,a") && (e.target.closest(".chat-head") || e.clientY < 28)) window.welinkDrag();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && (!S.remote || S.remote.state === "pending") && Navigation.handleBack()) {
      e.preventDefault();
    }
  });
  window.addEventListener("storage", (event) => {
    if ((event.key === "welink_token" || event.key === null) && S.token && localStorage.getItem("welink_token") !== S.token) logout(false);
  });
  applyTheme(localStorage.getItem("welink_dark") === "true");
  var Directory = createDirectorySearch({ S, api, esc: esc3, av, icon, renderSidebar, contextMenu });
  var Received = createReceivedCache({ S, toast, modal, closeModal: finishModal, esc: esc3, bytes, connectionState, onReconciled: (cid, messages, ids, denied) => {
    if (S.active !== cid) return;
    const live = new Map(messages.map((m) => [m.id, m])), checked = new Set(ids);
    S.messages = denied ? [] : S.messages.filter((m) => !checked.has(m.id) || live.has(m.id)).map((m) => live.get(m.id) || m);
    if (S.reply && (denied || checked.has(S.reply.id) && (!live.has(S.reply.id) || live.get(S.reply.id).recalled))) {
      S.reply = null;
      renderReply();
    }
    renderMessages(true);
  } });
  var Transfers = createTransfers({ S, api, esc: esc3, av, bytes, randomID, renderMessages, queueRefresh, toast });
  var Cloud = createCloud({ S, api, modal, closeModal, toast, esc: esc3, icon, bytes, fullTime, upload: Transfers.upload });
  createConversationActions({ S, api, modal, closeModal, toast, esc: esc3, icon, contextMenu, refresh });
  var Media = createMedia({ S, api, action, modal, closeModal, toast, esc: esc3, icon, fileURL, randomID, renderMessages, queueRefresh, upload, enqueue: (...args) => Outbox.enqueue(...args) });
  var Desktop = createDesktop({ S, modal, closeModal: finishModal, toast, markRead, esc: esc3 });
  var Sounds = createMessageSounds({ toast, native: Desktop.native, hidden: Desktop.hidden });
  var Attachments = createAttachments({ S, esc: esc3, icon, bytes, toast });
  var Receipts = createReceipts({ S, api, esc: esc3, av, modal });
  function downloadURL(url, name) {
    if (window.WeLinkAndroid) {
      window.WeLinkAndroid.downloadFile(url, name);
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
  }
  function showDocsTab(id) {
    pageHistory.push({ state: { tab: S.tab, active: S.active, profile: S.profile, search: S.search } });
    closeModal();
    S.tab = "docs";
    S.search = "";
    S.profile = null;
    renderShell();
    Docs.open(id);
  }
  var Docs = createDocs({ S, api, esc: esc3, av, modal, closeModal, toast, downloadURL, showDocsTab, when: shortTime });
  var Screenshots = createScreenshots({ S, modal, closeModal, toast, esc: esc3, attach: (file, cid) => Attachments.add([file], cid) });
  var Avatars = createAvatars({ S, api, modal, closeModal, toast, esc: esc3, av, refresh, renderMessages, renderMain, updateRail, profile, groupDetail: (id) => Groups.detail(id) });
  var Mentions = createMentions({ S, api, esc: esc3, av, toast, jump: jumpMessage });
  sidebarResize();
  var Work = createWork({ S, api, esc: esc3, av, icon, modal, closeModal, toast, renderSidebar, openMessage, preview, meetingButton });
  var GlobalSearch = createGlobalSearch({ S, api, esc: esc3, av, icon, modal, closeModal, toast, openMessage, openChat, startChat, Docs, preview, whenText });
  var Assistant = createAssistant({ S, api, esc: esc3, av, icon, toast, openChat, openMessage, startChat, showWork, showTab, Docs, Work, closeModal });
  function showTab(tab) {
    pageHistory.length = 0;
    closeModal();
    S.tab = tab;
    S.search = "";
    S.profile = null;
    renderShell();
  }
  function showWork(view) {
    Work.setView(view);
    showTab("work");
  }
  async function openChat(cid) {
    if (S.tab !== "messages") {
      S.tab = "messages";
      S.search = "";
      S.profile = null;
      renderShell();
    }
    await selectConversation(cid);
  }
  async function openMessage(cid, mid) {
    closeModal();
    await jumpMessage(cid, mid);
  }
  async function startChat(user) {
    const c = await action("/api/conversations", { kind: "direct", members: [user] });
    await refresh();
    await openChat(c.id);
  }
  function meetingButton(code) {
    const b = document.createElement("button");
    b.dataset.meetingCode = code;
    b.hidden = true;
    document.body.append(b);
    b.click();
    b.remove();
  }
  var ChatX = createChatFeatures({ S, api, esc: esc3, av, icon, modal, closeModal, toast, renderMessages, jumpMessage, messageMenu, Received, fileURL, download, Docs, shortTime, Mentions, queueRefresh, showPresence });
  var Me = createMe({ S, api, action, esc: esc3, icon, modal, closeModal, toast, refresh, selectConversation, renderSidebar, remote: async (d) => {
    if (!d.conversationId) return;
    await selectConversation(d.conversationId);
    await inviteRemote(d.mode === "control" ? "control" : "view", d.direction === "share" ? "share" : "request");
  } });
  var Updates = createUpdates({ S, api, action, esc: esc3, toast });
  var Outbox = createOutbox({ onSent: (message) => Me.onSent(message), sendLarge: Transfers.chat, S, api, toast, esc: esc3, av, bytes, randomID, Mentions, renderMessages, renderReply, queueRefresh, modal, closeModal: finishModal });
  var Groups = createGroups({ S, api, action, modal, closeModal, toast, esc: esc3, icon, av, refresh, selectConversation, renderMain, copy: copyMessage, stopMedia: () => Media.reset() });
  var Contacts = createContacts({ S, api, action, modal, closeModal: finishModal, toast, esc: esc3, icon, av, refresh, renderSidebar, renderMain, stopMedia: () => Media.reset(), requestFriend, contextMenu });
  var Forwarding = createForwarding({ S, api, action, modal, closeModal, toast, esc: esc3, icon, av, preview, fullTime, bytes, fileURL, randomID, renderMessages, queueRefresh, mediaBubble: Media.bubble });
  var History = createHistory({ S, api, modal, toast, esc: esc3, preview, fullTime, jump: jumpMessage });
  var Meetings = createMeetings({ api, action, S, modal, closeModal, toast, esc: esc3, icon, av, Desktop, onCallClosed: (id) => Calls.mediaClosed(id), callCurrent: (id) => Calls.isCurrent(id), historyEntry: () => Calls.historyEntry() });
  var Calls = createCalls({ S, api, action, esc: esc3, av, icon, toast, modal, closeModal, randomID, Meetings, Desktop, renderMessages, queueRefresh, fullTime });
  async function nativeInviteEvent(event) {
    const n = event.detail;
    if (!S.user || !n || n.userId && n.userId !== S.user.id) return;
    if (n.type === "call") await Calls.changed(n);
    else if (n.type === "meeting") {
      if (n.state === "ended") Meetings.ended(n);
      else await Meetings.invited(n);
    } else if (n.type === "remote") await remoteEvent(n);
  }
  async function nativeInviteAction(event) {
    const { action: choice, notification: n } = event.detail || {};
    if (!S.user || !n || n.userId && n.userId !== S.user.id || !["accept", "reject"].includes(choice)) return;
    if (n.type === "call") {
      await Calls.nativeAction(n.id, choice === "accept");
      return;
    }
    if (n.type === "meeting") {
      await Meetings.nativeAction(n.code, choice === "accept");
      return;
    }
    if (n.type === "remote") {
      const current = await api("/api/remotes/" + n.id);
      if (current.state !== "pending") {
        await remoteEvent(current);
        return;
      }
      if (S.remote?.id !== current.id) await remoteEvent(current);
      if (S.remote?.id === current.id) await acceptRemote(choice === "accept");
    }
  }
  var nativeInviteQueue = Promise.resolve();
  window.addEventListener("welink-native-invite-event", (event) => {
    nativeInviteQueue = nativeInviteQueue.then(() => nativeInviteEvent(event)).catch((e) => toast(e.message));
  });
  window.addEventListener("welink-native-invite-action", (event) => {
    nativeInviteQueue = nativeInviteQueue.then(() => nativeInviteAction(event)).catch((e) => toast(e.message));
  });
  var Security = createSecurity({ api, action, S, modal, toast, esc: esc3, icon, logout });
  var QR = createQRLogin({ action, S, modal, toast, esc: esc3, enter, renderAuth, windows, logo, icon });
  var EmailAuth = createEmailAuth({ S, action, enter, QR, Desktop, windows, logo });
  async function loadRegistration() {
    try {
      const response = await Promise.race([fetch("/api/public-config"), new Promise((_, reject) => setTimeout(() => reject(Error("config timeout")), 4e3))]);
      if (!response.ok) return;
      const value = await response.json();
      applyBrand(value.appName, value.brandIcon).catch(() => {
      });
      S.registrationEnabled = !!value.registrationEnabled;
      S.emailAuthEnabled = true;
      const links = document.querySelector("#auth-form .auth-links");
      if (links && !S.user) {
        const button = links.querySelector("[data-action=register],[data-email-mode=register]");
        if (S.registrationEnabled && !button && !links.querySelector("[data-email-mode=login]")) {
          links.insertAdjacentHTML("afterbegin", '<button type="button" data-email-mode="register">注册账号</button>');
          links.querySelector("[data-email-mode=register]").onclick = () => EmailAuth.render("register", document.querySelector("#auth-form [name=email]")?.value || "");
        }
        if (!S.registrationEnabled) button?.remove();
      }
    } catch {
    }
  }
  var bootstrapping = false;
  async function bootstrap() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      S.config = await api("/local/config");
      loadRegistration();
      if (S.token) {
        try {
          S.user = await api("/api/me");
          await enter();
        } catch (error) {
          if (error.status === 401) {
            S.token = "";
            localStorage.removeItem("welink_token");
            renderAuth();
          } else throw error;
        }
      } else renderAuth();
    } catch (error) {
      Outbox.stop();
      S.user = null;
      $("#app").innerHTML = '<main class="auth-shell">' + windows() + '<section class="auth-card">' + logo() + '<h2>正在重新连接</h2><p class="subtitle">登录状态与本机草稿已保留</p><p class="auth-error">' + esc3(error.message) + '</p><button class="primary" id="retry-connect">立即重试</button><div class="auth-links"><button data-action="logout">返回登录</button><button data-action="connection">连接设置</button></div></section></main>';
      $("#retry-connect").onclick = bootstrap;
      setTimeout(() => {
        if ($("#retry-connect")) bootstrap();
      }, 1e4);
    } finally {
      bootstrapping = false;
    }
  }
  bootstrap();
  var fileDragDepth = 0;
  var fileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  document.addEventListener("dragenter", (e) => {
    if (!fileDrag(e) || !S.user) return;
    e.preventDefault();
    if (S.tab === "drive" || S.tab === "messages" && S.active) {
      fileDragDepth++;
      document.querySelector(".shell")?.classList.add("file-drop-active");
    }
  });
  document.addEventListener("dragover", (e) => {
    if (fileDrag(e)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
  });
  document.addEventListener("dragleave", (e) => {
    if (fileDrag(e) && --fileDragDepth <= 0) document.querySelector(".shell")?.classList.remove("file-drop-active");
  });
  document.addEventListener("drop", async (e) => {
    if (!fileDrag(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    document.querySelector(".shell")?.classList.remove("file-drop-active");
    const files = Array.from(e.dataTransfer.files || []), cid = S.active, owner2 = S.token;
    if (!S.user) return;
    if (S.tab === "drive") {
      await Cloud.sendFiles(files);
      return;
    }
    if (S.tab !== "messages" || !cid) {
      toast("请先打开聊天或网盘");
      return;
    }
    if (S.token === owner2) Attachments.add(files, cid);
  });
  var creatingGroups = /* @__PURE__ */ new Set();
  document.addEventListener("click", async (event) => {
    const b = event.target.closest("[data-create-group-user]");
    if (!b || !S.user) return;
    const id = b.dataset.createGroupUser;
    if (id === S.user.id || creatingGroups.has(id)) return;
    creatingGroups.add(id);
    try {
      const c = await action("/api/conversations", { kind: "group", members: [id] });
      closeModal();
      await refresh();
      await selectConversation(c.id);
    } catch (e) {
      toast(e.message);
    } finally {
      creatingGroups.delete(id);
    }
  });
})();
